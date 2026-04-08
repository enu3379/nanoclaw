#!/usr/bin/env bash
set -euo pipefail

steps=(
  "npm run format:check"
  "npm run lint"
  "npm run typecheck"
  "npm run build"
  "npm --prefix container/agent-runner ci"
  "npm run build:runners"
  "npm test"
)

for step in "${steps[@]}"; do
  echo
  echo "==> ${step}"
  eval "${step}"
done

echo
echo "Local CI passed."
