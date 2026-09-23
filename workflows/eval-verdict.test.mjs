// Tests the pure pass-grading block in swarm-smoke.js by extracting the code
// between the <eval-verdict> markers verbatim and evaluating it with injected
// `expected`, `confirmed`, `raw` and `unresolved` — so the PRODUCTION code is
// what runs (swarm-review.js carries a byte-identical copy, dimension-sync.test.mjs).
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

const grade = (expected, confirmed, raw = [], unresolved = []) =>
  new Function('expected', 'confirmed', 'raw', 'unresolved', m[1] + '\nreturn { missed, unexpected, pass, baseline, missedInconclusive, unexpectedInconclusive }')(expected, confirmed, raw, unresolved)

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

test('inconclusive: an unresolved false positive is neither unexpected nor killed — it is counted apart', () => {
  const fp = { file: '/fx/guards.js', problem: 'off-by-one in tail' }
  const bug = { file: '/fx/grid.js', problem: 'fill shares one row' }
  const r = grade([{ file: 'grid.js' }], [bug], [bug, fp], [fp])
  assert.deepEqual(r.unexpected, [])
  assert.deepEqual(r.baseline.unexpected.map(c => c.file), ['/fx/guards.js'])
  assert.deepEqual(r.unexpectedInconclusive.map(c => c.file), ['/fx/guards.js'],
    'baseline.unexpected - unexpected - unexpectedInconclusive = 0 killed, not 1')
})

test('inconclusive: an unresolved planted bug still fails the run but is counted apart from wrongly rejected', () => {
  const bug = { file: '/fx/tags.js', problem: 'Set has no length' }
  const r = grade([{ file: 'tags.js' }], [], [bug], [bug])
  assert.equal(r.pass, false, 'only a confirmed planted bug passes')
  assert.deepEqual(r.missed.map(e => e.file), ['tags.js'])
  assert.deepEqual(r.missedInconclusive.map(e => e.file), ['tags.js'],
    'missed - baselineMissed - missedInconclusive = 0 wrongly rejected, not 1')
})

test('inconclusive: empty outside graded mode', () => {
  const r = grade(null, [], [], [{ file: '/fx/a.js', problem: 'x' }])
  assert.deepEqual(r.missedInconclusive, [])
  assert.deepEqual(r.unexpectedInconclusive, [])
})
