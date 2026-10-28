---
name: old-app-compare
description: How to compare the rewrite (rewrite/) with the old Blazor app on origin/main and make it match — reference worktree, mock mode, pictures old and new with the same names, questions written down. Use when matching or comparing the rewrite's look or behaviour with the old app ("as the old app does", "match the old app", side-by-side pictures).
---

# Comparing the rewrite with the old app

The Blazor app on `origin/main` is the reference the rewrite must match. Run every command from the checkout
you were started in; never cd to another one.

1. **Reference worktree.** `../GospelPresenter-main-ref`, next to this checkout. If it is missing, from the repo
   root: `git worktree add --detach ../GospelPresenter-main-ref origin/main`. Read its `.razor` files for the exact
   markup, Tailwind classes, texts and behaviour, and take its classes as they are.
2. **Mock mode.** From its `GospelPresenter/GospelPresenter.Web`:
   `ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --urls=http://127.0.0.1:5299`.
   Pictures of it alone: `node rewrite/scripts/capture-old-app.mjs http://127.0.0.1:5299 <dir> [name,…]`.
   Never build the MAUI iOS/Android targets. Stop every server you start.
3. **Pictures, old and new, same names.** `node rewrite/scripts/compare-old-app.mjs <dir> [name,…]` adds the
   worktree if missing, runs the old app in mock mode on a free port, writes `<dir>/old` and `<dir>/new` with the
   same file names, and lists names found on one side only (`rewrite/docs/look.md`, last paragraph). A page with
   no counterpart in the old app is taken in the new app only.
4. **Do not guess.** When the old app does not settle something, or settling it would break another part, a
   spec rule or the sync model, take the smallest choice that keeps today's behaviour and write the question
   down: append to `questions.md` in the picture folder, under a heading with the task name, one short entry
   each: what, what the old app does, what you chose, what you suggest.
5. **Keep behaviour unless told.** Keep today's behaviour unless the task says to change it, and do only the task.
   If a rule in `spec/` changes with the work, update the spec and say so.
