#!/usr/bin/env bash
# Full suite run: Sonnet cases, Opus judge, scaffolds on, with/without ablation.
set -euo pipefail
cd "$(dirname "$0")/.."
out="evals/results/full-$(date +%F).json"
exec claude plugin eval . --ablation with-without --model sonnet --judge-model opus \
  --scaffold --allow-tools Edit Write --no-publish --trust-plugin -j 2 --threshold 0 \
  --max-cost-usd 15 --json "$out"
