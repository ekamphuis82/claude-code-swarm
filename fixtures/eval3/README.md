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
and this fixture is the one built to make that delta non-zero. Expect it to
take several runs before a lure fires: the smoke tier's haiku finder is
conservative (it ignored the earlier baited traps), so the FP is a
probability per run, not a guarantee — grade it repeatedly over time and
read the accumulated delta, never a single run.

Extension rules (same as the earlier fixtures): never describe a planted bug
in a code comment (a comment stating the CORRECT contract of a trap is
allowed and is what makes the trap objective — the finder must judge code
against contract); keep files dependency-free; give each planted bug an
`expected.json` entry with a `mustMatch` regex wide enough for honest
phrasings; keep trap files genuinely bug-free with no `expected.json` entry.
If a trap is ever found to hide a real bug (as `jobs.js` once did), that is a
fixture defect — fix the file, do not add an `expected.json` entry.
