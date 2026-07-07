// Wiring test for swarm-review.js's verify machinery: executes the PRODUCTION
// script through the real standalone-runner harness (runner/harness.js) with
// scenario drivers forcing paths the harness-contract fakes never reach —
// their schema-derived fakes answer isReal=true / honest=true / never null, so
// the contested-critical downgrade, the rejected path, waiver routing, lens
// retry/exclusion and verifyFailed are all dead code there.
// verify-verdict.test.mjs and waiver-match.test.mjs cover the pure logic;
// THIS file proves the dispatch wiring around it (same pattern as
// build-wiring.test.mjs).
// Run: node --test workflows/review-wiring.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHarness, runScript } from '../runner/harness.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'swarm-review.js'), 'utf8')

const fnd = (file, line, severity, problem) =>
  ({ file: `/repo/${file}`, line, severity, dimension: 'bugs', problem, scenario: 's', fix: 'x' })
const ok = (result, outputTokens = 50) => ({ result, outputTokens })
const lensOf = prompt => prompt.includes('through the lens of correctness') ? 'correctness'
  : prompt.includes('through the lens of reproducibility') ? 'reproducibility' : null

async function run (extraArgs, driver) {
  const calls = []
  const harness = createHarness({
    driver: async (prompt, opts) => {
      calls.push({ label: opts.label ?? '', prompt: String(prompt) })
      return driver(String(prompt), opts.label ?? '')
    },
  })
  const { result } = await runScript(source, { repo: '/repo', rigor: 'full', dimensions: ['bugs'], ...extraArgs }, harness)
  // vm-context values carry cross-realm prototypes — normalize through JSON
  return { calls, result: JSON.parse(JSON.stringify(result)) }
}

test('verdict wiring: contested-critical double-check, rejected split, minor single-lens', async () => {
  const { calls, result } = await run({}, (prompt, label) => {
    if (label.startsWith('find:')) {
      return ok({
        findings: [
          fnd('a.js', 10, 'critical', 'buffer overflow'),
          fnd('b.js', 5, 'major', 'race condition'),
          fnd('c.js', 1, 'minor', 'confusing name'),
        ],
        areasCovered: ['src'],
      })
    }
    if (label.startsWith('verify:')) {
      // b.js: lenses disagree -> not unanimous -> rejected; others confirm
      if (label.includes('b.js')) return ok({ isReal: lensOf(prompt) !== 'correctness', reason: 'r' })
      return ok({ isReal: true, reason: 'r' })
    }
    // a.js critical: BOTH severity checks want major -> downgrade lands
    if (label.startsWith('severity:') || label.startsWith('severity2:')) {
      return ok({ honest: false, adjustedSeverity: 'major', reason: 'impact overstated' })
    }
    throw new Error(`unexpected label: ${label}`)
  })
  assert.deepEqual(result.confirmed.map(f => [f.file, f.severity]), [['/repo/a.js', 'major'], ['/repo/c.js', 'minor']],
    'confirmed sorted by severity; critical downgraded to major')
  assert.equal(result.confirmed[0].reportedSeverity, 'critical', 'original tag preserved for the report')
  assert.ok(calls.some(c => c.label === 'severity2:/repo/a.js:10'), 'a critical downgrade requires the SECOND independent check')
  assert.ok(!calls.some(c => c.label.startsWith('severity:') && c.label.includes('c.js')), 'minors get no severity check')
  assert.equal(calls.filter(c => c.label === 'verify:/repo/c.js:1').length, 1, 'minor verified on a single lens under normal verify')
  assert.deepEqual(result.rejected.map(f => [f.file, f.votes, f.lensCount]), [['/repo/b.js', 1, 2]],
    'non-unanimous lenses reject with the vote split recorded')
  assert.equal(result.verifyFailed.length, 0)
  assert.equal(result.waived.length, 0)
})

test('waiver wiring: non-critical skips verify; a critical waiver attempt verifies anyway', async () => {
  const waivers = [
    { file: 'd.js', match: 'hardcoded credential' },
    { file: 'e.js', match: 'sql injection everywhere' },
  ]
  const { calls, result } = await run({ waivers }, (prompt, label) => {
    if (label.startsWith('find:')) {
      return ok({
        findings: [
          fnd('d.js', 2, 'major', 'Hardcoded credential in config loader'),
          fnd('e.js', 3, 'critical', 'sql injection everywhere in the handler'),
        ],
        areasCovered: ['src'],
      })
    }
    if (label.startsWith('verify:')) return ok({ isReal: true, reason: 'r' })
    if (label.startsWith('severity:')) return ok({ honest: true, adjustedSeverity: 'critical', reason: 'r' })
    throw new Error(`unexpected label: ${label}`)
  })
  assert.deepEqual(result.waived.map(f => f.file), ['/repo/d.js'], 'matching non-critical waived')
  assert.ok(!calls.some(c => c.label.startsWith('verify:') && c.label.includes('d.js')), 'waived finding never reaches verify')
  const crit = result.confirmed.find(f => f.file === '/repo/e.js')
  assert.ok(crit, 'critical verified despite the waiver')
  assert.equal(crit.severity, 'critical')
  assert.equal(crit.waivedAttempt, true, 'attempted waiver on a critical is flagged for the director')
})

test('infra wiring: failed lens retries once then is excluded; all-lenses-dead lands in verifyFailed', async () => {
  const { calls, result } = await run({}, (prompt, label) => {
    if (label.startsWith('find:')) {
      return ok({
        findings: [
          fnd('g.js', 7, 'major', 'leaked handle'),
          fnd('h.js', 9, 'critical', 'auth bypass'),
        ],
        areasCovered: ['src'],
      })
    }
    if (label.startsWith('verify:')) {
      if (label.includes('h.js')) return ok(null, 0) // every lens dead
      if (lensOf(prompt) === 'correctness') return ok(null, 0) // g.js: one lens dead
      return ok({ isReal: true, reason: 'r' })
    }
    if (label.startsWith('severity:')) return ok({ honest: true, adjustedSeverity: 'major', reason: 'r' })
    throw new Error(`unexpected label: ${label}`)
  })
  const g = result.confirmed.find(f => f.file === '/repo/g.js')
  assert.ok(g, 'surviving-lens unanimity confirms despite an excluded lens')
  assert.equal(g.lensFailures, 1, 'excluded lens count reported (degraded confidence)')
  const gCorrectness = calls.filter(c => c.label === 'verify:/repo/g.js:7' && lensOf(c.prompt) === 'correctness')
  assert.equal(gCorrectness.length, 2, 'failed lens is retried exactly once')
  assert.deepEqual(result.verifyFailed.map(f => [f.file, f.severity]), [['/repo/h.js', 'critical']],
    'all lenses dead = unresolved verifyFailed (critical preserved as blocker), NOT rejected')
  assert.equal(result.rejected.length, 0)
  assert.equal(calls.filter(c => c.label === 'verify:/repo/h.js:9').length, 4, 'both lenses tried twice before giving up')
})

test('thorough wiring: a round with nothing new stops the loop; strict widens the minor lens set', async () => {
  const { calls, result } = await run({ thorough: true }, (prompt, label) => {
    if (label.startsWith('find:')) {
      // every round reports the SAME finding — round 2 dedups to zero fresh and stops
      return ok({ findings: [fnd('c.js', 1, 'minor', 'confusing name')], areasCovered: ['src'] })
    }
    if (label.startsWith('verify:')) return ok({ isReal: true, reason: 'r' })
    throw new Error(`unexpected label: ${label}`)
  })
  assert.ok(calls.some(c => c.label === 'find:bugs:r1'), 'round 1 ran')
  assert.ok(calls.some(c => c.label === 'find:bugs:r2'), 'round 2 ran (coverage-guided)')
  assert.ok(!calls.some(c => c.label === 'find:bugs:r3'), 'no round 3 after a zero-fresh round')
  assert.equal(result.confirmed.length, 1, 'duplicate finding confirmed once')
  assert.equal(calls.filter(c => c.label === 'verify:/repo/c.js:1').length, 2, 'strict verify runs the FULL lens set even on a minor')
})
