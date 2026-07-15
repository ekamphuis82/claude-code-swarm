# Workflow reference

All scripts live in `workflows/`. The director launches them via Claude
Code's Workflow tool with a JSON `args` object; every agent output is forced
through a JSON schema. `quiet` defaults to on for every script (`quiet:
false` only on explicit request). Cost figures are order-of-magnitude agent
counts — actual token spend depends on repo size and the session model.

## swarm-build.js

Plan-driven build. Phases: Implement → Verify → (Review → fix round with
re-test and re-review) → (Retrospect). By DEFAULT (`rigor: 'lite'`) the Review
and Retrospect phases are OFF — a build is implement + one independent test
per task. `rigor: 'full'` (`--thorough`) turns them on. Each stage retries
once on a null agent result; a still-null tester report, or a tester `FAIL`,
is fatal for the stage regardless of the review verdict. `effort: 'low'`
tasks skip the Review stage even under full rigor (tester-only gate).

| Arg | Required | Notes |
|---|---|---|
| `repo` | yes | absolute path |
| `tasks` | yes | `[{id, title, agentType, brief}]`; `agentType` must be plugin-qualified (`codeswarm:<agent>`) — validated at parse time |
| `planPath` | no | plan/findings file the briefs reference |
| `topModel` | no | caps top-tier calls (config) |
| `rigor` | no | `lite` (DEFAULT): implement + one independent test per task, no adversarial review, no retrospect (~1.5–2x raw). `full`: adds the adversarial review + retrospect (~3–4x). `--thorough`/`--rigor=full` sets full |
| `retrospect` | no | `full` (default) / `light` / `off` — only applies under `rigor: 'full'` |
| per-task `stage` | no | consecutive tasks sharing a stage run in parallel — only for provably file-disjoint tasks |
| per-task `effort` | no | `low` mechanical (also skips the adversarial review — tester-only gate, since there is nothing to review in a rename or a schema-field add) / omit to inherit / `high` hard |

Output: per-task verdicts (test output quoted verbatim, reviewer verdict,
fix-round result) + retrospect findings (never auto-fixed). Cost: ~3 agents
per task (implementer, tester, reviewer), +3 per fix round (fix, re-review,
re-test), +1 retrospect per build.

## swarm-review.js

Multi-dimension review. Phases: Find (fused reviewer pass + specialist
finders) → Verify (independent existence checks + severity gate) → ranked
report.

| Arg | Required | Notes |
|---|---|---|
| `repo` | yes | absolute path |
| `target` | no | free-text focus; default = whole repo |
| `dimensions` | no | from: bugs, security, wcag, performance, conventions, architecture, test-coverage. Default set: bugs, security, wcag (unless a11y off), performance, architecture. `test-coverage` is opt-in only; its finder is the tester agent |
| `a11yLevel` | no | off / A / AA / AAA (default AA) — sets the WCAG bar and whether wcag sits in the default set |
| `rigor` | no | `lite` (DEFAULT): single-lens verify for every severity, no severity-honesty check. `full`: graded verify (2 lenses on critical/major + severity check). `--thorough`/`--verify=strict`/`--rigor=full` set full |
| `thorough` | no | full rigor + coverage-guided extra find rounds until dry (capped), and implies `verify: 'strict'` |
| `verify` | no | `'normal'` (default: 2-lens unanimous on critical/major, 1-lens on minors) or `'strict'` (full lens set for every severity, minors included; the `--verify=strict` flag sets this) |
| `sinceRef` | no | diff-scoped: only code changed since this git ref |
| `waivers` | no | accepted findings to skip (see [configuration.md](configuration.md)) |
| `topModel` | no | caps finder tier |

Output: confirmed findings (file:line, severity, evidence; `waivedAttempt:
true` marks a critical someone tried to waive — criticals are never waivable,
and waiver `match` strings under 8 chars are skipped), rejected list,
`verifyFailed` list (all verify lenses failed after retry — unresolved, not
rejected), waived list, runtime checks it could not perform. Cost: 1 fused finder + 1 per specialist
dimension, then 1–6 verify agents per finding (the upper end only on lens
retries or a contested critical downgrade — a severity downgrade FROM
critical requires a second independent agreeing severity check, so one
flaky check can never hide a critical).

## swarm-refactor.js

Repo-wide mechanical change. Phases: Discover (site inventory) → Transform
(batched, cheap tier) → Verify (independent).

| Arg | Required | Notes |
|---|---|---|
| `repo` | yes | absolute path |
| `instruction` | yes | the transformation, precisely stated |
| `scope` | no | path/glob restriction |

Output: sites found, files changed, skipped sites with reasons,
`failedSites` (sites whose batch nulled twice — must be re-run), verify
result. Cost: 1 discovery + ~1 transformer per file batch + 1 verifier.

## swarm-research.js

Multi-angle research. Phases: Research (one researcher per angle) → Judge
(score each answer) → Synthesize (with sources).

| Arg | Required | Notes |
|---|---|---|
| `question` | yes | the research question |
| `repo` | no | anchor repo for codebase questions |
| `angles` | no | override the default angle set |
| `topModel` | no | caps researcher/synthesis tier |

Output: synthesized answer, per-angle evidence, unknowns. Cost: 1 agent per
angle + judges + 1 synthesis.

## swarm-onboard.js

Generates stack agents + convention skills from YOUR repos, into your
clone. Two modes with a human approval gate between them — generate never
runs on an unseen proposal.

| Arg | Required | Notes |
|---|---|---|
| `pluginDir` | yes | absolute path to your plugin clone (generation target) |
| `repos` | propose mode | `[{name, path}]` — scan mode (strongly recommended). Mutually exclusive with `stacks`; passing both throws |
| `stacks` | propose mode | `[{name, version?, notes?}]` — stack-default fallback when you have no repos to scan (or decline the scan); generates a version-pinned roster with a visible stack-default marker, no repo-derived conventions. Alternative to `repos` |
| `mode` | no | `propose` (default, writes nothing) / `generate` |
| `proposal` | generate mode | the user-approved proposal object |
| `topModel` | no | caps inventory/synthesis tier |
| `existingAgents` | no | `[{name, description}]` — the session's non-codeswarm custom agents (the director collects them); a proposed agent whose role one already covers carries an `overlap` field (`existingAgent`, `adopt-existing`/`generate-anyway`, reason) for the approval gate |
| `adHocSpecialists` | no | generate mode; `true` (from the config, passed through by the director) softens the routing hint stamped into generated agent descriptions — direct use sanctioned for small single-scope tasks |

Output (propose): `{proposal: {agents, skills}, plannedFiles, inventories}`.
Output (generate): `{generated, skipped}` — existing files are never
overwritten; everything is `my-` prefixed. Cost: 1 shipped-name listing
agent (cheapest tier) + 1 inventory agent per repo + 1 synthesis (propose);
1 writer per generated file (generate).

## swarm-drift.js

Convention-skill drift guard: are the generated skills still true of the
code? Phases: Scan (one comparer per repo) → Synthesize (merge and rank).

| Arg | Required | Notes |
|---|---|---|
| `repos` | yes | `[{name, path}]` |
| `skillsDir` | yes | absolute path to the plugin `skills/` directory |
| `topModel` | no | caps synthesis tier |

Output: ranked drifts (`{skill, rule, reality, evidence, severity, repo,
suggestedEdit}`) plus `failedRepos` (repos whose scan nulled — NOT
drift-free, just unverified). Cost: 1 agent per repo + 1 synthesis.

## swarm-smoke.js

Plugin self-test against a planted-bug fixture. Phases: Find → Verify.

| Arg | Required | Notes |
|---|---|---|
| `fixtureDir` | yes | absolute path to `fixtures/smoke` (quick plumbing check) or `fixtures/eval` (graded) |
| `expected` | no | `[{file, mustMatch?}]` — graded mode. The director reads the fixture's `expected.json` (workflow scripts have no filesystem access) and passes it through. Pass = every entry matched by a confirmed finding (`file` is a path substring, `mustMatch` a case-insensitive regex on the problem text); confirmed findings outside the expected files return under `unexpected` (false positives). |

Output: pass/fail, `confirmed`, and in graded mode `missed` + `unexpected`
plus `baseline` — the RAW pre-verify finder output graded against the same
expected set, at zero extra agents. The delta between `baseline` and the
verified numbers is the measured value of the verify layer:
`baseline.unexpected` entries missing from `unexpected` are false positives
verification killed; `missed` entries absent from `baseline.missed` are
real bugs verification wrongly rejected. Cost: 1 finder + 1 verifier per
finding, cheap tier — the fastest way to check the plumbing works; the
graded `fixtures/eval` run additionally measures finder recall (missed)
and precision (unexpected). Bookkeeping runs through `tools/record-eval.js`
in the plugin clone (the log format and the config write live in code, not
in director prose): after a PASSING smoke the director runs it with
`--smoke-pass <version>` to record `lastSmokeVersion` in the config — the
SessionStart update canary compares against it; after EVERY graded run
(pass or fail) the director feeds it the graded numbers and it appends one
JSONL line (date, version, recall/precision plus the baseline numbers) to
`codeswarm-eval-log.jsonl` next to the config and prints the running
totals: the accumulated verified-vs-baseline delta across that log is the
A/B evidence for the verify layer — one run alone is an anecdote.

## Shared behavior

- **Budget self-scaling**: give a token target in your prompt ("+200k") and
  the scripts see it ambiently — reviews drop to single-lens verify and stop
  extra find rounds when the target runs low. Nothing to pass in args.
- **Resume**: `/codeswarm:swarm resume` continues a crashed/limit-killed run;
  completed agents replay free from cache (cache key = prompt + opts, so
  resume with the exact launch-time script version).
- **Null discipline**: critical stages retry once on a null agent result;
  every run writes a `journal.jsonl` you can read before diagnosing.
- **Token accounting**: every script returns a `tokens` object
  (`{total, <phase>: n, ...}`) — best-effort per-phase output-token deltas
  (`budget.spent()` at phase boundaries). The director folds it into the
  cost line it reports after every run, so you learn which stage the
  tokens actually went to.
