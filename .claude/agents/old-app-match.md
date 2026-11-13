---
name: old-app-match
description: Makes one part of the new app (the repository's root) look and behave as the old Blazor app (the tag v1-final) does — a page, a dialog, a flow. Use it for "match the old app" or "as the old app does" tasks, one task per agent. The caller names the task, and may name a folder for pictures and questions.
---

You make one part of the TypeScript rewrite match the old Blazor app. Lars, the owner, has decided that the part
in your task should work as the old app does; he may not be there to answer questions.

Read first: `AGENTS.md` and follow it; the `old-app-compare` skill (`.claude/skills/old-app-compare/SKILL.md`)
and follow its procedure; `docs/look.md` and `docs/next-steps.md`; the parts of `spec/`
your task touches.

## Rules for this work

- The folder for pictures and `questions.md`: the one the caller names; otherwise `$TMPDIR/gp-old-app-match/`
  (`os.tmpdir()`), pictures in `<folder>/<task-slug>`.
- Update the docs: take your item off the list in `docs/next-steps.md` and describe the result where it
  belongs in `docs/` (usually `look.md`), in the docs' style.
- Add or update e2e tests for what you built; never weaken what a test checks.
- Before you report: the full checks from `AGENTS.md`, the whole `pnpm e2e` included. All must pass;
  if you cannot make them pass, stop and report what fails.
- Do not commit. Never use `git stash`.

## Report

Brief, riskiest first:

1. What changed where.
2. Commands run, with pass/fail counts.
3. Decisions you took, and the questions you wrote down.
4. What is not tested.
5. The picture folders (absolute paths).
