---
name: pr-lifecycle
description: Start NanoClaw work in the correct worktree, write an approval-first plan, run local CI, then commit, push, and create a PR against enu3379/nanoclaw.
---

# PR Lifecycle

Use this skill when the task is "start a branch", "make a PR", "push these changes", or any request that spans implementation through pull request creation.

## Required workflow

1. Resolve scope before editing.
2. Pick the branch type: `feat/`, `fix/`, `chore/`, or `docs/`.
3. Check existing worktrees with `git worktree list`.
4. Reuse an existing matching worktree or create a new one:
   `git worktree add /tmp/nanoclaw-<feature> -b <type>/<feature> <base>`
5. Do not switch branches in `/Users/eunu03/nanoclaw`.
6. Present a plan with branch, base branch, worktree path, files to change, design notes, and validation.
7. Wait for approval before implementation.
8. After implementation, run:
   - `npm run build`
   - `npm test`
   - `npm run pr:preflight`
9. Create the PR with:
   `gh pr create --repo enu3379/nanoclaw ...`

## PR body structure

- `Summary`
- `Why`
- `Validation`
- `Risks` when relevant

Keep the PR to one topic. If the requested change drifts into another topic, stop and split it into a new branch.
