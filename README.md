# claude-code-swarm

codeswarm is a multi-agent "swarm" plugin for
[Claude Code](https://claude.com/claude-code). One entrypoint
(`/codeswarm:swarm`): your main session becomes the **director**, triages
the task and orchestrates parallel specialist agents through
**deterministic workflow scripts** — fixed phases, structured JSON
handoffs, independent verification, quiet-by-default output, agents
generated for *your* stack. (Deterministic describes the *orchestration* —
control flow and resume behavior; the agents inside are still model calls.)

It addresses three recurring problems with single-agent work: everything
runs serially in one growing context; review findings arrive unverified, so
you re-check them by hand; and tokens go to narration instead of work. The
design answer: tokens are spent on breadth (more specialist agents) or
certainty (independent verification), and the ceremony is engineered out.
See [Cost](#cost-what-to-expect) for what drives the bill and every lever
that lowers it — and [What's measured vs. designed](#whats-measured-vs-designed)
for which of these claims currently have measured evidence behind them and
which are still design bets.

## Quickstart

From clone to your first verified review. Check the
[requirements](#requirements) first — a recent Claude Code with the Workflow
tool, plus Node.js.

1. Clone this repository anywhere: `git clone <this-repo-url>`
2. Inside Claude Code, register the clone as a local marketplace:
   `/plugin marketplace add <path-to-clone>`
3. Install the plugin: `/plugin install codeswarm@claude-code-swarm`
4. Reload so the `/codeswarm:swarm` command registers: `/reload-plugins` (or restart
   Claude Code).
5. Configure it: `/codeswarm:swarm setup` — six short questions, the defaults are
   sensible (see [Configuration](#configuration)).
6. Generate agents that know your stack:
   `/codeswarm:swarm onboard <path-to-your-repos>` — point it at the directory that
   holds your repositories (quote the path if it contains spaces:
   `/codeswarm:swarm onboard "C:\My Repos"`), then approve the proposal it shows you
   (see [Onboarding](#onboarding-generate-your-own-stack-agents)).
7. Reload so the generated agents are picked up: `/reload-plugins`
   (or restart Claude Code).
8. Run your first review from any repo:
   `/codeswarm:swarm review this repo for bugs and security issues`

Steps 6–7 can be deferred: reviews work out of the box with the shipped
process agents; onboarding is what staffs *builds* with specialists for your
stack. If anything misbehaves, run `/codeswarm:swarm doctor`.

What the design gives you:

- **Parallel where safe, sequential where it must be** (stage-aware build
  pipeline; only provably file-disjoint tasks run concurrently)
- **Independently verified findings** (every finding passes an existence
  check plus a severity gate before it reaches your report)
- **Agents that know your stack** (the onboard generator scans your repos and
  writes stack agents + convention skills into your clone)
- **Cost under control** (quiet mode by default, model + effort tiering,
  budget self-scaling)
- **Crash and rate-limit proof** (deterministic scripts resume from cache —
  finished agents replay free)
- **Your rules win** (the target repo's `CLAUDE.md` and project-local gates
  outrank the plugin's defaults)
- **Configurable strictness** (`/codeswarm:swarm setup`: accessibility level,
  retrospect mode, top-model consent)

What ships:

- **Director skill** (`skills/swarm-director/`) — triages a task into one of
  the workflows below and runs it end to end.
- **7 deterministic workflow scripts** (`workflows/`) — build, review,
  refactor, research, drift, smoke, onboard. Orchestration is script-driven:
  fixed phases, structured outputs, model/effort tiers, budget self-scaling,
  loop-until-dry where it matters.
- **5 process agents** (`agents/`) — tester, reviewer, security auditor,
  WCAG auditor, researcher. Stack-agnostic: they read the target repo's
  `CLAUDE.md`/`AGENTS.md` and project-local skills instead of hardcoding
  assumptions.
- **Onboard generator** (`workflows/swarm-onboard.js`) — scans *your* repos
  and generates stack agents and convention skills tailored to *your* stack,
  into your clone. See
  [Onboarding](#onboarding-generate-your-own-stack-agents).

## Why not just the raw Workflow tool?

Driving the raw Workflow tool (or "ultracode" mode) means authoring a fresh
orchestration script per task, with no specialist roster, no convention
knowledge and no verify gates unless you re-invent them each time. codeswarm
ships that layer once: workflow scripts (fused finder passes, multi-lens
verification, staged parallel builds, coverage-guided thorough rounds,
resume discipline), a generated stack-specific roster plus convention skills
(onboard), routing hooks, one config file and cost tiering — reusable across
every repo and session. If you enjoy writing orchestration scripts per
task, the raw tool is great; codeswarm is for using that power without
rebuilding it every time.

## Requirements

- **Claude Code with the Workflow tool** — tested with Claude Code >= 2.1.200.
  The workflow scripts are executed by Claude Code's Workflow tool on the
  default path. How to check: ask Claude "do you have the Workflow tool?" in
  any session, or run `/codeswarm:swarm doctor` after installing — a missing
  Workflow tool shows up as a failing row with a fix hint (update Claude
  Code). Fallback: the **standalone runner** (`runner/`) executes the same
  scripts through `claude -p` subprocesses when the Workflow tool is broken
  or absent — degraded (no progress UI, permissions pre-granted — see
  [docs/security.md](docs/security.md)), not dead.
- **Node.js** (any recent LTS). The two session hooks and the development
  checks run on it; without Node the hooks fail with a visible (non-blocking)
  hook error on every session start and prompt, and `/codeswarm:swarm doctor` flags it.
- **Any OS.** macOS, Linux and Windows all work — the plugin contains no
  platform-specific paths, and the runtime hooks need only Node. The
  [development checks](#development) additionally need a POSIX shell (on
  Windows: Git Bash, which ships with Git for Windows).
- **superpowers plugin recommended, not required.** When the `superpowers`
  plugin (available from the official marketplace:
  `/plugin install superpowers`) is installed, the director uses its
  brainstorming/planning/TDD process skills; when absent it falls back to a
  condensed built-in flow.
- **Plugin name vs command name.** The plugin registers as `codeswarm`
  (skills and agents resolve as `codeswarm:*`); the command it provides is
  `/codeswarm:swarm`. Claude Code always namespace-prefixes plugin commands
  (`/<plugin>:<command>`), so a bare `/swarm` does not exist — typing it
  gives "Unknown command".
- Repo specifics (ports, gates, style rules) belong in each target repo's
  `CLAUDE.md`; agents read that first. Project-local gates win: if a repo
  ships its own review/eval gate, the swarm invokes that instead of
  substituting its own.

## Use

```
/codeswarm:swarm setup
/codeswarm:swarm build <feature description or path to an approved plan>
/codeswarm:swarm review the whole repo for security and accessibility issues
/codeswarm:swarm refactor rename X to Y across the repo
/codeswarm:swarm research which websocket client library should we adopt
/codeswarm:swarm drift
/codeswarm:swarm smoke
/codeswarm:swarm doctor
/codeswarm:swarm onboard <path-to-your-repos>
/codeswarm:swarm resume
```

### Flags (per-invocation overrides)

Any `/codeswarm:swarm` task may carry flags; they override the config **for that run
only** (precedence: flag > repo `## swarm` profile > global config >
default):

- `--preset=cheap|balanced|paranoid` (default: none) — one knob instead of
  six: `cheap` = lite rigor, top tier capped at `sonnet`, retrospect off;
  `balanced` = the built-in defaults; `paranoid` = `--thorough
  --verify=strict` with a full retrospect. Expands before the other flags,
  so an explicitly given flag always wins over its preset value.
- `--dry` (default: off) — show the task list + agent-count estimate, ask
  go/no-go, launch nothing.
- `--verbose` (default: off, agents run quiet) — turn quiet mode off for
  this run's agents (debugging a misbehaving workflow).
- `--thorough` (alias `--rigor=full`; default: lite) — escalate this run to
  full rigor. A build regains the adversarial review + retrospect; a review
  regains the graded 2-lens + severity verify and coverage-guided extra
  finder rounds. The default is the lite tier (implement + one independent
  test; single-lens verify) — see [Cost](#cost-what-to-expect).
- `--verify=normal|strict` (default under full rigor: `normal`) — verify
  regime once you are at full rigor: `normal` = two unanimous lenses on
  critical/major, one on minors; `strict` = the full lens set for every
  severity plus a verifier on director-inline work. Ignored under lite
  (lite is single-lens by design).
- `--max-model=<name>` (default: the config `topModel`, else your session
  model) — this run's model ceiling for top-tier agent calls (cap it:
  `--max-model=sonnet`; or raise it above a configured cap:
  `--max-model=opus`).
- `--max-effort=low|high|max` (default: per-stage tiers) — effort ceiling
  for this run's build tasks (other workflows have their effort tiers
  baked in).

You don't have to remember any of these. After you ask for a swarm run, the
director offers one short prompt with the knobs that matter — rigor, model
cap, effort — each annotated with its rough cost next to the **no-swarm**
(inline) number, pre-set to your config defaults. Flags just skip that
prompt; "always do this" saves the choice to your config.

The director triages into one of these workflows:

| Task type | Workflow | Shape |
|---|---|---|
| feature build | `workflows/swarm-build.js` | per plan task, sequentially: implementer (TDD) → independent tester (+ project gate) → adversarial reviewer → fix round with re-test → whole-build retrospect |
| review / audit | `workflows/swarm-review.js` | fused reviewer pass (bugs/performance/architecture in one agent) + specialist finders (security, WCAG) → dedup → unanimous two-lens existence verify plus a severity check (1–4 agents per finding; minors and budget-tight runs get one lens, and downgrading a critical takes two agreeing severity checks) → ranked report; `thorough` = up to 3 coverage-guided finder rounds (stopping early when a round finds nothing new) plus the full verify-lens set for every severity |
| refactor / migration | `workflows/swarm-refactor.js` | discover sites → transform in sequential batches → independent verify |
| research | `workflows/swarm-research.js` | multi-angle sweep by independent researchers → judge scoring → synthesis with sources |
| skill drift | `workflows/swarm-drift.js` | per repo: compare your generated convention skills against the actual code → merged ranked drift list |
| self-test | `workflows/swarm-smoke.js` | one finder + one verifier per finding against a planted-bug fixture; graded recall/precision run against `fixtures/eval` (see [Development](#development)) |
| onboard | `workflows/swarm-onboard.js` | scan your repos → propose a specialist roster for your approval → generate `my-*` agents + convention skills into your clone |

## Onboarding: generate your own stack agents

Out of the box the plugin ships only stack-agnostic process agents. The
differentiator is `/codeswarm:swarm onboard`: point it at the directory that holds your
repositories and it will

1. **scan** them with parallel inventory agents (languages, frameworks, build
   tools, CI, cross-cutting concerns, code-organization / layout conventions,
   gotchas — structured output per repo),
2. **propose** a specialist roster and a convention-skill set for your stack,
   presented as a compact table you can amend (rename, drop, merge, edit
   rules) — nothing is written at this point, and
3. **generate** — only after your approval — the stack agents
   (`agents/my-*.md`) and convention skills (`skills/my-*/SKILL.md`) directly
   into your local clone of this plugin, following the shape templates in
   `templates/`.

> **The scan can take a while on large codebases.** Onboarding dispatches one
> inventory agent per repo in parallel, but each reads across its repo's tree
> to evidence conventions — so with many repos, or a lot of code, the scan
> step is the slow part. That is expected; let it finish. (The propose and
> generate steps that follow are quick.)

Already have custom agents of your own (or from other plugins)? Onboard
takes them into account: the director passes your existing agents along,
and the proposal marks any role overlap — per overlapping agent you decide
at the approval gate whether to adopt your existing agent for that lane or
generate the specialist anyway. The director can also dispatch your own
agents inside swarm runs when one fits a task better than any generated
specialist. And with `adHocSpecialists: true` in the config, the generated
`my-*` agents work the other way around too: spawn them directly for small
single-scope tasks, no director required.

Diff-review the generated `my-*` files against the approved proposal before
reloading — the file bodies are LLM-composed after the approval gate (see
[docs/security.md](docs/security.md)). Then reload plugins
(`/reload-plugins` or restart Claude Code) and the swarm now staffs your
builds with agents that know *your* stack. The generated files are yours:
edit them, commit them to your fork, and run `/codeswarm:swarm drift` periodically to
catch conventions drifting away from the actual code.

## Update safety: the `my-` contract

Updating is cheap either way — and update *risk* is watched for you: the
SessionStart hook compares the running Claude Code version against the last
smoke-proven one and nudges a `/codeswarm:swarm smoke` re-run on mismatch (see
Hooks below). And when an update actually breaks the Workflow tool, the swarm
degrades instead of dying: set `"runner": "standalone"` in the config and the
director dispatches the same workflow scripts through the standalone runner
(`node runner/run.js`, one `claude -p` subprocess per agent, own
journal/resume) until a re-smoke on the Workflow tool passes. Marketplace added as a GitHub reference: run
`claude plugin marketplace update claude-code-swarm && claude plugin update
codeswarm@claude-code-swarm` in a terminal (the plugin name must be
marketplace-qualified; there is no `/plugin update` slash command) — a
release is whatever commit bumps the `version` in `plugin.json`, since the
updater compares that number, not the content. Marketplace added as
a local clone path: `git pull` in the clone, then the same two commands (or
restart Claude Code). Neither will ever conflict with what onboard
generated for you:

- Everything onboard generates is prefixed `my-` (`agents/my-*.md`,
  `skills/my-*/SKILL.md`).
- This plugin promises to never ship `my-*` files, so upstream updates and
  your generated files can never collide. `/codeswarm:swarm doctor` asserts that
  invariant against the upstream tree.
- Re-running onboard never overwrites an existing file either: pre-existing
  artifacts are skipped and reported, so your edits survive.

## Configuration

`/codeswarm:swarm setup` writes exactly one file, **`~/.claude/codeswarm.json`** (when
the `CLAUDE_CONFIG_DIR` environment variable is set, the file lives there
instead). It is re-runnable at any time: it shows the current config, re-asks
the seven questions and overwrites the file. Changed your subscription?
Re-run `/codeswarm:swarm setup` to raise or drop the model cap. `/codeswarm:swarm doctor`
displays the active config.

| Key | Values (default) | What it does |
|---|---|---|
| `alwaysOn` | `true` / `false` (`false`) | when true, every new session starts with a one-line directive to route substantive coding work through the swarm director; when false the swarm only engages when asked |
| `topModel` | model name or `null` (`null`) | cost cap for top-tier agent calls (implementers, finders, synthesis, review gates); `null` = inherit the session model, i.e. the best model available |
| `accessibility` | `off` / `A` / `AA` / `AAA` (`AA`) | the WCAG 2.2 level the auditors apply, and whether the wcag dimension sits in the default review set (`off` removes it); a default, not a mandate |
| `retrospect` | `full` / `light` / `off` (`full`) | strictness of the post-build architecture retrospect — `light` reports breaking findings only, `off` skips the phase; it never auto-fixes in any mode |
| `adHocSpecialists` | `true` / `false` (`false`) | when true, your generated `my-*` stack agents may be spawned directly for small single-scope tasks (handy when you use them outside swarm runs too); multi-step or review-gated work still routes through the director. Direct use deliberately skips the swarm's verification layers |
| `issueTracker` | `{ "kind": "none" }`, `gitlab`, `github` (`none`) | optional output sink: file confirmed findings as issues, batched after a workflow, opt-in per run |

A target repo's `CLAUDE.md` may carry a `## swarm` section that overrides
`accessibility` and `retrospect` for that repo — the repo wins over the
global config. Tokens never go into the chat: the issue-tracker question
asks for a token *file path* only.

### Hooks

The plugin ships two hooks (`hooks/hooks.json`) as tiny, auditable Node
scripts — this is why Node.js is a requirement. They send nothing anywhere
(no telemetry, no network); each prints at most one line of session context:

- **SessionStart** (`hooks/session-start.js`), staged: no config yet →
  a one-line "run `/codeswarm:swarm setup`" nudge; Claude Code version differs from
  the last smoke-proven one (`lastSmokeVersion`, recorded via
  `tools/record-eval.js` after a passing `/codeswarm:swarm smoke`) → a one-line update canary pointing at a
  re-smoke (the Workflow tool has no stable API — an update means unproven
  plumbing); `alwaysOn: true` → a directive to route substantive coding
  work through the swarm director; otherwise silent. Always at most one
  line — when the canary and always-on both apply they share the line.
- **UserPromptSubmit** (`hooks/swarm-router.js`): when a prompt mentions the
  swarm (whole word), it injects one routing line so the session loads
  `codeswarm:swarm-director` first instead of spawning `codeswarm:*` agents
  ad hoc. Mentions that are about the plugin rather than asks for the swarm
  (paths, filenames, the repo name) do not fire it. Other prompts pass
  through untouched.

## Cost: what to expect

### What actually drives the token bill

Two things, and *only* two: **how many agents a run spawns** (breadth) and
**how much each agent reads and writes**. Everything below is a lever on one
of those.

**Parallelism is not one of them.** Running agents concurrently vs one after
another costs the *same* tokens — parallelism buys wall-clock speed, nothing
else. So "make it serial to save tokens" does not work; it only makes the
same bill arrive slower. To spend less you spawn fewer agents or have each
read less — never "run them one at a time."

Every lever, cheapest-default first:

| Lever | What it does | Default |
|---|---|---|
| **altitude rule** | trivial work (docs, config, one-line edits) is done inline by the director — zero agents, ~1x | always on |
| **`rigor: lite`** | build = implement + one independent test; review = single-lens verify — no adversarial review/retrospect/severity check (~1.5–2x) | **default** |
| **`quiet`** | agents emit structured output only — no narration, no diffs in transcripts (output tokens cost ~5x input) | always on |
| **model + effort tiers** | mechanical work on the cheapest model, verify on the middle tier; only the top tier runs your best model | always on |
| **finder fusion** | reviewer dimensions read the repo *once* in one agent, not once per dimension | always on (review) |
| **`effort: 'low'`** (per build task) | mechanical tasks skip the adversarial review — tester only | per task |
| **`dimensions`** (review) | audit fewer aspects → fewer finder agents | you choose |
| **`--dry`** | prints the agent count + estimate and asks go/no-go before spending anything | off |
| **`topModel` / `--max-model`** | caps the top tier (e.g. `sonnet`) to cut per-agent cost | inherit session |
| **budget target** (`+200k` in your prompt) | scripts self-scale down (single-lens verify, stop extra rounds) as the target runs low | none |
| **`--thorough` / `rigor: full`** | the opposite direction — *adds* the adversarial review + retrospect + graded verify (~3–4x) when a bug would be expensive | opt-in |

So the dial is entirely in your hands: the defaults are the cheap end, and
you escalate only where a mistake is costly.

### Orders of magnitude

A swarm run dispatches many agents on purpose — independent verification is
the whole point — so be deliberate about when you reach for full rigor.

| Workflow | Agents dispatched | Expect |
|---|---|---|
| review | 3 finder agents on the default dimensions (fused reviewer + security + WCAG), then **1 verify agent per finding** by default (lite); `--thorough`/`--rigor=full` lifts that to the graded 1–5 verify and adds finder rounds | small repo: tens of agents, a few hundred thousand tokens |
| build | **default (lite): implementer + independent tester per task** (~2 agents/task). `--thorough`/`--rigor=full` adds the adversarial reviewer + a fix round (up to 3 more) + one retrospect per build | lite: a 5-task build is ~10 agents; full: 15–30 |
| refactor | 1 discover + 1 transformer per batch of 8 sites (cheapest model tier) + 1 verify | cheap next to build/review |
| research | 1 researcher per angle (default 3) + 1 judge per answer + 1 synthesis | about 7 agents |
| drift | 1 scanner per repo + 1 merge | scales with repo count |
| onboard | 1 shipped-name listing agent (cheapest tier), then propose: 1 inventory agent per repo + 1 synthesis; generate: 1 writer per generated file | scales with repo count and roster size |
| smoke | 1 finder + 1 verifier per reported finding — normally 2 agents total, all on the cheapest model tier | the cheapest run; use it freely |

(The levers behind these numbers — quiet, model tiers, session-model
inheritance for any subscription, budget self-scaling — are in the table
above.)

### Is every stage worth it?

At **full rigor** a build runs implement → verify → review → (fix round) →
retrospect — roughly **3–4x the tokens** of asking a single agent to "just do
it" in one pass. That is why full rigor is *not* the default: the default
(lite) is implement → verify only, ~1.5–2x. Whether the extra stages are
worth turning on depends on the stage and on the blast radius of the code —
so here is the per-stage value:

- **Verify (independent tester) — almost never skip.** Implementers
  routinely report "tests pass" on a red suite. A fresh agent that actually
  re-runs the suite catches it. This is the cheapest insurance in the whole
  system; it is the stage that makes the output trustworthy.
- **Review (adversarial) — scales with stakes.** On correctness-critical
  code it earns its tokens many times over. On a mechanical one-line change
  there is nothing to review and it is mostly waste — so gate it down (see
  below). It is not free; spend it where a bug is expensive.
- **Retrospect — the weakest per token.** It is a whole-build architecture
  pass. On a large feature or a greenfield slice it is valuable; on a
  bugfix or refactor batch it finds almost nothing. Default it to `off` or
  `light` for fix work (`retrospect` config key, or `--max-effort`-style
  tuning).

**Why pay the multiple at all?** Because the alternative is unverified
output you re-check by hand. A real example from this repo's own
development: a review of the orchestration engine surfaced 20 confirmed
bugs (2 critical, 6 major). Handing "fix these 20" to a single-pass agent
with no independent verification is how you re-introduce bugs while
believing they are fixed — a fix silently breaks an adjacent path, the
agent reports success, nobody re-runs the suite. The swarm spends tokens so
**you spend attention only on the final verdict**. (That example is one
anecdote from development, not a measurement — see the next section.)

Rule of thumb: full ceremony (`--thorough`) when a bug would be expensive
or hard to notice; `--dry` to see the agent count first; `retrospect: off`
on fix batches; the altitude rule already keeps trivial work out of the
ceremony. Set `rigor: "full"` in config only if most of your work is
high-stakes.

### What's measured vs. designed

Where the evidence for the claims in this README actually stands:

- **Measured:** that the plumbing works end to end (`/codeswarm:swarm
  smoke`), and finder recall/precision on the graded fixtures (`fixtures/eval`:
  five planted bugs across distinct failure classes, two false-positive trap
  files, an `expected.json` manifest; `fixtures/eval2`: four more planted bugs
  in disjoint classes plus a trap file, added to break the single-fixture
  correlation problem). Every graded run also grades the RAW pre-verify finder
  output as a baseline and records both in `codeswarm-eval-log.jsonl` next to
  the config; the accumulated verified-vs-baseline delta across that log is the
  A/B evidence for the verify layer.
- **Not yet demonstrated:** that the verify layer earns its cost as a
  trend. The eval log on disk currently holds a single graded run
  (`fixtures/eval2`, 2026-07-13): 4/4 planted bugs found, zero false
  positives, and — because the raw finder was already clean — a zero verify
  delta (nothing to kill, nothing wrongly rejected). One null sample is not a
  trend. An earlier 21-run batch (2026-07-06) is described in `CLAUDE.md` and
  `fixtures/eval/README.md` but is NOT present in the current log file (it ran
  on another machine/config-dir and was not retained), so treat it as
  documented history, not a live log total; it reportedly produced deltas in
  BOTH directions — 1 false positive killed and 1 real bug wrongly rejected —
  two anecdotes, opposite signs, net zero. Independent checks catching
  plausible-but-wrong findings is the design bet this plugin is built on, and
  the eval log exists to test that bet — not to presume it. Until the log
  accumulates across VARIED fixtures, read "independently verified findings"
  as a description of the mechanism, not a measured guarantee that re-checking
  is never needed. That 2026-07-06 batch also showed finder recall on the JS
  fixture is uneven per bug at the cheapest model tier (`swarm-smoke.js`
  hardcodes haiku) — 2/20 clean passes, two bug classes missed in 13/20 runs,
  one missed in 0/20 — a property of that tier and fixture, not a claim about
  `swarm-review.js`'s recall on real code (session-model finder, sonnet
  verify).
- **Anecdotal:** two real-world signals, neither a measured claim about the
  verify layer. (1) The 20-confirmed-bugs example above shows finder utility
  on a real codebase; it says nothing about the verify delta, and a single
  fixture is not a real-world workload. (2) Driven from a handful of prompts,
  the swarm built a multi-tenant SaaS end to end — a Spring Boot backend, an
  admin GUI and a consumer GUI, plus the matching Android apps — wired to the
  project's own documented conventions and architecture over a multi-day
  autonomous run. It came out largely working but not first-time-perfect: a
  few small issues still needed follow-up fixes. This illustrates
  build-orchestration and convention-adherence at scale; it is a usage story,
  not a benchmark, and it measures nothing about review precision or the
  verify delta.

## FAQ

**Is this related to OpenAI Swarm?** No. OpenAI Swarm is a Python framework
for building multi-agent applications against the OpenAI API. codeswarm is a
Claude Code plugin: it orchestrates Claude Code's own subagents through the
built-in Workflow tool. Same word, different ecosystem.

**Does it phone home?** No. The hooks are two tiny Node scripts you can read
in one sitting; they print at most one line of session context and send
nothing anywhere. See [docs/security.md](docs/security.md).

**Can I cap the cost?** Yes — every lever (quiet default, `topModel` cap,
budget targets, `--dry`) is in the table in [Cost](#cost-what-to-expect).

**Isn't this a lot more tokens than just asking one agent to do it?** Lite
(the default) is ~1.5–2x; full rigor is ~3–4x and opt-in (`--thorough`).
The trade: unverified output you re-check yourself, or tokens spent so you
don't. Full breakdown in [Cost](#cost-what-to-expect).

**Does running the agents serially instead of in parallel save tokens?**
No — parallelism affects wall-clock time only. See
[Cost → what drives the bill](#what-actually-drives-the-token-bill).

**Will it tell me when the swarm isn't worth it?** Yes. Before every launch
the director states fit and cost in a line: right tool → proceeds; likely
more expensive than inline → does it inline (altitude rule) or proposes a
`--dry` estimate first. It never springs a 3–4x bill on a task that didn't
need it.

**What happens when a run crashes or hits a rate limit?** Nothing is lost:
`/codeswarm:swarm resume` lists unfinished runs and continues them — completed agents
replay free from cache, only the missing tail runs live.

**More depth?** [docs/architecture.md](docs/architecture.md) (how the pieces
fit), [docs/workflows.md](docs/workflows.md) (per-workflow reference),
[docs/configuration.md](docs/configuration.md) (every config key),
[docs/security.md](docs/security.md) (hooks and token handling).

## Development

- **Structural check** — manifests parse, hooks are valid standalone JS, and
  every workflow script parses as a Workflow-harness module (plain
  `node --check` cannot validate those — `export const meta` + top-level
  return only parse inside the harness wrapper, which
  `workflows/syntax.test.mjs` reproduces). The `node --test` step also runs
  `workflows/harness-contract.test.mjs`, which EXECUTES every script
  against a mock of the documented harness semantics (agent/parallel/
  pipeline/budget behavior, written down as numbered contract clauses) —
  when a Claude Code update breaks the plumbing, the mismatch is diagnosed
  against a named clause instead of mid-run:

  ```sh
  node -e "['.claude-plugin/plugin.json','.claude-plugin/marketplace.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8')))"
  for f in hooks/*.js; do node --check "$f" || exit 1; done
  node --test workflows/*.test.mjs
  ```

- **Hook pipe tests** — `sh hooks/hooks.test.sh` feeds sample hook JSON to
  both hook scripts on stdin and asserts the SessionStart stages (setup
  nudge, update canary, always-on) and the router's word-boundary behavior.
- **Standalone-runner tests** — `node --test runner/*.test.mjs`:
  `runner/harness.test.mjs` asserts the runner's own harness against the
  same numbered contract clauses the Workflow-tool mock documents AND runs
  every shipped workflow script through it (the proof the scripts run
  unchanged outside the Workflow tool); `runner/driver.test.mjs` covers the
  claude-driver's pure helpers. No subprocess is spawned in tests — the
  live path is proved by running a smoke through
  `node runner/run.js workflows/swarm-smoke.js ...`.
- **Doctor** — run `/codeswarm:swarm doctor`: static installation/config diagnostics
  (node present, Workflow tool available, `codeswarm:*` agents and skills
  registered, installed copy vs clone, the `~/.claude/codeswarm.json` config
  written by `/codeswarm:swarm setup`, syntax over every workflow and hook
  script, and the `my-` contract) reported as one status table with a fix
  hint per failing row. Routed through the director triage (no separate
  command file); see `skills/swarm-doctor/SKILL.md`.
- **Smoke self-test** — run `/codeswarm:swarm smoke`: executes
  `workflows/swarm-smoke.js` against `fixtures/smoke/` (a fixture with one
  planted bug) and must report exactly that bug, nothing else. Doctor and
  smoke are deliberately separate: doctor is static and cannot prove
  agentType resolution; smoke proves it end to end through a real workflow —
  doctor's last line points you at it.
- **Graded eval** — the same script against `fixtures/eval/` (five planted
  bugs across distinct failure classes, correct near-miss code, an
  `expected.json` manifest) measures finder recall (`missed`) and precision
  (`unexpected`); the director reads the manifest and passes it as the
  `expected` arg. Graded runs also return a `baseline`: the RAW pre-verify
  finder output graded against the same manifest, at zero extra agents —
  the delta against the verified numbers is the measured value (and cost)
  of the verify layer, i.e. the A/B evidence for the swarm's central claim.
  The fixture also ships two pure trap files (`jobs.js` and `schedule.js` —
  every planted bug class in its correct form, so a pattern-matching finder
  produces measurable false positives), and the director records every
  graded result via
  `tools/record-eval.js`: one JSONL line appended to
  `codeswarm-eval-log.jsonl` next to the config, plus the running totals
  the tool prints back — a single run is an anecdote; the accumulated
  verified-vs-baseline delta is the measurement. See
  [docs/workflows.md](docs/workflows.md).

## License

[MIT](LICENSE)
