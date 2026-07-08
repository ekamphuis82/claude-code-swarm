#!/bin/sh
# Pipe tests for the codeswarm hooks (spec item 4) — run from anywhere:
#   sh hooks/hooks.test.sh
# Feeds sample hook JSON on stdin and asserts the printed context lines.
# Stdin feeds use printf '%s\n', NEVER echo: `sh` is dash on Ubuntu CI and
# dash's XSI echo expands backslash escapes, corrupting the Windows-path
# JSON fixtures ("C:\\..." -> invalid \d escape); bash's echo leaves them
# alone, so the corruption only shows on CI. printf %s is literal in both.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# --- session-start.js: three stages ---

# stage 1: no config file -> one-line "run /codeswarm:swarm setup" nudge
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/session-start.js") || fail "stage1 exit code"
echo "$out" | grep -q "/codeswarm:swarm setup" || fail "stage1: expected the setup nudge, got: $out"
[ "$(printf '%s' "$out" | grep -c .)" -eq 1 ] || fail "stage1: must be exactly one line"

# stage 2: alwaysOn true -> director directive
echo '{"alwaysOn": true}' > "$TMP/codeswarm.json"
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/session-start.js") || fail "stage2 exit code"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "stage2: expected the always-on directive, got: $out"
[ "$(printf '%s' "$out" | grep -c .)" -eq 1 ] || fail "stage2: must be exactly one line"

# stage 3: config present, alwaysOn false -> silent
echo '{"alwaysOn": false}' > "$TMP/codeswarm.json"
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/session-start.js") || fail "stage3 exit code"
[ -z "$out" ] || fail "stage3: must be silent, got: $out"

# malformed config -> treated as missing (stage 1 nudge), never a crash
echo 'not json' > "$TMP/codeswarm.json"
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/session-start.js") || fail "malformed-config exit code"
echo "$out" | grep -q "/codeswarm:swarm setup" || fail "malformed config: expected the setup nudge, got: $out"

# valid JSON but not a config object (array) -> also stage 1 nudge
echo '[]' > "$TMP/codeswarm.json"
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/session-start.js") || fail "array-config exit code"
echo "$out" | grep -q "/codeswarm:swarm setup" || fail "array config: expected the setup nudge, got: $out"

# --- session-start.js: update canary (CLAUDE_CODE_VERSION pins detection deterministically) ---

# version differs from lastSmokeVersion -> one canary line pointing at smoke
echo '{"alwaysOn": false, "lastSmokeVersion": "1.0.0"}' > "$TMP/codeswarm.json"
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" CLAUDE_CODE_VERSION="9.9.9" node "$ROOT/hooks/session-start.js") || fail "canary exit code"
echo "$out" | grep -q "update canary" || fail "canary: expected the canary line, got: $out"
echo "$out" | grep -q "/codeswarm:swarm smoke" || fail "canary: must point at smoke, got: $out"
[ "$(printf '%s' "$out" | grep -c .)" -eq 1 ] || fail "canary: must be exactly one line"

# version matches lastSmokeVersion, not always-on -> silent
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" CLAUDE_CODE_VERSION="1.0.0" node "$ROOT/hooks/session-start.js") || fail "canary-match exit code"
[ -z "$out" ] || fail "canary: must be silent when versions match, got: $out"

# canary + alwaysOn -> STILL one line, carrying both the canary and the directive
echo '{"alwaysOn": true, "lastSmokeVersion": "1.0.0"}' > "$TMP/codeswarm.json"
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" CLAUDE_CODE_VERSION="9.9.9" node "$ROOT/hooks/session-start.js") || fail "canary+alwayson exit code"
echo "$out" | grep -q "update canary" || fail "canary+alwaysOn: expected the canary, got: $out"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "canary+alwaysOn: expected the directive too, got: $out"
[ "$(printf '%s' "$out" | grep -c .)" -eq 1 ] || fail "canary+alwaysOn: must be exactly one line"

# version matches, alwaysOn true -> plain always-on directive (no canary)
out=$(printf '%s\n' '{"session_id":"t"}' | CLAUDE_CONFIG_DIR="$TMP" CLAUDE_CODE_VERSION="1.0.0" node "$ROOT/hooks/session-start.js") || fail "canary-quiet exit code"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "canary-quiet: expected the always-on directive, got: $out"
if echo "$out" | grep -q "update canary"; then fail "canary-quiet: canary must not fire on a matching version, got: $out"; fi

# --- swarm-router.js: UserPromptSubmit router ---

# scope gate: no config at all -> silent even on a clear swarm mention
RTMP="$(mktemp -d)"
out=$(printf '%s\n' '{"prompt":"use the swarm to review this repo"}' | CLAUDE_CONFIG_DIR="$RTMP" node "$ROOT/hooks/swarm-router.js") || fail "router unconfigured exit code"
[ -z "$out" ] || fail "router: must stay silent until codeswarm is configured, got: $out"
rm -rf "$RTMP"

# the rest of the router tests run against a configured install (setup already run)
echo '{"alwaysOn": false}' > "$TMP/codeswarm.json"

# prompt mentions swarm as a word -> one routing line
out=$(printf '%s\n' '{"prompt":"use the swarm to review this repo"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router exit code"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "router: expected the routing line, got: $out"
[ "$(printf '%s' "$out" | grep -c .)" -eq 1 ] || fail "router: must be exactly one line"

# the plugin's own brand "codeswarm" must fire too
out=$(printf '%s\n' '{"prompt":"use codeswarm to review this repo"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router codeswarm exit code"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "router: expected the routing line for 'codeswarm', got: $out"
[ "$(printf '%s' "$out" | grep -c .)" -eq 1 ] || fail "router codeswarm: must be exactly one line"

# word boundary: "swarming" must NOT fire
out=$(printf '%s\n' '{"prompt":"bees swarming around the hive"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router boundary exit code"
[ -z "$out" ] || fail "router: must not fire on 'swarming', got: $out"

# path mention must NOT fire (talking ABOUT the repo, not asking for the swarm)
out=$(printf '%s\n' '{"prompt":"what do you think of C:\\devProjects\\claude-code-swarm"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router path exit code"
[ -z "$out" ] || fail "router: must not fire on a windows path, got: $out"
out=$(printf '%s\n' '{"prompt":"review hooks/swarm-router.js for bugs"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router relpath exit code"
[ -z "$out" ] || fail "router: must not fire on a relative path, got: $out"

# bare repo/marketplace name must NOT fire
out=$(printf '%s\n' '{"prompt":"update the claude-code-swarm marketplace"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router reponame exit code"
[ -z "$out" ] || fail "router: must not fire on the repo name, got: $out"

# filename token must NOT fire
out=$(printf '%s\n' '{"prompt":"open swarm-router.js and codeswarm.json"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router filename exit code"
[ -z "$out" ] || fail "router: must not fire on filenames, got: $out"

# the slash command mentioned in prose MUST still fire
out=$(printf '%s\n' '{"prompt":"run /codeswarm:swarm review on this repo"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router slashcmd exit code"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "router: expected the routing line for '/codeswarm:swarm', got: $out"

# a real ask that also contains a path MUST still fire (scrub only kills the path token)
out=$(printf '%s\n' '{"prompt":"use the swarm to audit C:\\devProjects\\some-target-repo"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router mixed exit code"
echo "$out" | grep -q "codeswarm:swarm-director" || fail "router: expected the routing line for swarm+path, got: $out"

# no mention -> silent
out=$(printf '%s\n' '{"prompt":"fix the login bug"}' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router silent exit code"
[ -z "$out" ] || fail "router: must be silent without a mention, got: $out"

# malformed stdin -> silent, exit 0
out=$(printf '%s\n' 'garbage not json' | CLAUDE_CONFIG_DIR="$TMP" node "$ROOT/hooks/swarm-router.js") || fail "router malformed exit code"
[ -z "$out" ] || fail "router: must be silent on malformed input, got: $out"

echo "ALL HOOK TESTS PASS"
