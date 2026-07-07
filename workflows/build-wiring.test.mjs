// Wiring test for swarm-build.js's fix-round machinery: executes the
// PRODUCTION script through the real standalone-runner harness
// (runner/harness.js — the C1-C8 implementation, not a mock) with a
// scenario driver forcing paths the harness-contract fakes never reach:
// their schema-derived fakes return the FIRST enum value (PASS/APPROVE),
// so the fix round, re-test, re-review and the fatal-stop gate are dead
// code there. build-helpers.test.mjs covers the pure logic; THIS file
// proves the dispatch wiring around it.
// Run: node --test workflows/build-wiring.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHarness, runScript } from '../runner/harness.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'swarm-build.js'), 'utf8')

// scenario driver: first test verdict FAILs and the review demands changes,
// forcing the fix round; retestVerdict controls whether the fix repairs it.
// Yields a macrotask before answering so concurrent dispatches overlap —
// maxActive then measures real stage parallelism.
function makeDriver (calls, { retestVerdict }) {
  let active = 0
  const state = { maxActive: 0 }
  const driver = async (prompt, opts) => {
    const label = opts.label ?? ''
    calls.push(label)
    active++
    state.maxActive = Math.max(state.maxActive, active)
    await new Promise(r => setImmediate(r))
    active--
    const out = r => ({ result: r, outputTokens: 100 })
    if (label.startsWith('impl:')) return out({ filesChanged: ['a.js'], testsRun: 'npm t', testOutput: '1 failed', risks: ['r1'] })
    if (label.startsWith('test:')) return out({ suiteResult: '4 passed, 1 failed', edgeCasesTried: ['empty input'], verdict: 'FAIL' })
    if (label.startsWith('review:')) return out({ verdict: 'CHANGES-REQUESTED', findings: ['a.js:1 — major — off by one — use <='] })
    if (label.startsWith('fix:')) return out({ filesChanged: ['a.js', 'b.js'], testsRun: 'npm t', testOutput: 'all pass', risks: ['r2'] })
    if (label.startsWith('re-test:')) return out({ suiteResult: retestVerdict === 'PASS' ? '5 passed' : 'still 1 failed', edgeCasesTried: [], verdict: retestVerdict })
    if (label.startsWith('re-review:')) return out({ verdict: 'APPROVE', findings: [] })
    if (label === 'retrospect') return out({ coherent: true, findings: [] })
    throw new Error(`unexpected label: ${label}`)
  }
  return { driver, state }
}

async function run (tasks, opts) {
  const calls = []
  const { driver, state } = makeDriver(calls, opts)
  const harness = createHarness({ driver })
  const { result } = await runScript(source, { repo: '/repo', rigor: 'full', tasks }, harness)
  // vm-context values carry cross-realm prototypes — deepStrictEqual would
  // fail on identical content; normalize through JSON before asserting
  return { calls, state, result: JSON.parse(JSON.stringify(result)) }
}

test('fix round wiring: merge, supersede, re-test, re-review, retrospect; same-stage tasks overlap', async () => {
  const tasks = [
    { id: 'T1', title: 't1', brief: 'b1', agentType: 'codeswarm:x', stage: 's' },
    { id: 'T2', title: 't2', brief: 'b2', agentType: 'codeswarm:x', stage: 's' },
  ]
  const { calls, state, result } = await run(tasks, { retestVerdict: 'PASS' })
  for (const id of ['T1', 'T2']) {
    const r = result.results.find(x => x.task === id)
    assert.deepEqual(r.implemented.filesChanged, ['a.js', 'b.js'], `${id}: mergeImpl files union`)
    assert.deepEqual(r.implemented.risks, ['r1', 'r2'], `${id}: risks union`)
    assert.equal(r.implemented.testOutput, 'all pass', `${id}: fix report supersedes the pre-fix one`)
    assert.equal(r.testerReport.verdict, 'PASS', `${id}: re-test verdict replaces the stale FAIL`)
    assert.equal(r.reviewVerdict.verdict, 'APPROVE', `${id}: re-review verdict lands`)
    for (const p of ['impl:', 'test:', 'review:', 'fix:', 're-test:', 're-review:']) {
      assert.ok(calls.includes(`${p}${id}`), `${id}: ${p} dispatched`)
    }
  }
  assert.ok(calls.includes('retrospect'), 'retrospect runs over 2 delivered tasks')
  assert.equal(result.retrospect.coherent, true)
  assert.ok(state.maxActive >= 2, `same-stage tasks must overlap (maxActive ${state.maxActive})`)
})

test('persistent tester FAIL is fatal: sequential successor never dispatched, retrospect skipped', async () => {
  const tasks = [
    { id: 'T1', title: 't1', brief: 'b1', agentType: 'codeswarm:x' },
    { id: 'T2', title: 't2', brief: 'b2', agentType: 'codeswarm:x' },
  ]
  const { calls, result } = await run(tasks, { retestVerdict: 'FAIL' })
  assert.equal(result.results.length, 1, 'run stops after the failing stage')
  assert.equal(result.results[0].testerReport.verdict, 'FAIL')
  assert.ok(!calls.some(c => c.endsWith(':T2')), 'T2 never dispatched after fatal T1')
  assert.equal(result.retrospect, null, 'retrospect skipped below 2 delivered tasks')
})
