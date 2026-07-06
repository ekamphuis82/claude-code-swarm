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
const { routeWaivers, verdictFromVotes, splitConfirmed, applySeverityChecks } =
  new Function(m[1] + '\nreturn { routeWaivers, verdictFromVotes, splitConfirmed, applySeverityChecks }')()

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

// --- verdictFromVotes: null lens = infra failure, never a not-real vote ---

test('all lenses real → confirmed', () => {
  const v = verdictFromVotes([{ isReal: true }, { isReal: true }], 2)
  assert.deepEqual(v, { real: 2, lensCount: 2, lensFailures: 0, verifyFailed: false, isConfirmed: true })
})

test('one not-real lens → rejected (unanimity required), not verifyFailed', () => {
  const v = verdictFromVotes([{ isReal: true }, { isReal: false }], 2)
  assert.equal(v.isConfirmed, false)
  assert.equal(v.verifyFailed, false)
})

test('null lens is EXCLUDED, not counted as not-real: [null, real] still confirms', () => {
  const v = verdictFromVotes([null, { isReal: true }], 2)
  assert.equal(v.isConfirmed, true)
  assert.equal(v.lensFailures, 1)
  assert.equal(v.lensCount, 1)
})

test('all lenses null → verifyFailed, NEVER a rejection', () => {
  const v = verdictFromVotes([null, null], 2)
  assert.equal(v.verifyFailed, true)
  assert.equal(v.isConfirmed, false)
  assert.equal(v.lensFailures, 2)
})

test('single-lens (lite/minor) real vote confirms', () => {
  const v = verdictFromVotes([{ isReal: true }], 1)
  assert.equal(v.isConfirmed, true)
  assert.equal(v.lensFailures, 0)
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

test('unconfirmed findings land in neither bucket (routed to rejected/verifyFailed downstream)', () => {
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
