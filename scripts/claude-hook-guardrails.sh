#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
command="$(printf '%s' "${payload}" | jq -r '.tool_input.command // empty')"

if [[ -z "${command}" ]]; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
branch="$(git branch --show-current 2>/dev/null || true)"

block() {
  jq -nc --arg reason "$1" '{decision:"block", reason:$reason}'
  exit 0
}

if [[ "${command}" =~ ^[[:space:]]*git[[:space:]]+push\b ]]; then
  push_args="$(printf '%s' "${command}" | sed -E 's/^[[:space:]]*git[[:space:]]+push[[:space:]]+//')"
  if printf '%s' "${push_args}" | grep -qE '(^|[[:space:]])(main|master)([[:space:]]|$)'; then
    block "main/master 브랜치에 직접 push 차단. 브랜치 → PR로 진행하세요."
  fi
fi

if [[ "${command}" =~ ^[[:space:]]*gh[[:space:]]+pr[[:space:]]+create\b ]]; then
  if ! printf '%s' "${command}" | grep -q -- '--repo[[:space:]]\+enu3379/nanoclaw'; then
    block "gh pr create 시 --repo enu3379/nanoclaw 를 반드시 명시하세요."
  fi
  if [[ "${repo_root}" == "/Users/eunu03/nanoclaw" ]]; then
    block "메인 repo checkout 에서 직접 PR 생성하지 마세요. /tmp worktree 에서 진행하세요."
  fi
fi

if [[ "${repo_root}" == "/Users/eunu03/nanoclaw" && "${command}" =~ ^[[:space:]]*git[[:space:]]+(checkout|switch)\b ]]; then
  block "메인 repo checkout 에서 branch 전환 금지. 새 worktree 를 만들어 작업하세요."
fi

if [[ "${repo_root}" == "/Users/eunu03/nanoclaw" && "${branch}" =~ ^(feat|fix|chore|docs)/ && "${command}" =~ ^[[:space:]]*git[[:space:]]+commit\b ]]; then
  block "feature 작업 커밋은 메인 repo checkout 이 아니라 해당 branch worktree 에서 수행하세요."
fi
