---
name: swarm-resume
description: Resume flow for crashed or rate-limit-killed swarm runs - lists unfinished workflow runs and resumes with the exact launch-time script version so completed agents replay free from cache [internal: loaded by swarm-director on a resume task]
---

# Resume flow (crashed or limit-killed runs)

1. List unfinished runs: transcript dirs under the session's
   `subagents/workflows/` with a `journal.jsonl` but no completed task
   result; show run id, workflow name, completed-agent count.
2. CRITICAL: resume with the EXACT script version the run launched with —
   cache keys are (prompt, opts). If the script changed since launch,
   extract the launch-time version (`git show <commit>:workflows/x.js`) to
   a scratch file and pass THAT as `scriptPath`.
3. `Workflow({scriptPath, resumeFromRunId, args: <identical args>})` —
   completed agents replay free from cache; only the missing tail runs.
4. Never resume while a rate limit is still active; nothing is lost by
   waiting. If the old run is not visible (e.g. a new session), read its
   `journal.jsonl` and dispatch only the provably missing tail as fresh,
   narrowly-scoped work — never re-run completed agents live.

Standalone-runner runs (config `runner: "standalone"`) resume themselves:
`node <pluginDir>/runner/run.js --resume <runId>` — the runner saved the
launch-time script, args and journal under
`<configDir>/codeswarm-runs/<runId>/`; completed agents replay from the
journal, null results re-run live. Steps 1–3 above apply to Workflow-tool
runs only.

The fit & cost gate does not re-apply here — the spend decision was made at
launch. Report what resumed, what replayed free from cache, and what ran
live, per the director's reporting rules.
