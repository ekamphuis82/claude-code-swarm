// Tests the pure build-helpers block in swarm-build.js by extracting the code
// between the <build-helpers> markers verbatim and evaluating it — so the
// PRODUCTION code is what runs (same pattern as waiver-match.test.mjs).
// These helpers carry the fix-round gate, the impl/fix merge and the stage
// grouping — the subtlest logic in the build script.
// Run: node --test workflows/build-helpers.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'swarm-build.js'), 'utf8')
const m = src.match(/\/\/ <build-helpers>[^\n]*\n([\s\S]*?)\/\/ <\/build-helpers>/)
assert.ok(m, 'build-helpers markers present in swarm-build.js')

const { needsFixRound, fixFindings, mergeImpl, groupStages } = new Function(
  m[1] + '\nreturn { needsFixRound, fixFindings, mergeImpl, groupStages }'
)()

// --- needsFixRound: FAIL suite must be fixed even when review approved/skipped
test('review CHANGES-REQUESTED forces a fix round', () => {
  assert.equal(needsFixRound({ verdict: 'CHANGES-REQUESTED', findings: [] }, { verdict: 'PASS' }), true)
})
test('tester FAIL forces a fix round even on review APPROVE', () => {
  assert.equal(needsFixRound({ verdict: 'APPROVE', findings: [] }, { verdict: 'FAIL', suiteResult: 'x' }), true)
})
test('tester FAIL forces a fix round when review was skipped (null)', () => {
  assert.equal(needsFixRound(null, { verdict: 'FAIL', suiteResult: 'x' }), true)
})
test('APPROVE + PASS = no fix round', () => {
  assert.equal(needsFixRound({ verdict: 'APPROVE', findings: [] }, { verdict: 'PASS' }), false)
})
test('review skipped + missing tester report = no fix round (fatal-gate handles it downstream)', () => {
  assert.equal(needsFixRound(null, null), false)
})

// --- fixFindings: review findings first, tester FAIL line last
test('composes review findings plus the tester FAIL line', () => {
  const s = fixFindings(
    { verdict: 'CHANGES-REQUESTED', findings: ['a.js:1 — major — x — fix y'] },
    { verdict: 'FAIL', suiteResult: '3 passed, 1 failed' }
  )
  assert.equal(s, 'a.js:1 — major — x — fix y\ntester FAIL: 3 passed, 1 failed')
})
test('PASS suite contributes no tester line; null review contributes nothing', () => {
  assert.equal(fixFindings(null, { verdict: 'PASS', suiteResult: 'ok' }), '')
})

// --- mergeImpl: fix supersedes test report, files/risks accumulate deduped
test('fix test report supersedes; files and risks union deduped', () => {
  const merged = mergeImpl(
    { filesChanged: ['a.js', 'b.js'], testsRun: 'old', testOutput: 'old out', risks: ['r1'] },
    { filesChanged: ['b.js', 'c.js'], testsRun: 'new', testOutput: 'new out', risks: ['r1', 'r2'] }
  )
  assert.deepEqual(merged.filesChanged, ['a.js', 'b.js', 'c.js'])
  assert.equal(merged.testsRun, 'new')
  assert.equal(merged.testOutput, 'new out')
  assert.deepEqual(merged.risks, ['r1', 'r2'])
})
test('missing arrays on either side are null-safe', () => {
  const merged = mergeImpl({ testsRun: 'a', testOutput: 'b' }, { testsRun: 'c', testOutput: 'd' })
  assert.deepEqual(merged.filesChanged, [])
  assert.deepEqual(merged.risks, [])
})

// --- groupStages: only CONSECUTIVE same-stage tasks run in parallel
test('consecutive same-stage tasks group; stage change splits', () => {
  const gs = groupStages([{ id: 1, stage: 'a' }, { id: 2, stage: 'a' }, { id: 3, stage: 'b' }])
  assert.equal(gs.length, 2)
  assert.deepEqual(gs[0].tasks.map(t => t.id), [1, 2])
  assert.deepEqual(gs[1].tasks.map(t => t.id), [3])
})
test('NON-consecutive same-stage tasks do NOT merge (an interleaved dependent is never overtaken)', () => {
  const gs = groupStages([{ id: 1, stage: 'a' }, { id: 2 }, { id: 3, stage: 'a' }])
  assert.equal(gs.length, 3)
})
test('unset stages stay sequential singles; order preserved', () => {
  const gs = groupStages([{ id: 1 }, { id: 2 }])
  assert.equal(gs.length, 2)
  assert.deepEqual(gs.map(g => g.key), [null, null])
})
test('stage 0 is a valid stage (only null/undefined mean sequential)', () => {
  const gs = groupStages([{ id: 1, stage: 0 }, { id: 2, stage: 0 }])
  assert.equal(gs.length, 1)
  assert.deepEqual(gs[0].tasks.map(t => t.id), [1, 2])
})
