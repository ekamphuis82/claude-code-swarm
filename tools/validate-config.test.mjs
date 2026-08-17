// CLI tests for tools/validate-config.js: runs the real script against temp config
// files and asserts the exit codes, the unknown-key detection and the historical
// [CSW-1] value (`rigor: "standard"`) being caught.
// Run: node --test tools/validate-config.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'validate-config.js')
const freshDir = () => mkdtempSync(join(tmpdir(), 'codeswarm-validate-config-'))

// write a config into a temp dir and check it via CLAUDE_CONFIG_DIR (the real
// resolution path), or pass raw text to exercise the malformed-JSON branch
function check (config, { raw = null } = {}) {
  const dir = freshDir()
  if (raw !== null || config !== undefined) writeFileSync(join(dir, 'codeswarm.json'), raw ?? JSON.stringify(config))
  const r = spawnSync(process.execPath, [script, '--json'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8',
  })
  return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr }
}
const keys = out => out.problems.map(p => p.key).sort()

const VALID = {
  version: 1, alwaysOn: false, topModel: 'opus', accessibility: 'AA',
  retrospect: 'light', rigor: 'lite', adHocSpecialists: false,
  issueTracker: { kind: 'none' }, lastSmokeVersion: '2.1.233',
}

test('a fully valid config exits 0 with no problems', () => {
  const { status, out } = check(VALID)
  assert.equal(status, 0)
  assert.equal(out.valid, true)
  assert.deepEqual(out.problems, [])
  assert.equal(out.keys, 9)
})

test('an absent config is valid — built-in defaults apply', () => {
  const { status, out } = check(undefined)
  assert.equal(status, 0)
  assert.equal(out.present, false)
  assert.equal(out.valid, true)
})

test('[CSW-1]: rigor "standard" is reported, not silently accepted', () => {
  const { status, out } = check({ ...VALID, rigor: 'standard' })
  assert.equal(status, 1)
  assert.deepEqual(keys(out), ['rigor'])
  assert.equal(out.problems[0].kind, 'invalid')
  assert.match(out.problems[0].hint, /lite \| full/)
})

test('a mis-cased key is reported as unknown with a did-you-mean hint', () => {
  const { adHocSpecialists, ...rest } = VALID
  const { status, out } = check({ ...rest, adhocSpecialists: true })
  assert.equal(status, 1)
  assert.deepEqual(keys(out), ['adhocSpecialists'])
  assert.equal(out.problems[0].kind, 'unknown')
  assert.match(out.problems[0].hint, /adHocSpecialists/)
})

test('topModel accepts null, family aliases and pinned ids; rejects foreign models', () => {
  for (const topModel of [null, 'opus', 'sonnet', 'haiku', 'fable', 'claude-opus-4-8']) {
    assert.equal(check({ ...VALID, topModel }).status, 0, `expected ${JSON.stringify(topModel)} to be valid`)
  }
  for (const topModel of ['gpt-4', '', 'latest', 'Opus']) {
    assert.equal(check({ ...VALID, topModel }).status, 1, `expected ${JSON.stringify(topModel)} to be invalid`)
  }
})

test('booleans must be real booleans, not the strings "true"/"false"', () => {
  const { status, out } = check({ ...VALID, alwaysOn: 'false' })
  assert.equal(status, 1)
  assert.deepEqual(keys(out), ['alwaysOn'])
})

test('issueTracker: gitlab needs apiBase AND tokenFile; github may omit both', () => {
  assert.equal(check({ ...VALID, issueTracker: { kind: 'github' } }).status, 0)
  assert.equal(check({ ...VALID, issueTracker: { kind: 'gitlab', apiBase: 'https://x/api/v4', tokenFile: '/t' } }).status, 0)
  assert.equal(check({ ...VALID, issueTracker: { kind: 'gitlab', apiBase: 'https://x/api/v4' } }).status, 1)
  assert.equal(check({ ...VALID, issueTracker: { kind: 'jira' } }).status, 1)
  assert.equal(check({ ...VALID, issueTracker: 'github' }).status, 1)
})

test('lastSmokeVersion must be full semver', () => {
  assert.equal(check({ ...VALID, lastSmokeVersion: '2.1' }).status, 1)
  assert.equal(check({ ...VALID, lastSmokeVersion: '2.1.233' }).status, 0)
})

test('every problem is reported in one pass, not just the first', () => {
  const { status, out } = check({ ...VALID, rigor: 'standard', accessibility: 'AA+', runner: 'wrkflow', nope: 1 })
  assert.equal(status, 1)
  assert.deepEqual(keys(out), ['accessibility', 'nope', 'rigor', 'runner'])
})

test('malformed JSON and a non-object top level exit 2', () => {
  assert.equal(check(undefined, { raw: '{oops' }).status, 2)
  assert.equal(check(undefined, { raw: '[1,2]' }).status, 2)
})
