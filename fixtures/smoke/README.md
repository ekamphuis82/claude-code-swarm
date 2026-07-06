# Smoke fixture

`calc.js` contains ONE deliberately planted bug (off-by-one loop bound in
`sumUpTo`). `workflows/swarm-smoke.js` must find it, verify it, and report
exactly this bug. Do not fix it — it is the test.
