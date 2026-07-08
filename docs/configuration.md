# Configuration

Three layers, in order of precedence: **repo `## swarm` profile** (wins) →
**global config file** → built-in defaults.

## The config file: `~/.claude/codeswarm.json`

Written by `/codeswarm:swarm setup` (re-runnable — it shows current values and
re-asks). Location: `$HOME/.claude/codeswarm.json`, or
`$CLAUDE_CONFIG_DIR/codeswarm.json` when that environment variable is set.

```json
{
  "version": 1,
  "alwaysOn": false,
  "topModel": null,
  "accessibility": "AA",
  "retrospect": "full",
  "rigor": "lite",
  "adHocSpecialists": false,
  "issueTracker": { "kind": "none" }
}
```

| Key | Values (default) | Effect |
|---|---|---|
| `version` | `1` | file-shape version |
| `alwaysOn` | `true`/`false` (`false`) | `true`: every new session starts with a one-line directive to route substantive coding work through the director. Read by the SessionStart hook only; takes effect next session |
| `topModel` | `null`, family alias, or pinned id (`null`) | `null` = top-tier calls inherit your session model. A family **alias** (`"opus"`/`"sonnet"`/`"haiku"`/`"fable"`) tracks the LATEST of that family — `"opus"` runs Opus 4.8 today and auto-upgrades when a newer Opus ships. A **pinned id** (`"claude-opus-4-7"`) freezes to that exact version. `"sonnet"` caps top-tier cost. Mechanical/verify tiers unaffected. No `"latest"` keyword — the alias is the latest-tracking value |
| `accessibility` | `"off"`/`"A"`/`"AA"`/`"AAA"` (`"AA"`) | whether the wcag dimension sits in the default review set, and which WCAG 2.2 level the auditors apply (contrast bars shift with the level) |
| `retrospect` | `"full"`/`"light"`/`"off"` (`"full"`) | post-build architecture retrospect: full = coherence + package hygiene + naming + DX; light = breaking findings only; off = skipped. Never auto-fixes in any mode |
| `rigor` | `"lite"`/`"full"` (`"lite"`) | default verification depth. `lite` (default): build = implement + one independent test per task, no adversarial review, no retrospect; review = single-lens verify, no severity check (~1.5–2x raw). `full`: adds the adversarial review + retrospect (build) and the graded 2-lens + severity verify (review) (~3–4x). Escalate one run with `--thorough`/`--rigor=full` without changing this default |
| `adHocSpecialists` | `true`/`false` (`false`) | `true`: your generated `my-*` stack specialists may be spawned directly for small single-scope tasks — the hook directives and newly generated agent descriptions say so; multi-step or review-gated work still routes through the director. Direct use deliberately skips the swarm's verification layers. Existing `my-*` files keep their old description until hand-edited (or deleted and regenerated — onboard never overwrites) |
| `issueTracker` | object (`{"kind": "none"}`) | output sink for confirmed findings — see below |
| `lastSmokeVersion` | semver string (absent) | update-canary baseline: the Claude Code version at the last PASSING `/codeswarm:swarm smoke` run. Written via `tools/record-eval.js` (the director runs it after a passing smoke; it preserves every other key, and setup preserves this one); the SessionStart hook compares it against the running version and nudges a re-smoke on mismatch, because the Workflow tool has no stable public API |
| `runner` | `"workflow"`/`"standalone"` (absent = `"workflow"`) | execution vehicle for the workflow scripts. `workflow` (default) = Claude Code's Workflow tool. `standalone` = the director dispatches via `node runner/run.js` instead — the failover when a Claude Code update breaks the Workflow tool (canary fires, smoke fails). Not a setup question; set it by hand or on the director's advice, and remove it once a re-smoke passes on the Workflow tool. See docs/security.md "Standalone runner" for the permission model |

### issueTracker variants

```json
{ "kind": "none" }
{ "kind": "gitlab", "apiBase": "https://gitlab.com/api/v4", "tokenFile": "/home/me/.gitlab-token" }
{ "kind": "github" }
{ "kind": "github", "tokenFile": "/home/me/.github-token" }
```

- `none` — findings stay in-chat (default).
- `gitlab` — REST against `apiBase`; token read from `tokenFile` at call
  time, sent as `PRIVATE-TOKEN`.
- `github` — the `gh` CLI when installed and authenticated (no token file);
  otherwise REST against `api.github.com` with the `tokenFile` token.

Issues are only ever filed by the director, in one batch, after a workflow
completes, and only when you opt in ("file these as issues"). Agents never
touch the tracker API. Token handling rules: [security.md](security.md).

## Repo profile: `## swarm` in the target repo's CLAUDE.md

A target repo may carry a `## swarm` section: default review dimensions,
the test-gate command, path exclusions, preferred implementer agentType,
and per-repo overrides of `accessibility` and `retrospect`. The repo wins
over the global config. Example:

```markdown
## swarm
- dimensions: bugs, security, performance
- test-gate: npm test
- exclude: vendor/, generated/
- accessibility: off        # CLI tool, no UI
- retrospect: light
```

## Waivers: `.swarm-waivers.json` in the target repo

Accepted findings the review should skip (reported under `waived`, never
silently dropped):

```json
[
  { "file": "src/legacy.js", "match": "substring of the finding problem",
    "reason": "scheduled for deletion in Q3", "date": "2026-07-04" }
]
```

Two safety rules the review enforces on this file:

- **Criticals are never waivable.** A waiver that matches a critical finding
  is ignored; the finding is verified normally and reported (flagged
  `waivedAttempt`). Only if the pipeline's own severity check then downgrades
  it below critical is the waiver honored.
- **`match` must be at least 8 characters.** Shorter match strings are
  rejected up front (a one- or two-char `match` would waive almost anything);
  `file` matches on a path-segment boundary, so `a.js` never matches
  `spa.js`.

When you dismiss a finding ("ignore this from now on"), the director
appends it here; entries are never deleted silently.
