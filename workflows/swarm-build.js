export const meta = {
  name: 'swarm-build',
  description: 'Plan-driven build: per task implement (TDD) → independent test verify → adversarial review, fix round with re-test → architecture retrospect; tasks with the same stage run in parallel [internal: launched by swarm-director]',
  phases: [
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Review' },
    { title: 'Retrospect' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.repo) throw new Error('args.repo (absolute path) is required')
if (!Array.isArray(A.tasks) || !A.tasks.length) throw new Error('args.tasks [{id,title,agentType,brief}] is required — director builds this from the approved plan')
// fail fast — a malformed task otherwise surfaces deep in the run as null
// dispatches or clobbered per-task results
for (const t of A.tasks) {
  if (t.id == null || String(t.id).trim() === '') throw new Error('task validation: every task needs a non-empty id (0 is allowed)')
  if (typeof t.title !== 'string' || !t.title.trim()) throw new Error(`task ${t.id}: title is required`)
  if (typeof t.brief !== 'string' || !t.brief.trim()) throw new Error(`task ${t.id}: brief is required`)
  if (typeof t.agentType !== 'string' || !t.agentType.includes(':')) throw new Error(`task ${t.id}: agentType "${t.agentType}" is not plugin-qualified — use "codeswarm:agent-name" (onboard returns bare names; the director adds the prefix)`)
}
const ids = A.tasks.map(t => String(t.id))
const dupeId = ids.find((id, i) => ids.indexOf(id) !== i)
if (dupeId) throw new Error(`task validation: duplicate task id "${dupeId}" — ids must be unique (per-task results are keyed by id)`)
// quiet-by-default invariant (CONTRIBUTING)
const QUIET = A.quiet === false ? '' : '\nOUTPUT DISCIPLINE (silent mode): no narration between tool calls; never print diffs, file dumps or code blocks into your transcript (write files with your tools, do not echo them); read only what you need; deliver ONLY the structured output, every string field terse (facts, file:line refs, verbatim test summary lines).'
// unset topModel = no model key -> inherits the SESSION model; never break that fallback (spec item 5)
const TOP = A.topModel ? { model: A.topModel } : {}
// rigor default 'lite' (spec item 28): implement + ONE independent test per task
// (~1.5-2x raw) — the tester always gates correctness; 'full' adds adversarial
// review + retrospect (~3-4x) for work where a bug is expensive
const RIGOR = A.rigor === 'full' ? 'full' : 'lite'
const LITE = RIGOR === 'lite'
// retrospect full|light|off (spec item 12); lite rigor forces off
const RETRO_MODE = LITE ? 'off' : (['full', 'light', 'off'].includes(A.retrospect) ? A.retrospect : 'full')

// per-phase output-token laps (best-effort: budget.spent() is turn-wide);
// build phases interleave per task, so the split is tasks vs retrospect only
const T0 = budget.spent()
let tPrev = T0
const tokensByPhase = {}
const lap = name => { tokensByPhase[name] = (tokensByPhase[name] ?? 0) + budget.spent() - tPrev; tPrev = budget.spent() }
const tokens = () => ({ total: budget.spent() - T0, ...tokensByPhase })

const IMPL = {
  type: 'object', required: ['filesChanged', 'testsRun', 'testOutput', 'risks'],
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'string' }, testOutput: { type: 'string', description: 'verbatim summary line' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}
const TESTREP = {
  type: 'object', required: ['suiteResult', 'edgeCasesTried', 'verdict'],
  properties: {
    suiteResult: { type: 'string', description: 'verbatim summary line' },
    edgeCasesTried: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'], description: 'PASS | FAIL' },
  },
}
const REVIEW = {
  type: 'object', required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES-REQUESTED'], description: 'APPROVE | CHANGES-REQUESTED' },
    findings: { type: 'array', items: { type: 'string' }, description: 'path:line — severity — problem — fix' },
  },
}
const RETRO = {
  type: 'object', required: ['coherent', 'findings'],
  properties: {
    coherent: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' }, description: 'path — problem — fix (architecture / package hygiene / DX only)' },
  },
}

const GATE = `\nIf the repo ships a project-local gate skill (check ${A.repo}/.claude/skills (example: a project-local code-grade-style gate)), run it via the Skill tool and fold its verdict into suiteResult.`

// <build-helpers> (extracted verbatim by build-helpers.test.mjs — keep pure, no A/log/agent)
// fix gate: a FAIL suite must be fixed even when the review approved/was skipped
const needsFixRound = (review, test) => (!!review && review.verdict !== 'APPROVE') || test?.verdict === 'FAIL'
// everything the fix agent must address — review findings first, tester FAIL last
const fixFindings = (review, test) => [
  ...(review?.findings ?? []),
  ...(test?.verdict === 'FAIL' ? [`tester FAIL: ${test.suiteResult}`] : []),
].join('\n')
// the diff on disk is now the fix — its test report supersedes the pre-fix one;
// files/risks accumulate (deduped): they describe the whole task, not one round
const mergeImpl = (impl, fix) => ({
  ...impl,
  filesChanged: [...new Set([...(impl.filesChanged ?? []), ...(fix.filesChanged ?? [])])],
  testsRun: fix.testsRun, testOutput: fix.testOutput,
  risks: [...new Set([...(impl.risks ?? []), ...(fix.risks ?? [])])],
})
// consecutive tasks sharing a `stage` run IN PARALLEL — director may only
// co-stage provably file-disjoint tasks (same working tree); no stage = sequential.
// CONSECUTIVE on purpose: non-adjacent same-stage tasks stay sequential, so an
// interleaved dependent task is never overtaken
const groupStages = tasks => {
  const stageList = []
  for (const t of tasks) {
    const prev = stageList[stageList.length - 1]
    if (t.stage != null && prev && prev.key === t.stage) prev.tasks.push(t)
    else stageList.push({ key: t.stage ?? null, tasks: [t] })
  }
  return stageList
}
// </build-helpers>

async function runTask(t) {
  const brief = `Repo: ${A.repo}\nPlan: ${A.planPath ?? 'brief only'}\nTask ${t.id}: ${t.title}\n${t.brief}\nFollow your standing instructions (mandatory skills, repo CLAUDE.md, TDD: failing test first).${QUIET}`
  let impl = await agent(brief, { label: `impl:${t.id}`, phase: 'Implement', schema: IMPL, agentType: t.agentType, effort: t.effort, ...TOP })
  if (!impl) { log(`task ${t.id}: implementer null — one retry`); impl = await agent(brief, { label: `impl-retry:${t.id}`, phase: 'Implement', schema: IMPL, agentType: t.agentType, effort: t.effort, ...TOP }) }
  if (!impl) {
    log(`task ${t.id}: implementer returned null`)
    return { task: t.id, title: t.title, implemented: null, error: 'implementer returned null' }
  }

  const testBrief = `Independently VERIFY task "${t.title}" in repo ${A.repo}. The implementer claims: files ${JSON.stringify(impl.filesChanged)}, tests "${impl.testsRun}" -> "${impl.testOutput}". Re-run the suite yourself, then try to break the change with edge cases the author likely missed.${GATE}${QUIET}`
  let test = await agent(testBrief, { label: `test:${t.id}`, phase: 'Verify', schema: TESTREP, agentType: 'codeswarm:swarm-tester', model: 'sonnet' })
  if (!test) { log(`task ${t.id}: tester null — one retry`); test = await agent(testBrief, { label: `test-retry:${t.id}`, phase: 'Verify', schema: TESTREP, agentType: 'codeswarm:swarm-tester', model: 'sonnet' }) }

  // effort:low tasks and lite rigor skip the adversarial review — tester still gates
  const skipReview = t.effort === 'low' || LITE
  const reviewBrief = `Adversarially review the diff for task "${t.title}" in repo ${A.repo} (files: ${JSON.stringify(impl.filesChanged)}). Tester verdict: ${test?.verdict ?? 'unknown'}.${QUIET}`
  let review = null
  if (skipReview) {
    log(`task ${t.id}: effort=low — adversarial review skipped (tester-only gate)`)
  } else {
    review = await agent(reviewBrief, { label: `review:${t.id}`, phase: 'Review', schema: REVIEW, agentType: 'codeswarm:swarm-reviewer', effort: 'max', ...TOP })
    if (!review) { log(`task ${t.id}: reviewer null — one retry`); review = await agent(reviewBrief, { label: `review-retry:${t.id}`, phase: 'Review', schema: REVIEW, agentType: 'codeswarm:swarm-reviewer', effort: 'max', ...TOP }) }
  }

  // one fix round (gate + findings composition: build-helpers above)
  if (needsFixRound(review, test)) {
    const priorFindings = fixFindings(review, test)
    let fix = await agent(
      `${brief}\nFIX ROUND — address ALL of the following before returning:\n${priorFindings}`,
      { label: `fix:${t.id}`, phase: 'Implement', schema: IMPL, agentType: t.agentType, effort: t.effort, ...TOP }
    )
    if (!fix) { log(`task ${t.id}: fix agent null — one retry`); fix = await agent(`${brief}\nFIX ROUND — address ALL of the following before returning:\n${priorFindings}`, { label: `fix-retry:${t.id}`, phase: 'Implement', schema: IMPL, agentType: t.agentType, effort: t.effort, ...TOP }) }
    if (fix) {
      impl = mergeImpl(impl, fix)
      // a stale pre-fix PASS/FAIL is worthless — always re-test
      const retestBrief = `Re-VERIFY task "${t.title}" in repo ${A.repo} AFTER a fix round (changed files now: ${JSON.stringify(impl.filesChanged)}). Re-run the suite and re-try the edge cases.${GATE}${QUIET}`
      test = await agent(retestBrief, { label: `re-test:${t.id}`, phase: 'Verify', schema: TESTREP, agentType: 'codeswarm:swarm-tester', model: 'sonnet' })
      if (!test) { log(`task ${t.id}: re-tester null — one retry`); test = await agent(retestBrief, { label: `re-test-retry:${t.id}`, phase: 'Verify', schema: TESTREP, agentType: 'codeswarm:swarm-tester', model: 'sonnet' }) }
      // null re-review keeps the pre-fix verdict — never silently upgrade unreviewed fix code
      if (!skipReview) {
        const rereviewBrief = `Re-review the diff for task "${t.title}" in repo ${A.repo} after a fix round (files: ${JSON.stringify(impl.filesChanged)}). Previous findings:\n${(review?.findings ?? []).join('\n')}${QUIET}`
        const rereviewed = await agent(rereviewBrief, { label: `re-review:${t.id}`, phase: 'Review', schema: REVIEW, agentType: 'codeswarm:swarm-reviewer', effort: 'max', ...TOP })
        if (rereviewed) review = rereviewed
      }
    }
  }

  log(`task ${t.id}: tester=${test?.verdict ?? '?'} review=${review?.verdict ?? (skipReview ? 'skipped' : '?')}`)
  return { task: t.id, title: t.title, implemented: impl, testerReport: test, reviewVerdict: review, reviewSkipped: skipReview }
}

const stageList = groupStages(A.tasks)

const results = []
for (const st of stageList) {
  phase('Implement')
  let rs
  if (st.tasks.length === 1) {
    rs = [await runTask(st.tasks[0])]
  } else {
    log(`stage ${st.key}: ${st.tasks.length} file-disjoint tasks in parallel`)
    rs = (await parallel(st.tasks.map(t => () => runTask(t)))).map((r, i) => r ?? { task: st.tasks[i].id, title: st.tasks[i].title, implemented: null, error: 'task runner failed' })
  }
  results.push(...rs)
  // tester FAIL or missing tester report is fatal regardless of the review
  // verdict — an approved diff on a red suite must not build onward
  const fatal = rs.some(r => r.error || !r.testerReport || r.testerReport.verdict === 'FAIL')
  if (fatal) {
    log('stopping after this stage: unresolved failure — director must intervene')
    break
  }
}

lap('tasks')
// whole-build architecture pass — coherence only shows ACROSS tasks. Never
// auto-fixes: findings go back to the director.
phase('Retrospect')
let retrospect = null
const delivered = results.filter(r => r.implemented)
if (RETRO_MODE === 'off') {
  log('retrospect: off (configured) — phase skipped')
} else if (delivered.length >= 2) {
  // below 2 tasks there is nothing cross-task to judge
  const allFiles = [...new Set(delivered.flatMap(r => r.implemented.filesChanged ?? []))]
  // full-mode FOCUS embeds the canonical <arch-dimension> clause from
  // agents/swarm-reviewer.md verbatim — dimension-sync.test.mjs guards it
  const FOCUS = RETRO_MODE === 'light'
    ? 'LIGHT MODE — judge ONLY breaking cross-task architecture problems: architectural misfit with the existing codebase, wrong layer direction, broken seams or contracts between the delivered tasks. Do NOT report DX, naming or package/folder-hygiene nits.'
    : 'Judge ONLY cross-task coherence: architectural fit with the existing codebase, layer direction, package/folder hygiene (no class dumps in a package root — dto/, components/, service/ etc. need logical submodules), naming consistency, DX (discoverability, readability).'
  retrospect = await agent(
    `Retrospective ARCHITECTURE review of repo ${A.repo} after a ${delivered.length}-task build (files touched: ${JSON.stringify(allFiles)}). ${FOCUS} Do NOT re-review correctness — that is done. Do NOT fix anything — report only. coherent=false requires at least one concrete finding.${QUIET}`,
    { label: 'retrospect', phase: 'Retrospect', schema: RETRO, agentType: 'codeswarm:swarm-reviewer', effort: 'max', ...TOP }
  )
  if (retrospect) log(`retrospect (${RETRO_MODE}): coherent=${retrospect.coherent}, ${retrospect.findings.length} finding(s)`)
  else log('retrospect agent failed — no architecture verdict')
}

lap('retrospect')
return { repo: A.repo, results, retrospect, retrospectMode: RETRO_MODE, tokens: tokens() }
