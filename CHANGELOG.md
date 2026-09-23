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

## [1.6.0] — 2026-09-23

### Added

- **`finderReadOnly` (`--finder-read-only`) for `swarm-review.js`.** Opt-in:
  finders judge by reading only — no repo code, no self-contained snippets,
  no test runner. Two uses. For code you have not read, it keeps every
  agent in the review from being told it may run code (prompt-level, not a
  sandbox). On eval fixtures it restores the verify measurement: on
  2026-09-23 twelve graded runs showed that finders which run their own
  claims emit no false positives, so the verify delta stayed at zero.
- `tools/record-eval.js` accepts `execRepro` and `finderReadOnly` as
  booleans and splits `byMode` totals by them (`/exec`, `/ro`).
- `fixtures/eval4`: two disjoint planted bugs and harder lures (correct
  twins of other fixtures' real bugs, outdated folk wisdom), each checked
  with `node`.

## [1.5.0] — 2026-09-23

### Changed

- **Verify verdicts are three-state: `confirmed`, `refuted`, `inconclusive`.**
  The binary `isReal` verdict, with its "default to false if you cannot
  confirm it" rule, folded "cannot confirm" into "refuted": one uncertain
  lens silently discarded a real critical, indistinguishable from a false
  positive. A lens now refutes only with counter-evidence (the input tried
  and the behaviour observed, or the file:line that rules the claim out); a
  finding is confirmed when every lens confirms, refuted when every lens
  refutes, and inconclusive otherwise — symmetric, so one lens alone can
  neither keep nor kill a finding another lens could not settle. Inconclusive
  critical/major findings land in a new `inconclusive` bucket — unresolved,
  a critical there blocks merge — and inconclusive minors are dropped and
  counted (`inconclusiveMinors`). Every bucket carries the per-lens evidence.
  `swarm-smoke.js` uses the same three states. Lens prompts also tell the
  verifier to check a finding's own stated repro — the one false positive
  that survived the 2026-08-17 `eval3` run had a repro that did not
  reproduce.
- **Co-staged build tasks need a `files` declaration to run in parallel.**
  A co-staged task without `files`, or two whose `files` overlap, now runs
  sequentially with a log line (fail-safe: no declaration, no parallelism);
  the declaration is also stated in the implementer's brief. After each
  parallel stage the result reports `stageOverlap` and `undeclaredWrites`
  from the implementers' own `filesChanged`. Shared API dependencies stay a
  director judgment.

### Added

- **`execRepro` (`--exec-repro`) for `swarm-review.js`.** Opt-in: verify
  lenses on `bugs` findings must run the finding's repro (a one-liner or an
  OS-temp scratch file, never inside the repo), and a verdict without an
  executed repro (one that left output) counts as inconclusive — so it also
  switches off read-only confirmations and kills for bugs findings. It runs
  repo code, so it is for trusted repos only — see `docs/security.md` "Repro
  execution". Without it, verify lenses are told not to execute repo code;
  finders are not restricted, and the security doc now says so.
- **Graded mode for `swarm-review.js`** (`expected`, same contract as
  `swarm-smoke.js`): the review tier — the only one that can measure the
  verify delta — no longer has to be graded by hand.
- **Run conditions in the eval log.** `tools/record-eval.js` accepts and
  validates `workflow`, `rigor`, `verify`, `finderModel`, `verifyModel`,
  `missedInconclusive`, `unexpectedInconclusive` and `notes` (conditions
  need `workflow`), rejects unknown fields, stamps `host` and
  `pluginVersion`, normalizes the fixture path, and splits its running
  totals per workflow/rigor (`byMode`; older rows land under `unlabelled`).
  An unresolved finding counts as neither a false positive killed nor a real
  bug wrongly rejected — graded mode reports `missedInconclusive` /
  `unexpectedInconclusive` so the A/B metric cannot book it as either.
  `lastSmokeVersion` now moves only on a passing smoke row, never on a
  review-tier graded run.

### Fixed

- **README and CLAUDE.md name whose log holds the 2026-08-17 delta.** The
  eval log is per config dir, so per machine; the run is in the
  maintainer's log under the fixture label `fixtures/eval3-bait-review`. A
  check on another machine had concluded it was never recorded.
- `tools/record-eval.test.mjs` removes its temp config dirs.

## [1.4.1] — 2026-08-17

### Added

- **`tools/write-inventory.test.mjs` — a gate that keeps the documented
  write inventory from drifting.** Every write `docs/security.md` had ever
  missed was prose-directed (a skill telling the model to write a file),
  never an `fs.*` call, so nothing kept the inventory in sync. The gate
  cannot discover new prose writes — measured before building, open
  vocabulary defeats grep — but it guarantees the DOCUMENTED set cannot
  drift: a write added to a hook, tool, runner or workflow, a retargeted
  destination, or a renamed inventory entry all fail loudly. New writes
  stay a review item, now a `CONTRIBUTING.md` checklist line ("any new
  write lands in three places"). Contributor-facing only, no shipped
  behaviour change.

### Changed

- **The superpowers dependency is stated in terms of skill availability,
  not plugin installation.** The director keys design and planning on
  `brainstorming` and `writing-plans` being available; the superpowers
  plugin is one way to get them, and copying those skill directories into
  `~/.claude/skills/` is another that resolves identically. Nothing in the
  flow changes — the condensed fallback and the agent-side TDD discipline
  are untouched — but a user who runs the skills without the plugin no
  longer gets the fallback for no reason. The README additionally notes why
  the copies can be preferable: the superpowers plugin registers a
  `SessionStart` hook that injects a preamble pressuring delegation and a
  separate verification pass, which a model that already does both (Opus 5)
  does not need, and which can contradict a target repo's own harness
  rules. Affects
  `README.md`, `skills/swarm-director/SKILL.md` and
  `skills/swarm-greenfield/SKILL.md`.

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
