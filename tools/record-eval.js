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
//   {"claudeCode":"2.1.201","fixture":"<dir>","workflow":"smoke","pass":true,
//    "missed":0,"unexpected":0,"baselineMissed":0,"baselineUnexpected":0,
//    "confirmed":5,"raw":5,"outputTokens":13000}
// Counts must be non-negative integers that fit together (verify can only
// remove findings, never add them) — an impossible row fails loud.
// Optional run conditions (stored when present, validated loud):
//   "rigor":"lite"|"full", "verify":"normal"|"strict",
//   "finderModel", "verifyModel", "notes" (strings), "execRepro", "finderReadOnly" (booleans),
//   "missedInconclusive", "unexpectedInconclusive" (numbers — planted bugs and
//   false positives verify left unresolved: neither wrongly rejected nor killed)
// Any other field is an error — a typo'd condition must never vanish silently.
// lastSmokeVersion moves only on a passing SMOKE row (workflow "smoke"):
// the canary is defined on the smoke, not on whatever graded run passed last.
// Stamped by the script itself: date, host, pluginVersion.
//
// Prints ONE JSON summary line with the running totals (the accumulated A/B
// evidence), overall and per workflow/rigor. Invalid input exits non-zero —
// dev tool, loud beats silent.
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

// same resolution as the hooks: CLAUDE_CONFIG_DIR overrides ~/.claude
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const configPath = path.join(configDir, 'codeswarm.json')
const logPath = path.join(configDir, 'codeswarm-eval-log.jsonl')
const manifestPath = path.join(__dirname, '..', '.claude-plugin', 'plugin.json')

const fail = msg => { console.error(`record-eval: ${msg}`); process.exit(1) }
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]))

const REQUIRED = {
  claudeCode: 'string', fixture: 'string', pass: 'boolean',
  missed: 'number', unexpected: 'number', baselineMissed: 'number',
  baselineUnexpected: 'number', confirmed: 'number', raw: 'number', outputTokens: 'number',
  workflow: ['smoke', 'review'],
}
// array = enum, string = typeof. Without these, rows run at lite and full rigor
// (or through smoke and review) were indistinguishable in the log.
const OPTIONAL = {
  rigor: ['lite', 'full'], verify: ['normal', 'strict'],
  finderModel: 'string', verifyModel: 'string', notes: 'string',
  execRepro: 'boolean', finderReadOnly: 'boolean',
  missedInconclusive: 'number', unexpectedInconclusive: 'number',
}
// a run-condition note, not a findings dump (security.md: no findings text in the log)
const NOTES_MAX = 300

// one fixture, one key: the log once held both `fixtures/eval` and an absolute
// `C:/…/fixtures/eval` for the same fixture
const normFixture = f => {
  const s = f.replace(/\\/g, '/').replace(/\/+$/, '')
  const m = s.match(/(?:^|\/)(fixtures\/[^/]+)$/)
  return m ? m[1] : s
}

// which install produced the row — the log is per config dir, so evidence
// recorded on another machine is simply absent here, and the log must say whose it is
function pluginVersion () {
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version } catch { return undefined }
}

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

// per run: falsePositivesKilled = baselineUnexpected - unexpected - unexpectedInconclusive;
// realBugsWronglyRejected = missed - baselineMissed - missedInconclusive (an
// unresolved finding is neither: it is summed under unresolved). No clamping.
// byMode splits the same sums per workflow/rigor (+ /exec, /ro when those
// regimes ran); rows logged before those fields existed land under
// "unlabelled" rather than being guessed.
function totals () {
  let lines = []
  try { lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean) } catch { /* no log yet */ }
  const blank = () => ({ runs: 0, falsePositivesKilled: 0, realBugsWronglyRejected: 0, unresolvedFalsePositives: 0, unresolvedRealBugs: 0 })
  const t = blank()
  const byMode = {}
  for (const line of lines) {
    let r
    try { r = JSON.parse(line) } catch { continue }
    const mode = r.workflow ? `${r.workflow}${r.rigor ? '/' + r.rigor : ''}${r.execRepro ? '/exec' : ''}${r.finderReadOnly ? '/ro' : ''}` : 'unlabelled'
    for (const acc of [t, byMode[mode] ??= blank()]) {
      acc.runs++
      const fpOpen = Number(r.unexpectedInconclusive) || 0
      const bugOpen = Number(r.missedInconclusive) || 0
      acc.falsePositivesKilled += (Number(r.baselineUnexpected) || 0) - (Number(r.unexpected) || 0) - fpOpen
      acc.realBugsWronglyRejected += (Number(r.missed) || 0) - (Number(r.baselineMissed) || 0) - bugOpen
      acc.unresolvedFalsePositives += fpOpen
      acc.unresolvedRealBugs += bugOpen
    }
  }
  return { ...t, byMode }
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
  if (typeof r !== 'object' || r === null || Array.isArray(r)) fail('expected a JSON object')
  for (const [k, t] of Object.entries(REQUIRED)) {
    if (Array.isArray(t) ? !t.includes(r[k]) : typeof r[k] !== t) fail(`field "${k}" must be ${Array.isArray(t) ? t.join('|') : `a ${t}`} (got ${JSON.stringify(r[k])})`)
  }
  const COUNTS = ['missed', 'unexpected', 'baselineMissed', 'baselineUnexpected', 'confirmed', 'raw', 'outputTokens', 'missedInconclusive', 'unexpectedInconclusive']
  for (const k of COUNTS) {
    if (r[k] !== undefined && (!Number.isInteger(r[k]) || r[k] < 0)) fail(`field "${k}" must be a non-negative integer (got ${JSON.stringify(r[k])})`)
  }
  const n = k => r[k] ?? 0
  const impossible = [
    [n('confirmed') > n('raw'), 'confirmed > raw'],
    [r.pass !== (n('missed') === 0), 'pass must equal (missed === 0) for a graded run'],
    [n('baselineUnexpected') > n('raw'), 'baselineUnexpected > raw'],
    [n('unexpected') > n('confirmed'), 'unexpected > confirmed'],
    [n('unexpected') > n('baselineUnexpected'), 'unexpected > baselineUnexpected (verify cannot add a false positive)'],
    [n('missed') < n('baselineMissed'), 'missed < baselineMissed (verify cannot find a bug the finder missed)'],
    [n('unexpectedInconclusive') > n('baselineUnexpected') - n('unexpected'), 'unexpectedInconclusive > baselineUnexpected - unexpected'],
    [n('missedInconclusive') > n('missed') - n('baselineMissed'), 'missedInconclusive > missed - baselineMissed'],
  ].filter(([bad]) => bad).map(([, why]) => why)
  if (impossible.length) fail(`counts do not fit together: ${impossible.join('; ')}`)
  const optional = Object.keys(OPTIONAL).filter(k => r[k] !== undefined)
  for (const k of optional) {
    const t = OPTIONAL[k]
    if (Array.isArray(t) ? !t.includes(r[k]) : typeof r[k] !== t) {
      fail(`optional field "${k}" must be ${Array.isArray(t) ? t.join('|') : `a ${t}`} (got ${JSON.stringify(r[k])})`)
    }
  }
  if (typeof r.notes === 'string' && r.notes.length > NOTES_MAX) fail(`field "notes" is a run-condition note, max ${NOTES_MAX} chars (got ${r.notes.length}) — never findings text`)
  const unknown = Object.keys(r).filter(k => !(k in REQUIRED) && !(k in OPTIONAL))
  if (unknown.length) fail(`unknown field(s) ${unknown.map(k => `"${k}"`).join(', ')} — valid optional fields: ${Object.keys(OPTIONAL).join(', ')}`)
  // the script stamps date/host/version itself — fewer fields a model can get wrong
  const version = pluginVersion()
  const line = {
    date: new Date().toISOString().slice(0, 10),
    host: os.hostname(),
    ...(version ? { pluginVersion: version } : {}),
    ...pick(r, Object.keys(REQUIRED)),
    fixture: normFixture(r.fixture),
    ...pick(r, optional),
  }
  fs.mkdirSync(configDir, { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(line) + '\n')
  const isSmoke = r.workflow === 'smoke'
  const lastSmokeVersion = !r.pass ? 'skipped (failing run)' : !isSmoke ? 'skipped (not a smoke run)' : recordVersion(r.claudeCode)
  console.log(JSON.stringify({ logged: true, lastSmokeVersion, ...totals() }))
}

main()
