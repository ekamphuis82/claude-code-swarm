# Security

## The hooks — small enough to read before you trust them

The plugin installs exactly two hooks (`hooks/hooks.json`), both tiny Node
scripts designed to be audited in one sitting:

- **`hooks/session-start.js`** (SessionStart) — reads
  `~/.claude/codeswarm.json` and prints AT MOST one line of session context:
  a "run `/codeswarm:swarm setup`" nudge when no config exists; an update-canary
  line when the Claude Code version differs from the last smoke-proven one
  (`lastSmokeVersion` — for this it reads the `CLAUDE_CODE_VERSION` env var
  or, read-only, the native installer's versions directory; undetectable =
  silent); the always-on routing directive when `alwaysOn` is true; nothing
  otherwise. Always exits 0 — a hook must never break a session.
- **`hooks/swarm-router.js`** (UserPromptSubmit) — scope-gated: until the
  user has run setup once (the same `codeswarm.json` config `session-start.js`
  reads exists), it exits immediately and never inspects prompt text. Once
  configured, it reads the prompt from stdin; when it mentions the swarm as a
  whole word, prints one routing line so the session loads the director
  first. Mentions that are
  *about* the plugin rather than asks *for* the swarm — path tokens, bare
  filenames, the repo name `claude-code-swarm` — are scrubbed before the
  match and never fire. Malformed input = silent. Always exits 0 — never
  blocks a prompt.

Neither script opens a network connection, spawns a process, or writes any
file. `sh hooks/hooks.test.sh` pipe-tests both.

## Where the plugin writes on disk

**Plugin state: four paths, and no others.** Three sit outside the plugin
directory; one sits inside it. Two further files are transient, and two
more can be left behind in a repo you point the swarm at — all four are
listed under the table. Everything here is local; nothing is uploaded (see
[No telemetry](#no-telemetry)).

| Path | Written by | Contents |
|---|---|---|
| `<configDir>/codeswarm.json` | `swarm setup` (the Write tool, so your normal permission prompt gates it); `tools/record-eval.js` for the `lastSmokeVersion` key only | your settings — and, for an issue tracker, the *path* to a token file, never a token |
| `<configDir>/codeswarm-eval-log.jsonl` | `tools/record-eval.js`, one appended line per graded run | fixture name, counts, token totals. No source code, no findings text |
| `<configDir>/codeswarm-runs/<runId>/` | the standalone runner only | `script.js`, `args.json`, `journal.jsonl`, `result.json` — the journal holds agent output, which is repo-derived text |
| `<pluginDir>/agents/my-*.md`, `<pluginDir>/skills/my-*/` | onboard generate mode, after your approval | the stack agents and convention skills generated for your repos |

`<configDir>` is `$CLAUDE_CONFIG_DIR` when that variable is set, otherwise
`~/.claude`. Every component resolves it identically — both hooks,
`tools/validate-config.js`, `tools/record-eval.js` and `runner/run.js` — so
no write target is ever a hardcoded home path, and pointing the whole
plugin at a throwaway or sandboxed config dir takes one environment
variable. (One READ does use a fixed home path: `session-start.js` looks in
`~/.local/share/claude/versions` to detect the running Claude Code version
when the env var is absent. It never writes there, and an unreadable
directory just makes the canary go silent.) The runner additionally accepts
`--runs-dir <dir>` to relocate run state on its own.

### Transient files

Two writes are working files rather than state — both local, both short-lived:

- **The issue-tracker auth header** (`skills/swarm-issues`). On the `curl`
  path the director writes the header line — which contains the token — to
  a private temp file, `chmod 600` on POSIX or an `icacls` current-user-only
  grant on Windows, passes it by reference (`-H @file` / `--config`), and
  deletes it after the batch. This exists precisely so the token never
  becomes a command-line argument, where process listings and shell xtrace
  would expose it. The PowerShell path builds headers in memory and writes
  no file at all. See [Token handling](#token-handling-issue-tracker).
- **A launch-time workflow script copy** (`skills/swarm-resume`). Resuming
  a run whose script has since changed requires the exact version it
  launched with, so the director extracts it (`git show
  <commit>:workflows/x.js`) into `<configDir>/codeswarm-runs/` and passes
  that path to the Workflow tool. Plain source from your own history, no
  secrets; delete the directory whenever you like.

### Why the config is not kept in the plugin directory

Storing it under `<pluginDir>` would be the tidier-looking choice and a
worse one:

- **Updates would wipe it.** A marketplace install is a managed directory —
  `claude plugin update` replaces its contents. Settings kept there would
  not survive a single update, and `swarm setup` would have to be re-run
  each time.
- **That directory may be read-only.** Nothing guarantees the installed
  plugin tree is writable; a config write that fails on some installs is
  not a config system.
- **One config, many checkouts.** Users who run an installed copy and a
  development clone get the same settings instead of two drifting ones.
- **`~/.claude` is where Claude Code keeps its own state.** `settings.json`
  and the rest already live there. This is the sanctioned location for
  per-user configuration, not an escape from the plugin's boundary — which
  is why the path is resolved through `CLAUDE_CONFIG_DIR` rather than
  assumed.

### What does not get written

- **The hooks write nothing at all** — they read the config and print at
  most one line each.
- **`tools/validate-config.js` writes nothing** — a config repair is always
  your own edit.
- **`tools/record-eval.js` never creates a config.** If none is readable it
  reports `skipped` and moves on; it only ever updates a key inside a file
  you already made.
- **Agents never write to your target repositories outside the task you
  asked for.** A build or refactor changes code because that is the job;
  research, drift and smoke runs are read-only. Two plugin-generated
  bookkeeping files can land in a repo, both listed just below.

### Files the plugin can leave in a target repo

Neither is written by an agent; the director writes both, and both are
plain text you can delete.

- **`docs/swarm-retrospect-<date>.md`** (repo root when there is no
  `docs/`) — the architecture retrospect at the end of a build, written as
  a walkable report because the retrospect never auto-fixes. It never
  overwrites an existing report (`-2`, `-3`, `-<HHmm>` suffixes). The build
  report ends with three choices; choosing "ignore" deletes the file, and
  no answer leaves it where it is.
- **`.swarm-waivers.json`** — appended only when *you* dismiss a review
  finding, recording `{file, match, reason, date}` so later reviews skip
  that finding and report it as waived. Nothing is ever removed from it
  silently, and criticals are never waivable. This is the one case where a
  review run is not read-only, and it takes your explicit dismissal.

### Removing the plugin's state

Uninstalling the plugin does not delete these files. To remove them:
`codeswarm.json` and `codeswarm-eval-log.jsonl` in `<configDir>`, plus the
`codeswarm-runs/` directory. The runs directory is safe to delete at any
time (it only costs you resume-from-cache on unfinished runs). The eval log
is the plugin's own measurement evidence — deleting it resets the reported
totals to zero.

### The write inside the plugin directory

Onboard generate mode writes `my-*` agents and skills into the plugin
clone. That is a deliberate trade-off, and it is the reason the `my-`
contract exists: those files are yours, upstream never ships them, and
`.gitignore` keeps them out of commits, so an update can never collide with
them by name. What that guarantee does *not* cover is survival: in a clone
you update with `git pull`, the generated files are untracked and stay put;
a managed reinstall that replaces the directory outright would take them
with it. Keep a copy of a roster you have edited. Review generated files
before reloading — see [Agent boundaries](#agent-boundaries).

## The tools (`tools/`)

Neither tool is a hook; both are invoked explicitly and both are local-only.

`tools/validate-config.js` READS one local file — `codeswarm.json` in
`$CLAUDE_CONFIG_DIR` or `~/.claude` (or a path given as its argument) — and
writes nothing at all: it reports invalid values and unknown keys and leaves
the file untouched, so a config repair is always the user's own edit. No
network, no spawned processes. Exit 0 valid, 1 problems, 2 unreadable/malformed.
`node --test tools/validate-config.test.mjs` covers it. It prints the config's
key names and offending values, so treat its output like the config itself:
`issueTracker.tokenFile` appears as a PATH (never the token), because that is
all the file holds.

`tools/record-eval.js` is NOT a hook either — the director invokes it explicitly
after a smoke or graded eval run. It writes exactly two local files next to
the config: it appends one line to `codeswarm-eval-log.jsonl`, and on a
passing run it updates the `lastSmokeVersion` key inside `codeswarm.json`
(preserving every other key; it never creates a config file). No network,
no spawned processes; invalid input fails loud with a non-zero exit.
`node --test tools/record-eval.test.mjs` covers it.

## Standalone runner (`runner/`)

The fallback execution path (`node runner/run.js`) spawns one `claude -p`
subprocess per agent — local processes only, no network of its own. What
you must know before using its flags:

- **Default permission posture is your own.** Without flags, spawned
  agents inherit your Claude Code settings (allowlists in
  `settings.json`). Headless agents cannot answer permission prompts, so
  tools outside your allowlist are simply denied — read-heavy workflows
  (review, research, drift, smoke) mostly work out of the box; build and
  refactor need write/Bash permissions granted up front.
- **`--permission-mode <mode>`** passes the mode to every spawned agent
  (e.g. `acceptEdits`). **`--grant-agent-tools`** allowlists exactly the
  tools an agent's own frontmatter declares (`agents/*.md` `tools:` line)
  — scoped, but it does grant `Bash` to agents that list it.
- **The runner ships no bypass flag of its own.** It never assembles
  `--dangerously-skip-permissions`, and `runner/driver.test.mjs` asserts
  that the string is never emitted. A full bypass is still reachable — it
  is a permission mode like any other, `--permission-mode
  bypassPermissions` — so the capability is the CLI's, spelled with the
  CLI's own name, rather than a convenience alias this plugin adds on top.
  Use it only in a sandbox or container, or on a throwaway checkout; never
  on a machine whose credentials matter.
- **State on disk:** each run writes `script.js`, `args.json`,
  `journal.jsonl` and `result.json` under
  `<configDir>/codeswarm-runs/<runId>/` — the journal contains agent
  results (repo-derived text). Treat the runs dir like transcripts:
  local, may contain code excerpts, delete freely.
- **Agent identity:** the runner inlines the `agents/*.md` body into the
  prompt (the headless CLI has no per-call agent registry) — the same
  text the Workflow tool would load, single-sourced from the file.

## No telemetry

The plugin sends nothing anywhere. There is no analytics endpoint, no
version-check call, no error reporting. The only network traffic the plugin
can ever cause is the optional issue-tracker output — and only when you
configured a tracker and opted in per run. (The standalone runner's spawned
`claude` processes talk to the model API exactly as your own sessions do —
that is Claude Code's traffic, not the plugin's.)

## Token handling (issue tracker)

- Tokens live in a **file you create yourself**; the config stores only the
  **path** (`issueTracker.tokenFile`). With the GitHub `gh` CLI, no token
  file is involved at all.
- The director reads the token at call time into a private header file
  (0600 where the OS honors it — on Windows, an `icacls` grant to the
  current user) passed to curl by reference (`-H @file` / `--config`),
  deleted after the batch — never assembled into a command-line argument,
  where it would
  be visible in process listings and shell xtrace. It is never echoed,
  never committed, and **never put into an agent prompt** — agents never
  touch tracker APIs.
- **Never paste a token into the chat.** Conversations are stored in
  transcripts/history on your machine. If a token does get pasted, treat it
  as compromised and rotate it; setup and doctor will only ever ask for a
  file path.
- Setup prints the token file **path** when confirming config — never file
  contents.

## Agent boundaries

- Agents coordinate in-session through structured outputs and files — no
  external side channels.
- Issue bodies and other tracker content are untrusted input: data, never
  instructions that override skills, gates or config.
- Onboard proposals are synthesized from scanned repo content — and, when
  the director passes `existingAgents`, from the descriptions of custom
  agents that may come from third-party plugins; both ride the synthesis
  prompts inside the same data fence (untrusted data, never instructions).
  Proposals are untrusted until you have read them. The approval gate therefore reviews
  CONTENT, not counts: the director shows every string field of the
  proposal — full rule texts, agent descriptions, scope and evidence —
  BEFORE generate mode writes anything. Never approve from a
  name/scope/rule-count summary alone.
- The gate reviews generation inputs; the actual `my-*` file bodies are
  LLM-composed after approval. Diff-review the generated `my-*` files
  against the approved proposal BEFORE reloading plugins — writer drift or
  injected instructions would otherwise load into every future session.
  They are plain markdown in your clone: review and edit them like any
  code you adopt.
