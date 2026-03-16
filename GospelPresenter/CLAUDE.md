# Project Rules

## UI consistency
- Match the size and style of buttons to existing ones in the app. Avoid introducing new button variants.
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
- Use toasts for confirmations and short-lived messages (e.g. "Sparat", "Ångra"). Toasts must disappear automatically but also be manually dismissible.
- Prefer the undo pattern (an "Ångra" toast) over confirmation dialogs for a smoother flow.
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

## Database
- All database operations must be atomic. Use transactions when multiple writes depend on each other to ensure data consistency.
- Lists that the user can reorder must persist their order to the database, not just in memory.

## Validation and error handling
- Validate input both in the UI (for fast feedback) and on the server (for security). Never rely solely on client-side validation.
- Show user-friendly error messages in Swedish when operations fail. Never expose stack traces or technical details in the UI.
- All API and database calls must have error handling so the UI never ends up in a broken state.

## Logging
- Log all significant events (logins, data changes, errors) on the server side for debugging. Never log sensitive data such as passwords.

## Language
- All UI text must be localized using `IStringLocalizer<SharedResource> L` (injected via `_Imports.razor`).
- Use `@L["Key"]` in Razor templates and `L["Key"]` in `@code` blocks. For formatted strings, use `L["Key", arg1, arg2]`.
- When rendering HTML from localized strings, use `@((MarkupString)L["Key"].Value)`.
- Translations are stored in `.resx` files under `GospelPresenter.Shared/Resources/`: `SharedResource.resx` (English) and `SharedResource.sv.resx` (Swedish).
- The app defaults to the browser's `Accept-Language` header, with English as the fallback language.
- Never hardcode UI-visible strings — always add them to both `.resx` files.
- Code, comments, and variable names must be in English.

## Real-time / SignalR
- Changes that affect the live presentation must sync in real-time to all connected clients. Always verify that changes are reflected immediately.

## URL routing
- Important views must have their own URLs so they can be bookmarked and shared. Navigation must not unexpectedly lose state.
