// Tests the pure verify-verdict block in swarm-review.js (waiver routing,
// lens-vote aggregation, post-verify waiver honoring, severity-check
// application) by extracting the code
// between the <verify-verdict> markers verbatim and evaluating it — so the
// PRODUCTION code is what runs. These are the invariants whose failure mode
// is a silently dropped critical finding.
// Run: node --test workflows/verify-verdict.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'swarm-review.js'), 'utf8')
const m = src.match(/\/\/ <verify-verdict>[^\n]*\n([\s\S]*?)\/\/ <\/verify-verdict>/)
assert.ok(m, 'verify-verdict markers present in swarm-review.js')

// the block is pure by contract — evaluate with NO injected globals so any
// accidental dependency on A/log/process fails loudly here
const { routeWaivers, normalizeVote, verdictFromVotes, splitInconclusive, splitConfirmed, applySeverityChecks } =
  new Function(m[1] + '\nreturn { routeWaivers, normalizeVote, verdictFromVotes, splitInconclusive, splitConfirmed, applySeverityChecks }')()

// --- routeWaivers: criticals are never waivable ---

test('non-matching finding goes to toVerify untouched', () => {
  const f = { file: 'a.js', severity: 'major', problem: 'x' }
  const { waived, toVerify } = routeWaivers([f], () => false)
  assert.deepEqual(toVerify, [f])
  assert.equal(waived.length, 0)
})

test('matching non-critical is waived (skips verify)', () => {
  const f = { file: 'a.js', severity: 'major', problem: 'x' }
  const { waived, toVerify } = routeWaivers([f], () => true)
  assert.deepEqual(waived, [f])
  assert.equal(toVerify.length, 0)
})

test('matching CRITICAL is NOT waived — verified with waivedAttempt flag', () => {
  const f = { file: 'a.js', severity: 'critical', problem: 'x' }
  const { waived, toVerify } = routeWaivers([f], () => true)
  assert.equal(waived.length, 0)
  assert.equal(toVerify.length, 1)
  assert.equal(toVerify[0].waivedAttempt, true)
  assert.equal(f.waivedAttempt, undefined, 'original finding object must not be mutated')
})

// --- verdictFromVotes: three states; null lens = infra failure, never a vote ---

const C = (evidence = 'ran f([]) → throws') => ({ verdict: 'confirmed', reason: 'r', evidence, reproExecuted: false, observed: '' })
const R = (evidence = 'guards.js:4 clamps the start') => ({ verdict: 'refuted', reason: 'r', evidence, reproExecuted: false, observed: '' })
const I = () => ({ verdict: 'inconclusive', reason: 'r', evidence: '', reproExecuted: false, observed: '' })
const X = v => ({ ...v, reproExecuted: true, observed: 'out' }) // the lens actually ran the repro

test('all lenses confirm → confirmed', () => {
  const v = verdictFromVotes([C(), C()], 2)
  assert.equal(v.verdict, 'confirmed')
  assert.equal(v.isConfirmed, true)
  assert.deepEqual([v.real, v.lensCount, v.lensFailures, v.verifyFailed], [2, 2, 0, false])
})

test('an UNCERTAIN lens never kills a finding: [confirmed, inconclusive] → inconclusive, not refuted', () => {
  const v = verdictFromVotes([C(), I()], 2)
  assert.equal(v.verdict, 'inconclusive')
  assert.equal(v.isConfirmed, false)
  assert.equal(v.verifyFailed, false)
})

test('lenses that contradict each other → inconclusive (contested, not a rejection)', () => {
  assert.equal(verdictFromVotes([C(), R()], 2).verdict, 'inconclusive')
})

test('symmetric: refuted needs EVERY deciding lens to refute — [refuted, inconclusive] → inconclusive', () => {
  assert.equal(verdictFromVotes([R(), R()], 2).verdict, 'refuted')
  assert.equal(verdictFromVotes([R()], 1).verdict, 'refuted')
  assert.equal(verdictFromVotes([R(), I()], 2).verdict, 'inconclusive', 'one lens alone cannot kill what another could not settle')
})

test('all lenses inconclusive → inconclusive', () => {
  assert.equal(verdictFromVotes([I(), I()], 2).verdict, 'inconclusive')
})

test('a verdict WITHOUT evidence is not stated → inconclusive (both directions)', () => {
  assert.equal(verdictFromVotes([R('  ')], 1).verdict, 'inconclusive')
  assert.equal(verdictFromVotes([C('')], 1).verdict, 'inconclusive')
  assert.equal(normalizeVote(R(''), false).stated, 'refuted', 'the lens\'s own claim is kept for the report')
})

test('exec regime: a claimed run with EMPTY output is not a run, even with prose evidence', () => {
  assert.equal(verdictFromVotes([{ ...R('a guard exists'), reproExecuted: true, observed: '' }], 1, true).verdict, 'inconclusive')
  assert.equal(verdictFromVotes([{ ...C('it throws'), reproExecuted: true, observed: '  ' }, X(R())], 2, true).verdict, 'refuted',
    'the empty-output confirmation drops out; the real run decides')
})

test('an executed repro\'s output counts as evidence', () => {
  assert.equal(verdictFromVotes([{ ...X(R('')), observed: 'tail([1,2,3],2) → [2,3]' }], 1, true).verdict, 'refuted')
  assert.equal(verdictFromVotes([{ ...R(''), reproExecuted: true, observed: '' }], 1).verdict, 'inconclusive', 'an empty run proves nothing')
})

test('null lens is EXCLUDED, not counted: [null, confirmed] still confirms', () => {
  const v = verdictFromVotes([null, C()], 2)
  assert.equal(v.verdict, 'confirmed')
  assert.equal(v.lensFailures, 1)
  assert.equal(v.lensCount, 1)
})

test('all lenses null → verifyFailed with NO verdict, never a rejection', () => {
  const v = verdictFromVotes([null, null], 2)
  assert.equal(v.verifyFailed, true)
  assert.equal(v.verdict, null)
  assert.equal(v.isConfirmed, false)
  assert.equal(v.lensFailures, 2)
})

test('normalized votes stay index-aligned with the lenses (nulls kept in place)', () => {
  const v = verdictFromVotes([null, C()], 2)
  assert.equal(v.normalized.length, 2)
  assert.equal(v.normalized[0], null)
  assert.equal(v.normalized[1].verdict, 'confirmed')
})

// --- exec regime: executed repros decide, reading alone does not ---

test('exec regime: an unexecuted confirmation or refutation counts as inconclusive', () => {
  assert.equal(verdictFromVotes([C()], 1, true).verdict, 'inconclusive')
  assert.equal(verdictFromVotes([R()], 1, true).verdict, 'inconclusive')
  assert.equal(normalizeVote(R(), true).stated, 'refuted')
})

test('exec regime: executed repros decide — an executed refutation outranks a read-only confirmation', () => {
  assert.equal(verdictFromVotes([C(), X(R())], 2, true).verdict, 'refuted', 'the fooled reader loses to the observed run')
  assert.equal(verdictFromVotes([X(C()), I()], 2, true).verdict, 'confirmed', 'an observed failure confirms')
  assert.equal(verdictFromVotes([X(C()), X(R())], 2, true).verdict, 'inconclusive', 'contradictory runs stay unresolved')
})

test('outside the exec regime reproExecuted is irrelevant', () => {
  assert.equal(verdictFromVotes([C(), X(R())], 2, false).verdict, 'inconclusive')
})

// --- splitInconclusive: majors/criticals stay visible, minors are only counted ---

test('inconclusive critical/major = unresolved bucket; inconclusive minors dropped and counted', () => {
  const ok = [
    { verdict: 'inconclusive', severity: 'critical' },
    { verdict: 'inconclusive', severity: 'major' },
    { verdict: 'inconclusive', severity: 'minor' },
    { verdict: 'refuted', severity: 'major' },
    { verdict: 'confirmed', severity: 'minor' },
  ]
  const { inconclusive, inconclusiveMinors } = splitInconclusive(ok)
  assert.deepEqual(inconclusive.map(f => f.severity), ['critical', 'major'])
  assert.equal(inconclusiveMinors, 1)
})

// --- splitConfirmed: waiver honored only after a downgrade below critical ---

test('confirmed waivedAttempt still critical → stays confirmed (waiver stays ignored)', () => {
  const f = { isConfirmed: true, waivedAttempt: true, severity: 'critical' }
  const { confirmed, waiverHonored } = splitConfirmed([f])
  assert.deepEqual(confirmed, [f])
  assert.equal(waiverHonored.length, 0)
})

test('confirmed waivedAttempt downgraded to major → waiver honored, NOT confirmed', () => {
  const f = { isConfirmed: true, waivedAttempt: true, severity: 'major' }
  const { confirmed, waiverHonored } = splitConfirmed([f])
  assert.equal(confirmed.length, 0)
  assert.deepEqual(waiverHonored, [f])
})

test('plain confirmed finding (no waivedAttempt) passes through', () => {
  const f = { isConfirmed: true, severity: 'minor' }
  const { confirmed, waiverHonored } = splitConfirmed([f])
  assert.deepEqual(confirmed, [f])
  assert.equal(waiverHonored.length, 0)
})

test('unconfirmed findings land in neither bucket (routed to rejected/inconclusive/verifyFailed downstream)', () => {
  const { confirmed, waiverHonored } = splitConfirmed([{ isConfirmed: false, waivedAttempt: true, severity: 'major' }])
  assert.equal(confirmed.length, 0)
  assert.equal(waiverHonored.length, 0)
})

// --- applySeverityChecks: one flaky check can never downgrade a critical ---

test('honest first check keeps the tag', () => {
  assert.equal(applySeverityChecks('critical', { honest: true, adjustedSeverity: 'minor' }, null), 'critical')
})

test('null first check (infra) keeps the tag', () => {
  assert.equal(applySeverityChecks('critical', null, null), 'critical')
})

test('non-critical downgrades on ONE check', () => {
  assert.equal(applySeverityChecks('major', { honest: false, adjustedSeverity: 'minor' }, null), 'minor')
})

test('non-critical upgrades on ONE check', () => {
  assert.equal(applySeverityChecks('major', { honest: false, adjustedSeverity: 'critical' }, null), 'critical')
})

test('critical downgrade with NO second check stays critical', () => {
  assert.equal(applySeverityChecks('critical', { honest: false, adjustedSeverity: 'minor' }, null), 'critical')
})

test('critical downgrade with an honest second check stays critical', () => {
  assert.equal(applySeverityChecks('critical', { honest: false, adjustedSeverity: 'major' }, { honest: true, adjustedSeverity: 'critical' }), 'critical')
})

test('critical downgrade with a still-critical second adjustment stays critical', () => {
  assert.equal(applySeverityChecks('critical', { honest: false, adjustedSeverity: 'major' }, { honest: false, adjustedSeverity: 'critical' }), 'critical')
})

test('two agreeing downgrades take the MORE severe adjustment', () => {
  assert.equal(applySeverityChecks('critical', { honest: false, adjustedSeverity: 'minor' }, { honest: false, adjustedSeverity: 'major' }), 'major')
  assert.equal(applySeverityChecks('critical', { honest: false, adjustedSeverity: 'major' }, { honest: false, adjustedSeverity: 'minor' }), 'major')
})
