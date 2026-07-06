// Tests the pure waiver-matcher block in swarm-review.js by extracting the
// code between the <waiver-matcher> markers verbatim and evaluating it with
// injected `process`, `A` and `log` — so the PRODUCTION code is what runs.
// Run: node --test workflows/waiver-match.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'swarm-review.js'), 'utf8')
const m = src.match(/\/\/ <waiver-matcher>[^\n]*\n([\s\S]*?)\/\/ <\/waiver-matcher>/)
assert.ok(m, 'waiver-matcher markers present in swarm-review.js')

const build = ({ platform = 'linux', repo = '/repo', waivers = [] } = {}) => {
  const logs = []
  const fn = new Function('process', 'A', 'log',
    m[1] + '\nreturn { relPath, fileMatches, matchesWaiver, waiverProblem, waivers }')
  const out = fn({ platform }, { repo, waivers }, s => logs.push(s))
  out.logs = logs
  return out
}

test('relative waiver file matches repo-relative finding', () => {
  const { matchesWaiver } = build({ waivers: [{ file: 'src/a.js', match: 'sql injection' }] })
  assert.ok(matchesWaiver({ file: '/repo/src/a.js', problem: 'SQL injection via q param' }))
})

test('ABSOLUTE waiver file path still matches (regression: relPath on both sides)', () => {
  const { matchesWaiver } = build({ waivers: [{ file: '/repo/src/a.js', match: 'sql injection' }] })
  assert.ok(matchesWaiver({ file: '/repo/src/a.js', problem: 'sql injection here' }))
})

test('windows: backslashes + case-insensitive matching', () => {
  const { matchesWaiver } = build({
    platform: 'win32', repo: 'D:/Repo',
    waivers: [{ file: 'SRC\\A.js', match: 'race condition' }],
  })
  assert.ok(matchesWaiver({ file: 'D:\\repo\\src\\a.js', problem: 'Race condition on save' }))
})

test('darwin folds case too (default APFS is case-insensitive)', () => {
  const { matchesWaiver } = build({ platform: 'darwin', waivers: [{ file: 'Src/A.js', match: 'race condition' }] })
  assert.ok(matchesWaiver({ file: '/repo/src/a.js', problem: 'race condition x' }))
})

test('linux stays case-sensitive', () => {
  const { matchesWaiver } = build({ waivers: [{ file: 'Src/A.js', match: 'race condition' }] })
  assert.equal(matchesWaiver({ file: '/repo/src/a.js', problem: 'race condition x' }), false)
})

test('path-segment boundary: waiver a.js must not match spa.js', () => {
  const { fileMatches } = build()
  assert.equal(fileMatches('/repo/src/spa.js', 'a.js'), false)
  assert.ok(fileMatches('/repo/src/a.js', 'a.js'))
})

test('match string < 8 chars is rejected up front and logged', () => {
  const { waivers, logs, matchesWaiver } = build({ waivers: [{ file: 'src/a.js', match: 'short' }] })
  assert.equal(waivers.length, 0)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /8 chars/)
  assert.equal(matchesWaiver({ file: '/repo/src/a.js', problem: 'short problem text' }), false)
})

test('invalid entries (null, missing file/match) are skipped without throwing', () => {
  const { waivers, logs } = build({ waivers: [null, { match: 'long enough' }, { file: 'a/b.js' }, 'nope'] })
  assert.equal(waivers.length, 0)
  assert.equal(logs.length, 4)
})

test('problem-text match is case-insensitive and substring-based', () => {
  const { matchesWaiver } = build({ waivers: [{ file: 'src/a.js', match: 'Unbounded Query' }] })
  assert.ok(matchesWaiver({ file: '/repo/src/a.js', problem: 'the unbounded query returns all rows' }))
  assert.equal(matchesWaiver({ file: '/repo/src/a.js', problem: 'different issue' }), false)
})
