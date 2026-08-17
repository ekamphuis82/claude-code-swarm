# Contributing

Thanks for considering a contribution. Ground rules — short, because the
repo is small on purpose.

## Before you build

Open an issue first for anything beyond a typo/docs fix — the plugin guards
a few load-bearing invariants (quiet default, model-tier fallback, the `my-`
naming contract, approval-gated generation) and it is cheaper to align
before code exists.

## Development checks

No package.json, no build. The whole gate is:

```sh
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'))"
for f in hooks/*.js tools/*.js runner/*.js; do node --check "$f"; done
node --test workflows/*.test.mjs tools/*.test.mjs runner/*.test.mjs
sh hooks/hooks.test.sh
{ [ ! -f .sanitize-terms ] || { git grep -riE --untracked -f .sanitize-terms -- ':!LICENSE' ':!.claude-plugin'; [ $? -eq 1 ]; }; }
```

All five must pass (on Windows: run them in Git Bash) — this is the same gate
`CLAUDE.md` documents. CI runs it on every push, plus a frontmatter lint
(skill/agent `name:` must match the dir/filename). The last line is the
sanitize gate: `.sanitize-terms` is a gitignored local term list (one regex
per line) that never gets committed — absent (CI, forks) means the check
passes silently; a hit outside the attribution exclusions fails the gate.

Note `node --check` covers the hooks, `tools/` and `runner/` only. The
workflow scripts are Workflow-harness modules (`export const meta` +
top-level return/await in one file) that standalone node cannot parse —
whether `--check` passes on them is node-version luck (v24 yes, v18 no).
Their syntax gate is `workflows/syntax.test.mjs` (strips the export, parses
the body as an async function — exactly what the harness does), which runs
in the `node --test` step.

## Invariants (PRs that break these will be declined)

- **Never hardcode a top-tier model in a workflow script.** Top-tier
  `agent()` calls carry no `model` key so they inherit the session model;
  the only sanctioned override is the `topModel` arg.
- **Quiet is the default.** Every agent prompt gets the silent-mode
  directive unless `quiet: false` was passed explicitly.
- **Upstream never ships `my-*` files.** That prefix belongs to
  user-generated artifacts; it is what makes `git pull` updates safe.
- **Generation is approval-gated.** `swarm-onboard.js` in generate mode
  only ever runs on a proposal a human has seen in full — every rule
  string, description, scope and evidence field; it never overwrites
  existing files.
- **Hooks stay tiny, silent-safe and offline.** At most one printed line,
  always exit 0, no network, no file writes.
- **A new `codeswarm.json` key lands in three places in the same PR:** the
  table in `docs/configuration.md`, the code that reads it (with an
  allowlist + `log()` warning, never a silent `=== 'value'` fallback), and
  `SCHEMA` in `tools/validate-config.js` — a key missing from the schema is
  reported as unknown on an otherwise correct config. `prose-sync.test.mjs`
  asserts the schema half; `validate-config.js` never rewrites a user's file.
- **Any new write lands in three places in the same PR:** the code or prose
  that performs it, an entry in `docs/security.md` "Where the plugin writes
  on disk", and an entry in `tools/write-inventory.test.mjs` (bump its group
  count deliberately). **This includes prose** — a skill or agent telling
  the model to write a file is a write, and it is the kind that keeps
  escaping: every write the inventory has ever missed was prose-directed,
  never an `fs.*` call. The test cannot discover a new one for you — open
  vocabulary defeats pattern matching, measured on this repo — so it is a
  review item. What the test does guarantee is that the documented set
  cannot drift in either direction.
- **Workflow scripts are plain JS** (the Workflow tool parses no
  TypeScript) and must keep `meta` a pure literal.
- **Internal workflow markers** go at the END of `meta.description` as
  `[internal: launched by swarm-director]` — the description doubles as the
  progress-UI title.
- **Bump `plugin.json` `version` in the same PR as any user-visible
  change.** The marketplace listing requires the field, and Claude Code
  uses the version string as the plugin cache key: `claude plugin update`
  reports "already at the latest version" on an unchanged number even when
  the content is newer — an unbumped release silently freezes every
  installed copy on the old cache. (The field was originally omitted so the
  git SHA served as the version and every pushed commit was installable;
  marketplace submission ended that option.) Semver-ish is fine: features
  minor, fixes patch.
- **Add a `CHANGELOG.md` section for the same version, and tag the bump
  commit `v<version>`.** The marketplace pre-submission checklist requires
  the changelog's top version to match the manifest, and a tag is what a
  reviewer pins. Because the version string is the cache key, the bump
  commit is the release event: the section covers every change since the
  previous bump, and the tag goes on the bump commit — not on whatever
  landed afterwards. No release-URL link refs in the changelog: the repo URL
  carries the maintainer name, which the sanitize gate blocks outside
  LICENSE and the `.claude-plugin` manifests.

## Style

- English everywhere (identifiers, comments, docs).
- Keep agent prompts terse and evidence-driven (file:line, verbatim test
  lines) — prose padding in prompts is cost, not quality.
