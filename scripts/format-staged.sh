#!/usr/bin/env bash
set -euo pipefail

staged_files=()
pattern='\.(ts|tsx|js|jsx|json|md|yml|yaml)$'

while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  if [[ "${file}" =~ $pattern ]]; then
    staged_files+=("${file}")
  fi
done < <(git diff --cached --name-only --diff-filter=ACMR)

if [[ ${#staged_files[@]} -eq 0 ]]; then
  echo "No staged files to format."
  exit 0
fi

npx prettier --write "${staged_files[@]}"
git add -- "${staged_files[@]}"

echo "Formatted staged files with Prettier."
