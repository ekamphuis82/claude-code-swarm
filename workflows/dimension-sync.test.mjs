// Guards the single-source architecture-dimension wording.
// Canonical clause lives in agents/swarm-reviewer.md between the
// <arch-dimension> HTML-comment markers (inert in the agent prompt).
// The two runtime copies — swarm-review.js DIMENSION_HINTS.architecture and
// swarm-build.js full-mode retrospect FOCUS — must contain that clause
// verbatim (whitespace-normalized; each copy has its own lead-in/trailer,
// and the md is line-wrapped, so "verbatim" = the normalized clause is a
// substring of the normalized copy).
// Intentionally NOT synced: skills/repo-entry/SKILL.md "Editing discipline"
// restates the hygiene/DX rules as imperative editing directives, not as a
// review-dimension definition — different mode, drift there is acceptable.
// Run: node --test workflows/dimension-sync.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, p), 'utf8')
const norm = s => s.replace(/\s+/g, ' ').trim()

const md = read('../agents/swarm-reviewer.md')
const mdMatch = md.match(/<!-- <arch-dimension>[^\n]*-->\s*([\s\S]*?)\s*<!-- <\/arch-dimension> -->/)

test('canonical <arch-dimension> block present in agents/swarm-reviewer.md', () => {
  assert.ok(mdMatch, '<arch-dimension> markers missing from agents/swarm-reviewer.md')
})

const canonical = norm(mdMatch ? mdMatch[1] : '')

test('canonical clause is non-trivial', () => {
  assert.ok(canonical.length > 80, `canonical clause suspiciously short: "${canonical}"`)
})

test('swarm-review.js DIMENSION_HINTS.architecture contains the canonical clause verbatim', () => {
  const src = read('swarm-review.js')
  const m = src.match(/architecture:\s*'(architecture = [^']*)'/)
  assert.ok(m, 'DIMENSION_HINTS.architecture string not found in swarm-review.js')
  assert.ok(norm(m[1]).includes(canonical),
    `swarm-review.js architecture hint drifted from canonical.\ncanonical: ${canonical}\ncopy: ${norm(m[1])}`)
})

test('swarm-build.js full-mode retrospect FOCUS contains the canonical clause verbatim', () => {
  const src = read('swarm-build.js')
  const m = src.match(/'(Judge ONLY cross-task coherence:[^']*)'/)
  assert.ok(m, 'full-mode retrospect FOCUS string not found in swarm-build.js')
  assert.ok(norm(m[1]).includes(canonical),
    `swarm-build.js retrospect FOCUS drifted from canonical.\ncanonical: ${canonical}\ncopy: ${norm(m[1])}`)
})
