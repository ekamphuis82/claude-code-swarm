// Tests the pure pass-grading block in swarm-smoke.js by extracting the code
// between the <eval-verdict> markers verbatim and evaluating it with injected
// `expected` and `confirmed` — so the PRODUCTION code is what runs.
// Run: node --test workflows/eval-verdict.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(dir, 'swarm-smoke.js'), 'utf8')
const m = src.match(/\/\/ <eval-verdict>[^\n]*\n([\s\S]*?)\/\/ <\/eval-verdict>/)
assert.ok(m, 'eval-verdict markers present in swarm-smoke.js')

const grade = (expected, confirmed, raw = []) =>
  new Function('expected', 'confirmed', 'raw', m[1] + '\nreturn { missed, unexpected, pass, baseline }')(expected, confirmed, raw)

test('legacy mode (no expected): passes on a confirmed calc finding', () => {
  const r = grade(null, [{ file: '/fx/calc.js', problem: 'off by one' }])
  assert.equal(r.pass, true)
  assert.deepEqual(r.missed, [])
  assert.deepEqual(r.unexpected, [])
})

test('legacy mode: fails with zero confirmed findings', () => {
  assert.equal(grade(null, []).pass, false)
})

test('graded: passes when every expected entry is matched', () => {
  const r = grade(
    [{ file: 'cart.js', mustMatch: 'reduce|empty' }, { file: 'queue.js' }],
    [
      { file: '/fx/cart.js', problem: 'reduce without initial value crashes on empty array' },
      { file: '/fx/queue.js', problem: 'splice during forEach skips elements' },
    ]
  )
  assert.equal(r.pass, true)
  assert.deepEqual(r.missed, [])
})

test('graded: a missed planted bug fails the run and is listed', () => {
  const r = grade(
    [{ file: 'cart.js' }, { file: 'dates.js' }],
    [{ file: '/fx/cart.js', problem: 'reduce crash' }]
  )
  assert.equal(r.pass, false)
  assert.deepEqual(r.missed.map(e => e.file), ['dates.js'])
})

test('graded: a finding in the right file but wrong problem text does not satisfy mustMatch', () => {
  const r = grade(
    [{ file: 'dates.js', mustMatch: 'sunday|getday' }],
    [{ file: '/fx/dates.js', problem: 'variable naming is unclear' }]
  )
  assert.equal(r.pass, false)
})

test('graded: mustMatch is case-insensitive', () => {
  const r = grade(
    [{ file: 'dates.js', mustMatch: 'sunday' }],
    [{ file: '/fx/dates.js', problem: 'Sunday is getDay() 0, day === 7 never matches' }]
  )
  assert.equal(r.pass, true)
})

test('graded: confirmed findings outside expected land in unexpected without failing the run', () => {
  const r = grade(
    [{ file: 'cart.js' }],
    [
      { file: '/fx/cart.js', problem: 'reduce crash' },
      { file: '/fx/format.js', problem: 'imagined bug' },
    ]
  )
  assert.equal(r.pass, true)
  assert.deepEqual(r.unexpected.map(c => c.file), ['/fx/format.js'])
})

test('baseline: null outside graded mode', () => {
  assert.equal(grade(null, [], [{ file: '/fx/calc.js', problem: 'x' }]).baseline, null)
})

test('baseline: shows the false positives the verify layer killed', () => {
  const raw = [
    { file: '/fx/cart.js', problem: 'reduce without initial value' },
    { file: '/fx/format.js', problem: 'imagined bug' },
  ]
  const r = grade([{ file: 'cart.js' }], [raw[0]], raw)
  assert.deepEqual(r.unexpected, [], 'verified pass has no false positives')
  assert.deepEqual(r.baseline.unexpected.map(c => c.file), ['/fx/format.js'], 'raw pass had one')
  assert.deepEqual(r.baseline.missed, [], 'raw finder saw the planted bug')
})

test('baseline: shows a real bug the verify layer wrongly rejected', () => {
  const raw = [
    { file: '/fx/cart.js', problem: 'reduce crash' },
    { file: '/fx/dates.js', problem: 'sunday never matches' },
  ]
  const r = grade([{ file: 'cart.js' }, { file: 'dates.js' }], [raw[0]], raw)
  assert.equal(r.pass, false)
  assert.deepEqual(r.missed.map(e => e.file), ['dates.js'], 'verified pass missed it')
  assert.deepEqual(r.baseline.missed, [], 'the raw finder had found it — verify rejected a real bug')
})
