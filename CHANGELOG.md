# Changelog

All notable changes to the codeswarm plugin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version in `.claude-plugin/plugin.json` is the release version; each
release below is tagged `v<version>` in git.

## [1.3.0] — 2026-08-17

### Added

- Write-side JSON-schema check for `~/.claude/codeswarm.json`: every config
  write is validated before it lands, so a malformed hand-edit or a bad
  setup answer fails loudly instead of silently changing behaviour
  (`tools/validate-config.js`).
- First live A/B measurement of the verify layer recorded in the eval log: a
  graded `fixtures/eval3` run with a suspicion-biased target killed three
  false positives and wrongly rejected nothing.

### Changed

- Rigor levels now drive an explicit allowlist rather than ad hoc per-route
  logic, and the highest gates run at `xhigh` effort.

### Removed

- The re-review round in the build workflow. It re-spent tokens on findings
  the fix round had already addressed without changing outcomes.

## [1.2.1] — 2026-07-15

### Added

- `fixtures/eval3`: a precision-weighted grading fixture whose `guards.js`
  is correct code shaped like notorious bugs, built to make a finder emit a
  false positive that the verify layer can kill.

### Fixed

- Finder output relayed into later prompts is now fenced in the review
  workflow, closing a prompt-injection path from reviewed source into a
  downstream agent prompt.
- Shadowed inner binding in the onboard workflow renamed (`bare` → `bareRef`).

### Changed

- Documentation reconciled with what is actually on disk: the eval-log claims
  now describe the log's shape rather than freezing a run count, and a
  backfilled batch that was not independent live evidence was removed from
  the log (backup retained next to the config).

## [1.2.0] — 2026-07-10

### Added

- The onboard repo scan now captures code-organization and layout
  conventions, so generated convention skills describe where code goes, not
  only how it is written.

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
  onboard, doctor, setup, resume.
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
- Grading fixtures (`fixtures/eval`, `fixtures/smoke`) and the eval log
  written by `tools/record-eval.js`.
- Manifest metadata and repository links for marketplace submission.
