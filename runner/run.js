#!/usr/bin/env node
'use strict'
// CLI entry of the standalone runner: executes a workflow script UNCHANGED
// against runner/harness.js with claude-driver subprocess agents. This is the
// fallback path when a Claude Code update breaks the (unstable) Workflow tool
// — degraded (no /workflows UI, no in-session permission prompts), not dead.
//
// Usage:
//   node runner/run.js <workflow.js> --args '<json>' [options]
//   node runner/run.js --resume <runId> [options]
//
// Options:
//   --args <json> | --args-file <path>   workflow args (object)
//   --budget <n>            output-token target (budget.total; default none)
//   --concurrency <n>       max concurrent agents (default min(16, cpus-2))
//   --permission-mode <m>   passed to `claude -p` (default: user settings)
//   --skip-permissions      passes --dangerously-skip-permissions (read
//                           docs/security.md "Standalone runner" first)
//   --grant-agent-tools     allowlist each agent's frontmatter tools
//   --agent-timeout <sec>   per-agent wall clock (default 3600)
//   --claude-cmd <cmd>      claude executable (default "claude")
//   --runs-dir <dir>        run-state root (default <configDir>/codeswarm-runs)
//
// Every run persists its launch-time script copy, args and journal under the
// run dir, so --resume always replays against the exact launch version
// (the same discipline codeswarm:swarm-resume prescribes for the Workflow
// tool). Completed agents replay free; null results re-run live.
// Progress goes to stderr; stdout is exactly one JSON result line.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { createHarness, runScript } = require('./harness')
const { createDriver } = require('./claude-driver')
const { createJournal, loadEntries } = require('./journal')

function fail (msg) { console.error(`runner: ${msg}`); process.exit(1) }

function parseArgv (argv) {
  const o = { flags: {}, positional: [] }
  const takesValue = new Set(['--args', '--args-file', '--resume', '--budget', '--concurrency',
    '--permission-mode', '--agent-timeout', '--claude-cmd', '--runs-dir'])
  const boolean = new Set(['--skip-permissions', '--grant-agent-tools'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (takesValue.has(a)) {
      if (argv[i + 1] === undefined) fail(`${a} needs a value`)
      o.flags[a] = argv[++i]
    } else if (boolean.has(a)) {
      o.flags[a] = true
    } else if (a.startsWith('--')) {
      fail(`unknown option ${a}`)
    } else {
      o.positional.push(a)
    }
  }
  return o
}

function main () {
  const { flags, positional } = parseArgv(process.argv.slice(2))
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const runsDir = flags['--runs-dir'] || path.join(configDir, 'codeswarm-runs')

  let runId, runDir, scriptPath, args
  if (flags['--resume']) {
    runId = flags['--resume']
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) fail('invalid run id')
    runDir = path.join(runsDir, runId)
    scriptPath = path.join(runDir, 'script.js')
    if (!fs.existsSync(scriptPath)) fail(`no saved run at ${runDir}`)
    args = JSON.parse(fs.readFileSync(path.join(runDir, 'args.json'), 'utf8'))
  } else {
    scriptPath = positional[0]
    if (!scriptPath) fail('usage: node runner/run.js <workflow.js> --args \'<json>\' | --resume <runId>')
    if (!fs.existsSync(scriptPath)) fail(`script not found: ${scriptPath}`)
    const rawArgs = flags['--args-file'] ? fs.readFileSync(flags['--args-file'], 'utf8') : (flags['--args'] ?? 'null')
    try { args = JSON.parse(rawArgs) } catch { fail('--args / --args-file must be valid JSON') }
    runId = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`
    runDir = path.join(runsDir, runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(runDir, 'script.js')) // launch-time version, for resume
    fs.writeFileSync(path.join(runDir, 'args.json'), JSON.stringify(args, null, 2) + '\n')
  }

  const source = fs.readFileSync(path.join(runDir, 'script.js'), 'utf8')
  const journalFile = path.join(runDir, 'journal.jsonl')
  const journal = createJournal(journalFile, flags['--resume'] ? loadEntries(journalFile) : [])
  if (flags['--resume']) console.error(`runner: resuming ${runId} — ${journal.cachedCount()} completed agent(s) replay from journal`)

  const onEvent = e => {
    if (e.type === 'phase') console.error(`runner: phase ${e.title}`)
    else if (e.type === 'log') console.error(`runner: ${e.message}`)
    else if (e.type === 'agent-start') console.error(`runner: agent ${e.label ?? e.id} started`)
    else if (e.type === 'agent-cached') console.error(`runner: agent ${e.label ?? e.id} replayed from journal`)
    else if (e.type === 'agent-done') console.error(`runner: agent ${e.label ?? e.id} done (${e.outputTokens} output tokens${e.nullResult ? ', NULL result' : ''})`)
    else if (e.type === 'agent-error') console.error(`runner: agent ${e.label ?? e.id} errored: ${e.error}`)
    else if (e.type === 'driver') console.error(`runner: [driver ${e.label ?? ''}] ${e.note}`)
  }

  const driver = createDriver({
    pluginDir: path.resolve(__dirname, '..'),
    claudeCmd: flags['--claude-cmd'],
    permissionMode: flags['--permission-mode'],
    skipPermissions: !!flags['--skip-permissions'],
    grantAgentTools: !!flags['--grant-agent-tools'],
    timeoutMs: (Number(flags['--agent-timeout']) || 3600) * 1000,
    onEvent,
  })
  const harness = createHarness({
    driver,
    budgetTotal: flags['--budget'] ? Number(flags['--budget']) : null,
    concurrency: Number(flags['--concurrency']) || Math.min(16, Math.max(1, os.cpus().length - 2)),
    journal,
    onEvent,
  })

  runScript(source, args, harness).then(({ result, meta }) => {
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify({ runId, workflow: (meta && meta.name) ?? null, ok: true, result }))
  }, e => {
    // script threw (bad args, budget ceiling, ...) — journal survives for --resume
    console.error(`runner: run failed: ${String((e && e.message) || e)}`)
    console.log(JSON.stringify({ runId, ok: false, error: String((e && e.message) || e) }))
    process.exitCode = 1
  })
}

main()
