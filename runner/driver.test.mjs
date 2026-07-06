// Unit tests for the pure helpers of runner/claude-driver.js — validation,
// JSON extraction, prompt composition, argv building, payload parsing and
// agent-md loading. No subprocess is ever spawned here; the live path is
// proved by /codeswarm:swarm smoke on the standalone runner.
// Run: node --test runner/driver.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate, extractJson, composePrompt, buildArgv, parsePayload, loadAgentMd } from './claude-driver.js'

// --- validate ----------------------------------------------------------------

const FINDINGS = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'line', 'severity'],
        properties: {
          file: { type: 'string' }, line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
        },
      },
    },
  },
}

test('validate: conforming object passes', () => {
  assert.deepEqual(validate(FINDINGS, { findings: [{ file: 'a.js', line: 3, severity: 'major' }] }), [])
})

test('validate: missing required, wrong types, bad enum are all reported with paths', () => {
  const errs = validate(FINDINGS, { findings: [{ file: 1, line: 1.5, severity: 'urgent' }] })
  assert.ok(errs.some(e => e.includes('findings[0].file') && e.includes('string')))
  assert.ok(errs.some(e => e.includes('findings[0].line') && e.includes('integer')))
  assert.ok(errs.some(e => e.includes('findings[0].severity')))
})

test('validate: non-object where object expected fails; extra keys are allowed', () => {
  assert.ok(validate(FINDINGS, 'nope').length)
  assert.deepEqual(validate(FINDINGS, { findings: [], extra: true }), [])
})

test('validate: pattern on strings', () => {
  const s = { type: 'string', pattern: '^[a-z-]+$' }
  assert.deepEqual(validate(s, 'my-agent'), [])
  assert.ok(validate(s, 'My Agent').length)
})

// --- extractJson ----------------------------------------------------------------

test('extractJson: bare, fenced and prose-wrapped JSON all parse', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('Here you go:\n{"a":{"b":2}}\nDone.'), { a: { b: 2 } })
  assert.equal(extractJson('no json here'), undefined)
})

// --- composePrompt ----------------------------------------------------------------

test('composePrompt: agent body leads, schema contract trails, plain prompt stays bare', () => {
  const p = composePrompt('task', { schema: { type: 'object' } }, 'You are a reviewer.')
  assert.ok(p.startsWith('AGENT DEFINITION'))
  assert.ok(p.includes('task'))
  assert.ok(p.includes('OUTPUT CONTRACT'))
  assert.equal(composePrompt('task', {}, null), 'task')
})

// --- buildArgv ----------------------------------------------------------------

test('buildArgv: base flags; model, permission mode and tool grants are opt-in', () => {
  assert.deepEqual(buildArgv({}, {}), ['-p', '--output-format', 'json'])
  assert.deepEqual(
    buildArgv({ model: 'sonnet', _tools: ['Read', 'Grep'] }, { permissionMode: 'acceptEdits', grantAgentTools: true }),
    ['-p', '--output-format', 'json', '--model', 'sonnet', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Grep'])
})

test('buildArgv: without grantAgentTools the frontmatter tools are NOT allowlisted', () => {
  assert.ok(!buildArgv({ _tools: ['Bash'] }, {}).includes('--allowedTools'))
})

test('buildArgv: skipPermissions maps to the dangerously flag', () => {
  assert.ok(buildArgv({}, { skipPermissions: true }).includes('--dangerously-skip-permissions'))
})

// --- parsePayload ----------------------------------------------------------------

test('parsePayload: claude -p json reply yields text + usage tokens', () => {
  const out = JSON.stringify({ type: 'result', is_error: false, result: 'hello', usage: { output_tokens: 42 } })
  assert.deepEqual(parsePayload(out), { text: 'hello', outputTokens: 42, isError: false })
})

test('parsePayload: is_error surfaces; non-JSON stdout degrades to raw text + estimate', () => {
  assert.equal(parsePayload(JSON.stringify({ result: 'x', is_error: true })).isError, true)
  const r = parsePayload('plain text output')
  assert.equal(r.text, 'plain text output')
  assert.ok(r.outputTokens > 0)
  assert.equal(r.isError, false)
})

// --- loadAgentMd ----------------------------------------------------------------

test('loadAgentMd: strips frontmatter, returns body + parsed tools; bad names throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codeswarm-driver-'))
  mkdirSync(join(dir, 'agents'))
  writeFileSync(join(dir, 'agents', 'my-tester.md'),
    '---\nname: my-tester\ndescription: d\ntools: Read, Grep, Bash\n---\n\nYou are a tester.\n')
  const a = loadAgentMd(dir, 'codeswarm:my-tester')
  assert.equal(a.body, 'You are a tester.')
  assert.deepEqual(a.tools, ['Read', 'Grep', 'Bash'])
  assert.throws(() => loadAgentMd(dir, 'codeswarm:../../etc/passwd'), /invalid agentType/)
  assert.throws(() => loadAgentMd(dir, 'codeswarm:does-not-exist'), /ENOENT/)
})
