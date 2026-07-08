// Guards prose<->script drift for the director skill: the machine-checkable
// FACTS in skills/swarm-director/SKILL.md (args table, config table,
// dimension list, defaults) are asserted against the workflow-script source.
// Marker blocks in the md (<!-- <args-table> -->, <!-- <config-table> -->)
// anchor the parsing, so prose around them may reword freely.
//
// Deliberately NOT checked: semantic prose claims ("criticals are never
// waivable", flow rules) — those are pinned on BEHAVIOR by the wiring tests
// (build-wiring / review-wiring); this file only keeps the reference tables
// honest. The flags table is director-prose with no code counterpart.
// Run: node --test workflows/prose-sync.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, p), 'utf8')
const skill = read('../skills/swarm-director/SKILL.md')

const block = name => {
  const m = skill.match(new RegExp(`<!-- <${name}>[\\s\\S]*?-->\\s*([\\s\\S]*?)<!-- </${name}> -->`))
  return m?.[1]
}

// --- args table --------------------------------------------------------------
const argsTable = block('args-table')
test('args-table marker block present in the director skill', () => {
  assert.ok(argsTable, '<args-table> markers missing from skills/swarm-director/SKILL.md')
})

// | `script.js` | required cell | optional cell |
const rows = new Map()
for (const line of (argsTable ?? '').split('\n')) {
  const m = line.match(/^\| `([a-z-]+\.js)` \|(.*)\|(.*)\|\s*$/)
  if (m) rows.set(m[1], { required: m[2], optional: m[3] })
}

const scripts = readdirSync(here).filter(f => /^swarm-.*\.js$/.test(f) && !f.includes('.test.')).sort()

for (const script of scripts) {
  test(`${script}: has an args-table row and its required args match the validation throws`, () => {
    const row = rows.get(script)
    assert.ok(row, `${script} has no row in the director skill's args table — every workflow script must be documented there`)
    const src = read(script)
    // required args = every args.<name> named in a validation throw that says "required"
    const required = new Set()
    for (const [, msg] of src.matchAll(/throw new Error\('([^']*)'\)/g)) {
      if (!/required/.test(msg)) continue
      for (const [, name] of msg.matchAll(/args\.([a-zA-Z]+)/g)) required.add(name)
    }
    assert.ok(required.size, `${script}: no required-arg validation throws found — the extraction regex may have drifted`)
    for (const name of required) {
      assert.ok(row.required.includes('`' + name), `${script}: required arg "${name}" (per its validation throw) is missing from the args-table required cell`)
    }
  })
}

test('every args-table row points at an existing workflow script', () => {
  for (const name of rows.keys()) {
    assert.ok(scripts.includes(name), `args table documents "${name}" but workflows/${name} does not exist`)
  }
})

test('review row lists every dimension the script actually accepts', () => {
  const src = read('swarm-review.js')
  const agents = src.match(/const DIMENSION_AGENTS = \{([\s\S]*?)\n\}/)
  assert.ok(agents, 'DIMENSION_AGENTS not found in swarm-review.js')
  const dims = [...agents[1].matchAll(/^\s+'?([a-z-]+)'?:/gm)].map(m => m[1])
  assert.ok(dims.length >= 6, `suspiciously few dimensions parsed: ${dims.join(', ')}`)
  const row = rows.get('swarm-review.js')
  for (const d of dims) {
    assert.ok(row.optional.includes(d), `dimension "${d}" exists in DIMENSION_AGENTS but is missing from the review row's dimensions list`)
  }
})

// --- config table ------------------------------------------------------------
const configTable = block('config-table')
test('config-table marker block present in the director skill', () => {
  assert.ok(configTable, '<config-table> markers missing from skills/swarm-director/SKILL.md')
})

const configRow = key => (configTable ?? '').split('\n').find(l => l.startsWith(`| \`${key}\``))

// every documented key -> the code that must actually read it, and the
// documented default -> the code default it must match
const CONFIG_FACTS = [
  { key: 'alwaysOn', default: '(false)', readers: [['../hooks/session-start.js', 'config.alwaysOn']] },
  {
    key: 'topModel', default: '(null = inherit session model)',
    readers: ['swarm-build.js', 'swarm-review.js', 'swarm-research.js', 'swarm-drift.js', 'swarm-onboard.js'].map(f => [f, 'A.topModel']),
  },
  { key: 'accessibility', default: '(AA)', readers: [['swarm-review.js', "A.a11yLevel) ? A.a11yLevel : 'AA'"]] },
  { key: 'retrospect', default: '(full)', readers: [['swarm-build.js', "includes(A.retrospect) ? A.retrospect : 'full'"]] },
  { key: 'rigor', default: '(lite)', readers: [['swarm-build.js', "A.rigor === 'full' ? 'full' : 'lite'"], ['swarm-review.js', "A.rigor === 'full'"]] },
  {
    key: 'adHocSpecialists', default: '(false)',
    readers: [['../hooks/session-start.js', 'config.adHocSpecialists'], ['../hooks/swarm-router.js', 'config.adHocSpecialists'], ['swarm-onboard.js', 'A.adHocSpecialists']],
  },
  { key: 'issueTracker', default: '(none)', readers: [] }, // sink is prose-driven (swarm-issues skill); nothing in script code
]

for (const fact of CONFIG_FACTS) {
  test(`config key "${fact.key}": documented with its default, and actually read by the named code`, () => {
    const row = configRow(fact.key)
    assert.ok(row, `config table has no row for "${fact.key}"`)
    assert.ok(row.includes(fact.default), `config row "${fact.key}" no longer states the default ${fact.default} — code and prose must change together`)
    for (const [file, token] of fact.readers) {
      assert.ok(read(file).includes(token), `${file} no longer contains "${token}" — the config wiring for "${fact.key}" drifted from the table`)
    }
  })
}
