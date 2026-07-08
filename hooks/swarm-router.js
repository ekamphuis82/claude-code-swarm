#!/usr/bin/env node
// codeswarm UserPromptSubmit router (spec item 4): prompt mentions the swarm as a
// whole word -> ONE routing line so the session loads the director first. Sends
// nothing anywhere, always exits 0 (never blocks a prompt).
// Scope-gated: only observes prompt text once the user has run setup once
// (same ~/.claude/codeswarm.json config session-start.js reads) - keeps this
// hook from inspecting every prompt in every project for users who never
// opted into codeswarm.
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const configPath = path.join(configDir, 'codeswarm.json')

let config = null
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { /* missing or unreadable = not configured, stay silent */ }
const configured = config !== null && typeof config === 'object' && !Array.isArray(config)

if (!configured) process.exit(0)

// same wording split as session-start.js: adHocSpecialists sanctions direct
// use of the user's own my-* stack agents for small single-scope tasks
const adHocTail = config.adHocSpecialists === true
  ? 'spawn codeswarm process agents only via the director; my-* stack specialists may be used directly for small single-scope tasks.'
  : 'never spawn codeswarm:* agents ad hoc.'

let raw = ''
process.stdin.on('data', d => { raw += d })
process.stdin.on('end', () => {
  let prompt = ''
  try { prompt = String(JSON.parse(raw).prompt ?? '') } catch { /* malformed input: stay silent */ }
  // scrub mentions ABOUT the plugin (paths, filenames, the repo name) so only asks
  // FOR the swarm fire; "/codeswarm:swarm ..." keeps firing — a leading slash has
  // no path segment before it, so the path scrub skips it
  const scrubbed = prompt
    .replace(/\S+[/\\]\S*/g, ' ')
    .replace(/\bclaude-code-swarm\b/gi, ' ')
    .replace(/\S+\.[a-z0-9]{1,5}(?=\s|$)/gi, ' ')
  if (/\b(?:code)?swarm\b/i.test(scrubbed)) {
    console.log(`codeswarm router: this prompt mentions the swarm — load the codeswarm:swarm-director skill FIRST and follow its triage; ${adHocTail}`)
  }
  // no process.exit(): stdout to a pipe is async on Windows and exit() can truncate
  // the routing line; with no open handles the script exits 0 naturally.
})
