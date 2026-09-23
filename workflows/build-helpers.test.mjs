// Tests the pure build-helpers block in swarm-build.js by extracting the code
// between the <build-helpers> markers verbatim and evaluating it — so the
// PRODUCTION code is what runs (same pattern as waiver-match.test.mjs).
// These helpers carry the fix-round gate, the impl/fix merge, the stage
// grouping and the pre-/post-hoc parallelism guards — the subtlest logic in
// the build script.
// Run: node --test workflows/build-helpers.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'swarm-build.js'), 'utf8')
const m = src.match(/\/\/ <build-helpers>[^\n]*\n([\s\S]*?)\/\/ <\/build-helpers>/)
assert.ok(m, 'build-helpers markers present in swarm-build.js')

const { needsFixRound, fixFindings, mergeImpl, groupStages, fileKey, covers, guardStage, stageOverlap, undeclaredWrites } = new Function(
  m[1] + '\nreturn { needsFixRound, fixFindings, mergeImpl, groupStages, fileKey, covers, guardStage, stageOverlap, undeclaredWrites }'
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

// --- fileKey: one key per file, however the path is spelled
test('fileKey: absolute, relative, ./ and backslash spellings of one file collide', () => {
  const keys = ['/repo/src/a.js', 'src/a.js', './src/a.js', '\\repo\\src\\a.js'].map(p => fileKey('/repo', p, false))
  assert.deepEqual(new Set(keys), new Set(['src/a.js']))
})
test('fileKey: always case-folds and resolves . / .. / doubled slashes (the guard must fail safe)', () => {
  assert.equal(fileKey('C:/Repo', 'C:/Repo/Src/A.js'), 'src/a.js')
  assert.equal(fileKey('/repo', 'Src/A.js'), 'src/a.js', 'NTFS/APFS treat these as one file even where the harness cannot tell')
  assert.equal(fileKey('/repo', 'src/lib/../a.js'), 'src/a.js')
  assert.equal(fileKey('/repo', 'src//./a.js'), 'src/a.js')
})

// --- guardStage: pre-hoc, fail-safe (no declaration = no parallelism)
const stage = tasks => ({ key: 's', tasks })
test('guardStage: disjoint declarations keep the stage parallel', () => {
  const st = stage([{ id: 1, files: ['a.js'] }, { id: 2, files: ['b.js'] }])
  const { stages, reason } = guardStage(st, '/repo')
  assert.equal(reason, null)
  assert.deepEqual(stages, [st])
})
test('guardStage: a co-staged task WITHOUT files splits the stage into sequential singles', () => {
  const { stages, reason } = guardStage(stage([{ id: 1, files: ['a.js'] }, { id: 2 }]), '/repo')
  assert.deepEqual(stages.map(s => s.tasks.map(t => t.id)), [[1], [2]])
  assert.match(reason, /2 declare no files/)
})
test('guardStage: overlapping declarations split the stage, spelled differently or not', () => {
  const { stages, reason } = guardStage(stage([{ id: 1, files: ['src/a.js'] }, { id: 2, files: ['/repo/src/a.js', 'b.js'] }]), '/repo')
  assert.equal(stages.length, 2)
  assert.match(reason, /src\/a\.js \(1 \+ 2\)/)
})
test('guardStage: a directory entry (trailing /) clashes with any file under it', () => {
  const { stages, reason } = guardStage(stage([{ id: 1, files: ['src/api/'] }, { id: 2, files: ['src/api/users.js'] }]), '/repo')
  assert.equal(stages.length, 2)
  assert.match(reason, /src\/api ~ src\/api\/users\.js \(1 \+ 2\)/)
  assert.equal(guardStage(stage([{ id: 1, files: ['src/api/'] }, { id: 2, files: ['src/apix.js'] }]), '/repo').reason, null, 'prefix is per directory, not per string')
})
test('guardStage: singles pass untouched, declared or not', () => {
  const st = stage([{ id: 1 }])
  assert.deepEqual(guardStage(st, '/repo'), { stages: [st], reason: null })
})

// --- stageOverlap / undeclaredWrites: post-hoc, report-only
test('stageOverlap: a file two co-staged tasks both report is flagged with both task ids', () => {
  const rs = [
    { task: 'T1', implemented: { filesChanged: ['/repo/a.js', 'x.js'] } },
    { task: 'T2', implemented: { filesChanged: ['a.js'] } },
    { task: 'T3', implemented: null, error: 'implementer returned null' },
  ]
  assert.deepEqual(stageOverlap('s', rs, '/repo'), [{ stage: 's', file: 'a.js', tasks: ['T1', 'T2'] }])
})
test('stageOverlap: disjoint reports = no overlap', () => {
  assert.deepEqual(stageOverlap('s', [{ task: 1, implemented: { filesChanged: ['a.js'] } }, { task: 2, implemented: { filesChanged: ['b.js'] } }], '/repo'), [])
})
test('undeclaredWrites: a directory declaration covers the files under it', () => {
  assert.deepEqual(undeclaredWrites({ files: ['src/api/'] }, { implemented: { filesChanged: ['src/api/a.js', 'src/b.js'] } }, '/repo'), ['src/b.js'])
})
test('undeclaredWrites: files reported outside the declaration; nothing for undeclared tasks', () => {
  assert.deepEqual(undeclaredWrites({ files: ['a.js'] }, { implemented: { filesChanged: ['/repo/a.js', 'shared.js'] } }, '/repo'), ['shared.js'])
  assert.deepEqual(undeclaredWrites({}, { implemented: { filesChanged: ['z.js'] } }, '/repo'), [])
  assert.deepEqual(undeclaredWrites({ files: ['a.js'] }, { implemented: null }, '/repo'), [])
})

test('guardStage: a directory declared WITHOUT a trailing slash still covers its files', () => {
  const { stages } = guardStage(stage([{ id: 1, files: ['src/api'] }, { id: 2, files: ['src/api/users.js'] }]), '/repo')
  assert.equal(stages.length, 2)
})
test('guardStage: case and ../ spellings of one file clash', () => {
  assert.equal(guardStage(stage([{ id: 1, files: ['Src/A.js'] }, { id: 2, files: ['src/a.js'] }]), '/repo').stages.length, 2)
  assert.equal(guardStage(stage([{ id: 1, files: ['src/x/../a.js'] }, { id: 2, files: ['./src/a.js'] }]), '/repo').stages.length, 2)
})

test('covers: a whole-repo declaration (".", "./", the root) covers every file — the guard must not fail open', () => {
  for (const whole of ['.', './', '/repo', '/repo/', 'src/..']) {
    assert.equal(fileKey('/repo', whole), '')
    assert.equal(guardStage(stage([{ id: 1, files: [whole] }, { id: 2, files: ['src/a.js'] }]), '/repo').stages.length, 2, whole)
  }
  assert.deepEqual(undeclaredWrites({ files: ['./'] }, { implemented: { filesChanged: ['src/a.js'] } }, '/repo'), [])
})
test('reports keep the original spelling; comparison stays case-folded', () => {
  const rs = [{ task: 'T1', implemented: { filesChanged: ['/repo/src/MyButton.vue'] } }, { task: 'T2', implemented: { filesChanged: ['src/mybutton.vue'] } }]
  assert.deepEqual(stageOverlap('s', rs, '/repo'), [{ stage: 's', file: 'src/MyButton.vue', tasks: ['T1', 'T2'] }])
  assert.deepEqual(undeclaredWrites({ files: ['src/a.js'] }, { implemented: { filesChanged: ['src/Other.vue'] } }, '/repo'), ['src/Other.vue'])
})
