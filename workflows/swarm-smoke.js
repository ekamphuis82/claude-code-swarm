export const meta = {
  name: 'swarm-smoke',
  description: 'Plugin self-test: one finder + one verifier per finding against a planted-bug fixture, graded against expected findings when provided [internal: launched by swarm-director]',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.fixtureDir) throw new Error('args.fixtureDir (absolute path to a fixture dir, e.g. fixtures/smoke or fixtures/eval) is required')
// graded mode: director reads the fixture's expected.json (scripts have no fs)
// and passes expected [{file, mustMatch?}]; unmatched entry = missed, extra
// confirmed finding = false positive
const expected = Array.isArray(A.expected) && A.expected.length ? A.expected : null
if (A.expected !== undefined && !expected) throw new Error('args.expected must be a non-empty array of {file, mustMatch?}')
for (const e of expected ?? []) {
  if (typeof e.file !== 'string' || !e.file) throw new Error('every expected entry needs a file (substring of the finding path)')
  if (e.mustMatch !== undefined) new RegExp(e.mustMatch, 'i') // bad regex fails loud at parse time
}
// sandbox contract probe: every shipped script guards Node-global access with
// `typeof` (e.g. swarm-review.js CASE_FOLD; contract C8 — absent, access throws,
// typeof safe: live-proven 2026-07-07 on 2.1.202). If a harness update ever makes
// the typeof pattern itself throw, smoke fails HERE with a clear trace instead of
// an expensive workflow dying mid-run on its own guard.
if (typeof process !== 'undefined') log('sandbox unexpectedly exposes `process` — shipped scripts assume Node globals are absent (C8)')

// quiet-by-default invariant (CONTRIBUTING)
const QUIET = A.quiet === false ? '' : '\nOUTPUT DISCIPLINE (silent mode): no narration between tool calls; never print diffs or file dumps; deliver ONLY the structured output, terse.'
// smoke runs entirely on haiku BY DESIGN (cheapest self-test) — args.topModel is
// accepted but deliberately unwired (spec item 5)

// per-phase output-token laps (best-effort: budget.spent() is turn-wide)
const T0 = budget.spent()
let tPrev = T0
const tokensByPhase = {}
const lap = name => { tokensByPhase[name] = (tokensByPhase[name] ?? 0) + budget.spent() - tPrev; tPrev = budget.spent() }
const tokens = () => ({ total: budget.spent() - T0, ...tokensByPhase })

const FINDINGS = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['file', 'line', 'problem'],
        properties: { file: { type: 'string' }, line: { type: 'integer' }, problem: { type: 'string' } },
      },
    },
  },
}
// same three states as swarm-review.js: "cannot confirm" is never "refuted"
const VERDICT = {
  type: 'object', required: ['verdict', 'reason', 'evidence'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'inconclusive'], description: 'confirmed | refuted | inconclusive' },
    reason: { type: 'string' },
    evidence: { type: 'string', description: 'the input tried and the behaviour observed, or the exact file:line; empty only when inconclusive' },
  },
}

phase('Find')
const found = await agent(
  `Review the tiny JavaScript codebase at ${A.fixtureDir} for correctness bugs. Skip README files. Report exact file:line.${QUIET}`,
  { label: 'smoke:find', phase: 'Find', schema: FINDINGS, agentType: 'codeswarm:swarm-reviewer', model: 'haiku' }
)

lap('find')
phase('Verify')
const verified = await parallel((found?.findings ?? []).map(f => () =>
  agent(
    `Adversarially verify this finding in ${A.fixtureDir}: ${f.file}:${f.line} — ${f.problem}. Read the code; construct the concrete failing input. confirmed only when you established the wrong behaviour; refuted only with counter-evidence (the input tried and the behaviour observed, or the file:line that rules it out); otherwise inconclusive — never guess. Put the proof in evidence.${QUIET}`,
    { label: `smoke:verify:${f.line}`, phase: 'Verify', schema: VERDICT, model: 'haiku' }
  ).then(v => v && { ...f, ...v })
))

lap('verify')
// a verdict without evidence is not stated (mirrors normalizeVote in swarm-review.js)
const stated = v => String(v.evidence ?? '').trim() !== ''
const confirmed = verified.filter(Boolean).filter(v => v.verdict === 'confirmed' && stated(v))
const inconclusive = verified.filter(Boolean).filter(v => !((v.verdict === 'confirmed' || v.verdict === 'refuted') && stated(v)))
const raw = found?.findings ?? []
// null verify = infra failure: neither a kill nor a wrong rejection
const unresolved = [...inconclusive, ...raw.filter((_, i) => !verified[i])]
// <eval-verdict> pass grading — extracted verbatim by eval-verdict.test.mjs
const matchesExpected = (e, c) => c.file.includes(e.file) && (e.mustMatch === undefined || new RegExp(e.mustMatch, 'i').test(c.problem))
const missed = (expected ?? []).filter(e => !confirmed.some(c => matchesExpected(e, c)))
const unexpected = expected ? confirmed.filter(c => !expected.some(e => c.file.includes(e.file))) : []
const pass = expected ? missed.length === 0 : confirmed.length >= 1
// free A/B baseline: grade the RAW pre-verify finder output against the same set.
// killed = baselineUnexpected - unexpected - unexpectedInconclusive; wrongly
// rejected = missed - baselineMissed - missedInconclusive (as tools/record-eval.js books it)
const baseline = expected ? {
  missed: expected.filter(e => !raw.some(c => matchesExpected(e, c))),
  unexpected: raw.filter(c => !expected.some(e => c.file.includes(e.file))),
} : null
// inconclusive is neither killed nor wrongly rejected: an unresolved false
// positive or an unresolved planted bug is counted apart, so the A/B metric
// (baseline minus verified) never books it as a verify win or loss
const missedInconclusive = missed.filter(e => unresolved.some(c => matchesExpected(e, c)))
const unexpectedInconclusive = expected ? unresolved.filter(c => !expected.some(e => c.file.includes(e.file))) : []
// </eval-verdict>
return { pass, confirmed, inconclusive, missed, unexpected, ...(expected ? { missedInconclusive, unexpectedInconclusive } : {}), baseline, raw, tokens: tokens() }
