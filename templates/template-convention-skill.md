---
name: my-rails-api-conventions
description: Conventions for the acme Rails backends (acme-api, acme-admin) - ActiveRecord seams, Sidekiq rules, RSpec gates, load-bearing gotchas. Load before any Ruby backend work.
---

> **TEMPLATE — FICTIONAL.** This file is the shape template the
> `swarm-onboard.js` writers follow when generating `skills/my-*/SKILL.md`.
> The rules (for the made-up "acme" org) are invented. It lives in
> `templates/` — not under `skills/` — precisely so it is never loaded as a
> real skill. Generated files omit this blockquote.

# Rails API conventions

Scope tags: `[universal]` = every repo this skill covers;
`[acme-api]` / `[acme-admin]` = that repo only.

## Dependencies / build

- `[universal]` Ruby 3.3 + Rails 7.2 (Gemfile.lock); run everything through
  `bundle exec` — globally installed gems drift.
- `[acme-api]` Postgres via `pg` only; do not add `mysql2` (Gemfile:14).

## Testing

- `[universal]` RSpec is the only test framework: `bundle exec rspec` (full
  suite), `bundle exec rspec spec/<path>` (targeted). Test data via
  FactoryBot, never `fixtures/*.yml` (spec/spec_helper.rb:12).
- `[acme-api]` Request specs only — controller specs are banned (.rspec:3,
  deprecation note).

## Load-bearing gotchas

- `[universal]` Strong Migrations blocks unsafe DDL — a rejected migration in
  CI means rewrite it, never blanket `safety_assured` it away
  (config/initializers/strong_migrations.rb:5).
- `[acme-admin]` The admin app mounts the API's engine; never duplicate a
  model — require it from the engine gem (app/models/README.md:1).
