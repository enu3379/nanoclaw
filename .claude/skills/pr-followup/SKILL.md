---
name: pr-followup
description: Triage NanoClaw PR review comments and failed checks into actionable fixes, then rerun local validation before a follow-up commit.
---

# PR Follow-up

Use this skill when the task is "check PR comments", "fix review feedback", "address CI", or "what changed after the PR".

## Workflow

1. Identify the target PR from the current branch or explicit PR number.
2. Gather:
   - unresolved review comments
   - failing checks
   - latest branch diff
3. Convert findings into three buckets:
   - `actionable`: must fix before merge
   - `nitpick`: optional or low-risk cleanup
   - `ignore`: stale, already fixed, or incorrect
4. Preserve file and line references when summarizing findings.
5. Implement only the approved actionable scope.
6. Before the follow-up commit, rerun:
   - `npm run build`
   - `npm test`
   - narrower checks if the failure is formatter or lint only
7. In the commit message, make it explicit that this is review follow-up.

## Heuristics

- Formatter-only comments should usually be handled by local auto-formatting first.
- Re-check the current code before fixing bot comments; some comments may already be stale.
- Prefer one follow-up commit per review batch unless a failing check requires a separate fix.
