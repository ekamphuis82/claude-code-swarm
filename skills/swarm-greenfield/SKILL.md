---
name: swarm-greenfield
description: Greenfield flow for building a new platform from scratch - platform spec, per-repo plans in bootstrap order, per-slice integration verify [internal: loaded by swarm-director on a new-platform task]
---

# Greenfield flow (new platform from scratch)

If a platform-blueprint skill exists in the plugin clone (onboard can
generate one), load it FIRST — it carries the canonical repo set, bootstrap
order and day-0 invariants; otherwise establish those three during the spec
step.

1. Platform spec in the MAIN THREAD (superpowers or the director's
   condensed flow): tenancy model, repo set, admin surface, mobile scope.
   One spec for the platform; one plan per repo — a platform is never a
   single implementation plan.
2. Director does the platform plumbing inline (one-off privileged actions,
   not agent work): local repo init, CLAUDE.md scaffolds; remote host
   groups/projects only if credentials are available (otherwise local-only,
   wire remotes later). Optionally — ask once per platform — push the slice
   backlog to the issue tracker (load `codeswarm:swarm-issues` for the
   rules and the mapping).
3. Per repo, in bootstrap order (backend first, auth slice before any
   feature): the director's FEATURE flow with that repo's plan.
4. After each vertical slice: integration verify across repos — run each
   repo's test gate and drive the contract surface end to end (an auth
   roundtrip, one API call through the gateway, one realtime subscribe if
   the platform has one) — before starting the next slice.
