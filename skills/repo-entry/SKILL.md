---
name: repo-entry
description: How to enter any target repo - read the repo's CLAUDE.md/AGENTS.md completely first, trust code over markdown, respect project-local skills and gates, editing discipline. Load before touching any repo.
---

# Repo entry

How every swarm agent (and the director) enters a target repo. All rules are
universal — they apply to any repo, any stack.

## Before any work in a repo

1. Read the target repo's `CLAUDE.md` and/or `AGENTS.md` COMPLETELY. Repo
   specifics (ports, run commands, test gates, style rules, dev-proxy
   targets, domain terminology) live THERE, not in this plugin. Never assume
   a port, topic name, or command from another repo. If the repo's docs point
   to an index (e.g. a `docs/INDEX.md`), read that door too before deciding
   anything architectural.
2. Check `<repo>/.claude/skills/` for project-local skills and gates.
   Project-local skills and gates OVERRIDE this plugin's defaults: if the
   repo ships its own review gate, eval harness, or workflow skill, use it
   instead of (not in addition to) your own generic equivalent, and say in
   your result which gate applied.

## Trust code over markdown

README/IMPLEMENTATION-style docs overstate what is done. When a doc and the
code disagree, the code is right. Verify claims by reading source, not docs.

## Editing discipline

- Match surrounding code style; comments only for non-obvious constraints.
- Exclude generated code and applied database migrations from bulk
  search-replace. Applied migrations (Flyway/Liquibase/etc.) are immutable —
  editing one changes its checksum and crash-loops every environment that
  already ran it; add a new migration instead.
- Package/folder hygiene: never dump classes in a package/folder root that is
  accumulating unrelated types — `dto/`, `service/`, `components/` and
  friends get logical submodules. New code goes in (or creates) the right
  submodule; flag existing dumping grounds you touch.
- DX is a quality bar, not taste: results must be discoverable (predictable
  locations, consistent naming) and readable — poor DX is a review finding.

## Repo swarm profile

A repo's CLAUDE.md MAY contain a `## swarm` section — binding configuration
for all swarm work in that repo:

- `dimensions:` default review dimensions for `swarm-review.js`
- `test-gate:` the command that must pass before any work is "done"
- `exclude:` path globs that bulk edits and reviews must skip
- `implementer:` preferred implementer agentType for build tasks

When present, apply it when building workflow args; when absent, derive the
same facts from the repo's docs and build files before starting.
