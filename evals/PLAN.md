# codeswarm eval suite — design (NOT yet written as cases, NOT yet run)

Status: **paused at Gate 1 (inputs) — awaiting run on Friday 2026-09-25 if 5h
token budget allows.** Nothing under `evals/` has been executed. This file is
the interview state so the work resumes without redoing it.

Authored during `claude plugin eval init`, 2026-09-21.

## Scope: ONE flow

**swarm-director triage + altitude/fit gate.** Chosen over swarm-doctor,
swarm-review end-to-end and the onboard propose flow. It is the entry gate every
other route rides on, and it can be graded without dispatching a workflow.

## What "good" means (the spec the graders are written against)

Four failure modes, confirmed by the author as what the suite must catch:

| # | Failure | A case must catch |
|---|---|---|
| F1 | Fans out on trivial work | under-floor task ⇒ inline, no workflow |
| F2 | Silent launch | fit + cost line present before any dispatch |
| F3 | Wrong route | triage table maps the phrasing to the right script |
| F4 | Missed carve-out | auth/schema/money/new-dep escalates even when tiny |

## How the plugin actually gets triggered (checked, matters for the suite)

- `hooks/swarm-router.js` fires only on the literal word **"swarm"** in the
  prompt, and only when `~/.claude/codeswarm.json` exists.
- `hooks/session-start.js` injects the always-on routing directive only when
  `alwaysOn: true`.
- Author's config on both installs: **`alwaysOn: false`**.

⇒ In real use the plugin is almost never invoked explicitly; it must auto-trigger
on big/complex tasks via the **swarm-director skill description alone**
("…or for any multi-agent work"). That is the weakest link and what these inputs
measure. Every fire case below therefore avoids the word "swarm" entirely.

## Inputs (5 fire, 2 should-NOT-fire) — Gate 1, not yet approved

Real traffic yielded nothing usable: 545 transcripts mined (WSL2 + Windows),
295 "swarm" mentions / 132 unique, but only 2 genuine invocations
(`/codeswarm:swarm smoke`, `/codeswarm:swarm-setup`) — both side-routes, neither
exercising triage. All cases below are therefore synthesized.

| slug | lang | prompt | expected win over a bare session |
|---|---|---|---|
| `01-build-multiservice` | NL | "We moeten reserveringen kunnen annuleren met restitutie. Raakt drie services: `booking-api` (nieuw endpoint + state machine), `payments-core` (refund flow, geldbedragen), `admin-gui` (annuleerscherm met bevestiging). Plus een Flyway-migratie voor de refund-tabel. Pak dit op." | FEATURE flow; fit+cost line; design/plan in main thread with approval **before** dispatch; per-task specialists named; stage-disjoint task list. Bare: starts coding or a generic plan, no cost judgment, no verify staging |
| `02-audit-cost` | EN | "Before we open this up to external partners I want the whole auth + tenancy surface audited — about 60 files across the API and the admin GUI. What would that cost me and how would you run it?" | review route; agent count; estimate anchored on the **inline baseline** with a multiplier; go/no-go; never launches. Bare: no cost model, no verify layer |
| `03-carveout-auth-cookie` | EN | "Small one: our session cookie in `session.ts` is missing `SameSite`. One file, ~10 changed lines. Just do it?" | **F4** — must not silently apply the ≤2-file/≤40-line floor; names the auth/security carve-out and judges it. Verdict may still be inline (+ an independent check); does *not* reward fanning out |
| `04-migration-plan` | NL | "Alle 8 packages in de monorepo gebruiken nog `getUserById`. Moet `findUserById` worden, inclusief tests en mocks — ruim 60 plekken. Hoe pak je dit aan?" | refactor route: discover sites → batched transform → **independent verify**; fit line. Bare: a `sed` one-liner, no verify stage |
| `05-resume-run` | NL | "De run van gisteravond is gesneuveld op de rate limit, halverwege. Kunnen we verder waar hij gebleven is?" | resume route: list unfinished runs; resume with the **exact launch-time script version** so finished agents replay from cache. Bare: offers to redo the work |
| `06-neg-readme-wording` | EN | "Can you review the wording of this README paragraph? It reads clunky: 'This library provides functionality for the parsing of configuration files which are in the YAML format.'" | contains the triage keyword *review* on a docs task ⇒ stays inline, zero ceremony |
| `07-neg-offbyone` | EN | "Off-by-one here: `for (let i = 0; i <= items.length; i++)`. Fix it." | small fix ⇒ no fit line, no cost table, no agents, no swarm vocabulary |

Input shapes covered: big-task handover (01), cost question (02),
small-but-sensitive (03), plan question (04), resume (05) — plus two negatives.
Bilingual on purpose: real traffic is NL/EN mixed.

### Why no case dispatches a workflow

The eval sandbox has no Workflow tool, and a case that tried to dispatch would
score 0 in *both* arms — reading as "the plugin did nothing". So: `01`/`04` stop
for plan approval by design, `02` hits the estimate path (a cost question is one
of its documented triggers), `03` is inline, `05` finds no unfinished runs.

**Known limit, to repeat in the Step-3 unsure list:** no case exercises a real
dispatch, so a genuine silent-launch regression on a live run is not caught.

## Floor invariants (non-negotiable, do not drop when resuming)

- ≥1 should-NOT-fire case stays in the suite
- every case gets ≥1 **outcome** grader — `tool_used: Skill` on swarm-director is
  display-only under ablation (leave `arm` unset) and never the only grader
- `runs: 3` minimum
- `--ablation with-without` stays — Δ is the headline number, not pass rate
- negatives carry the scored inverse: `tool_used` with `min: 0`, `max: 0`,
  `arm: both`

## Cost (estimated, NOT measured — this is why it was deferred)

7 cases × 2 arms × 3 runs = **42 agent runs** + ~3 judge calls each.
Rough: **~850k input / ~95k output**, plus ~250k input of judging.
Real figure comes from the pilot's top-level `costUsd`.

Open decision, deferred to Friday: **Sonnet cases + Opus judge** (~¼ the cost,
but not the model the director is actually driven with) vs **Opus cases + Sonnet
judge** (honest test bed). Judge must differ from the case model (self-preference).
Trimming to 4 fire + 1 negative saves ~30% and loses the refactor route.
**Decided 2026-09-23: Sonnet cases + Opus judge.** Command for step 5: `--judge-model opus`.

## Resume from here

1. Confirm or adjust the input table above (Gate 1).
2. Step 3: grader table — one row per case, ① verifiable → ⑤ preference hierarchy,
   `allowed_tools` set per case to match what each grader implies, plus an
   explicit "Things I'm unsure about" list.
3. Step 3b: write the case dirs, then pilot:
   `claude plugin eval . --runs 1 --ablation with-without --no-scaffold --no-publish`
   Verify `suite.plugins` lists codeswarm with no `manifest_invalid` /
   `disabled_by_default` / `will_not_load` problem, else the with-arm ran without
   the plugin and the pilot is meaningless.
4. Step 4: state the measured cost, get a yes.
5. Full run: `claude plugin eval . --ablation with-without --judge-model <judge>`

## Follow-up found while reading the plugin (not fixed — plugin is read-only here)

README quickstart step 5 says `/codeswarm:swarm setup` asks **"six short
questions"**; `skills/swarm-setup/SKILL.md` and the director's config table both
list **seven** (alwaysOn, topModel, accessibility, retrospect, rigor,
adHocSpecialists, issueTracker).

## Results 2026-09-23 (full run, CLI 2.1.280, plugin 1.4.1 @ 0b6b061)

Cases are `case.yaml` + `scaffold.sh`, generated; run command in `run-full.sh`
(`--model sonnet --judge-model opus --scaffold --allow-tools Edit Write`). The first
pilot ran in an empty cwd and was void — every case needs its scaffold.

42 runs, $6.44, 16.6 min. with 0.90, mean delta **+0.30**; negatives 0 false fires.

| case | with | without | delta | note |
|---|---|---|---|---|
| 01 build | 0.72 | 0.44 | +0.28 | bare arm writes code 1/3; `risk-and-split` 0/3 in both arms = grader too strict (director asks design questions first, split comes later) |
| 02 audit-cost | 1.00 | 0.50 | +0.50 | inline-anchored estimate + verify layer only with plugin |
| 03 carve-out | 0.56 | 0.33 | +0.22 | director never loads; carve-out named 1/3 — rule lives only in the skill body (F4 gap) |
| 04 migration | 1.00 | 0.53 | +0.47 | director loaded 0/3; description alone carries the answer |
| 05 resume | 1.00 | 0.33 | +0.67 | |
| 06/07 negatives | 1.00 | 1.00 | 0 | |

Follow-ups: loosen `risk-and-split` to the design stage; decide whether the auth/security
carve-out belongs in the swarm-director description so small security edits trigger it.

### After-run: carve-out in the director description (same day, $6.56)

The auth/schema/money/new-dep carve-out moved into the swarm-director `description`.
Case 03 with-arm 0.56 -> **1.00** (carve-out named 3/3), delta +0.22 -> +0.44.
Negatives 06/07 stay 1.00 with zero codeswarm skill loads, so no new false fires.
Mean delta +0.30 -> +0.25 comes from case 05: its without-arm scored 1.00 this time
(fPf before) — bare-arm variance, the plugin arm is 1.00 in both runs.
