// tools/sanitize.sh in a throwaway git repo: both passes, the exclusions,
// and the fail-loud exit contract. Run: node --test tools/sanitize.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sanitize.sh')

function repo (files, { terms = 'acmecorp\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q')
  const all = { '.gitignore': '.sanitize-terms\nagents/my-*\nskills/my-*/\n', 'README.md': 'clean\n', ...files }
  if (terms !== null) all['.sanitize-terms'] = terms
  for (const [f, body] of Object.entries(all)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body) }
  git('add', '.gitignore', 'README.md')
  return dir
}
const gate = dir => spawnSync('sh', [script], { cwd: dir, encoding: 'utf8' }).status

const G = body => `---\nname: x\nscope: global\n---\n${body}`
const P = body => `---\nname: x\n---\n${body}`

test('clean tree and clean global my-* files pass; no term list passes', () => {
  assert.equal(gate(repo({ 'skills/my-x/SKILL.md': G('fine\n'), 'agents/my-y.md': G('fine\n') })), 0)
  assert.equal(gate(repo({ 'docs/a.md': 'acmecorp\n' }, { terms: null })), 0, 'absent list = nothing to check')
})

test('a hit in tracked or untracked files fails; LICENSE and .claude-plugin are exempt', () => {
  assert.notEqual(gate(repo({ 'docs/a.md': 'made by AcmeCorp\n' })), 0)
  assert.equal(gate(repo({ LICENSE: 'Copyright acmecorp\n', '.claude-plugin/plugin.json': '{"author":"acmecorp"}\n' })), 0)
})

test('pass 2 scans only my-* artifacts marked scope: global; unmarked ones are project-specific and skipped', () => {
  assert.notEqual(gate(repo({ 'agents/my-y.md': G('acmecorp\n') })), 0, 'marked agent')
  assert.equal(gate(repo({ 'agents/my-y.md': P('acmecorp\n') })), 0, 'unmarked agent')
  assert.notEqual(gate(repo({ 'agents/my-y.md': G('acmecorp\n').replace(/\n/g, '\r\n') })), 0, 'CRLF frontmatter still counts')
  assert.equal(gate(repo({ 'agents/my-y.md': 'scope: global\nacmecorp\n' })), 0, 'the marker only counts inside the frontmatter')
  assert.equal(gate(repo({ 'skills/my-p/SKILL.md': P('acmecorp\n'), 'skills/my-p/lib/a.js': 'acmecorp\n' })), 0, 'unmarked skill dir')
})

test('a marked SKILL.md covers its whole skill dir, node_modules excepted', () => {
  assert.notEqual(gate(repo({ 'skills/my-x/SKILL.md': G('acmecorp.example\n') })), 0)
  assert.notEqual(gate(repo({ 'skills/my-x/SKILL.md': G('fine\n'), 'skills/my-x/scripts/lib/a.js': '// acmecorp\n' })), 0)
  assert.equal(gate(repo({ 'skills/my-x/SKILL.md': G('fine\n'), 'skills/my-x/scripts/node_modules/p/index.js': 'acmecorp\n' })), 0)
  assert.equal(gate(repo({ 'skills/my-x/SKILL.md': G('fine\n'), 'skills/my-p/SKILL.md': P('fine\n'), 'skills/my-p/a.md': 'acmecorp\n' })), 0, 'a marked sibling does not pull in an unmarked one')
  assert.equal(gate(repo({ 'other-ignored/my-z.md': 'acmecorp\n', '.gitignore': '.sanitize-terms\nother-ignored/\n' })), 0, 'only the my-* locations are scanned among ignored files')
})
