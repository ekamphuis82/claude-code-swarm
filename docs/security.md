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

## The bookkeeping tool

`tools/record-eval.js` is NOT a hook — the director invokes it explicitly
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
- **`--skip-permissions`** maps to `--dangerously-skip-permissions`.
  Same warning as the flag name: only in a sandbox/container or on a
  throwaway checkout, never on a machine whose credentials matter.
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
