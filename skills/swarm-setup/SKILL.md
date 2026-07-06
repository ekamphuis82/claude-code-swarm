---
name: swarm-setup
description: Re-runnable configuration dialogue for the codeswarm plugin — shows the current config when present, asks the six setup questions (always-on, top model, accessibility level, retrospect mode, rigor, issue tracker) and writes ~/.claude/codeswarm.json. Run it any time settings change, e.g. after a subscription change.
---

# /codeswarm:swarm setup — configuration (re-runnable)

You (the main session) run this inline — no agents, no workflow script. The
result is exactly ONE file:

**`~/.claude/codeswarm.json`** — that is `$HOME/.claude/codeswarm.json`
(macOS/Linux) or `%USERPROFILE%\.claude\codeswarm.json` (Windows). When the
`CLAUDE_CONFIG_DIR` environment variable is set, the file lives at
`$CLAUDE_CONFIG_DIR/codeswarm.json` instead. The SessionStart hook and the
swarm director read exactly this path — write nowhere else.

Re-runnable by design: running setup again shows the current values, re-asks
every question and overwrites the file with the new answers. Typical reason
to re-run: a subscription change (raise or drop the top-model cap).

## Flow

1. **Show current config first.** Read the config path. If the file exists,
   print its values as a compact table (for `issueTracker.tokenFile` print
   only the path — NEVER the file contents) and use them as the defaults for
   the questions below. If absent, say this is first-time setup and use the
   stated defaults.
2. **Ask the six questions** below — one at a time, short answers, always
   offering the default.
3. **Write the file** with the Write tool, exact shape as in "File shape"
   below. Pretty-print (2-space indent). Carry over a `lastSmokeVersion`
   key when the existing file has one — it is director bookkeeping for the
   update canary (see `codeswarm:swarm-director`), not a setup question;
   overwriting setup must not erase it.
4. **Confirm**: print the written path and the final values (token file path
   only, never token contents). Mention: `alwaysOn` takes effect on the next
   session (the SessionStart hook reads it); `/codeswarm:swarm doctor` displays the
   active config; re-run `/codeswarm:swarm setup` any time.

## The six questions

1. **Always-on mode?** — key `alwaysOn`, `true`/`false`, default `false`.
   When true, every new session starts with a one-line directive to route
   substantive coding work through the swarm director. When false, the swarm
   only engages when mentioned or via `/codeswarm:swarm`.
   *Cost:* on routes more work through the multi-agent swarm — higher token
   use than working inline; off keeps the swarm opt-in.
2. **Top model** — key `topModel`, default `null`. Three kinds of value,
   present them in this order:
   - `null` — top-tier agent calls (implementers, finders, synthesis,
     review gates) carry no model and inherit the session model. Whatever
     model the user is running the session on is what the top tier uses.
   - a **family alias** — `"opus"` / `"sonnet"` / `"haiku"` / `"fable"`.
     This tracks the LATEST release of that family: `"opus"` runs Opus 4.8
     today and auto-moves to a newer Opus when one ships. Recommended for
     "always use the best Opus" without re-editing config. Use `"sonnet"`
     to cap top-tier cost on a limited subscription.
   - a **pinned id** — e.g. `"claude-opus-4-7"` / `"claude-opus-4-6"`.
     Freezes the top tier to that exact version (reproducibility, or
     staying on a version you have validated); it will NOT auto-upgrade.
   Any model name Claude Code accepts is valid. Mechanical/verify tiers are
   unaffected either way. There is no synthetic `"latest"` keyword — the
   family alias IS the latest-tracking value.
   *Cost:* the top tier is the single biggest per-agent spend; a family cap
   like `"sonnet"` cuts it substantially, `null`/`"opus"` spends the most.
3. **Accessibility level** — key `accessibility`, one of `"off"`, `"A"`,
   `"AA"`, `"AAA"`, default `"AA"` (the industry norm — a default, not a
   mandate). Controls whether the wcag dimension sits in the default review
   set and which WCAG 2.2 level the auditors apply (contrast bars 3.0 / 4.5
   / 7.0 shift with the level; AAA adds the stricter criteria). A target
   repo's `## swarm` profile can override this per repo (repo wins).
   *Cost:* `off` drops the wcag finder from the default review — one fewer
   finder agent per review; `A`/`AA`/`AAA` cost the same, they only change
   strictness.
4. **Retrospect mode** — key `retrospect`, one of `"full"`, `"light"`,
   `"off"`, default `"full"`. full = the post-build architecture retrospect
   judges coherence, package hygiene, naming and DX; light = breaking
   architecture findings only, no DX/naming nits; off = the phase is
   skipped. Per-repo `## swarm` override wins. The retrospect never
   auto-fixes in any mode.
   *Cost:* `full` adds a whole-build architecture pass (one extra agent) at
   the end of each build; `light` is cheaper, `off` spends nothing. Note:
   retrospect runs ONLY under full rigor — on the default `lite` rigor this
   setting has no cost because the phase is skipped entirely.
5. **Rigor** — key `rigor`, one of `"lite"`, `"full"`, default `"lite"`.
   The default verification depth. `lite` (default): a build is implement +
   one independent test per task (no adversarial review, no retrospect); a
   review is single-lens verify with no severity check — roughly 1.5–2x raw
   cost. The independent tester still gates correctness; you trade away the
   adversarial review and the retrospect. `full`: adds the adversarial
   review + retrospect (build) and the graded 2-lens + severity verify
   (review), ~3–4x. Recommend leaving it on `lite` and escalating a single
   run with `--thorough` (or `--rigor=full`) when a bug would be expensive;
   set `full` only if most of your work is high-stakes.
6. **Issue tracker** — key `issueTracker`, default `{ "kind": "none" }`.
   `none` = findings stay in-chat. `gitlab` / `github` = the director MAY
   (opt-in per run, batched after a workflow) file confirmed findings as
   issues.
   - `gitlab`: also ask `apiBase` (default `https://gitlab.com/api/v4`) and
     a token **FILE PATH** for `tokenFile`.
   - `github`: ask whether the `gh` CLI is installed and authenticated —
     yes: omit `tokenFile` (the CLI carries auth); no: ask a token **FILE
     PATH** for `tokenFile` (REST fallback).
   - **Token safety (hard rule): NEVER let the user paste a token into the
     chat.** The conversation is stored in transcripts/history. Ask for the
     PATH to a token file the user creates themselves; verify it exists
     (`test -f` / `Test-Path`) without ever printing its contents. If a
     token does get pasted anyway: do not use or store it, tell the user to
     treat it as compromised and rotate it, then continue with a file path.

## File shape (write exactly these keys)

```json
{
  "version": 1,
  "alwaysOn": false,
  "topModel": null,
  "accessibility": "AA",
  "retrospect": "full",
  "rigor": "lite",
  "issueTracker": { "kind": "none" }
}
```

`issueTracker` variants:

```json
{ "kind": "gitlab", "apiBase": "https://gitlab.com/api/v4", "tokenFile": "/home/me/.gitlab-token" }
{ "kind": "github" }
{ "kind": "github", "tokenFile": "/home/me/.github-token" }
```

## Who reads this file

- `hooks/session-start.js` — `alwaysOn` (three-stage session nudge).
- The swarm director (`codeswarm:swarm-director`) — all other keys, at
  triage time, wired into workflow args (see its "Config file" section).
- `/codeswarm:swarm doctor` — displays the active config as one status row.
