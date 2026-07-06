// Guards the quiet-by-default invariant (CONTRIBUTING.md: "Quiet is the
// default. Every agent prompt gets the silent-mode directive unless
// quiet: false was passed explicitly") mechanically, across EVERY workflow
// script:
//   1. the silent-mode directive sits behind the exact default-ON gate
//      `A.quiet === false ? ''` and carries the load-bearing phrases;
//   2. every agent() dispatch carries the directive — either its inline
//      prompt template interpolates ${QUIET} directly, or it passes a
//      prompt variable whose template does so (transitively: a template
//      interpolating a carrying variable, e.g. `${brief}` in a fix-round
//      prompt, also counts).
// Template literals are extracted with a small nesting-aware scanner
// (regexes cannot handle the nested backticks inside ${...}). Known
// simplifications, all loud-fail: regex literals are not lexed (none of the
// workflow scripts put quotes or backticks inside one), and a prompt built
// by string concatenation instead of a template would surface as an
// unresolvable identifier. Extend the scanner then — never delete the test.
// Run: node --test workflows/quiet-invariant.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const scripts = readdirSync(here).filter(f => /^swarm-.*\.js$/.test(f)).sort()

const PHRASES = [
  'OUTPUT DISCIPLINE (silent mode)',
  'no narration between tool calls',
  'ONLY the structured output',
]

// --- nesting-aware template-literal scanner -------------------------------
// Walks the source skipping comments and quoted strings; for every TOP-LEVEL
// template literal it records the full raw text (nested templates included)
// plus what precedes it: an assignment target (`name =` / `name:`) or an
// agent( call site.
function readString (src, i) { // src[i] is the opening quote
  const q = src[i]; i++
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === q) return i + 1
    i++
  }
  throw new Error('unterminated string')
}
function readTemplate (src, i) { // src[i] === '`'; returns index AFTER the closing backtick
  i++
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '`') return i + 1
    if (ch === '$' && src[i + 1] === '{') { i = readInterp(src, i + 2); continue }
    i++
  }
  throw new Error('unterminated template')
}
function readInterp (src, i) { // inside ${ ... }; returns index after the matching }
  let depth = 1
  while (i < src.length) {
    const ch = src[i]
    if (ch === '{') { depth++; i++; continue }
    if (ch === '}') { depth--; i++; if (!depth) return i; continue }
    if (ch === '`') { i = readTemplate(src, i); continue }
    if (ch === "'" || ch === '"') { i = readString(src, i); continue }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    i++
  }
  throw new Error('unterminated interpolation')
}
function scanTemplates (src) {
  const found = [] // { raw, name, isAgentArg }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue }
    if (ch === "'" || ch === '"') { i = readString(src, i); continue }
    if (ch === '`') {
      const start = i
      i = readTemplate(src, i)
      const before = src.slice(0, start)
      const assign = before.match(/(\w+)\s*[:=]\s*$/)
      found.push({
        raw: src.slice(start, i),
        name: assign ? assign[1] : null,
        isAgentArg: /\bagent\(\s*$/.test(before),
      })
      continue
    }
    i++
  }
  return found
}
// ---------------------------------------------------------------------------

test('workflow scripts found', () => {
  assert.ok(scripts.length >= 7, `expected the 7 workflow scripts, found ${scripts.length}`)
})

for (const file of scripts) {
  const src = readFileSync(join(here, file), 'utf8')

  test(`${file}: silent mode is default-ON (off only via explicit quiet:false)`, () => {
    assert.match(src, /A\.quiet === false \? ''/,
      "missing the exact default-on gate `A.quiet === false ? ''`")
  })

  test(`${file}: silent-mode directive carries the load-bearing phrases`, () => {
    for (const p of PHRASES) assert.ok(src.includes(p), `directive is missing the phrase "${p}"`)
  })

  const templates = scanTemplates(src)

  // fixed-point carrier resolution: QUIET seeds the set; a NAME becomes a
  // carrier only when EVERY template assigned to it interpolates a carrier
  // (all-assignments rule: one quiet-less variant of a reused name must fail)
  const byName = new Map()
  for (const t of templates) {
    if (!t.name) continue
    if (!byName.has(t.name)) byName.set(t.name, [])
    byName.get(t.name).push(t.raw)
  }
  const carriers = new Set(['QUIET'])
  const carries = raw => [...carriers].some(c => raw.includes('${' + c + '}'))
  let grew = true
  while (grew) {
    grew = false
    for (const [name, raws] of byName) {
      if (carriers.has(name)) continue
      if (raws.every(carries)) { carriers.add(name); grew = true }
    }
  }

  test(`${file}: every agent() prompt carries the silent-mode directive`, () => {
    const inline = templates.filter(t => t.isAgentArg)
    // identifier-arg call sites: agent(someVar, ...) / agent(w.prompt, ...)
    const identCalls = [...src.matchAll(/\bagent\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*,/g)].map(m => m[1])
    assert.ok(inline.length + identCalls.length > 0,
      'no agent() call sites found — the scanner assumptions no longer hold, extend the test')
    for (const t of inline) {
      assert.ok(carries(t.raw),
        `inline agent() template without \${QUIET} (or a carrying variable): "${t.raw.slice(0, 100)}..."`)
    }
    for (const ident of identCalls) {
      const name = ident.split('.').pop()
      assert.ok(carriers.has(name),
        `agent(${ident}, ...) — no template assigned to "${name}" interpolates \${QUIET}`)
    }
  })
}
