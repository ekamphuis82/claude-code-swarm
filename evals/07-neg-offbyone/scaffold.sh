#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/items.ts <<'EOF'
export function total(items: { price: number }[]): number {
  let sum = 0
  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price
  }
  return sum
}
EOF
