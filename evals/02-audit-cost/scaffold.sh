#!/usr/bin/env bash
set -euo pipefail
mkdir -p api/src/auth api/src/tenancy admin-gui/src/auth admin-gui/src/guards
for i in $(seq 1 18); do printf 'export function authStep%s(req: unknown) { return req }\n' "$i" > "api/src/auth/step$i.ts"; done
for i in $(seq 1 14); do printf 'export function tenantScope%s(id: string) { return id }\n' "$i" > "api/src/tenancy/scope$i.ts"; done
for i in $(seq 1 16); do printf 'export const session%s = () => document.cookie\n' "$i" > "admin-gui/src/auth/session$i.ts"; done
for i in $(seq 1 12); do printf 'export const guard%s = () => true\n' "$i" > "admin-gui/src/guards/guard$i.ts"; done
