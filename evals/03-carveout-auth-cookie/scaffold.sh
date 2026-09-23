#!/usr/bin/env bash
set -euo pipefail
cat > session.ts <<'EOF'
import type { Response } from 'express'

export function setSessionCookie(res: Response, token: string): void {
  res.cookie('sid', token, {
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: 1000 * 60 * 60 * 8
  })
}
EOF
