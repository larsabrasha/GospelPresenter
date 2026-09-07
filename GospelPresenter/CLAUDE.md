# Project Rules

## UI consistency
- Use the `<AppButton>` component for buttons. Use the `Variant` parameter (`ButtonVariant.Primary`, `ButtonVariant.Danger`, `ButtonVariant.Cancel`, etc.) and `Filled` for emphasis. A raw `<button>` is acceptable only where `AppButton` cannot do the job: a disclosure toggle carrying `aria-expanded`, a selectable list row, or a control that must call plain JS synchronously from `onclick` to survive the popup blocker. An icon-only button — raw or not — carries an `aria-label`; `title` alone is not exposed on touch.
- UI must support both light and dark mode.
- All interactive elements (buttons, actions, icons) must always be visible. Never hide them behind hover states — the app must work equally well on mobile, tablet, and desktop.
- Layouts must work on all screen sizes. Use Tailwind's responsive breakpoints — avoid fixed pixel widths.

## Empty states
- Every view that can be empty must show an empty state with an SVG icon and a short descriptive text in Swedish.
- Use the three-state pattern: loading (`null` → "Laddar..."), empty (`.Count == 0` → icon + text), content.
- Match the style of existing empty states in the codebase.

## Images and media
- Uploaded images must be validated (file type, size) and compressed/optimized before storage. Always show a preview before upload.

## Feedback and destructive operations
- Use toasts for confirmations and short-lived messages (e.g. "Sparat"). Toasts are non-interactive and must disappear automatically.
- Use a confirmation dialog only when the operation cannot be undone (e.g. permanent data deletion with no rollback).

## Async behavior
- Buttons that trigger async operations must show a loading indicator (e.g. disabled + spinner) and prevent double-clicks.
- Prefer optimistic updates where possible — update the UI immediately and roll back on error, instead of waiting for the server response.

## Add modals
- These rules apply to modals that have an "Add" (Lägg till) button. Modals with other actions (e.g. "Save") are not affected.
- Items are only added when the user clicks the "Add" button (bottom-right of the modal).
- The "Add" button must be sticky/fixed at the bottom of the modal (always visible regardless of scroll).
- After clicking "Add", the modal closes.
- Keyboard shortcuts:
  - `Ctrl+Enter` — add and close the modal.
  - `Shift+Enter` — add without closing the modal.

## Search and filtering
- Search fields must filter in real-time as the user types (with debounce). Always show the number of results and a clear way to reset the search.

## Accessibility
- Form fields must have labels. Interactive elements must be reachable via keyboard.
- When a modal closes, return focus to the element that opened it. When an item is created or added, focus or scroll to the new item.
- Document all keyboard shortcuts with tooltips (e.g. show the shortcut when hovering over a button). Shortcuts must not conflict with each other.

## Authorization
- All actions (read and write) must be permission-checked. Users must never be able to access or modify data they are not authorized for.
- Enforce permissions on the server side — never rely solely on hiding UI elements for access control.
- An anonymous endpoint whose only credential is a secret in the URL (a watch code, a calendar token, an API key) gets `.AddEndpointFilter<GuessThrottleFilter>()` so wrong guesses from one address are cut off; the anonymous image proxies serve only what `LiveMediaScope.IsOnScreen` says is on screen. Request-rate limits per address are the wrong tool for the public pages — a congregation on one wifi is one address.
- Never call `IJSRuntime.InvokeAsync("eval", …)`. Add a named function to `wwwroot/utils.js` under `window.gospelPresenter` instead; a Content-Security-Policy cannot allow eval.

## Database
- All database operations must be atomic. Use transactions when multiple writes depend on each other to ensure data consistency.
- Lists that the user can reorder must persist their order to the database, not just in memory.

## Offline sync tracking
- Entities implementing `ISyncTracked` get `ModifiedAt` stamped automatically by `PresentationContext.SaveChanges`, and tracked deletes produce `SyncTombstone` rows automatically.
- `ExecuteUpdateAsync`/`ExecuteDeleteAsync` BYPASS this: every `ExecuteUpdateAsync` on a synced entity must include `.SetProperty(x => x.ModifiedAt, DateTimeOffset.UtcNow)`, and every `ExecuteDeleteAsync` must add tombstones via `context.AddTombstones(...)` in the same transaction (or be converted to a tracked delete).
- When a child row changes (song part, presentation item/part, arrangement), also bump the aggregate root's `ModifiedAt` (see `PresentationService.BumpPresentationAsync` and `SongService.TouchSong`) — push conflict detection compares the root.
- A child write and its root bump (`BumpPresentationAsync`) go in one transaction, and `IOrganizationChangeNotifier.Notify` is called after the commit, never before: an announcement that arrives while the row is still unsaved makes devices pull, find nothing, and wait out the idle interval.
- Add a pinning test in `SyncTrackingCallSiteTests` for every new mutation path.
- Never let a `DeleteBehavior.SetNull` cascade detach synced children (song parts from a label, presentations from a theme): the trigger bumps `Version` but nothing stamps `ModifiedAt`, so no device is ever told and every device's base version goes stale. Detach explicitly with `ExecuteUpdateAsync` stamping `ModifiedAt` (and bump the root) in the same transaction, before the delete — see `SongPartLabelService.DeleteLabelAsync`.
- Rows that predate `AddSyncTracking` carry `ModifiedAt = DateTimeOffset.MinValue` (`-infinity` in Postgres) wherever the table had no `UpdatedAt`/`CreatedAt` to backfill from. That is correct and must be left alone: an unbounded first pull delivers them, later pulls skip them because a stamp older than the client's watermark is by definition already known, and re-stamping them server-side would make `BaseModifiedAt` disagree with the root on every synced client — turning the next offline edit of each row into a false conflict. Never filter on `ModifiedAt` for non-sync purposes without allowing for these rows.

## Mac Catalyst app
- Editing `Platforms/MacCatalyst/Info.plist` does not reach the built bundle on its own — MSBuild reuses a stale `obj/Debug/net10.0-maccatalyst/<rid>/AppManifest.plist`. Delete that file (and the `.app`, which is also not re-signed incrementally) and rebuild, then verify with `plutil` that the key actually landed.
- The app is ad-hoc signed until there is an Apple developer account. Never add an entitlement that needs a provisioning profile — macOS SIGKILLs the app at launch for requesting one it cannot prove it owns.
- Blazor is served from `app://0.0.0.0/`, which is not a secure context: `crypto.randomUUID` is undefined and storage APIs can throw. Feature-detect in shared JS rather than assuming the browser environment.

## Validation and error handling
- Validate input both in the UI (for fast feedback) and on the server (for security). Never rely solely on client-side validation.
- Show user-friendly error messages in Swedish when operations fail. Never expose stack traces or technical details in the UI.
- All API and database calls must have error handling so the UI never ends up in a broken state.

## Logging
- Log all significant events (logins, data changes, errors) on the server side for debugging. Never log sensitive data such as passwords.

## Language
- All UI text must be localized using `IStringLocalizer<SharedResource> L` (injected via `_Imports.razor`).
- Use `@L["Key"]` in Razor templates and `L["Key"]` in `@code` blocks. For formatted strings, use `L["Key", arg1, arg2]`.
- When a localized string with no arguments contains markup, render it with `@((MarkupString)L["Key"].Value)`.
- Never pass user-authored data (names, titles, filenames) as an argument to a localized string that is rendered as a `MarkupString` — the argument is not encoded and the markup executes. Keep markup out of the `.resx` value and render it in Razor instead, so the framework encodes the value: use `<LocalizedEmphasis Key="..." Value="@name"/>` for the common "…<strong>{0}</strong>…" case.
- Bible slide content is stored as HTML and is the only stored data that is ever rendered as a `MarkupString`. It must always pass through `BibleSlideHtml.Sanitize` on the way to a `MarkupString`, and the sync push rejects Bible parts `BibleSlideHtml.IsWellFormed` does not accept. If `BibleTextService` ever emits a new tag or attribute, extend the grammar in `BibleSlideHtml` in the same change — otherwise the new output renders as text.
- Translations are stored in `.resx` files under `GospelPresenter.Shared/Resources/`: `SharedResource.resx` (English) and `SharedResource.sv.resx` (Swedish).
- The app defaults to the browser's `Accept-Language` header, with English as the fallback language.
- Never hardcode UI-visible strings — always add them to both `.resx` files.
- Code, comments, and variable names must be in English.

## Real-time / SignalR
- Changes that affect the live presentation must sync in real-time to all connected clients. Always verify that changes are reflected immediately.

## URL routing
- Important views must have their own URLs so they can be bookmarked and shared. Navigation must not unexpectedly lose state.
