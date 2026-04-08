#!/usr/bin/env bash
set -euo pipefail

staged_files=()
if command -v rg >/dev/null 2>&1; then
  while IFS= read -r file; do
    staged_files+=("$file")
  done < <(
    git diff --cached --name-only --diff-filter=ACMR \
      | rg '\.(ts|tsx|js|jsx)$' \
      | rg '^(src|setup|runners)/' \
      || true
  )
else
  while IFS= read -r file; do
    staged_files+=("$file")
  done < <(
    git diff --cached --name-only --diff-filter=ACMR \
      | grep -E '\.(ts|tsx|js|jsx)$' \
      | grep -E '^(src|setup|runners)/' \
      || true
  )
fi

if [[ ${#staged_files[@]} -eq 0 || -z "${staged_files[0]:-}" ]]; then
  echo "No staged TS/JS files to lint."
  exit 0
fi

npx eslint --fix --quiet "${staged_files[@]}"
git add -- "${staged_files[@]}"

echo "Linted staged files with ESLint."
