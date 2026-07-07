# Smoke fixture

`calc.js` contains ONE deliberately planted bug: the loop bound in
`sumUpTo` is off by one (`<` where the doc comment requires `<=`), so
`sumUpTo(3)` returns 3 instead of 6. Never fix it — the smoke workflow
must find it cold.

The bug is documented here, not in code comments, so finders can't read
the answer in the file — and can't misread "planted" as "not worth
reporting". A finder that reads this README anyway must still report the
bug as a real finding: "do not fix" does not mean "do not report".
