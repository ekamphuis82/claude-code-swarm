---
name: swarm-issues
description: Issue-tracker output sink for swarm results - batching rules, token-file handling, GitLab/GitHub provider commands and the finding-to-issue mapping [internal: loaded by swarm-director before filing issues]
---

# Issue tracker output (optional, director-only)

An OUTPUT SINK, never coordination. Provider from the config
(`issueTracker`); `kind: "none"` (default) = in-chat report only. Opt-in:
only when the user asks ("file these as issues") or a flow says so
(greenfield slice backlog). Tracker unusable (no config, missing token
file, no credentials) → skip tracker steps or do them locally (git init
without remote, in-chat report); never block or fail a workflow on tracker
availability.

## Hard rules

- Agents NEVER touch the tracker API; the director writes issues in ONE
  batch AFTER the workflow completes. Anything else makes the API a
  bottleneck and leaks credentials into agent contexts.
- Token handling: read the token at call time from the config's `tokenFile`
  (or wherever the target repo's CLAUDE.md says credentials live). Never on
  a command line (argv is visible in process listings and shell xtrace),
  never echoed, never in an agent prompt, never committed. With `curl`:
  write the header line to a private temp file and pass it by reference
  (`-H @file` / `--config`) — `chmod 600` on POSIX, an `icacls`
  current-user-only grant on Windows — and delete it after the batch. With
  PowerShell no temp file is needed: build headers in memory,
  `Invoke-RestMethod -Headers @{ 'PRIVATE-TOKEN' = (Get-Content $tokenFile -Raw).Trim() }`.
- NEVER let a token be pasted into the chat (conversations persist in
  transcripts/history): ask for a FILE PATH to a token file the user
  creates; if a token does get pasted, tell the user to treat it as
  compromised and rotate it.

## Providers

- `gitlab`: REST against `apiBase` (default `https://gitlab.com/api/v4`),
  token as the `PRIVATE-TOKEN` header per the rules above. Issue create:
  POST `{apiBase}/projects/{url-encoded path}/issues`.
- `github`: prefer the `gh` CLI when installed and authenticated
  (`gh issue create --repo owner/name --title ... --body ... --label ...` —
  no token file involved); otherwise REST against
  `https://api.github.com`, token as the `Authorization: Bearer` header,
  same rules.

## Mapping (provider-independent)

Review → one issue per confirmed finding (title = `file:line — problem`,
label per dimension, severity label); greenfield → one milestone per slice,
one issue per plan task, per repo; refactor → a single issue with the site
checklist when work is deferred. Direct REST calls or the `gh` CLI — no
wrapper tooling.
