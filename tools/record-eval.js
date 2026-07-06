#!/usr/bin/env node
// codeswarm smoke/eval bookkeeping — run by the DIRECTOR after a smoke run (not a
// hook). Log format, config-preserving lastSmokeVersion write and running A/B
// totals live in CODE so a paraphrasing model cannot corrupt them. Writes exactly
// two local files next to the config; no network, no spawns (docs/security.md).
//
// Usage (from the plugin clone):
//   node tools/record-eval.js --smoke-pass <version>   record lastSmokeVersion only
//   node tools/record-eval.js '<json>'                 graded run: append one
//                                                      eval-log line (+ version on pass)
//   node tools/record-eval.js < result.json            same, JSON on stdin
//
// Graded JSON fields (all required):
//   {"claudeCode":"2.1.201","fixture":"<dir>","pass":true,"missed":0,
//    "unexpected":0,"baselineMissed":0,"baselineUnexpected":0,
//    "confirmed":5,"raw":5,"outputTokens":13000}
//
// Prints ONE JSON summary line with the running totals (the accumulated A/B
// evidence). Invalid input exits non-zero — dev tool, loud beats silent.
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

// same resolution as the hooks: CLAUDE_CONFIG_DIR overrides ~/.claude
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const configPath = path.join(configDir, 'codeswarm.json')
const logPath = path.join(configDir, 'codeswarm-eval-log.jsonl')

const fail = msg => { console.error(`record-eval: ${msg}`); process.exit(1) }
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]))

// PRESERVES every other key; config absent/unreadable = skip (bookkeeping never invents a config)
function recordVersion (version) {
  let config
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { return 'skipped (no readable config)' }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 'skipped (config not an object)'
  if (config.lastSmokeVersion === version) return 'unchanged'
  config.lastSmokeVersion = version
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  return 'updated'
}

// per run: falsePositivesKilled = baselineUnexpected - unexpected;
// realBugsWronglyRejected = missed - baselineMissed. No clamping — honest either way.
function totals () {
  let lines = []
  try { lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean) } catch { /* no log yet */ }
  const t = { runs: 0, falsePositivesKilled: 0, realBugsWronglyRejected: 0 }
  for (const line of lines) {
    let r
    try { r = JSON.parse(line) } catch { continue }
    t.runs++
    t.falsePositivesKilled += (Number(r.baselineUnexpected) || 0) - (Number(r.unexpected) || 0)
    t.realBugsWronglyRejected += (Number(r.missed) || 0) - (Number(r.baselineMissed) || 0)
  }
  return t
}

async function main () {
  const argv = process.argv.slice(2)
  if (argv[0] === '--smoke-pass') {
    if (!argv[1] || !/^\d+\.\d+\.\d+/.test(argv[1])) fail('--smoke-pass needs a version, e.g. --smoke-pass 2.1.201')
    console.log(JSON.stringify({ logged: false, lastSmokeVersion: recordVersion(argv[1]), ...totals() }))
    return
  }
  let raw = argv.find(a => a.trimStart().startsWith('{'))
  if (!raw) { raw = ''; for await (const chunk of process.stdin) raw += chunk }
  let r
  try { r = JSON.parse(raw) } catch { fail('expected the graded-run JSON as an argument or on stdin') }
  const REQUIRED = {
    claudeCode: 'string', fixture: 'string', pass: 'boolean',
    missed: 'number', unexpected: 'number', baselineMissed: 'number',
    baselineUnexpected: 'number', confirmed: 'number', raw: 'number', outputTokens: 'number',
  }
  for (const [k, t] of Object.entries(REQUIRED)) {
    if (typeof r[k] !== t) fail(`field "${k}" must be a ${t} (got ${JSON.stringify(r[k])})`)
  }
  // the script stamps the date itself — one less field a model can get wrong
  const line = { date: new Date().toISOString().slice(0, 10), ...pick(r, Object.keys(REQUIRED)) }
  fs.mkdirSync(configDir, { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(line) + '\n')
  const lastSmokeVersion = r.pass ? recordVersion(r.claudeCode) : 'skipped (failing run)'
  console.log(JSON.stringify({ logged: true, lastSmokeVersion, ...totals() }))
}

main()
