// Pipe/CLI tests for tools/record-eval.js: runs the real script as a child
// process against a temp CLAUDE_CONFIG_DIR and asserts the log append, the
// key-preserving lastSmokeVersion write and the running totals.
// Run: node --test tools/record-eval.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'record-eval.js')
const freshDir = () => mkdtempSync(join(tmpdir(), 'codeswarm-record-eval-'))
const run = (dir, args = [], input) =>
  spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    input, encoding: 'utf8',
  })
const graded = over => JSON.stringify({
  claudeCode: '2.1.201', fixture: '/fx/eval', pass: true,
  missed: 0, unexpected: 0, baselineMissed: 0, baselineUnexpected: 0,
  confirmed: 5, raw: 5, outputTokens: 13000, ...over,
})
const logLines = dir => readFileSync(join(dir, 'codeswarm-eval-log.jsonl'), 'utf8').split('\n').filter(Boolean)

test('graded pass: appends a dated log line and updates lastSmokeVersion preserving other keys', () => {
  const dir = freshDir()
  writeFileSync(join(dir, 'codeswarm.json'), JSON.stringify({ alwaysOn: true, topModel: 'sonnet' }))
  const r = run(dir, [graded()])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.logged, true)
  assert.equal(out.lastSmokeVersion, 'updated')
  assert.equal(out.runs, 1)
  const line = JSON.parse(logLines(dir)[0])
  assert.match(line.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(line.claudeCode, '2.1.201')
  assert.equal(line.outputTokens, 13000)
  const config = JSON.parse(readFileSync(join(dir, 'codeswarm.json'), 'utf8'))
  assert.equal(config.lastSmokeVersion, '2.1.201')
  assert.equal(config.alwaysOn, true, 'other keys preserved')
  assert.equal(config.topModel, 'sonnet', 'other keys preserved')
})

test('graded FAIL: appends the log line but never touches the version', () => {
  const dir = freshDir()
  writeFileSync(join(dir, 'codeswarm.json'), JSON.stringify({ lastSmokeVersion: '1.0.0' }))
  const r = run(dir, [graded({ pass: false, missed: 2 })])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.lastSmokeVersion, 'skipped (failing run)')
  assert.equal(logLines(dir).length, 1)
  assert.equal(JSON.parse(readFileSync(join(dir, 'codeswarm.json'), 'utf8')).lastSmokeVersion, '1.0.0')
})

test('config absent: log still written, version skipped silently', () => {
  const dir = freshDir()
  const r = run(dir, [graded()])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.match(out.lastSmokeVersion, /^skipped/)
  assert.equal(logLines(dir).length, 1)
  assert.equal(existsSync(join(dir, 'codeswarm.json')), false, 'never invents a config file')
})

test('--smoke-pass: updates the version only, no log line', () => {
  const dir = freshDir()
  writeFileSync(join(dir, 'codeswarm.json'), JSON.stringify({ alwaysOn: false }))
  const r = run(dir, ['--smoke-pass', '2.2.0'])
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.logged, false)
  assert.equal(out.lastSmokeVersion, 'updated')
  assert.equal(existsSync(join(dir, 'codeswarm-eval-log.jsonl')), false)
  assert.equal(JSON.parse(readFileSync(join(dir, 'codeswarm.json'), 'utf8')).lastSmokeVersion, '2.2.0')
})

test('running totals accumulate the verified-vs-baseline delta across runs', () => {
  const dir = freshDir()
  run(dir, [graded({ baselineUnexpected: 3, unexpected: 1 })])
  const r = run(dir, [graded({ pass: false, missed: 1, baselineMissed: 0 })])
  const out = JSON.parse(r.stdout)
  assert.equal(out.runs, 2)
  assert.equal(out.falsePositivesKilled, 2)
  assert.equal(out.realBugsWronglyRejected, 1)
})

test('JSON on stdin works too', () => {
  const dir = freshDir()
  const r = run(dir, [], graded())
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).logged, true)
})

test('invalid input fails loud and writes nothing', () => {
  const dir = freshDir()
  const missing = run(dir, [JSON.stringify({ claudeCode: '2.1.201' })])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /must be a/)
  const garbage = run(dir, [], 'not json')
  assert.notEqual(garbage.status, 0)
  const badVersion = run(dir, ['--smoke-pass', 'nope'])
  assert.notEqual(badVersion.status, 0)
  assert.equal(existsSync(join(dir, 'codeswarm-eval-log.jsonl')), false)
})
