# Eval fixture 2 (decorrelated)

A second graded self-test set for `workflows/swarm-smoke.js`, added to break
the single-fixture correlation problem: repeating `fixtures/eval` adds
correlated samples, not independent evidence (see CLAUDE.md). Same JavaScript
language (the smoke finder prompt is JS-specific), but four planted bug
classes that are DISJOINT from `fixtures/eval`'s five, plus a correct-form
trap file for precision teeth.

Planted bugs:

- `bounds.js` — `lastN` loops `i <= arr.length`: reads one past the end, so
  the result carries a trailing `undefined` (`lastN([1,2,3],2)` →
  `[2,3,undefined]`). Off-by-one on the upper bound.
- `clamp.js` — `clamp` swaps the min/max arguments to `Math.max`/`Math.min`:
  `clamp(5,0,10)` returns `10` instead of `5`. Correct shape, wrong operands.
- `async.js` — `fetchAll` uses `forEach` with an `async` callback and does
  not await it, so `results` is returned empty before any push runs. The
  async-in-forEach class (distinct from `fixtures/eval`'s missing-await in a
  plain `return`).
- `falsy.js` — `displayPrice` guards with `cents || 'n/a'`, so a legitimate
  `0` (free) renders as `'n/a'` instead of `'0.00'`. Falsy-zero via `||`.

Pure trap file (NO planted bugs — precision teeth; any confirmed finding
here is a false positive, no `expected.json` entry):

- `correct.js` — the correct form of all four classes above: `i <
  arr.length`, non-swapped `clamp`, `Promise.all(ids.map(...))`, and a
  `cents == null` guard. A finder that pattern-matches on shape instead of
  reasoning about behaviour will flag these.

Run via the director exactly like `fixtures/eval`: it reads `expected.json`
and passes it as the `expected` arg to `swarm-smoke.js` (workflow scripts
have no filesystem access). Pass = zero `missed`. The result's `baseline`
(raw pre-verify finder output graded against the same set) minus the
verified numbers is the measured value/cost of the verify layer — the whole
point of grading a second, decorrelated fixture over time.

Extension rules (same as `fixtures/eval`): never describe a planted bug in a
code comment, keep files dependency-free, give each planted bug an
`expected.json` entry with a `mustMatch` regex wide enough for honest
phrasings, and keep trap files genuinely bug-free with no `expected.json`
entry.
