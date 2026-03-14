# Project Rules

## Destructive operations
- Always require user confirmation before destructive operations (e.g. deleting items, removing data).

## Add modals
- These rules apply to modals that have an "Add" (Lägg till) button. Modals with other actions (e.g. "Save") are not affected.
- Items are only added when the user clicks the "Add" button (bottom-right of the modal).
- The "Add" button must be sticky/fixed at the bottom of the modal (always visible regardless of scroll).
- After clicking "Add", the modal closes.
- Keyboard shortcuts:
  - `Ctrl+Enter` — add and close the modal.
  - `Shift+Enter` — add without closing the modal.

## UI consistency
- Match the size and style of buttons to existing ones in the app. Avoid introducing new button variants.
- UI must support both light and dark mode.