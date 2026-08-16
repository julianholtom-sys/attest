---
name: update-project-status
description: Update docs/PROJECT_STATUS.md (and AGENTS.md if needed), then commit and push so every device/agent shares the same project state.
disable-model-invocation: true
---

# Update project status and push

Run this when ending a session or after meaningful product/demo changes.

## Steps

1. Review recent git history (`git log -10 --oneline`), branch name, and working-tree changes.
2. Update `docs/PROJECT_STATUS.md`:
   - Refresh **Last updated** date (UTC).
   - Sync product model, brand notes, how to run, phone tunnel practice.
   - Summarize recent work and open PRs/branches if known.
   - Keep **Known issues / next** accurate (check off done items, add new ones).
3. Update `AGENTS.md` only if agent briefing, architecture, brand, or tunnel practice changed.
4. Commit only the continuity docs (and related rule/skill files if touched). Do not commit `TUNNEL_URL.txt` or local DB/files.
5. `git push -u origin HEAD` (or the current feature branch).
6. Reply with a short summary of what was recorded and confirm push succeeded.

## Tone of the status file

Keep it factual and scannable — enough for another agent on phone or desktop to continue without the prior chat.
