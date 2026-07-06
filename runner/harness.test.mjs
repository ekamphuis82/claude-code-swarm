// Asserts the STANDALONE harness (runner/harness.js) against the contract
// clauses C1-C8 spec'd in workflows/harness-contract.test.mjs, then runs
// every shipped workflow script through it with a schema-fake driver — the
// proof the scripts run unchanged outside the Workflow tool.
// Run: node --test runner/harness.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHarness, runScript } from './harness.js'
import { createJournal, loadEntries } from './journal.js'

const here = dirname(fileURLToPath(import.meta.url))
const workflowsDir = join(here, '..', 'workflows')

// same minimal schema-instance faker as harness-contract.test.mjs
function fake (schema) {
  if (!schema || typeof schema !== 'object') return 'x'
  if (Array.isArray(schema.enum)) return schema.enum[0]
  switch (schema.type) {
    case 'object': {
      const o = {}
      for (const k of schema.required ?? []) o[k] = fake(schema.properties?.[k])
      return o
    }
    case 'array': return schema.items ? [fake(schema.items)] : []
    case 'string': return 'x'
    case 'integer': case 'number': return 1
    case 'boolean': return true
    default: return 'x'
  }
}

const fakeDriver = async (_prompt, opts) => ({ result: fake(opts?.schema), outputTokens: 1000 })

// --- C1: agent resolves to data, null on driver error, never rejects -------

test('C1: driver result flows through; a throwing driver yields null, not a rejection', async () => {
  const h = createHarness({ driver: fakeDriver })
  assert.deepEqual(await h.agent('p', { schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } }), { a: 'x' })
  const bad = createHarness({ driver: async () => { throw new Error('boom') } })
  assert.equal(await bad.agent('p', {}), null)
})

test('C1: at the budget ceiling agent() throws', async () => {
  const h = createHarness({ driver: fakeDriver, budgetTotal: 1500 })
  await h.agent('a', {}) // spent 1000 < 1500
  await h.agent('b', {}) // check passes at 1000, spent becomes 2000
  await assert.rejects(() => h.agent('c', {}), /budget ceiling/)
})

// --- C2: parallel is a never-rejecting barrier ------------------------------

test('C2: a throwing thunk resolves to null in the result array', async () => {
  const h = createHarness({ driver: fakeDriver })
  const r = await h.parallel([async () => 7, async () => { throw new Error('x') }])
  assert.deepEqual(r, [7, null])
})

// --- C3: pipeline stage semantics -------------------------------------------

test('C3: stages get (prev, originalItem, index); a throwing stage drops to null and skips the rest', async () => {
  const h = createHarness({ driver: fakeDriver })
  const seen = []
  const r = await h.pipeline(
    ['a', 'b'],
    (prev, item, i) => { seen.push([prev, item, i]); return prev.toUpperCase() },
    (prev, item, i) => { if (item === 'b') throw new Error('drop'); return `${prev}:${item}:${i}` },
    prev => prev + '!'
  )
  assert.deepEqual(seen, [['a', 'a', 0], ['b', 'b', 1]])
  assert.deepEqual(r, ['A:a:0!', null])
})

// --- C5: budget ---------------------------------------------------------------

test('C5: no target = remaining Infinity; spent grows monotonically', async () => {
  const h = createHarness({ driver: fakeDriver })
  assert.equal(h.budget.total, null)
  assert.equal(h.budget.remaining(), Infinity)
  assert.equal(h.budget.spent(), 0)
  await h.agent('a', {})
  assert.equal(h.budget.spent(), 1000)
})

// --- C7 + C8: script wrapper and bare sandbox --------------------------------

test('C7/C8: export-stripped body runs with top-level return/await; no Node globals leak', async () => {
  const src = `export const meta = { name: 't', description: 'd' }
if (typeof process !== 'undefined' || typeof require !== 'undefined' || typeof console !== 'undefined') throw new Error('host global leaked')
const r = await agent('x', { label: 'l', schema: { type: 'string' } })
return { r, tokens: { total: budget.spent() } }`
  const h = createHarness({ driver: fakeDriver })
  const { result, meta } = await runScript(src, {}, h)
  assert.equal(meta.name, 't')
  // JSON round-trip: vm results live in another realm (different Object prototype)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { r: 'x', tokens: { total: 1000 } })
})

test('C8: Math.random / Date.now / argless new Date throw inside a script', async () => {
  const h = () => createHarness({ driver: fakeDriver })
  const wrap = expr => `export const meta = { name: 't', description: 'd' }\nreturn ${expr}`
  await assert.rejects(() => runScript(wrap('Math.random()'), {}, h()), /Math\.random/)
  await assert.rejects(() => runScript(wrap('Date.now()'), {}, h()), /Date\.now/)
  await assert.rejects(() => runScript(wrap('new Date()'), {}, h()), /argless new Date/)
  const { result } = await runScript(wrap('Math.imul(3, 4)'), {}, h())
  assert.equal(result, 12, 'the rest of Math still works')
})

test('workflow() throws (shipped scripts never nest)', async () => {
  const h = createHarness({ driver: fakeDriver })
  await assert.rejects(() => h.workflow('x'), /not supported/)
})

// --- journal resume -----------------------------------------------------------

const SCRIPT_2CALLS = `export const meta = { name: 'j', description: 'd' }
const a = await agent('same prompt', { label: 'one', schema: { type: 'integer' } })
const b = await agent('same prompt', { label: 'one', schema: { type: 'integer' } })
return { a, b, tokens: { total: budget.spent() } }`

test('resume: identical calls cache by occurrence; replay spawns nothing and spends nothing', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'codeswarm-runner-')), 'journal.jsonl')
  let calls = 0
  const countingDriver = async () => ({ result: ++calls, outputTokens: 500 })

  const first = createHarness({ driver: countingDriver, journal: createJournal(file, []) })
  const r1 = (await runScript(SCRIPT_2CALLS, {}, first)).result
  assert.deepEqual([r1.a, r1.b], [1, 2], 'two identical calls are distinct occurrences')
  assert.equal(calls, 2)

  const journal = createJournal(file, loadEntries(file))
  assert.equal(journal.cachedCount(), 2)
  const second = createHarness({ driver: countingDriver, journal })
  const r2 = (await runScript(SCRIPT_2CALLS, {}, second)).result
  assert.deepEqual([r2.a, r2.b], [1, 2], 'replay returns the journaled results in order')
  assert.equal(calls, 2, 'no live driver call on full replay')
  assert.equal(r2.tokens.total, 0, 'replayed agents spend nothing')
})

test('resume: a journaled null result is NOT replayed — the agent re-runs live', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'codeswarm-runner-')), 'journal.jsonl')
  const failing = createHarness({ driver: async () => { throw new Error('down') }, journal: createJournal(file, []) })
  assert.equal(await failing.agent('p', { label: 'l' }), null)

  const journal = createJournal(file, loadEntries(file))
  assert.equal(journal.cachedCount(), 0, 'null results are never cached')
  const healthy = createHarness({ driver: async () => ({ result: 42, outputTokens: 1 }), journal })
  assert.equal(await healthy.agent('p', { label: 'l' }), 42)
})

// --- every shipped workflow script runs unchanged ------------------------------

const RUNS = [
  ['swarm-smoke.js', { fixtureDir: '/fx', expected: [{ file: 'x' }] }],
  ['swarm-review.js', { repo: '/repo' }],
  ['swarm-review.js', { repo: '/repo', rigor: 'full' }],
  ['swarm-build.js', { repo: '/repo', tasks: [{ id: 'T1', title: 't', brief: 'b', agentType: 'codeswarm:x' }] }],
  ['swarm-research.js', { question: 'q' }],
  ['swarm-refactor.js', { repo: '/repo', instruction: 'rename x to y' }],
  ['swarm-drift.js', { repos: [{ name: 'r', path: '/r' }], skillsDir: '/s' }],
  ['swarm-onboard.js', { pluginDir: '/p', repos: [{ name: 'r', path: '/r' }] }],
]

for (const [file, args] of RUNS) {
  test(`${file} runs to completion on the standalone harness (${JSON.stringify(args).slice(0, 40)}...)`, async () => {
    const src = readFileSync(join(workflowsDir, file), 'utf8')
    const h = createHarness({ driver: fakeDriver })
    const { result, meta } = await runScript(src, args, h)
    assert.ok(result && typeof result === 'object', 'script returned a result object')
    assert.equal(typeof result.tokens?.total, 'number', 'tokens accounting present')
    assert.equal(meta.name, file.replace(/\.js$/, ''))
  })
}

test('all shipped workflow scripts are covered by the standalone runs above', () => {
  const shipped = readdirSync(workflowsDir).filter(f => /^swarm-.*\.js$/.test(f)).sort()
  const covered = [...new Set(RUNS.map(r => r[0]))].sort()
  assert.deepEqual(covered, shipped, 'a new workflow script must be added to RUNS')
})
