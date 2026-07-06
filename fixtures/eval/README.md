# Eval fixture

A graded self-test set for `workflows/swarm-smoke.js` — five planted bugs
across distinct failure classes, plus deliberately correct near-miss code,
so a run measures both recall (every `expected.json` entry must be matched
by a confirmed finding) and precision (confirmed findings outside
`expected.json` come back under `unexpected`).

Planted bugs:

- `cart.js` — `cartTotal` calls `reduce` without an initial value: an empty
  cart throws, a one-item cart returns the item object.
- `dates.js` — `isWeekend`: `getDay()` returns 0–6 with Sunday = 0, so
  `day === 7` never matches and Sundays are not weekends. (`daysInMonth` is
  correct — a near-miss trap; flagging it is a false positive.)
- `queue.js` — `removeCompleted` splices inside `forEach`: removal shifts
  the array, so the element after each removed job is skipped.
- `retry.js` — `withRetry` returns `operation()` without `await`: a rejected
  promise escapes the try/catch, so nothing is ever retried. (`backoffDelay`
  is correct — near-miss trap.)
- `stats.js` — `sortScores` calls `.sort()` without a comparator: numbers
  sort lexicographically ([1, 10, 2]). (`median` is correct for a
  numerically sorted input — near-miss trap.)

Pure trap files (NO planted bugs — they exist to give the precision number
teeth; any confirmed finding in them is a false positive by construction and
comes back under `unexpected`):

- `jobs.js` — mirrors three planted bug classes in their CORRECT form:
  splice inside a REVERSE loop (queue.js's class, done right), `reduce` WITH
  an initial value (cart.js's class), `return await` inside try/catch
  (retry.js's class). A finder that pattern-matches instead of reasoning
  will flag these.
- `schedule.js` — mirrors the remaining two classes plus extra bait:
  `getDay()` used correctly with Sunday = 0 (dates.js's class), a numeric
  DESCENDING sort comparator on a copied array (stats.js's class — `b - a`
  looks "reversed" to a pattern-matcher), modulo day arithmetic that looks
  off-by-one but is correct, and 1-based→0-based month conversion
  (`monthFrom1 - 1`) that baits an off-by-one report. Together with
  `jobs.js`, every planted bug class now has a correct-form twin.

Run: `/codeswarm:swarm smoke` against this directory — the director reads
`expected.json` (workflow scripts have no filesystem access) and passes it
as the `expected` arg. Pass = zero `missed` entries. The result also
carries `baseline`: the RAW pre-verify finder output graded against the
same expected set — the delta against the verified numbers is the measured
value (and cost) of the verify layer, at zero extra agents.

Rules for extending this fixture: never describe a planted bug in a code
comment (the finder would only be reading comments, not code), keep files
dependency-free, and add a matching `expected.json` entry with a
`mustMatch` regex wide enough for honest phrasings of the bug. Trap files
must stay genuinely bug-free (they get no `expected.json` entry — that is
the point) and must never be labeled as traps in their own code.

## 2026-07-06 batch (20 graded runs, haiku tier)

A 20-run batch (ad hoc script, not shipped — see CLAUDE.md structural
constraints) surfaced two findings worth recording here so the next editor
does not have to re-derive them:

- **`jobs.js` had an unintended real bug**, caught by this fixture's own
  purpose: `firstSuccessful([])` threw `undefined` instead of an `Error`.
  4/20 runs found it, and single-lens verify correctly confirmed it as real
  every time — that was verify working correctly against a genuinely broken
  trap file, not a false-positive miss. Fixed (guards the empty-array case
  now). Before this fix, every `unexpected` finding in the batch traced to
  this one line — `schedule.js` produced zero false positives across all 20
  runs.
- **Recall on the smoke tier is uneven, and unevenly so per bug**: `cart.js`
  (reduce-without-initial) and `stats.js` (lexicographic sort) were each
  missed in 13/20 runs; `dates.js` was missed in 0/20; `queue.js`/`retry.js`
  missed only a handful of times. Only 2/20 runs passed cleanly. This is a
  property of the CHEAPEST tier (`swarm-smoke.js` hardcodes haiku for both
  finder and verifier by design) — real reviews finder on the session model
  and verify on sonnet, so this recall number does not transfer to
  `swarm-review.js` and should not be read as "the plugin misses 65% of
  bugs."
