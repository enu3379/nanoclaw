#!/usr/bin/env bash
set -euo pipefail

run_step() {
  local step_label="$1"
  shift

  echo
  echo "==> ${step_label}"
  "$@"
}

run_step "npm run format:check" npm run format:check
run_step "npm run lint" npm run lint
run_step "npm run typecheck" npm run typecheck
run_step "npm run build" npm run build
run_step "npm --prefix container/agent-runner ci" npm --prefix container/agent-runner ci
run_step "npm run build:runners" npm run build:runners
run_step "npm test" npm test

echo
echo "Local CI passed."
