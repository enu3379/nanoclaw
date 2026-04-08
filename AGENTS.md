# AGENTS.md

이 레포에서 작업하는 AI 에이전트(Claude, Codex 등)가 따라야 할 워크플로우.

## 기본 워크플로우

### 1. 요구사항 이해

- 사용자의 요청을 정확히 파악한다.
- 불명확한 부분은 반드시 질문으로 해결한다.
- 관련 코드, 기존 구현, 아키텍처를 파악한다 (파일 읽기, grep 등).
- 이 단계에서 코드를 수정하지 않는다.

### 2. 계획 수립

#### 작업 환경 결정 (계획 작성 전 필수)

1. **브랜치 결정**
   - 기존 브랜치에서 이어가는 작업인지, 새 브랜치가 필요한지 판단한다.
   - 새 브랜치라면 어디서 분기할지 결정한다 (`main`, 기존 feature 브랜치 등).
   - 브랜치명은 브랜치 규칙(`feat/`, `fix/`, `chore/`, `docs/`)을 따른다.

2. **워크트리 결정**
   - `git worktree list`로 기존 워크트리를 확인한다.
   - 이미 해당 브랜치의 워크트리가 있으면 그곳에서 작업한다.
   - 없으면 새 워크트리를 만든다: `git worktree add /tmp/nanoclaw-{feature} -b {type}/{feature} {base}`
   - 메인 repo(`/Users/eunu03/nanoclaw`)에서 직접 브랜치를 바꾸지 않는다.

3. **계획에 명시**
   - 브랜치명, 베이스 브랜치, 워크트리 경로를 계획 문서 상단에 기록한다.

#### 계획 내용

- 변경할 파일 목록과 각 파일의 변경 내용을 정리한다.
- 설계 결정사항을 명시한다 (왜 이 방식인지).
- 검증 절차를 정의한다:
  - 테스트 스펙 — 어떤 테스트를 작성/수정할지, 입력값과 기대값
  - 빌드 확인 — `npm run build`
  - 기존 테스트 통과 — `npm test`
- **계획은 사용자에게 보여주고 승인받은 후에 구현한다.**

### 3. 구현

- 승인된 계획에 따라 코드를 작성한다.
- 계획에 없는 파일을 수정하지 않는다.
- 한 PR에는 한 주제만 담는다.

### 4. 검증

- `npm run build` 통과
- `npm test` 전체 통과
- 변경된 파일 목록이 계획과 일치하는지 확인

## 자동화 규칙

- staged 코드 포맷은 `npm run check:staged-format`으로 pre-commit에서 자동 정리한다.
- staged TS/JS lint는 `npm run check:staged-lint`으로 pre-commit에서 자동 수정 후 재-staging한다.
- push 전 검증은 `npm run ci:local`로 수행하며, CI와 최대한 같은 순서로 검사한다.
- PR 생성 전 `npm run pr:preflight`를 실행해 worktree, 브랜치, origin, clean working tree를 확인한다.
- `gh pr create` 시 반드시 `--repo enu3379/nanoclaw`를 포함한다.
- Claude hook은 메인 repo checkout에서의 branch 전환, feature 작업 커밋, 잘못된 PR 생성을 차단한다.

## 코드 작성 규칙

- TypeScript를 수정할 때는 같은 디렉토리의 기존 파일 패턴을 먼저 읽고 맞춘다.
- 포맷은 추측하지 말고 pre-commit의 Prettier 결과를 기준으로 확정한다.
- lint/format만 깨지는 후속 커밋이 나오지 않도록 구현 직후 `npm run ci:local` 또는 필요한 하위 검증을 먼저 돌린다.

## 브랜치 규칙

- `feat/<summary>` — 새 기능
- `fix/<summary>` — 버그 수정
- `chore/<summary>` — 잡일 (CI, 의존성, 설정 등)
- `docs/<summary>` — 문서

## Git 규칙

- `origin` = `enu3379/nanoclaw` (fork) — PR은 여기에 올린다
- `upstream` = `qwibitai/nanoclaw` (부모 레포) — pull only
- `gh pr create` 시 반드시 `--repo enu3379/nanoclaw` 명시
- 메인 repo(`/Users/eunu03/nanoclaw`) 브랜치를 변경하지 않는다
- 병렬 작업은 worktree로 분리한다: `git worktree add /tmp/nanoclaw-{feature} -b {type}/{feature} main`

## 작업 위임

다른 에이전트(Codex, Claude 등)에게 작업을 위임할 때 반드시 포함할 맥락:

- 현재 브랜치명
- 워크트리 경로
- 계획 문서 전문 (또는 경로)
- 구체적 작업 범위 — 어떤 파일, 어떤 함수
- 테스트 스펙 — 입력, 기대 출력, 테스트 파일 경로
- **"검토만" vs "구현" 명확히 구분**

### 검토 vs 구현

- **"검토해"** = 텍스트 피드백만 준다. 파일 수정/생성 절대 금지.
- **"구현해"** = 사용자가 승인한 후에만 코드를 작성한다.
