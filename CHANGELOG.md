# Changelog

All notable changes to the codeswarm plugin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Claude Code uses the `.claude-plugin/plugin.json` version string as the
plugin cache key, so the bump commit *is* the release event: a section below
covers every change the bump made installable — the commits since the
previous bump, plus the bump itself — and the `v<version>` tag sits on that
bump commit. Tags for 1.0.0 through 1.3.0 were created retroactively on
2026-08-17, when this changelog was written.

## [1.4.0] — 2026-08-17

### Removed

- **`node runner/run.js --skip-permissions`.** It was a convenience alias
  that made the runner assemble `--dangerously-skip-permissions`, and it
  added no capability: `--permission-mode` passes its value straight
  through to `claude -p`, and `bypassPermissions` is one of the CLI's own
  accepted modes. **Migration:** `--permission-mode bypassPermissions`,
  with the same sandbox-only warning as before. The flag now fails loudly
  as an unknown option rather than being silently ignored.

  A strict SemVer reading calls removing a documented CLI flag a MAJOR
  bump. Released as a minor because the flag lives on the degraded fallback
  path, the capability it exposed is unchanged, and the migration is a
  one-token edit — but it is a breaking change for anyone who scripted it.

### Changed

- The runner never assembles `--dangerously-skip-permissions` at all;
  `runner/driver.test.mjs` asserts the string is never emitted, so a
  future edit cannot quietly reintroduce a plugin-owned bypass. The
  security doc's runner section states the posture instead of warning
  about a flag.

## [1.3.2] — 2026-08-17

### Added

- `docs/security.md` now carries a "Where the plugin writes on disk"
  section: the full write inventory — four plugin-state paths, two
  transient files (the issue-tracker auth header, a launch-time script copy
  for resume) and the two files the director can leave in a target repo
  (the build retrospect report, `.swarm-waivers.json`) — why the config
  lives in `<configDir>` rather than the plugin directory, what is never
  written, and how to remove the plugin's state. Answers the question a
  marketplace reviewer has to ask about any out-of-root write.

### Changed

- The resume scratch copy of a launch-time workflow script now has a pinned
  location (`<configDir>/codeswarm-runs/`) instead of an unspecified one,
  so it is inventoried and cleanable.
- README's `my-` contract states what it does not cover: name-collision
  immunity is not file survival across a directory-replacing reinstall.

## [1.3.1] — 2026-08-17

### Added

- `CHANGELOG.md` (this file), covering 1.0.0 onward.
- `keywords` in the plugin manifest, for marketplace discovery, plus author
  email and url.
- Retroactive `v1.0.0`–`v1.3.0` git tags, so every documented release is
  pinnable.

### Changed

- `homepage` now points at the README anchor rather than repeating
  `repository`.
- The CONTRIBUTING version-bump rule now also requires a changelog section
  and a `v<version>` tag for the same release.

## [1.3.0] — 2026-08-17

### Added

- Write-side JSON-schema check for `~/.claude/codeswarm.json`: every config
  write is validated before it lands, so a malformed hand-edit or a bad
  setup answer fails loudly instead of silently changing behaviour
  (`tools/validate-config.js`).
- `fixtures/eval3`: a precision-weighted grading fixture whose `guards.js`
  is correct code shaped like notorious bugs, built to make a finder emit a
  false positive that the verify layer can kill.
- First live A/B measurement of the verify layer recorded in the eval log: a
  graded `eval3` run with a suspicion-biased target killed three false
  positives and wrongly rejected nothing.

### Changed

- Rigor levels now drive an explicit allowlist rather than ad hoc per-route
  logic, and the highest gates run at `xhigh` effort.
- Documentation reconciled with what is actually on disk: the eval-log
  claims now describe the log's shape rather than freezing a run count, and
  a backfilled batch that was not independent live evidence was removed from
  the log (backup retained next to the config).

### Fixed

- Shadowed inner binding in the onboard workflow renamed (`bare` →
  `bareRef`).

### Removed

- The re-review round in the build workflow. It re-spent tokens on findings
  the fix round had already addressed without changing outcomes.

## [1.2.1] — 2026-07-15

### Added

- `fixtures/eval2`: a grading fixture decorrelated from `fixtures/eval`, so
  repeated grading stops drawing correlated samples from one bug set.

### Fixed

- Finder output relayed into later prompts is now fenced in the review
  workflow, closing a prompt-injection path from reviewed source into a
  downstream agent prompt.

## [1.2.0] — 2026-07-10

### Added

- The onboard repo scan now captures code-organization and layout
  conventions, so generated convention skills describe where code goes, not
  only how it is written.

### Fixed

- The smoke workflow no longer checks for a stale `calc.js` filename in its
  no-expected pass gate.

## [1.1.1] — 2026-07-08

### Fixed

- `swarm doctor` now includes `adHocSpecialists` in its effective-config
  check, so a configured value no longer reads as unset.

## [1.1.0] — 2026-07-08

### Added

- Onboarding is aware of agents that already exist and will not propose
  duplicates; ad hoc specialist use is opt-in.
- Privacy policy (`PRIVACY.md`).
- Security documentation for the `swarm-router` scope gate.

### Fixed

- `swarm-router` is gated on a configured install, so the hook stays inert
  until the plugin has been set up.

### Changed

- Version-bump discipline replaces the earlier no-version invariant: the
  manifest carries a semantic version from this release onward.

## [1.0.0] — 2026-07-07

First public release.

### Added

- `/codeswarm:swarm` director entrypoint with task triage across eleven
  routes: build, greenfield, review, refactor, research, drift, smoke,
  onboard, doctor, setup, resume — including a specialist-fit gate in
  triage.
- Deterministic workflow scripts for build, review, refactor, research,
  drift, smoke and onboard — fixed phases, structured JSON handoffs,
  independent verification, quiet-by-default output.
- Stack-agnostic process agents: reviewer, tester, researcher, security
  auditor, WCAG auditor.
- Standalone runner (`runner/`) that executes the same workflow scripts
  unchanged via `claude -p` subprocesses, as a fallback when the Workflow
  tool is unavailable.
- Two small session hooks (`SessionStart` canary, `UserPromptSubmit`
  router), both offline and non-writing.
- Onboarding fallback that composes a stack-default roster for users with
  no scannable repos.
- Grading fixtures (`fixtures/eval`, `fixtures/smoke`) and the eval log
  written by `tools/record-eval.js`.
- Manifest metadata and repository links for marketplace submission.

### Fixed

- The standalone runner kills the whole process tree on a win32 driver
  timeout.
