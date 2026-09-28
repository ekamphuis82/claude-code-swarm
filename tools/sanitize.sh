#!/bin/sh
# Sanitize gate (branding rule, see CLAUDE.md). Exit 0 only on a genuinely
# clean scan: a hit (git grep exit 0) or a crashed grep (exit >1) fails.
# No term list (CI, forks) = nothing to check = pass.
#   pass 1: tracked + untracked, minus LICENSE and the .claude-plugin manifests
#   pass 2: gitignored local my-* artifacts that declare `scope: global` in
#           their frontmatter (an agent .md, or a skill's SKILL.md — which
#           covers the whole skill dir, node_modules skipped). Unmarked my-*
#           files are project-specific by design and not scanned.
# git grep, not grep -f: msys grep 3.0 (Git Bash) can abort on the term list.
terms="${SANITIZE_TERMS:-.sanitize-terms}"
[ -f "$terms" ] || exit 0
git grep -riE --untracked -f "$terms" -- ':!LICENSE' ':!.claude-plugin'
tracked=$?

# frontmatter (first --- block) carries `scope: global`
is_global () {
  awk 'NR == 1 { if ($0 !~ /^---\r?$/) exit; next } /^---\r?$/ { exit } /^scope:[ \t]*global[ \t]*\r?$/ { f = 1 } END { exit !f }' "$1"
}
set --
for f in agents/my-*.md; do [ -f "$f" ] && is_global "$f" && set -- "$@" "$f"; done
for f in skills/my-*/SKILL.md; do [ -f "$f" ] && is_global "$f" && set -- "$@" "${f%/SKILL.md}"; done
global=1
if [ $# -gt 0 ]; then
  git grep -riE --untracked --no-exclude-standard -f "$terms" -- "$@" ':(exclude,glob)**/node_modules/**'
  global=$?
fi
[ "$tracked" -eq 1 ] && [ "$global" -eq 1 ]
