// Syntax gate for the workflow scripts. Plain `node --check` cannot validate
// them: they are Workflow-harness modules (`export const meta` + top-level
// return/await in one file), a combination that is only legal inside the
// harness wrapper — CJS chokes on `export`, ESM on the top-level `return`,
// and whether --check happens to pass is node-version dependent (v24 passes,
// v18 fails). This test reproduces what the harness does: strip the export
// keyword and parse the body as an async function, where return and await
// are legal. Parse only — nothing is executed.
// Run: node --test workflows/syntax.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const scripts = readdirSync(dir).filter(f => f.endsWith('.js')).sort()
const AsyncFunction = (async () => {}).constructor
const HARNESS_GLOBALS = ['args', 'budget', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow']

assert.ok(scripts.length >= 7, `expected the 7 workflow scripts, found ${scripts.length}`)

for (const f of scripts) {
  test(`${f} parses as a Workflow-harness module`, () => {
    const src = readFileSync(join(dir, f), 'utf8')
    assert.match(src, /^export const meta = \{/m, 'must export a meta literal')
    const body = src.replace(/^export\s+/m, '')
    assert.doesNotThrow(() => new AsyncFunction(...HARNESS_GLOBALS, body))
  })
}
