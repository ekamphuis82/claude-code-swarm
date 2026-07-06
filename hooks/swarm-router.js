#!/usr/bin/env node
// codeswarm UserPromptSubmit router (spec item 4): prompt mentions the swarm as a
// whole word -> ONE routing line so the session loads the director first. Sends
// nothing anywhere, always exits 0 (never blocks a prompt).
'use strict'
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
    console.log('codeswarm router: this prompt mentions the swarm — load the codeswarm:swarm-director skill FIRST and follow its triage; never spawn codeswarm:* agents ad hoc.')
  }
  // no process.exit(): stdout to a pipe is async on Windows and exit() can truncate
  // the routing line; with no open handles the script exits 0 naturally.
})
