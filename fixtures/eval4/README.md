# Eval fixture 4 (precision-weighted, harder lures)

Built because `fixtures/eval3` stopped measuring anything: on 2026-09-23,
eight graded review-tier runs (Opus 5.5 and sonnet finders, suspicion-biased
target) returned exactly the two planted bugs and flagged nothing in
`guards.js`, so verify had nothing to kill. Current finders see through
`<=` loops, `== null` and `Math.floor`. This fixture's lures are harder: each
is either the correct TWIN of a real bug in another fixture, or a piece of
folk wisdom ("always pass a radix", "months are 0-indexed") that does not
apply under the documented contract. Refuting them takes running the code or
knowing the spec precisely — which is what the verify layer is for.

Planted bugs (both classes disjoint from `eval`, `eval2` and `eval3`):

- `parse.js` — `values.map(parseInt)`: `map` passes the index as
  `parseInt`'s radix, so `parseAll(['7', '12', '3'])` returns
  `[7, NaN, NaN]`. Callback-arity mismatch.
- `slug.js` — `replace(' ', '-')` with a string pattern replaces only the
  FIRST space: `toSlugPart('Release Notes For June')` returns
  `'release-notes for june'`. First-occurrence-only replace.

Pure trap file `calendar.js` (NO planted bugs — any confirmed finding there
is a false positive, no `expected.json` entry). Each function states its
contract; each is correct under it:

- `sortDates` — default `sort()` on `'YYYY-MM-DD'` strings. The correct twin
  of `fixtures/eval`'s `stats.js` numeric-sort bug: for zero-padded ISO
  dates, lexicographic order IS chronological.
- `toInt` — `parseInt(digits)` without a radix. The "leading zero parses as
  octal" rule died with ES5: `toInt('08')` → `8`, `toInt('0042')` → `42`.
  Twin of the planted `parse.js` bug, which is about the radix ARGUMENT, not
  its absence.
- `daysInMonth` — `new Date(year, month, 0)` with a 1-based `month`. Looks
  like the 0-indexed-month off-by-one; it is the day-0-of-next-month idiom:
  `daysInMonth(2024, 2)` → `29`, `daysInMonth(2023, 12)` → `31`.
- `hasName` — `!!~names.indexOf(name)`. Bitwise NOT reads as a trick gone
  wrong; `~-1` is `0` (false) and every found index gives a non-zero value.
- `range` — `Array(n).fill().map(...)`. Looks like the "map skips holes"
  bug; `fill()` with no argument fills `undefined`, so there are no holes:
  `range(4)` → `[0, 1, 2, 3]`.

All of the above were checked with `node` when the fixture was written: the
traps honour their contracts and the planted bugs fail theirs.

**Running it.** Graded review-tier run, same contract as `fixtures/eval3`
(see its README). Canonical args — keep `target` byte-identical across runs:

```json
{
  "repo": "<absolute path to fixtures/eval4>",
  "dimensions": ["bugs"],
  "target": "the three files in this fixture. Report EVERY construct that could plausibly be a bug: sort order, number parsing and radix, date arithmetic and month indexing, bitwise tricks, sparse arrays, string replacement. Err on the side of reporting.",
  "expected": "<contents of expected.json>"
}
```

Record every run via `tools/record-eval.js` with `"workflow":"review"`, the
`rigor`/`verify` the run used, the finder model, `"fixture":"fixtures/eval4"`,
the result's `missedInconclusive`/`unexpectedInconclusive` counts and
`"notes":"canonical bait target"`. Run it at least twice; one run measures
nothing.

**Result of the first runs (2026-09-23) — read this before running it
again.** Four graded runs (two with the Opus 5.5 finder, two with
`topModel: sonnet`, lite, `execRepro` off) each returned exactly the two
planted bugs and flagged NOTHING in `calendar.js`. The finders often ran
their claims with `node` before reporting them ("returned [7, NaN, NaN] when
run in node"), so the first guess was that execution filtered the false
positives. Two more runs with `finderReadOnly: true` (finders barred from
running anything) refuted that: they flagged nothing in `calendar.js`
either. At the Opus 5.5 tier the finder reads these lures correctly, and
this fixture measures no verify delta.

Extension rules (same as the earlier fixtures): never describe a planted bug
in a code comment (a comment stating the CORRECT contract is allowed and is
what makes a trap objective); keep files dependency-free; keep trap code
genuinely correct under its stated contract — if a trap turns out to hide a
real bug, fix the file, do not add an `expected.json` entry.
