#!/usr/bin/env node
// codeswarm SessionStart hook (spec item 4): reads the config, prints AT MOST one
// line, sends nothing anywhere, always exits 0. Stages:
//   1. no readable config        -> "run /codeswarm:swarm setup" nudge
//   2. version != lastSmokeVersion -> update canary (Workflow tool has no stable
//      API — an update means unproven plumbing); alwaysOn rides the SAME line
//   3. alwaysOn                  -> route-via-director directive
//   4. configured, current       -> silent
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

// same resolution Claude Code uses: CLAUDE_CONFIG_DIR overrides ~/.claude
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const configPath = path.join(configDir, 'codeswarm.json')

let config = null
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { /* missing or unreadable = stage 1 */ }

// best-effort version WITHOUT spawning (hooks never spawn — docs/security.md):
// env var, else highest semver dir of the native installer; else null = canary silent
function currentVersion () {
  if (process.env.CLAUDE_CODE_VERSION) return process.env.CLAUDE_CODE_VERSION
  try {
    return fs.readdirSync(path.join(os.homedir(), '.local', 'share', 'claude', 'versions'))
      .filter(v => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => { const A = a.split('.').map(Number), B = b.split('.').map(Number); return A[0] - B[0] || A[1] - B[1] || A[2] - B[2] })
      .pop() ?? null
  } catch { return null }
}

if (config === null || typeof config !== 'object' || Array.isArray(config)) {
  console.log('codeswarm: not configured yet — run /codeswarm:swarm setup once (re-runnable) to set swarm defaults; until then /codeswarm:swarm still works with built-in defaults.')
} else {
  // adHocSpecialists sanctions direct use of the user's own my-* stack agents
  // for small single-scope tasks; process agents stay director-dispatched
  const adHocTail = config.adHocSpecialists === true
    ? 'spawn codeswarm process agents only via the director; my-* stack specialists may be used directly for small single-scope tasks.'
    : 'never spawn codeswarm:* agents ad hoc.'
  const alwaysOnLine = `codeswarm always-on: for substantive coding work (feature build, review/audit, refactor, research), load the codeswarm:swarm-director skill first and let it triage — ${adHocTail}`
  // version lookup only when there is a recorded baseline to compare against
  const now = typeof config.lastSmokeVersion === 'string' && config.lastSmokeVersion ? currentVersion() : null
  if (now && now !== config.lastSmokeVersion) {
    console.log(`codeswarm update canary: Claude Code is now ${now} but the workflow plumbing was last smoke-tested on ${config.lastSmokeVersion} — the Workflow tool has no stable API, run /codeswarm:swarm smoke to re-verify.${config.alwaysOn === true ? ' ' + alwaysOnLine : ''}`)
  } else if (config.alwaysOn === true) {
    console.log(alwaysOnLine)
  }
}
// no process.exit(): stdout to a pipe is async on Windows and exit() can truncate
// the context line; with no open handles the script exits 0 naturally.
