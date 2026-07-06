'use strict'
// Agent driver for the standalone runner: one `claude -p` subprocess per
// agent() call — the PUBLIC headless interface, not the (unstable) Workflow
// tool. The prompt travels on stdin (no argv quoting hazards, win32 .cmd
// included); argv carries only simple flag tokens. Structured output is
// enforced here: schema directive in the prompt, minimal JSON-Schema
// validation on the reply, ONE retry with the violations quoted, then null
// (contract C1). Permission model: docs/security.md "Standalone runner".
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// --- pure helpers (unit-tested in runner/driver.test.mjs) ------------------

// minimal validator for the subset the workflow schemas use:
// type object/array/string/integer/number/boolean, required, enum, pattern
function validate (schema, value, at = '$') {
  const errs = []
  if (!schema || typeof schema !== 'object') return errs
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) errs.push(`${at}: expected one of ${schema.enum.join('|')}`)
    return errs
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) { errs.push(`${at}: expected object`); return errs }
      for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${at}.${k}: required property missing`)
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        if (k in value) errs.push(...validate(sub, value[k], `${at}.${k}`))
      }
      return errs
    }
    case 'array': {
      if (!Array.isArray(value)) { errs.push(`${at}: expected array`); return errs }
      if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${at}[${i}]`)))
      return errs
    }
    case 'string':
      if (typeof value !== 'string') errs.push(`${at}: expected string`)
      else if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match pattern ${schema.pattern}`)
      return errs
    case 'integer':
      if (!Number.isInteger(value)) errs.push(`${at}: expected integer`)
      return errs
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) errs.push(`${at}: expected number`)
      return errs
    case 'boolean':
      if (typeof value !== 'boolean') errs.push(`${at}: expected boolean`)
      return errs
    default:
      return errs
  }
}

// model reply → JSON object: direct parse, then fenced block, then the
// outermost {...} span; undefined = unparseable
function extractJson (text) {
  const t = String(text ?? '').trim()
  const candidates = [t]
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t)
  if (fence) candidates.push(fence[1].trim())
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(t.slice(first, last + 1))
  for (const c of candidates) {
    try { return JSON.parse(c) } catch { /* next candidate */ }
  }
  return undefined
}

// agentType 'codeswarm:name' → agents/name.md in the plugin clone; the md
// BODY becomes standing instructions inline in the prompt (the headless CLI
// has no per-call agent registry). Missing file throws — a config error must
// be loud, the harness turns it into a null result.
function loadAgentMd (pluginDir, agentType) {
  const name = String(agentType).replace(/^[^:]*:/, '')
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid agentType "${agentType}"`)
  const file = path.join(pluginDir, 'agents', `${name}.md`)
  const md = fs.readFileSync(file, 'utf8')
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  const body = fm ? md.slice(fm[0].length) : md
  const toolsLine = fm && /^tools:\s*(.+)$/m.exec(fm[1])
  const tools = toolsLine ? toolsLine[1].split(',').map(s => s.trim()).filter(Boolean) : null
  return { body: body.trim(), tools }
}

function composePrompt (prompt, opts, agentBody) {
  const parts = []
  if (agentBody) parts.push(`AGENT DEFINITION (your standing instructions):\n${agentBody}\n---`)
  parts.push(prompt)
  if (opts.schema) {
    parts.push('OUTPUT CONTRACT: your FINAL message must be EXACTLY one JSON object matching this JSON Schema — no markdown fences, no prose before or after it:\n' + JSON.stringify(opts.schema))
  }
  return parts.join('\n\n')
}

// argv stays shell-safe simple tokens (win32 spawns via shell to resolve
// claude.cmd); anything free-form goes over stdin instead
function buildArgv (opts, cfg) {
  const argv = ['-p', '--output-format', 'json']
  if (opts.model) argv.push('--model', String(opts.model))
  if (cfg.permissionMode) argv.push('--permission-mode', String(cfg.permissionMode))
  if (cfg.skipPermissions) argv.push('--dangerously-skip-permissions')
  if (cfg.grantAgentTools && opts._tools && opts._tools.length) argv.push('--allowedTools', opts._tools.join(','))
  return argv
}

// `claude -p --output-format json` reply → { text, outputTokens, isError };
// unparseable stdout degrades to raw text + a length-based token estimate
function parsePayload (stdout) {
  let o
  try { o = JSON.parse(stdout) } catch { /* not JSON */ }
  if (!o || typeof o !== 'object') {
    const text = String(stdout ?? '')
    return { text, outputTokens: Math.ceil(text.length / 4), isError: false }
  }
  const text = typeof o.result === 'string' ? o.result : JSON.stringify(o.result ?? '')
  const outputTokens = Number(o.usage && o.usage.output_tokens) || Math.ceil(text.length / 4)
  return { text, outputTokens, isError: o.is_error === true }
}

// --- subprocess -------------------------------------------------------------

// with a shell in play (win32, to resolve claude.cmd) every argv token must be
// provably inert — model names, permission modes and tool lists all fit this
const SAFE_ARG = /^[A-Za-z0-9._:@/,-]+$/

function spawnClaude (cmd, argv, input, timeoutMs) {
  return new Promise(resolve => {
    const win = process.platform === 'win32'
    if (win) {
      const unsafe = argv.find(a => !SAFE_ARG.test(a))
      if (unsafe) { resolve({ code: -1, stdout: '', stderr: `refusing shell-unsafe argv token: ${unsafe}`, timedOut: false }); return }
    }
    const child = win
      ? spawn(`"${cmd}" ${argv.join(' ')}`, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timer = null
    let settled = false
    const done = (code, timedOut) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut: !!timedOut })
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => { child.kill(); done(-1, true) }, timeoutMs)
    }
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', e => { stderr += String(e); done(-1) })
    child.on('close', code => done(code ?? -1))
    child.stdin.on('error', () => {}) // EPIPE when the child dies early
    child.stdin.end(input)
  })
}

// cfg: { pluginDir, claudeCmd, permissionMode, skipPermissions,
//        grantAgentTools, timeoutMs, onEvent }
function createDriver (cfg) {
  const claudeCmd = cfg.claudeCmd || 'claude'
  const timeoutMs = cfg.timeoutMs ?? 3600_000
  const emit = e => { try { (cfg.onEvent || (() => {}))(e) } catch { /* ignore */ } }

  return async function drive (prompt, opts) {
    const agentMd = opts.agentType ? loadAgentMd(cfg.pluginDir, opts.agentType) : null
    const base = composePrompt(prompt, opts, agentMd && agentMd.body)
    const argv = buildArgv({ ...opts, _tools: agentMd && agentMd.tools }, cfg)
    let outputTokens = 0
    let feedback = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { code, stdout, stderr, timedOut } = await spawnClaude(claudeCmd, argv, base + feedback, timeoutMs)
      if (timedOut) { emit({ type: 'driver', label: opts.label, note: `attempt ${attempt} timed out` }); continue }
      const payload = parsePayload(stdout)
      outputTokens += payload.outputTokens
      if (code !== 0 || payload.isError) {
        emit({ type: 'driver', label: opts.label, note: `attempt ${attempt} failed (exit ${code}): ${String(stderr).slice(0, 200)}` })
        continue
      }
      if (!opts.schema) return { result: payload.text, outputTokens }
      const obj = extractJson(payload.text)
      const errs = obj === undefined ? ['final message was not parseable JSON'] : validate(opts.schema, obj)
      if (!errs.length) return { result: obj, outputTokens }
      emit({ type: 'driver', label: opts.label, note: `attempt ${attempt} schema-invalid: ${errs.slice(0, 5).join('; ')}` })
      feedback = `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED — schema violations:\n${errs.join('\n')}\nReturn ONLY the corrected JSON object.`
    }
    return { result: null, outputTokens }
  }
}

module.exports = { createDriver, validate, extractJson, composePrompt, buildArgv, parsePayload, loadAgentMd }
