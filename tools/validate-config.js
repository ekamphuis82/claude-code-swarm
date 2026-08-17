#!/usr/bin/env node
// codeswarm config schema check — closes the silent-fallback class behind [CSW-1]
// (`rigor: "standard"` meant `lite` for months because nothing validated the file).
// The workflows must keep their own per-key allowlists (a run gets its args from the
// director, not from this file), so this is the WRITE-side gate: setup runs it after
// writing the config, doctor runs it as a static check, and a hand-edit can be checked
// with `node tools/validate-config.js`.
//
// Reports only — it NEVER rewrites the user's config. Reads one local file, no network,
// no spawns (docs/security.md).
//
// Usage:
//   node tools/validate-config.js              check $CLAUDE_CONFIG_DIR|~/.claude
//   node tools/validate-config.js <path.json>  check a specific file
//   node tools/validate-config.js --json       machine-readable, one JSON line only
//
// Exit codes: 0 = valid (an absent config is valid — built-in defaults apply),
// 1 = at least one invalid value or unknown key, 2 = unreadable/malformed JSON.
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

const argv = process.argv.slice(2)
const jsonOnly = argv.includes('--json')
const explicit = argv.find(a => !a.startsWith('--'))

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const configPath = explicit || path.join(configDir, 'codeswarm.json')

const isBool = v => v === true || v === false
const isSemver = v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)
const oneOf = (...vals) => v => vals.includes(v)
const plain = v => typeof v === 'object' && v !== null && !Array.isArray(v)

// topModel: null (inherit the session model), a family alias, or a pinned id.
// Aliases are enumerable; pinned ids are not (new models ship without this file
// changing), so the id branch is a SHAPE check — `claude-` + version-ish tail.
const ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
function topModelOk (v) {
  if (v === null) return true
  if (typeof v !== 'string' || !v) return false
  return ALIASES.includes(v) || /^claude-[a-z0-9][a-z0-9.-]*$/.test(v)
}

function issueTrackerOk (v) {
  if (!plain(v)) return false
  if (!['none', 'gitlab', 'github'].includes(v.kind)) return false
  // gitlab has no CLI fallback, so both fields are mandatory there
  if (v.kind === 'gitlab' && !(typeof v.apiBase === 'string' && v.apiBase && typeof v.tokenFile === 'string' && v.tokenFile)) return false
  if (v.tokenFile !== undefined && !(typeof v.tokenFile === 'string' && v.tokenFile)) return false
  if (v.apiBase !== undefined && !(typeof v.apiBase === 'string' && v.apiBase)) return false
  return true
}

// One row per key documented in docs/configuration.md. A key missing here is
// reported as unknown — that is the point: a typo must be loud.
const SCHEMA = {
  version: { ok: v => v === 1, expect: '1' },
  alwaysOn: { ok: isBool, expect: 'true | false' },
  topModel: { ok: topModelOk, expect: `null | ${ALIASES.join(' | ')} | pinned id (claude-…)` },
  accessibility: { ok: oneOf('off', 'A', 'AA', 'AAA'), expect: 'off | A | AA | AAA' },
  retrospect: { ok: oneOf('full', 'light', 'off'), expect: 'full | light | off' },
  rigor: { ok: oneOf('lite', 'full'), expect: 'lite | full' },
  adHocSpecialists: { ok: isBool, expect: 'true | false' },
  issueTracker: { ok: issueTrackerOk, expect: '{kind: none|gitlab|github} (gitlab also needs apiBase + tokenFile)' },
  lastSmokeVersion: { ok: isSemver, expect: 'semver string, e.g. "2.1.233"' },
  runner: { ok: oneOf('workflow', 'standalone'), expect: 'workflow | standalone' },
}

// Levenshtein-free near-miss hint: case-insensitive match is the common typo
// (adhocSpecialists, TopModel) and is worth naming explicitly.
const nearMiss = key => Object.keys(SCHEMA).find(k => k.toLowerCase() === key.toLowerCase())

function validate (config) {
  const problems = []
  for (const [key, value] of Object.entries(config)) {
    const rule = SCHEMA[key]
    if (!rule) {
      const near = nearMiss(key)
      problems.push({ key, kind: 'unknown', value, hint: near ? `did you mean "${near}"?` : 'not a documented key — it is ignored entirely' })
      continue
    }
    if (!rule.ok(value)) problems.push({ key, kind: 'invalid', value, hint: `expected ${rule.expect}` })
  }
  return problems
}

function main () {
  let raw
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch {
    // absent config is a valid state: the plugin runs on built-in defaults
    const out = { config: configPath, present: false, valid: true, problems: [] }
    console.log(jsonOnly ? JSON.stringify(out) : `validate-config: no config at ${configPath} — built-in defaults apply (valid)`)
    process.exit(0)
  }

  let config
  try {
    config = JSON.parse(raw)
  } catch (e) {
    const out = { config: configPath, present: true, valid: false, error: `malformed JSON: ${e.message}` }
    console.log(jsonOnly ? JSON.stringify(out) : `validate-config: ${configPath} is not valid JSON — ${e.message}`)
    process.exit(2)
  }
  if (!plain(config)) {
    const out = { config: configPath, present: true, valid: false, error: 'top level is not a JSON object' }
    console.log(jsonOnly ? JSON.stringify(out) : `validate-config: ${configPath} top level is not a JSON object`)
    process.exit(2)
  }

  const problems = validate(config)
  const out = { config: configPath, present: true, valid: problems.length === 0, keys: Object.keys(config).length, problems }
  if (jsonOnly) {
    console.log(JSON.stringify(out))
  } else if (!problems.length) {
    console.log(`validate-config: ${configPath} — ${out.keys} key(s), all valid`)
  } else {
    for (const p of problems) {
      console.log(`${p.kind === 'unknown' ? 'UNKNOWN KEY' : 'INVALID'}  ${p.key}: ${JSON.stringify(p.value)} — ${p.hint}`)
    }
    console.log(`validate-config: ${problems.length} problem(s) in ${configPath} — fix by hand or re-run /codeswarm:swarm setup (this tool never rewrites your config)`)
  }
  process.exit(problems.length ? 1 : 0)
}

if (require.main === module) main()
module.exports = { validate, SCHEMA }
