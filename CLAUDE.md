# codeswarm — repo context

Claude Code plugin: multi-agent swarm orchestration (director skill,
agents, workflow scripts, two tiny hooks). Plain markdown/JS — no
package.json, no build step.

## Dev gate (must pass before any commit)

```sh
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'))"
for f in hooks/*.js tools/*.js runner/*.js; do node --check "$f"; done
node --test workflows/*.test.mjs tools/*.test.mjs runner/*.test.mjs
sh hooks/hooks.test.sh
{ [ ! -f .sanitize-terms ] || { git grep -riE --untracked -f .sanitize-terms -- ':!LICENSE' ':!.claude-plugin'; [ $? -eq 1 ]; }; }
```

On Windows, run in Git Bash. CI additionally lints skill/agent frontmatter
(`name:` must match dir/filename).

The last line is the sanitize gate (branding rule): `.sanitize-terms` is a
gitignored, one-regex-per-line term list that must never be committed — when
the file is absent (CI, forks) the check passes silently. Any hit outside
the exclusions (LICENSE + manifest attribution, `.claude-plugin` manifests;
gitignored files like `my-*` are skipped by `git grep` itself) fails the
gate: fix the leak, never widen the exclusions. It runs on `git grep`
because msys `grep -f` (Git Bash ships grep 3.0) can abort on the combined
term list — and the explicit `[ $? -eq 1 ]` means only a genuinely clean
scan passes: a matching term (exit 0) or a crashed grep (exit >1) both fail
loud instead of passing silently.

`node --check` is for hooks, `tools/` and `runner/` only: the workflow
scripts are Workflow-harness modules (`export const meta` + top-level
return) that plain node cannot parse — their syntax gate is
`workflows/syntax.test.mjs`, which runs inside the `node --test` step.

## Invariants

See CONTRIBUTING.md — hard rules: never hardcode a top-tier model in a
workflow script; quiet is the default for every agent; upstream never ships
`my-*` files; generation is approval-gated (content review included); hooks
stay tiny, exit 0, offline, no writes.

## Structural constraints (deliberate — do not "fix")

- Everything rides on Claude Code's Workflow tool, which has no stable
  public API. `workflows/syntax.test.mjs` mirrors the harness wrapper and
  `workflows/harness-contract.test.mjs` executes every script against a
  mock of the documented harness semantics (numbered contract clauses —
  diagnose breakage there first). After a Claude Code update, prove the
  plumbing live with `/codeswarm:swarm smoke` (plus the graded
  `fixtures/eval` run) before trusting the scripts; a passing smoke records
  `lastSmokeVersion` in the config and the SessionStart canary nudges when
  the running version drifts from it. Last live proof: 2026-07-15 on
  Claude Code 2.1.210 (`fixtures/smoke` plumbing pass; `fixtures/eval2`
  graded 4/4 0 FP pass; `fixtures/eval` graded 3/5 — the two documented
  haiku misses). NOTE on the live log: `codeswarm-eval-log.jsonl` now holds
  exactly THREE genuine graded runs (2026-07-09 eval, 2026-07-15 eval2 +
  eval), and every one has a ZERO verify delta. On 2026-07-15 the log was
  purged of a 20-line `2026-07-06` batch that had been backfilled into it
  (19/20 lines shared an identical placeholder `outputTokens`, so they were
  reconstructed history, not independent live runs); a backup sits next to
  the config. The 2026-07-06 figures below are therefore DOCUMENTED HISTORY
  only, not live-log evidence. Run 1: 5/5 recall, 0 false positives,
  baseline identical. The fixture then gained two pure false-positive trap
  files (`jobs.js`, then `schedule.js`); a re-baseline run scored 3/5 recall
  (graded FAIL) and produced the first reported verify delta (1 FP killed).
  A follow-up 20-run batch at the haiku tier (ad hoc script, not shipped)
  surfaced two things now recorded in `fixtures/eval/README.md`: `jobs.js`
  had an UNINTENDED real bug (`firstSuccessful([])` threw `undefined`) that
  verify correctly confirmed as real 4/20 times — fixed, not a verify
  failure; and haiku-tier recall on this fixture is uneven per bug
  (`cart.js`/`stats.js` missed 13/20, `dates.js` missed 0/20) — a property
  of the cheapest tier `swarm-smoke.js` deliberately hardcodes, not a claim
  about `swarm-review.js` (session-model finder, sonnet verify). Reported
  totals from that documented 2026-07-06 batch (NOT in the live log): 1
  false positive killed, 1 real bug wrongly rejected — the only two measured
  deltas ever, opposite signs, and both from data no longer on disk; the
  three genuine live runs are all zero-delta, so there is currently NO live
  A/B evidence either way (single anecdotes — see the honesty section in
  README). A third fixture, `fixtures/eval3`, is precision-weighted: its
  `guards.js` is correct code shaped like notorious bugs (including the
  correct-form twin of `eval2`'s real `<=` off-by-one) to make a finder emit
  a false positive the verify layer can kill — the fixture built to make the
  delta non-zero over repeated runs. Every graded run is recorded via
  `tools/record-eval.js` into `codeswarm-eval-log.jsonl` next to the config
  (accumulating A/B evidence; the tool also owns the `lastSmokeVersion`
  write).
- The Workflow-tool dependency has a shipped fallback: the **standalone
  runner** (`runner/`) executes the workflow scripts UNCHANGED via
  `claude -p` subprocesses (the public headless interface), with its own
  journal/resume under `<configDir>/codeswarm-runs/`.
  `runner/harness.test.mjs` asserts the same C1–C8 contract clauses against
  the real implementation and runs every shipped script through it. When an
  update breaks the Workflow tool: canary fires → smoke fails → dispatch
  via `node runner/run.js` instead (degraded — no /workflows UI, no
  in-session permission prompts — not dead). Read docs/security.md
  "Standalone runner" before touching its permission flags.
- Prompt text is duplicated between `agents/*.md` and the workflow scripts
  on purpose: scripts run without filesystem access and the repo has no
  build step, so single-sourcing is impossible. `dimension-sync.test.mjs`
  guards the copies — extend it when adding a new duplicated clause. (The
  standalone runner does read `agents/*.md` at spawn time — under it the
  agentType body is single-sourced; the in-script duplication stays for the
  Workflow-tool path.)
- The director skill stays PROSE for judgment work (triage, fit & cost
  gate, estimates, task grouping) — that is inherently model judgment and
  cannot move into code. Only mechanical bookkeeping is codified
  (`tools/record-eval.js` owns the eval log + `lastSmokeVersion` write);
  new bookkeeping goes there too, never back into skill prose.
- The review dedup key (`swarm-review.js`) matches EXACT line numbers on
  purpose: no ±N line fuzz — distinct findings on adjacent lines must
  never merge; an occasional double-verify of the same reworded finding is
  the accepted cost.
- The verify layer's value is deliberately stated as THIN evidence (README
  "What's measured vs. designed"): the eval evidence to date holds two
  measured deltas in OPPOSITE directions (one false positive killed, one real
  bug wrongly rejected — from the documented 2026-07-06 batch, NOT retained in
  the current log, which now holds one null-delta run) — anecdotes, not a
  trend, and repeating the SAME fixture adds correlated samples, not
  independent evidence (see the 2026-07-06 batch note above). The only real
  fix is more/varied fixtures graded over time
  — never reword the README claim stronger without log evidence, and never
  "fix" the honesty section away.
- README repeats context that also lives in `docs/` on purpose (cost
  levers, eval story): the README must stand alone for a first-time
  reader; dedup against docs/ is not wanted.

## Docs

`docs/` — architecture, workflows, configuration, security model. Read
`docs/security.md` before touching token handling, hooks, or the onboard
flow.
