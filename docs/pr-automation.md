# PR Automation

NanoClaw 레포에서 반복되는 branch/worktree/CI/PR/review 후속 수정을 줄이기 위한 운영 문서.

## 목표

- 메인 repo checkout에서의 실수 방지
- formatter, lint, build, test 실패를 push 전에 검출
- PR 생성 절차의 일관성 확보
- PR 이후 review follow-up의 반복 비용 축소

## 자동화 구성

### Hooks

- `scripts/claude-hook-guardrails.sh`
  - `git push ... main|master` 차단
  - `gh pr create`에서 `--repo enu3379/nanoclaw` 누락 시 차단
  - 메인 repo checkout에서 `git checkout` / `git switch` 차단
  - 메인 repo checkout의 feature branch에서 직접 `git commit` 차단

### Husky

- `pre-commit`
  - `npm run check:staged-format`
  - `npm run check:secrets`
  - `npm run check:staged-lint`
- `pre-push`
  - `npm run ci:local`

### Scripts

- `scripts/format-staged.sh`
  - staged 파일에만 Prettier 적용 후 재-staging
- `scripts/lint-staged.sh`
  - staged TS/JS 파일에 ESLint `--fix` 적용 후 재-staging
- `scripts/ci-local.sh`
  - `format:check -> lint -> typecheck -> build -> build:runners -> test`
- `scripts/pr-preflight.sh`
  - worktree 경로, 브랜치, origin, clean working tree 점검

### Skills

- `.claude/skills/pr-lifecycle/SKILL.md`
  - worktree 생성부터 PR 생성까지 표준화
- `.claude/skills/pr-followup/SKILL.md`
  - review comment와 failing check 대응 표준화

## 추천 사용 흐름

1. 새 작업이면 `pr-lifecycle` 흐름으로 worktree를 먼저 만든다.
2. 계획을 승인받은 뒤 구현한다.
3. 커밋 전에 pre-commit 자동 수정 결과를 확인한다.
4. push 전에 `npm run ci:local`이 통과하는지 확인한다.
5. PR 생성 직전 `npm run pr:preflight`를 통과시킨다.
6. PR 이후에는 `pr-followup` 흐름으로 actionable comment만 처리한다.

## 운영 원칙

- hook은 실수를 차단하는 용도다.
- skill은 절차를 순서대로 실행하는 용도다.
- 문서는 사람이 왜 이 규칙을 따르는지 이해시키는 용도다.
- 셋 중 하나만으로 해결하려 하지 말고 같이 유지한다.
