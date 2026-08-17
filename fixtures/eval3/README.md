# Eval fixture 3 (precision-weighted)

A third graded self-test set for `workflows/swarm-smoke.js`, added to
generate the A/B evidence the log is thin on: the earlier fixtures'
verify delta ran at zero because their trap files never actually lured a
false positive (see the 2026-07-06 batch note in `fixtures/eval/README.md` —
`schedule.js` drew zero FPs in 20 runs). This fixture's centre of gravity is
`guards.js`: correct code engineered to match notorious bug SIGNATURES
strongly, so a pattern-matching finder is likelier to flag it — and the
verify layer, which constructs the concrete failing input and runs it, has
something real to KILL. Two planted bugs anchor recall; both bug classes are
DISJOINT from `fixtures/eval` and `fixtures/eval2`.

Planted bugs:

- `grid.js` — `makeGrid` builds the row array once and `new
  Array(rows).fill(row)` fills every row with the SAME reference, so
  `setCell(g, 0, 0, 9)` also writes `g[1][0]`. Shared-reference-from-fill
  (a class in neither earlier fixture).
- `tags.js` — `countUnique` reads `.length` on a `Set`; `Set` exposes
  `.size`, not `.length`, so the function returns `undefined` instead of the
  distinct count. Wrong-property-on-collection.

Pure trap file (NO planted bugs — precision teeth; any confirmed finding
here is a false positive, no `expected.json` entry). Each construct is the
correct form of a signature a finder is trained to distrust:

- `tail` loops `i <= arr.length - 1`. The `<=` reads as an off-by-one (it is
  the REAL bug in `fixtures/eval2`'s `bounds.js`), but `arr.length - 1` is
  the last valid index and the `Math.max(0, …)` start makes every `count`
  safe: `tail([1,2,3,4,5],2)` → `[4,5]`, `tail([1,2,3],9)` → `[1,2,3]`,
  `tail([],2)` → `[]`. A finder that flags `<=` in a loop without running it
  produces a false positive that reproducibility-verify rejects.
- `coalesce` uses `value == null`. Loose equality reads as sloppiness, but
  `== null` is the idiomatic null-AND-undefined test that deliberately lets
  `0`, `''` and `false` pass — the opposite of `fixtures/eval2`'s `falsy.js`
  `|| ` bug. Verify constructing `coalesce(0, 'x')` gets `0`, not `'x'`.
- `pageOf` uses `Math.floor(index / size)`. Integer division reads as
  truncation loss, but flooring is exactly right for a zero-based page
  number: `pageOf(9,5)` → `1`, `pageOf(10,5)` → `2`.

Run via the director exactly like the other fixtures: it reads
`expected.json` and passes it as the `expected` arg to `swarm-smoke.js`
(workflow scripts have no filesystem access). Pass = zero `missed`. The
result's `baseline` (raw pre-verify finder output graded against the same
set) MINUS the verified numbers is the measured value of the verify layer —
and this fixture is the one built to make that delta non-zero.

**Result of the first real attempt (2026-08-17) — read this before running
it again.** The smoke tier does NOT bait: four graded `swarm-smoke.js` runs
each returned exactly the two planted bugs and flagged NOTHING in
`guards.js`, so the delta stayed 0. Haiku is too conservative to take this
bait; do not read those zero-delta rows as evidence about the verify layer.

What worked was moving the finder up a tier AND biasing its prompt —
`swarm-review.js` on this fixture with a target that says, in effect,
"report EVERY construct that could plausibly be a bug: off-by-one risks,
loose equality, integer truncation, boundary handling, shared references;
err on the side of reporting". That produced the first non-zero delta in the
live log: **3 false positives killed** — all three `guards.js` lures
(`tail`'s `<=` shape, `coalesce`'s `== null`, `pageOf`'s `Math.floor`) —
with both planted bugs surviving verify.

Three things that run taught, worth keeping in mind here:

- **Run it at least twice.** Two runs with byte-identical args disagreed:
  a `grid.js:9` "no bounds check" finding was confirmed in one and rejected
  in the other. A single run measures nothing.
- **`tail` is the strongest lure, and it is not fully FP-proof.** One
  surviving false positive claimed `tail` mishandles negative/fractional
  `count` — out of the documented contract, so still an FP, but its stated
  repro was wrong (`tail([1,2,3], 1.5)` returns `[undefined]`, not `[3]`).
  If you tighten anything, tighten the verify prompt against findings whose
  own repro does not reproduce, not this file.
- Grade repeatedly over time and read the accumulated delta from the log,
  never a single run.

Extension rules (same as the earlier fixtures): never describe a planted bug
in a code comment (a comment stating the CORRECT contract of a trap is
allowed and is what makes the trap objective — the finder must judge code
against contract); keep files dependency-free; give each planted bug an
`expected.json` entry with a `mustMatch` regex wide enough for honest
phrasings; keep trap files genuinely bug-free with no `expected.json` entry.
If a trap is ever found to hide a real bug (as `jobs.js` once did), that is a
fixture defect — fix the file, do not add an `expected.json` entry.
