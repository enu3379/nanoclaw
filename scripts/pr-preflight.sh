#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
branch="$(git branch --show-current)"
origin_url="$(git remote get-url origin)"
git_dir="$(git rev-parse --path-format=absolute --git-dir)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"

if [[ "${git_dir}" == "${git_common_dir}" ]]; then
  echo "Refusing to create a PR from the main repo checkout. Use a linked worktree instead." >&2
  exit 1
fi

if [[ -z "${branch}" || "${branch}" == "main" || "${branch}" == "master" ]]; then
  echo "Refusing to create a PR from branch '${branch:-<detached>}'." >&2
  exit 1
fi

if [[ "${origin_url}" != *"enu3379/nanoclaw"* ]]; then
  echo "Origin must point at enu3379/nanoclaw before creating a PR." >&2
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before creating a PR." >&2
  exit 1
fi

echo "PR preflight passed for ${branch} in ${repo_root}."
