# Phase 2 — headless operation, other AI backends, MCP (spec, not yet built)

Status: DRAFT backlog spec. Nothing here ships until it is promoted into
the main spec and built through the normal build flow. Scope: running the
swarm without a human at the keyboard, running it on non-Claude backends,
and the safety model both require.

Foundation shipped ahead of this spec: the **standalone runner**
(`runner/` — see docs/architecture.md). It executes the workflow scripts
unchanged against `claude -p` subprocesses, owns its own journal/resume,
and reads agent definitions from `agents/*.md` at spawn time. Every item
below builds on it; none of them touch the Workflow tool.

## 1. Headless triggers

- Execution vehicles, in preference order: `node runner/run.js
  <workflow> --args '<json>'` when the task is already triaged (no
  director needed, fully deterministic), else `claude -p
  "/codeswarm:swarm <task>"` when triage/judgment is part of the job.
- First target: the drift guard — monthly `/codeswarm:swarm drift` over the
  onboarded repos, report as artifact/issue.
- Config: reuse `~/.claude/codeswarm.json`; headless runs NEVER prompt —
  any question the director would ask becomes "skip + report".
- Every headless run ends with a written artifact (report file or tracker
  issues) — a run nobody can read is a run that did not happen. The
  runner's `result.json` under the run dir is the minimum artifact.

## 2. Issue-driven work loop (configurable, default OFF)

Consume tracker issues as work input; optionally deliver merges.

```json
"issueWorkflow": {
  "pickup":   "manual | by-label",
  "delivery": "commit | branch | merge-request",
  "autoMerge": "off | gated"
}
```

- Defaults: `pickup: manual`, `delivery: merge-request`, `autoMerge: off`
  — never silent merges to a main branch.
- `autoMerge: gated` may merge ONLY when ALL hold: independent tester
  PASS + adversarial review APPROVE + project-local gate (when present)
  passes + no merge conflicts. Anything less stays an MR for human review.
- All VCS/tracker writes are director-only, same credential rules as the
  issue output sink (token via file path, never in agent contexts).

## 3. Safety constraints (binding, from day one)

- **Pickup allow-list**: the loop may ONLY pick up issues the plugin
  itself created (tagged with a plugin marker label + metadata at
  creation) or issues a human explicitly labeled for the swarm (e.g.
  `swarm:take`). NEVER auto-pick arbitrary tracker issues — a third party
  writing an issue must not be able to steer agents or trigger merges
  (prompt-injection / supply-chain surface).
- **Issue bodies are untrusted input** even when picked up: treat as
  data, never as instructions that override skills, gates or config.
- **Scope fence**: a headless run works only the repos/issues its trigger
  names; it never widens its own scope.
- **Headless permission grants are explicit**: unattended runs need
  pre-granted tool permissions (runner `--permission-mode` /
  `--grant-agent-tools`, or an allowlist in settings). The grant lives in
  the trigger definition where a human reviewed it — never decided at run
  time by the run itself. See docs/security.md "Standalone runner".

## 4. Multi-AI driver layer (other backends)

Goal: run the same workflow scripts with non-Claude agents. The
orchestration layer is already backend-neutral — `runner/harness.js` uses
no Claude-specific behavior; only `runner/claude-driver.js` knows how to
spawn an agent. This item adds sibling drivers behind the same driver
interface (`async (prompt, opts) => { result, outputTokens }`):

- `runner/drivers/codex.js` — OpenAI Codex CLI headless (`codex exec`).
- `runner/drivers/gemini.js` — Gemini CLI headless (`gemini -p`).
- Selection: `--driver <name>` on run.js; default stays `claude`.

Per-driver responsibilities (everything the Workflow tool used to do):

- **Model-tier mapping.** Scripts pin only the cheap/verify tiers
  (`haiku`/`sonnet` — a Claude vocabulary). Each driver carries a tier map
  in config (e.g. `{"haiku": "<cheap model>", "sonnet": "<mid model>"}`);
  unset model keys keep inheriting the backend's session default, which
  preserves the top-tier fallback invariant.
- **Structured output.** JSON-mode/schema prompting + the shared
  validate-and-retry loop (already in claude-driver, extract to a shared
  module when the second driver lands).
- **Agent definitions.** `agents/*.md` bodies are plain prompt text and
  travel inline — backend-neutral by construction. Frontmatter `tools:`
  maps to each CLI's tool/permission flags where they exist, else is
  ignored (documented per driver).
- **Effort.** No portable equivalent; drivers may map `opts.effort` to a
  backend knob when one exists, otherwise ignore it.

Acceptance gate — measured, not claimed (the README honesty rule extends
here): a driver ships only with graded `fixtures/eval` runs recorded via
`tools/record-eval.js` (the log entry gains a `backend` field, absent =
claude, so existing lines stay valid). Recall/precision per backend is
unknown until measured; "compatible with backend X" without eval-log lines
for X is exactly the kind of claim the README forbids.

Out of scope for this item: hooks and the director skill on non-Claude
hosts (host-specific surfaces; the runner is drivable from any shell), and
prompt re-tuning per backend (only if the eval numbers demand it).

## 5. MCP server wrapper

Goal: expose the swarm to ANY MCP-capable client (Claude Code, other
AI CLIs/IDEs) as a vendor-neutral tool surface — the client does triage
and conversation; the server runs the deterministic part.

- Tools: `swarm_review`, `swarm_build`, `swarm_refactor`,
  `swarm_research`, `swarm_drift`, `swarm_smoke`, `swarm_resume` — thin
  wrappers that shell out to `runner/run.js` and return its stdout JSON.
  Tool descriptions carry the director's argument conventions so the
  host model can fill args correctly.
- Long runs: MCP progress notifications from the runner's stderr events;
  the run dir path is returned immediately so a dropped client can
  `swarm_resume`.
- Ordering: only after section 4 has at least one non-Claude driver with
  eval evidence — an MCP server over a claude-only runner adds a protocol
  hop for Claude-only users and serves nobody else yet.
- Safety: the server inherits the runner's permission model; it never
  widens grants beyond what its own launch flags carry (same principle as
  section 3).

## 6. Parked with phase 2

- Self-tuning retro: mine run journals (null rates, fix-round frequency,
  token hotspots) → suggest prompt/skill tweaks. Needs real-run data. The
  standalone runner's journals are the richer data source (they include
  outputTokens per agent).
- Browser-runtime checks: execute a review's `runtimeChecksNeeded` via
  browser automation against a running dev server (phase 2.5).
- Hard smoke in CI: run the graded `fixtures/eval` smoke as a CI job so
  Workflow-tool breakage is caught preventively instead of by the
  (reactive) SessionStart canary. The standalone runner unblocks the
  vehicle (`node runner/run.js workflows/swarm-smoke.js ...` needs no
  Workflow tool at all); still blocked on a pinnable Claude Code version
  in CI and an API budget for the agent spend. Note the scope shift: a
  runner-based CI smoke proves the RUNNER path, not the Workflow-tool
  path — it complements the canary rather than replacing it.
