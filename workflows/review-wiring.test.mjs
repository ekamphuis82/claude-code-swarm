// Wiring test for swarm-review.js's verify machinery: executes the PRODUCTION
// script through the real standalone-runner harness (runner/harness.js) with
// scenario drivers forcing paths the harness-contract fakes never reach —
// their schema-derived fakes answer verdict=confirmed / honest=true / never null, so
// the contested-critical downgrade, the rejected and inconclusive paths, waiver
// routing, lens retry/exclusion, verifyFailed, the exec regime and graded mode
// are all dead code there.
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
const vote = (verdict, extra = {}) => ({ verdict, reason: 'r', evidence: verdict === 'inconclusive' ? '' : 'e', reproExecuted: false, observed: '', ...extra })
const CONF = vote('confirmed')
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
          fnd('d.js', 2, 'major', 'imagined overflow'),
        ],
        areasCovered: ['src'],
      })
    }
    if (label.startsWith('verify:')) {
      // b.js: lenses contradict -> inconclusive (unresolved, NOT rejected);
      // d.js: both lenses refute with evidence -> rejected; others confirm
      if (label.includes('b.js')) return ok(vote(lensOf(prompt) === 'correctness' ? 'refuted' : 'confirmed'))
      if (label.includes('d.js')) return ok(vote('refuted', { evidence: 'd.js:2 guards it' }))
      return ok(CONF)
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
  assert.deepEqual(result.rejected.map(f => [f.file, f.votes, f.lensCount]), [['/repo/d.js', 0, 2]],
    'only an evidenced refutation rejects')
  assert.deepEqual(result.rejected[0].lenses.map(l => [l.lens, l.verdict, l.evidence]), [['correctness', 'refuted', 'd.js:2 guards it'], ['reproducibility', 'refuted', 'd.js:2 guards it']],
    'lens evidence travels with the rejection')
  assert.deepEqual(result.inconclusive.map(f => [f.file, f.severity, f.lensCount]), [['/repo/b.js', 'major', 2]],
    'contradicting lenses leave a major UNRESOLVED instead of silently rejecting it')
  assert.deepEqual(result.inconclusive[0].lenses.map(l => l.verdict).sort(), ['confirmed', 'refuted'])
  assert.equal(result.inconclusiveMinors, 0)
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
    if (label.startsWith('verify:')) return ok(CONF)
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
      return ok(CONF)
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
    if (label.startsWith('verify:')) return ok(CONF)
    throw new Error(`unexpected label: ${label}`)
  })
  assert.ok(calls.some(c => c.label === 'find:bugs:r1'), 'round 1 ran')
  assert.ok(calls.some(c => c.label === 'find:bugs:r2'), 'round 2 ran (coverage-guided)')
  assert.ok(!calls.some(c => c.label === 'find:bugs:r3'), 'no round 3 after a zero-fresh round')
  assert.equal(result.confirmed.length, 1, 'duplicate finding confirmed once')
  assert.equal(calls.filter(c => c.label === 'verify:/repo/c.js:1').length, 2, 'strict verify runs the FULL lens set even on a minor')
})

test('inconclusive wiring: an uncertain lens leaves a critical unresolved; an uncertain minor is dropped and counted', async () => {
  const { result } = await run({}, (prompt, label) => {
    if (label.startsWith('find:')) {
      return ok({
        findings: [fnd('k.js', 4, 'critical', 'token check skipped'), fnd('m.js', 8, 'minor', 'odd rounding')],
        areasCovered: ['src'],
      })
    }
    // k.js: correctness confirms, reproducibility cannot build the input; m.js: the one minor lens cannot decide
    if (label.startsWith('verify:')) return ok(lensOf(prompt) === 'correctness' && label.includes('k.js') ? CONF : vote('inconclusive'))
    throw new Error(`unexpected label: ${label}`)
  })
  assert.deepEqual(result.inconclusive.map(f => [f.file, f.severity]), [['/repo/k.js', 'critical']],
    'an uncertain lens must never silently discard a critical — it stays visible as unresolved')
  assert.equal(result.rejected.length, 0, '"cannot confirm" is not "refuted"')
  assert.equal(result.confirmed.length, 0)
  assert.equal(result.inconclusiveMinors, 1, 'the uncertain minor is counted, not listed')
})

test('exec wiring: execRepro puts the EXECUTE clause on bugs lenses only; an unexecuted verdict counts as inconclusive', async () => {
  const sec = { ...fnd('s.js', 3, 'major', 'open redirect'), dimension: 'security' }
  const { calls, result } = await run({ execRepro: true, dimensions: ['bugs', 'security'] }, (prompt, label) => {
    if (label.startsWith('find:bugs')) {
      return ok({ findings: [fnd('e.js', 1, 'major', 'tail drops the last element'), fnd('f.js', 2, 'major', 'empty array crashes')], areasCovered: ['src'] })
    }
    if (label.startsWith('find:security')) return ok({ findings: [sec], areasCovered: ['src'] })
    if (label.startsWith('verify:')) {
      // e.js: the lenses READ and refute — no run, so under the exec regime that is not a refutation
      if (label.includes('e.js')) return ok(vote('refuted'))
      // f.js: the lenses ran the repro and saw the crash
      if (label.includes('f.js')) return ok(vote('confirmed', { reproExecuted: true, observed: 'TypeError: Reduce of empty array' }))
      return ok(CONF) // s.js: security finding, read-only rules apply
    }
    if (label.startsWith('severity:')) return ok({ honest: true, adjustedSeverity: 'major', reason: 'r' })
    throw new Error(`unexpected label: ${label}`)
  })
  const verifyPrompts = file => calls.filter(c => c.label.startsWith(`verify:/repo/${file}`)).map(c => c.prompt)
  assert.ok(verifyPrompts('e.js').every(p => p.includes('EXECUTE the repro')), 'bugs lenses get the execute clause')
  assert.ok(verifyPrompts('s.js').every(p => !p.includes('EXECUTE the repro') && p.includes('Do not execute repo code')), 'non-bugs lenses stay read-only')
  assert.deepEqual(result.inconclusive.map(f => f.file), ['/repo/e.js'], 'a read-only refutation is not enough under execRepro')
  assert.equal(result.inconclusive[0].lenses[0].stated, 'refuted', 'the lens\'s own claim is kept for the director')
  assert.deepEqual(result.confirmed.map(f => f.file).sort(), ['/repo/f.js', '/repo/s.js'])
  const f = result.confirmed.find(x => x.file === '/repo/f.js')
  assert.equal(f.lenses[0].reproExecuted, true)
  assert.match(f.lenses[0].observed, /Reduce of empty array/)
})

test('default wiring: without execRepro every lens is told not to execute repo code', async () => {
  const { calls } = await run({}, (prompt, label) => {
    if (label.startsWith('find:')) return ok({ findings: [fnd('a.js', 1, 'major', 'x')], areasCovered: ['src'] })
    if (label.startsWith('verify:')) return ok(CONF)
    if (label.startsWith('severity:')) return ok({ honest: true, adjustedSeverity: 'major', reason: 'r' })
    throw new Error(`unexpected label: ${label}`)
  })
  const lensPrompts = calls.filter(c => c.label.startsWith('verify:')).map(c => c.prompt)
  assert.ok(lensPrompts.length && lensPrompts.every(p => p.includes('Do not execute repo code') && !p.includes('EXECUTE the repro')))
})

test('graded wiring: a killed false positive shows up only in the baseline', async () => {
  const { result } = await run({ rigor: 'lite', expected: [{ file: 'grid.js', mustMatch: 'share' }] }, (prompt, label) => {
    if (label.startsWith('find:')) {
      return ok({
        findings: [fnd('grid.js', 5, 'major', 'fill shares one row array'), fnd('guards.js', 6, 'major', 'off-by-one in tail')],
        areasCovered: ['src'],
      })
    }
    if (label.startsWith('verify:')) return ok(label.includes('guards.js') ? vote('refuted', { evidence: 'tail([1,2,3],2) → [2,3]' }) : CONF)
    throw new Error(`unexpected label: ${label}`)
  })
  assert.equal(result.pass, true)
  assert.deepEqual(result.missed, [])
  assert.deepEqual(result.unexpected, [], 'the verified pass has no false positive')
  assert.deepEqual(result.baseline.unexpected.map(f => f.file), ['/repo/guards.js'], 'the raw finder output had one')
  assert.equal(result.raw.length, 2)
  assert.ok(result.raw.every(f => !('_runtime' in f)), 'internal fields stay out of raw')
})

test('graded wiring: an inconclusive false positive is reported as unresolved, not as killed', async () => {
  const { result } = await run({ rigor: 'lite', expected: [{ file: 'grid.js', mustMatch: 'share' }] }, (prompt, label) => {
    if (label.startsWith('find:')) {
      return ok({ findings: [fnd('grid.js', 5, 'major', 'fill shares one row array'), fnd('guards.js', 6, 'major', 'off-by-one in tail')], areasCovered: ['src'] })
    }
    if (label.startsWith('verify:')) return ok(label.includes('guards.js') ? vote('inconclusive') : CONF)
    throw new Error(`unexpected label: ${label}`)
  })
  assert.deepEqual(result.unexpected, [])
  assert.deepEqual(result.unexpectedInconclusive.map(f => f.file), ['/repo/guards.js'])
  assert.deepEqual(result.missedInconclusive, [])
  assert.deepEqual(result.inconclusive.map(f => f.file), ['/repo/guards.js'])
})

test('finderReadOnly wiring: every finder prompt carries the read-only rule; absent by default', async () => {
  const driver = (prompt, label) => {
    if (label.startsWith('find:')) return ok({ findings: [fnd('a.js', 1, 'major', 'x')], areasCovered: ['src'] })
    if (label.startsWith('verify:')) return ok(CONF)
    if (label.startsWith('severity:')) return ok({ honest: true, adjustedSeverity: 'major', reason: 'r' })
    throw new Error(`unexpected label: ${label}`)
  }
  const ro = await run({ finderReadOnly: true, dimensions: ['bugs', 'security'] }, driver)
  const roFinders = ro.calls.filter(c => c.label.startsWith('find:'))
  assert.equal(roFinders.length, 2)
  assert.ok(roFinders.every(c => c.prompt.includes('READ-ONLY RUN: do not execute anything')), 'every finder is told not to execute')
  const plain = await run({}, driver)
  assert.ok(plain.calls.filter(c => c.label.startsWith('find:')).every(c => !c.prompt.includes('READ-ONLY RUN')), 'default finders are not restricted')
})
