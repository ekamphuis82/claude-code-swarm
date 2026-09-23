// Pipe/CLI tests for tools/record-eval.js: runs the real script as a child
// process against a temp CLAUDE_CONFIG_DIR and asserts the log append, the
// key-preserving lastSmokeVersion write and the running totals.
// Run: node --test tools/record-eval.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'record-eval.js')
// every sandbox is removed afterwards: leftover codeswarm-record-eval-* dirs once
// read as stray eval logs during an evidence hunt
const dirs = []
const freshDir = () => { const d = mkdtempSync(join(tmpdir(), 'codeswarm-record-eval-')); dirs.push(d); return d }
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
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

test('optional run conditions are stored; date, host and pluginVersion are stamped', () => {
  const dir = freshDir()
  const r = run(dir, [graded({
    workflow: 'review', rigor: 'full', verify: 'strict', finderModel: 'opus', verifyModel: 'sonnet',
    notes: 'suspicion-biased target', missedInconclusive: 0, unexpectedInconclusive: 2,
  })])
  assert.equal(r.status, 0, r.stderr)
  const line = JSON.parse(logLines(dir)[0])
  assert.equal(line.workflow, 'review')
  assert.equal(line.rigor, 'full')
  assert.equal(line.verify, 'strict')
  assert.equal(line.finderModel, 'opus')
  assert.equal(line.verifyModel, 'sonnet')
  assert.equal(line.notes, 'suspicion-biased target')
  assert.equal(line.unexpectedInconclusive, 2)
  assert.equal(line.missedInconclusive, 0)
  assert.equal(typeof line.host, 'string')
  assert.ok(line.host.length)
  assert.match(line.pluginVersion, /^\d+\.\d+\.\d+/)
})

test('absent optional fields are not written as nulls', () => {
  const dir = freshDir()
  run(dir, [graded()])
  const line = JSON.parse(logLines(dir)[0])
  for (const k of ['workflow', 'rigor', 'verify', 'finderModel', 'verifyModel', 'notes', 'missedInconclusive', 'unexpectedInconclusive']) {
    assert.equal(k in line, false, `${k} must be absent, not null`)
  }
})

test('invalid or unknown optional fields fail loud and write nothing', () => {
  const dir = freshDir()
  for (const bad of [{ workflow: 'review', rigor: 'max' }, { workflow: 'review', verify: 'paranoid' }, { workflow: 'build' }, { workflow: 'smoke', missedInconclusive: '2' }, { workflow: 'review', finderModel: 5 }, { workflow: 'review', execRepro: 'yes' }, { finderReadOnly: true }, { rigour: 'full' }, { notes: 'x'.repeat(301) }, { rigor: 'lite' }, { inconclusive: 1 }]) {
    const r = run(dir, [graded(bad)])
    assert.notEqual(r.status, 0, `${JSON.stringify(bad)} must be rejected`)
  }
  assert.equal(existsSync(join(dir, 'codeswarm-eval-log.jsonl')), false)
})

test('fixture path is normalized to its fixtures/<name> key', () => {
  const dir = freshDir()
  run(dir, [graded({ fixture: 'C:\\devProjects\\claude-code-swarm\\fixtures\\eval3\\' })])
  run(dir, [graded({ fixture: '/home/u/claude-code-swarm/fixtures/eval3' })])
  run(dir, [graded({ fixture: 'fixtures/eval3' })])
  assert.deepEqual(logLines(dir).map(l => JSON.parse(l).fixture), ['fixtures/eval3', 'fixtures/eval3', 'fixtures/eval3'])
})

test('totals split per workflow/rigor; legacy rows land under unlabelled', () => {
  const dir = freshDir()
  // a legacy row, as logged before the run-condition fields existed
  writeFileSync(join(dir, 'codeswarm-eval-log.jsonl'), JSON.stringify({
    date: '2026-08-17', claudeCode: '2.1.233', fixture: 'fixtures/eval3-bait-review', pass: true,
    missed: 0, unexpected: 1, baselineMissed: 0, baselineUnexpected: 4, confirmed: 3, raw: 7, outputTokens: 18199,
  }) + '\n')
  // 3 raw false positives: 2 killed, 1 left inconclusive — the open one is NOT a kill
  run(dir, [graded({ workflow: 'review', rigor: 'lite', baselineUnexpected: 3, unexpected: 0, unexpectedInconclusive: 1 })])
  const out = JSON.parse(run(dir, [graded({ workflow: 'smoke' })]).stdout)
  assert.equal(out.runs, 3)
  assert.equal(out.falsePositivesKilled, 5)
  assert.equal(out.unresolvedFalsePositives, 1)
  assert.deepEqual(Object.keys(out.byMode).sort(), ['review/lite', 'smoke', 'unlabelled'])
  assert.equal(out.byMode.unlabelled.falsePositivesKilled, 3)
  assert.equal(out.byMode['review/lite'].falsePositivesKilled, 2)
  assert.equal(out.byMode['review/lite'].unresolvedFalsePositives, 1)
  assert.equal(out.byMode.smoke.runs, 1)
})

test('an unresolved planted bug is not counted as wrongly rejected', () => {
  const dir = freshDir()
  const out = JSON.parse(run(dir, [graded({ workflow: 'review', pass: false, missed: 1, baselineMissed: 0, missedInconclusive: 1 })]).stdout)
  assert.equal(out.realBugsWronglyRejected, 0)
  assert.equal(out.unresolvedRealBugs, 1)
})

test('a passing REVIEW-tier graded run never moves lastSmokeVersion (the canary is the smoke\'s)', () => {
  const dir = freshDir()
  writeFileSync(join(dir, 'codeswarm.json'), JSON.stringify({ lastSmokeVersion: '1.0.0' }))
  const out = JSON.parse(run(dir, [graded({ workflow: 'review', claudeCode: '9.9.9' })]).stdout)
  assert.equal(out.lastSmokeVersion, 'skipped (not a smoke run)')
  assert.equal(JSON.parse(readFileSync(join(dir, 'codeswarm.json'), 'utf8')).lastSmokeVersion, '1.0.0')
  const smoke = JSON.parse(run(dir, [graded({ workflow: 'smoke', claudeCode: '9.9.9' })]).stdout)
  assert.equal(smoke.lastSmokeVersion, 'updated', 'a passing graded smoke still records it')
})

test('execRepro and finderReadOnly are stored and split the totals into their own modes', () => {
  const dir = freshDir()
  run(dir, [graded({ workflow: 'review', rigor: 'lite', finderReadOnly: true, baselineUnexpected: 2, unexpected: 0 })])
  run(dir, [graded({ workflow: 'review', rigor: 'lite', execRepro: true })])
  const out = JSON.parse(run(dir, [graded({ workflow: 'review', rigor: 'lite' })]).stdout)
  assert.deepEqual(Object.keys(out.byMode).sort(), ['review/lite', 'review/lite/exec', 'review/lite/ro'])
  assert.equal(out.byMode['review/lite/ro'].falsePositivesKilled, 2)
  assert.equal(JSON.parse(logLines(dir)[0]).finderReadOnly, true)
})
