// Harness-contract test: executes EVERY workflow script against a mock of the
// Workflow harness implementing the documented semantics the scripts rely on.
// Two jobs:
//
// 1. CONTRACT — this mock is the written-down list of harness behaviors the
//    scripts assume. The Workflow tool has no stable public API; after a
//    Claude Code update a live `/codeswarm:swarm smoke` proves the real harness
//    still matches, and THIS file is where the assumptions live, so a mismatch
//    is diagnosed against a named clause instead of mid-run:
//      C1. agent(prompt, opts) resolves to schema-shaped data, or null on a
//          user skip / terminal agent error — it never rejects below the
//          budget ceiling.
//      C2. parallel(thunks) is a barrier that NEVER rejects: a thunk that
//          throws (or whose agent errors) resolves to null in the result array.
//      C3. pipeline(items, ...stages) runs stages per item with no barrier;
//          each stage receives (prev, originalItem, index); a throwing stage
//          drops the item to null and skips its remaining stages.
//      C4. phase(title) and log(message) are fire-and-forget, never throw.
//      C5. budget = {total, spent(), remaining()}; total null = no target and
//          remaining() === Infinity; spent() grows monotonically.
//      C6. args arrives verbatim — object or stringified JSON (scripts parse
//          defensively either way).
//      C7. a script runs as ONE async function body: `export const meta`
//          stripped, top-level return/await legal (mirrors syntax.test.mjs).
//      C8. the harness provides ONLY the documented globals (args, budget,
//          agent, parallel, pipeline, phase, log, workflow) plus standard JS
//          built-ins — NO Node/host globals (process, console, require, fs).
//          The sandbox deliberately omits them, so an undeclared dependency
//          fails HERE instead of live; a script probing the environment must
//          typeof-guard the probe (see CASE_FOLD in swarm-review.js).
//
// 2. REGRESSION — with agent() returning schema-derived fakes, every script
//    must run to completion and return its documented result shape, and every
//    agent call must respect the CONTRIBUTING invariants: a schema and label
//    on every call, the quiet directive by default, no hardcoded top-tier
//    model (only the cheap/verify tiers may be pinned), and only phase titles
//    that meta.phases declares.
//
// Run: node --test workflows/harness-contract.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// C7: strip the export keyword; `meta = {...}` then lands on the sandbox global
const load = f => readFileSync(join(here, f), 'utf8').replace(/^export\s+const\s+meta/m, 'meta')

// minimal valid instance from a JSON schema — arrays get ONE item so findings
// and sites actually flow through the verify/transform paths
function fake(schema) {
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

async function run(file, args) {
  const calls = []
  const phases = new Set()
  let spent = 0
  const sandbox = {
    meta: null,
    args,
    agent: async (prompt, opts) => {                                    // C1
      calls.push({ prompt: String(prompt), opts: opts ?? {} })
      if (opts?.phase) phases.add(opts.phase)
      spent += 1000
      return fake(opts?.schema)
    },
    parallel: async thunks =>                                           // C2
      Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null))),
    pipeline: async (items, ...stages) =>                               // C3
      Promise.all(items.map(async (item, i) => {
        let prev = item
        for (const s of stages) {
          try { prev = await s(prev, item, i) } catch { return null }
        }
        return prev
      })),
    phase: t => { phases.add(t) },                                      // C4
    log: m => { assert.equal(typeof m, 'string', `${file}: log() got a non-string`) },
    budget: { total: null, spent: () => spent, remaining: () => Infinity }, // C5
    workflow: async () => { throw new Error('workflow() must not be called by shipped scripts') },
    // C8: no process/console/require here ON PURPOSE — the real harness has none
  }
  vm.createContext(sandbox)
  const result = await new vm.Script(`(async () => { ${load(file)} })()`).runInContext(sandbox)
  return { result, calls, phases: [...phases], meta: sandbox.meta }
}

// CONTRIBUTING invariants, asserted over every agent call of every run
function assertInvariants(file, { calls, phases, meta, result }) {
  assert.ok(calls.length > 0, `${file}: no agent was ever dispatched`)
  const declared = new Set((meta?.phases ?? []).map(p => p.title))
  for (const { prompt, opts } of calls) {
    assert.equal(typeof opts.label, 'string', `${file}: agent call without a label`)
    assert.ok(opts.label.length, `${file}: empty agent label`)
    assert.ok(opts.schema && typeof opts.schema === 'object', `${file}: agent call "${opts.label}" without a schema (structured output is mandatory)`)
    assert.match(prompt, /silent mode/, `${file}: agent call "${opts.label}" is missing the quiet directive (quiet is the default)`)
    if (opts.model !== undefined) {
      assert.ok(['haiku', 'sonnet'].includes(opts.model),
        `${file}: agent call "${opts.label}" hardcodes model "${opts.model}" — top tier must inherit the session model (only topModel via args may override)`)
    }
  }
  for (const p of phases) {
    assert.ok(declared.has(p), `${file}: phase "${p}" is not declared in meta.phases (${[...declared].join(', ')})`)
  }
  assert.ok(result && typeof result === 'object', `${file}: script did not return a result object`)
  assert.equal(typeof result.tokens?.total, 'number', `${file}: result carries no tokens.total accounting`)
}

test('swarm-smoke.js: legacy mode returns the graded shape', async () => {
  const r = await run('swarm-smoke.js', { fixtureDir: '/fx' })
  assertInvariants('swarm-smoke.js', r)
  assert.equal(typeof r.result.pass, 'boolean')
  assert.ok(Array.isArray(r.result.confirmed))
  assert.ok(Array.isArray(r.result.raw))
  assert.equal(r.result.baseline, null, 'no baseline outside graded mode')
})

test('swarm-smoke.js: graded mode with STRINGIFIED args (C6) grades and baselines', async () => {
  const r = await run('swarm-smoke.js', JSON.stringify({ fixtureDir: '/fx', expected: [{ file: 'x' }] }))
  assertInvariants('swarm-smoke.js', r)
  assert.equal(r.result.pass, true, 'the fake finding matches the expected entry')
  assert.equal(r.result.missed.length, 0)
  assert.ok(r.result.baseline && Array.isArray(r.result.baseline.missed))
})

test('swarm-review.js: default dimensions produce the ranked-report shape', async () => {
  const r = await run('swarm-review.js', { repo: '/repo' })
  assertInvariants('swarm-review.js', r)
  for (const k of ['confirmed', 'rejected', 'verifyFailed', 'waived', 'dimensionsCovered']) {
    assert.ok(Array.isArray(r.result[k]), `review result.${k} must be an array`)
  }
  assert.ok(r.result.confirmed.length >= 1, 'the fake isReal finding must confirm')
})

test('swarm-review.js: full rigor dispatches the graded verify and the severity check', async () => {
  const r = await run('swarm-review.js', { repo: '/repo', rigor: 'full' })
  assertInvariants('swarm-review.js', r)
  assert.ok(r.calls.some(c => c.opts.label.startsWith('severity:')), 'severity check must run under full rigor')
  assert.ok(r.result.confirmed.length >= 1)
})

test('swarm-build.js: lite build returns per-task verdicts, no retrospect', async () => {
  const tasks = [
    { id: 'T1', title: 't1', brief: 'b1', agentType: 'codeswarm:x' },
    { id: 'T2', title: 't2', brief: 'b2', agentType: 'codeswarm:x' },
  ]
  const r = await run('swarm-build.js', { repo: '/repo', tasks })
  assertInvariants('swarm-build.js', r)
  assert.equal(r.result.results.length, 2)
  assert.equal(r.result.retrospect, null, 'lite rigor skips the retrospect')
  assert.equal(r.result.retrospectMode, 'off')
})

test('swarm-research.js: answers, judges and synthesizes with per-angle scores', async () => {
  const r = await run('swarm-research.js', { question: 'q' })
  assertInvariants('swarm-research.js', r)
  assert.equal(typeof r.result.answer, 'string')
  assert.ok(Array.isArray(r.result.perAngle) && r.result.perAngle.length >= 1)
})

test('swarm-refactor.js: discovers, transforms and verifies', async () => {
  const r = await run('swarm-refactor.js', { repo: '/repo', instruction: 'rename x to y' })
  assertInvariants('swarm-refactor.js', r)
  assert.ok(Array.isArray(r.result.sites) && r.result.sites.length >= 1)
  assert.ok(Array.isArray(r.result.transformed))
  assert.ok(r.result.verifyReport, 'verify report present')
})

test('swarm-drift.js: scans and merges into a drift list', async () => {
  const r = await run('swarm-drift.js', { repos: [{ name: 'r', path: '/r' }], skillsDir: '/s' })
  assertInvariants('swarm-drift.js', r)
  assert.ok(Array.isArray(r.result.drifts))
  assert.ok(Array.isArray(r.result.failedRepos))
})

test('swarm-onboard.js: propose mode writes nothing and returns a proposal shape', async () => {
  const r = await run('swarm-onboard.js', { pluginDir: '/p', repos: [{ name: 'r', path: '/r' }] })
  assertInvariants('swarm-onboard.js', r)
  assert.equal(r.result.mode, 'propose')
  assert.ok(Array.isArray(r.result.plannedFiles))
})

test('swarm-onboard.js: generate mode enforces the dictated target path', async () => {
  const proposal = { agents: [{ name: 'alpha', description: 'd', scope: 's', evidence: 'e', skills: [], rules: [] }], skills: [] }
  const r = await run('swarm-onboard.js', { pluginDir: '/p', mode: 'generate', proposal })
  assertInvariants('swarm-onboard.js', r)
  assert.equal(r.result.mode, 'generate')
  // the fake writer claims path "x" which never equals the dictated target,
  // so nothing may be counted as generated (trust-nothing path check)
  assert.equal(r.result.generated.length, 0)
})
