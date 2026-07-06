// Guards swarm-build.js parse-time task validation (id/title/brief/agentType,
// unique ids). Loads the module in a vm with the workflow globals stubbed so
// the top-level validation runs; a valid task list must NOT throw, a malformed
// one MUST. The stubbed agent() returns null, so valid runs short-circuit at
// the first implementer dispatch without needing a live model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'swarm-build.js'), 'utf8')

// strip the ESM `export` keyword so the source runs as a plain script in vm
const script = src.replace(/^export\s+const\s+meta/m, 'const meta')

// agent stub returning a valid schema object per stage label, recording labels
function stubAgent(labels) {
  return async (_prompt, opts) => {
    labels.push(opts?.label ?? '?')
    const l = opts?.label ?? ''
    if (l.startsWith('impl') || l.startsWith('fix')) return { filesChanged: ['f.js'], testsRun: 't', testOutput: 'ok', risks: [] }
    if (l.includes('test')) return { suiteResult: 'ok', edgeCasesTried: [], verdict: 'PASS' }
    if (l.includes('review')) return { verdict: 'APPROVE', findings: [] }
    if (l.startsWith('retrospect')) return { coherent: true, findings: [] }
    return null
  }
}

async function run(tasks, extraArgs = {}, labels = null) {
  const sandbox = {
    args: { repo: '/tmp/x', tasks, ...extraArgs },
    agent: labels ? stubAgent(labels) : async () => null, // null impl -> task returns early
    parallel: async (thunks) => Promise.all(thunks.map(t => t())),
    phase: () => {},
    log: () => {},
    budget: { total: null, spent: () => 0, remaining: () => Infinity },
    console,
    JSON, Math, Array, Object, Set, Error, Promise,
  }
  vm.createContext(sandbox)
  await new vm.Script(`(async () => { ${script} })()`).runInContext(sandbox)
}

const okTask = { id: 'T1', title: 'x', brief: 'do x', agentType: 'codeswarm:a' }

test('valid task list does not throw', async () => {
  await assert.doesNotReject(() => run([okTask]))
})

test('id 0 (falsy number) is accepted', async () => {
  await assert.doesNotReject(() => run([{ ...okTask, id: 0 }]))
})

test('missing/empty id throws', async () => {
  await assert.rejects(() => run([{ ...okTask, id: '' }]), /non-empty id/)
  await assert.rejects(() => run([{ ...okTask, id: null }]), /non-empty id/)
})

test('missing title throws', async () => {
  await assert.rejects(() => run([{ ...okTask, title: '' }]), /title is required/)
})

test('missing brief throws', async () => {
  await assert.rejects(() => run([{ ...okTask, brief: '  ' }]), /brief is required/)
})

test('bare (unqualified) agentType throws', async () => {
  await assert.rejects(() => run([{ ...okTask, agentType: 'a' }]), /not plugin-qualified/)
})

test('duplicate ids throw (string-coerced)', async () => {
  await assert.rejects(() => run([okTask, { ...okTask, id: 'T1' }]), /duplicate task id/)
  await assert.rejects(() => run([{ ...okTask, id: 1 }, { ...okTask, id: '1' }]), /duplicate task id/)
})

test('DEFAULT rigor is lite: no adversarial review, no retrospect', async () => {
  const labels = []
  await run([okTask, { ...okTask, id: 'T2' }], {}, labels)   // 2 tasks so retrospect COULD run
  assert.ok(labels.some(l => l.startsWith('impl')), 'implementer ran')
  assert.ok(labels.some(l => l.includes('test')), 'independent tester ran')
  assert.ok(!labels.some(l => l.includes('review')), `no review under lite, got: ${labels}`)
  assert.ok(!labels.some(l => l.startsWith('retrospect')), `no retrospect under lite, got: ${labels}`)
})

test('rigor:full adds adversarial review and retrospect', async () => {
  const labels = []
  await run([okTask, { ...okTask, id: 'T2' }], { rigor: 'full' }, labels)
  assert.ok(labels.some(l => l.startsWith('review:')), `review runs under full, got: ${labels}`)
  assert.ok(labels.some(l => l.startsWith('retrospect')), `retrospect runs under full, got: ${labels}`)
})

test('effort:low skips review even under full rigor', async () => {
  const labels = []
  await run([{ ...okTask, effort: 'low' }], { rigor: 'full' }, labels)
  assert.ok(!labels.some(l => l.startsWith('review:')), `effort:low skips review, got: ${labels}`)
})
