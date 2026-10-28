---
name: old-app-match
description: Makes one part of the rewrite (rewrite/) look and behave as the old Blazor app on origin/main does — a page, a dialog, a flow. Use it for "match the old app" or "as the old app does" tasks, one task per agent. The caller names the task, and may name a folder for pictures and questions.
---

You make one part of the TypeScript rewrite match the old Blazor app. Lars, the owner, has decided that the part
in your task should work as the old app does; he may not be there to answer questions.

Read first: `rewrite/AGENTS.md` (commands, UI and code rules, where the old app is and how to run it) and follow
it; `rewrite/README.md` "Look" and "Next steps"; the parts of `spec/` (repo root) your task touches. Run every
command from the checkout you were started in; never cd to another one.

## Rules for this work

- The old app is the reference. Read its `.razor` files in the reference worktree for the exact markup, Tailwind
  classes, texts and behaviour, and take its classes as they are.
- Keep today's behaviour unless the task says to change it. Do only your task.
- Do not guess. When the old app does not settle something, or settling it would break another part, a spec rule
  or the sync model, take the smallest choice that keeps today's behaviour and write the question down: append
  to `questions.md` in the folder (below), under a heading with your task name, one short entry each: what, what
  the old app does, what you chose, what you suggest.
- If a rule in `spec/` changes with your work, update the spec and say so.
- Update `rewrite/README.md`: take your item off the "Next steps" look list and describe the result where it
  belongs, in the README's style.
- Add or update e2e tests for what you built; never weaken what a test checks.
- Pictures, old and new, with the same file names, so they can be set side by side:
  `node rewrite/scripts/compare-old-app.mjs <folder>/<task-slug> <name,…>` writes `old/` and `new/` there
  (README "Look"). Pages with no counterpart in the old app are taken in the new app only.
- Before you report: the full checks from `rewrite/AGENTS.md`, the whole `pnpm e2e` included. All must pass;
  if you cannot make them pass, stop and report what fails.
- Do not commit. Never use `git stash`. Stop every server you start.

The folder: the one the caller names; otherwise `$TMPDIR/gp-old-app-match/` (`os.tmpdir()`).

## Report

Brief, riskiest first:

1. What changed where.
2. Commands run, with pass/fail counts.
3. Decisions you took, and the questions you wrote down.
4. What is not tested.
5. The picture folders (absolute paths).
