# 2. Admin list pages

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

`/admin` holds fourteen list pages — `Songs`, `Users`, `Templates`, `Overlays`, `Labels`, `ApiKeys`,
`Displays`, `Images`, `Audios`, `Themes`, `Bibles`, `CcliReport`, `SongTrash`, `SongHistory` — that
were each written on their own. They solve the same problem (a titled panel listing rows, with a way
to create, act on and find items) and they solve it differently every time:

- Row padding is `px-5` on some pages and `px-7` on others.
- The primary action is hidden when the list is empty on seven pages and always shown on three.
- Empty states come in four shapes: a 200×160 illustration with a CTA, a 200×160 illustration
  without one, a `size-12` icon with two lines of text, and a `size-12` icon with one.
- Row actions appear as four inline icon buttons (`Labels`), one `Danger` text button (`ApiKeys`),
  an overflow `…` menu (`Images`, `Audios`), a wrapping inline row (`Displays`), or not at all
  because the whole row is an `<a>` to a detail page (`Songs`, `Users`, `Templates`, `Overlays`).
- Item counts are shown on five pages and not on the other nine.
- Search exists on three pages. **Not one of the fourteen offers user-selectable sorting** — every
  list uses a fixed `OrderBy` in its service, and those orders were chosen ad hoc: name for songs,
  newest-first for images, audios and API keys, oldest-first for displays.

The app is not starting from nothing on sorting, though. `Presentations.razor` — outside this ADR's
scope — already has a working sort control: a `Dropdown` with a sort glyph, the current choice as
its label and a checkmark on the active option, backed by a `PresentationSortOrder` enum and
localized by the convention `Presentations.Sort.{EnumValue}`. That control is the thing to extract,
not a thing to design.

The pages are low-traffic and rarely visited, which is exactly why predictability matters more than
elegance here: an admin who opens `/admin/labels` twice a year should not have to relearn where the
delete button lives.

Constraints that shaped the decisions below:

- `CLAUDE.md` forbids hover-only affordances — every interactive element must be visible at all
  times, on mobile as much as on desktop. This rules out the usual "reveal row actions on hover"
  escape from crowded rows.
- `CLAUDE.md` requires keyboard reachability for interactive elements. The existing SortableJS
  helper (`initSortableList` in `utils.js`) does not satisfy this.
- `CLAUDE.md` requires bookmarkable URLs for important views and that navigation must not
  unexpectedly lose state.
- `PageContainer` caps content at `sm:w-180` (720px). Admin panels are never wide, on any display.
- `AdminLayout` already reserves the bottom of the mobile viewport (`pb-24 lg:pb-3` in
  `PageContainer`) for a floating menu toggle.

## Decision

### Scope

The fourteen `/admin/*` list pages. Deliberately excluded: `Presentations.razor` (the main
user-facing list, left alone for now), `SuperAdmin/*`, and the list views inside the presentation's
add-item modals — those are compact, embedded in their own scroll containers and driven by
`Ctrl+Enter`/`Shift+Enter` flows, so they answer to different constraints.

### Composable primitives, not a generic list page

A single `AdminListPage<T>` was rejected. The pages differ structurally in ways that would force
escape-hatch parameters within a month: `Songs` and `Bibles` carry an import panel *above* the list,
`ApiKeys` a `<details>` block with MCP configuration, `CcliReport` a toggle plus `PillTabs` plus
date grouping, `Themes` a preview grid rather than rows.

Instead, small components the page assembles itself:

| Primitive | Owns |
|---|---|
| `AdminPageHeader` | Title, description, primary action. Nestable per section |
| `AdminPanel` | The card: `bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border-t-[0.5px]` |
| `AdminListToolbar` | Count, search field, sort control, URL state |
| `AdminList` / `AdminListRow` | Row anatomy, padding, link-vs-div handling, the action zone |
| `AdminEmptyState` / `AdminNoResults` / `AdminLoading` | The three non-content states |

`CLAUDE.md` gets a rule making them mandatory for `/admin/*` list pages, in the same spirit as the
existing `AppButton` rule — five new components nobody is obliged to use would drift again.

If five or more pages turn out to share an *identical* composition, a composite `AdminListPage` can
be extracted **later**, when its real parameter list is known. Guessing it now is how the
fifteen-parameter component gets built.

### Primary action

Always in the header, top right, on every screen size, **never conditionally hidden**. The empty
state keeps its own CTA; the two never compete, because when the list is empty the empty state is
the focal point anyway. `AppButton` already sets `whitespace-nowrap`, and with `truncate` on the
title the pair fits at 375px.

A floating action button on mobile was considered and rejected: it would mean two places to look for
the same action depending on viewport width, and it overlaps list content while scrolling.

Pages may have several *sections*, each with its own header and primary action — `Displays` has two
(screens and public outputs), `Songs` and `Bibles` have an import panel with its own upload button.
`AdminPageHeader` is therefore per section, not per page.

### Toolbar

Two rows at every breakpoint. Row one: count on the left, sort control and secondary links (e.g.
`Songs`' trash link) on the right. Row two: the search field, full width.

No responsive branching. The 720px container cap means a full-width search field is not ugly on
desktop, which removes the only reason to have a second layout.

The count is **always** shown, for two reasons: it is free information, and it gives the sort
control a home that exists on every page. When a filter is active it reads `3 of 214` rather than
`214` — see "Already landed" below.

### Sorting

A page gets a sort control only when **both** tests pass:

1. The list can plausibly grow past **10 items**.
2. The entity yields **at least three meaningful options**. Two that are each other's mirror image
   (A–Z and Z–A) count as one.

It is **never** offered where the user defines the order — either the user decides the order or the
sort does, not both. In practice that is `Labels` (real `SortOrder` with up/down buttons) and
`Themes` (organization themes pinned first). Nor on lists that are always short (`ApiKeys`,
`Bibles`, `Displays`) or that already have their own filtering (`CcliReport`).

These are row lists, not tables, so clickable column headers — the conventional sorting gesture —
are not available and would not work on mobile regardless. The control is explicit, and it is the
existing `Presentations.razor` dropdown extracted into a shared component rather than a new design.

Sort options are chosen per entity, from fields that actually exist. Five pages qualify:

| Page | Options | Default |
|---|---|---|
| `Songs` | Name A–Z · Name Z–A · Author · Year | Name A–Z |
| `Images` | Newest · Oldest · Filename A–Z | Newest |
| `Audios` | Newest · Oldest · Filename A–Z | Newest |
| `Templates` | Last modified · Last created · Name A–Z | Last modified |
| `Users` | Name A–Z · Name Z–A · Role | Name A–Z |

`Overlays` does **not** get one: `OverlaySlide` carries only `Title`, `SortOrder` and `HasImage`, so
the control would hold a single option.

Sorting by role on `Users` is grouping wearing a sort's clothes, and that is fine — it answers the
question a user list is actually asked ("who are the admins?") and it is what lifts the page over
the three-option bar.

`Templates` needs one small enabler: `PresentationSummary` currently projects only `Id`, `Name` and
`UpdatedAt`, so "last created" is unavailable even though `Presentation.CreatedAt` exists. Adding it
to the projection is one line in `GetAllTemplateSummariesAsync` — no migration — but the record is
also consumed by `Presentations.razor` and `Dashboard`, so the change is not confined to `/admin`.
It lands when `Templates` is migrated, not before; a field with no reader is dead weight.

#### Missing timestamps, and why we are not adding them

`DbSong` has no `CreatedAt` and no `UpdatedAt` — only `DeletedAt`. `User` and `OverlaySlide` have no
timestamps either. So "recently added" is impossible for songs, which is a real loss: it is the
sort you want immediately after importing 200 ProPresenter files.

Two ways out were rejected for now:

- **An EF migration adding `CreatedAt`.** Existing rows would be backfilled with the migration's own
  timestamp, so the sort would order every pre-existing song identically and lie about all of them.
  A real cost for a sort whose values are fiction until new rows arrive.
- **Deriving "last modified" from `SongVersion`.** The history exists and its timestamps are
  genuine, but it answers "last edited", not "last added", and the in-memory `SongService` cache
  would have to carry the field.

Sorting is a convenience none of these pages has ever had. Paying for it with a migration that
backfills invented data is the wrong trade. Revisit if songs gain timestamps for another reason.

Independently of the control, **every** list gets a deliberately chosen default order, documented in
its service. The current orders are accidental.

### Toolbar state lives in the URL

Search text and sort selection go into query parameters, applied with `replace: true` so typing does
not fill the history stack. `[SupplyParameterFromQuery]` is already used in `Presentation.razor`.

**A parameter is omitted when it holds its default value.** Visiting `/admin/songs` leaves the URL
as `/admin/songs`, not `/admin/songs?q=&sort=name`. Links stay clean and "is this the default view?"
is readable straight from the address bar.

This also fixes a real gap: today, navigating into a song and back loses the search text.

### Row anatomy

Fixed slots, always in this order:

```
[reorder] [avatar/thumbnail] [title / subtitle] [badge] [actions]
```

- **At most one action inline**; two or more collapse into a `…` overflow menu. The action zone sits
  flush right in every variant, so its *position* is predictable even when its contents are not.
- **If the row navigates to a detail page, "edit" is redundant** — the row is the way in. Only
  secondary and destructive actions go in the menu. This takes `Labels` from four buttons to a
  reorder control plus one `…`.
- **Destructive actions come last in the menu**, separated, in red — as `Images` already does.
- Rows that are plain `<a>` elements today become a div with an overlaid link once they carry a
  button, so nested interactive elements do not occur. `AdminListRow` absorbs this once instead of
  five times.

Always showing every action is not negotiable (`CLAUDE.md`), which is why the overflow menu — itself
always visible — carries the overflow rather than hover doing it.

### Reordering

Up/down buttons, in their own slot at the **far left**, separate from the action zone.

Drag via the existing `initSortableList` was rejected for these lists: SortableJS drag is not
keyboard reachable, and copying that pattern would spread an accessibility gap that `Sidebar`
already has. Building drag *plus* custom keyboard reordering for `Labels` — the only reorderable
list in `/admin` — is not worth it.

The documented criterion going forward: **up/down below ~20 items, a drag handle above.** That keeps
`Sidebar` (presentation items, can get long) correct with drag and the admin lists correct with
buttons — two patterns, but chosen by a rule rather than by whoever wrote the page.

Left placement is deliberate: the action zone on the right must be the immovable fixed point,
because it appears on every page. Reordering appears on one.

### Four states, not three

`CLAUDE.md` documents loading → empty → content. Pages with search need a fourth: *the search
matched nothing*, which is not the same as *the collection is empty*. `AdminNoResults` owns it —
one line of text plus a `Clear search` action, identical everywhere. Today it is unstyled text in
`Songs`, `Images` and `Audios` with no way back except the × in the field.

Empty states come in two tiers, chosen by what the emptiness *means*:

- **Large illustration + CTA** when the collection is empty and the user is expected to fill it:
  `Songs`, `Images`, `Audios`, `Users`, `Labels`, `Templates`, `Overlays`, `ApiKeys`, `Displays`,
  `Bibles`.
- **Small icon + one line, no CTA** when emptiness is a normal condition rather than a prompt:
  `SongTrash` (an empty bin is good news), `SongHistory`, `CcliReport`.

An empty song library is an invitation; an empty trash is a receipt. Giving them the same visual
weight would be uniform and wrong. Four new illustrations are needed (`Songs`, `Images`, `Audios`,
`Bibles`), drawn in the existing style: geometric line art, `stroke-width="2"`,
`fill-neutral-100 dark:fill-neutral-800`, detail strokes at `opacity` 0.3–0.5.

### Loading, and the delayed-appear utility

A standardized text line (`Common.Loading`, one padding, one size) rather than skeleton rows.
`Songs` loads synchronously from an in-memory cache and the other pages make a single EF call
against a local database; a skeleton visible for 20ms is flicker, not polish. The rule is
**text by default, skeletons only where a page demonstrably takes >300ms** — and since `AdminLoading`
is a primitive, `Images` can switch later without touching anything else.

The flicker problem itself is solved in CSS, not C#:

```css
.delayed-appear {
    opacity: 0;
    animation: delayed-appear 150ms ease-out var(--delay, 400ms) forwards;
}
@keyframes delayed-appear {
    from { opacity: 0; }
    to   { opacity: 1; }
}
```

The element renders immediately but stays invisible during the delay; if content arrives first it is
removed before the animation starts and the user never saw anything. No C# timer, no
`StateHasChanged`, no race — and critically, no round trip over SignalR to drive the delay, which is
what the existing `Task.Delay` approach in `AutoSaveIndicator` would have cost here.

This is a general utility in `app.css`, not baked into `AdminLoading`, so the next place that needs
it does not reinvent it. Applied to `AdminLoading` and to the `Songs`/`Bibles` import progress bars.
**Not** applied to `AppButton`'s spinner — on a button, immediate feedback is the entire point.
Under `prefers-reduced-motion` the delay is kept and the fade dropped.

### Localization

New shared strings go in `Common.*` (`Common.ClearSearch`, `Common.ResultsOfTotal`). Sort **option**
labels are per entity, so they follow the convention `Presentations.Sort.*` already established —
`Songs.Sort.NameAsc`, `Users.Sort.Role` and so on, looked up as `L[$"{Page}.Sort.{option}"]` exactly
as `Presentations.razor` does today. Existing keys are otherwise left alone during the refactor.

Renaming the four `Admin.*` groups (`Admin.Labels`, `Admin.Themes`, `Admin.Displays`,
`Admin.PublicOutputs`, 46 keys) down to bare `<Page>.*` — the convention the other twelve pages
already follow — is mechanical and greppable but pure churn, so it lands as its own commit rather
than inside a large refactor. Verification: `grep -rn '"Admin\.'` returns nothing, plus a build.

Leaving it undone entirely was rejected: a documented convention that four groups violate is a
convention the next person ignores.

### Verification

Two nets, catching different classes of failure:

- **bUnit tests on the primitives**, not on the pages. The logic lives in `AdminListToolbar` (count
  formatting, URL parameters in and out, default omission) and `AdminList` (empty vs no-results vs
  content, the overflow threshold). Testing a primitive once covers all fourteen pages. Per-page
  tests would need each page's services mocked and would assert markup that is *meant* to change —
  they get deleted at the first refactor.
- **The screenshot rig as a visual diff.** `GospelPresenter.Screenshots` already captures
  `sv`/`en` × `light`/`dark` × `desktop`/`mobile`, which is exactly the 112-view matrix nobody
  checks by hand. The fourteen admin pages go into the scenario list behind a flag, captured on
  `main` and on the branch and compared. Behind a flag, not permanently — otherwise every marketing
  capture grows from 7 scenarios to 21 for nothing.

bUnit catches logic (wrong count, sort lost on navigation, the wrong empty state). Screenshots catch
layout (row height jumps, the action zone wrapping at 375px, dead contrast in dark mode). Neither
catches the other's category, and layout is the category this refactor actually risks.

## Consequences

- Fourteen pages get the same header, toolbar, row padding, action placement and state handling, and
  a new page gets them by composition rather than by copying.
- Sorting becomes available for the first time, on the six lists that can grow.
- Search and sort survive navigation and can be shared as links.
- Three pages keep documented exceptions (below), so "all admin list pages look alike" is true with
  named caveats rather than quietly false.
- Four illustrations must be drawn before `Songs`, `Images`, `Audios` and `Bibles` are done.
- Five new components exist that a future page could ignore; the `CLAUDE.md` rule is what prevents
  that, and it is only as strong as the review that enforces it.

### Documented exceptions

- **`Themes`** is a two-column preview card grid, not a row list. It adopts `AdminPanel` and
  `AdminEmptyState` and nothing else.
- **`Displays`** has two sections with separate primary actions. It adopts `AdminPageHeader` twice.
- **`CcliReport`** groups rows by date behind `PillTabs` filters. It adopts `AdminPanel` and
  `AdminEmptyState`; it does not get `AdminList` or a sort control.
- **`Overlays`** is an ordinary row list in every respect but has too few sortable fields to earn a
  sort control. Nothing else about it is exceptional.

## Out of scope / follow-ups

- `Presentations.razor` and the add-item modal lists.
- The `Admin.*` → `<Page>.*` key rename (own commit, after the refactor).
- **`OverlaySlide.SortOrder` is dead.** `GetOverlaysAsync` orders by it, but nothing writes it and no
  view can change it, so every overlay holds the `int` default and the resulting order is arbitrary.
  It looks like user-defined ordering to anyone reading the query — which is why it nearly excluded
  `Overlays` from sorting under the "user owns the order" rule. Either wire up reordering or drop
  the column; leaving it is a trap for the next reader.
- Timestamps on `DbSong`, `User` and `OverlaySlide` — see "Missing timestamps" above.
- **Search debouncing was considered and deliberately dropped.** `SongService` keeps an in-memory
  cache with a prebuilt `SearchIndex`, so search is a scored in-memory scan with no I/O; `Images`
  and `Audios` filter an already-loaded list. Nothing is being hammered. What a C# debounce would
  save is the re-render and DOM patch, not the SignalR round trip — `@oninput` sends every keystroke
  regardless. If profiling later shows the round trip is the cost, the answer is JS-side debouncing
  on the `<input>`, not a larger C# delay. Note that `CLAUDE.md`'s "filter in real-time as the user
  types (with debounce)" currently reads as a requirement the code does not meet, which invites
  someone to "fix" a non-problem.
- E2E coverage. `GospelPresenter.E2ETests` turned out to be a stale `bin`/`obj` directory with no
  `.csproj`, untracked and absent from the solution; it has been deleted. Any E2E work starts from
  zero.

## Implementation order

1. Build the primitives and the `.delayed-appear` utility. The sort control is lifted out of
   `Presentations.razor` into a shared component first, and that page switched over to it, so the
   extraction is proven against its original caller before any admin page depends on it.
2. **Pilot `Songs`** — stresses the toolbar hardest (search, count, sort, URL state, rows as links,
   empty, no-results) *and* has a section above the list, which tests whether `AdminPanel` really
   nests per section.
3. **Pilot `Labels`** — stresses row anatomy hardest (reorder in the left slot, `…` menu, empty
   state with CTA, and the only page where the ≥2-actions rule actually fires).
4. Evaluate. If either pilot needs an escape-hatch parameter used by nothing else, the answer is to
   let that page keep raw markup for its odd part — not to bend the primitive. The abstraction
   serves the twelve simple pages, not the two hard ones.
5. `Users` → `Templates` → `Overlays` → `ApiKeys` → `Displays` → `Bibles` → `Images` → `Audios`.
   `PresentationSummary` gains `CreatedAt` as part of the `Templates` step — and `Presentations.razor`
   and `Dashboard` are checked, since they consume the same record.
6. `Themes`, `CcliReport`, `SongTrash`, `SongHistory` — these mostly just adopt `AdminPanel` and
   `AdminEmptyState`.
7. Four new illustrations.
8. Separate commit: the `Admin.*` key rename.

### Already landed

Three items were fixed ahead of the refactor because they stand on their own:

- `Songs`, `Images` and `Audios` showed the total in the panel header while the list below was
  filtered ("All songs (214)" above three rows). All three now use a `CountLabel` that reads
  `3 of 214` while a filter is active and `214` otherwise, via the new `Common.ResultsOfTotal`.
- `/admin/images` and `/admin/audios` borrowed `ImageTab.*` and `AudioTab.*` keys from the
  presentation's add-item modal. Both surfaces delete the same file from the same library, so they
  *should* share wording — the fault was the name, not the sharing. The shared subset moved to
  `Common.Upload`, `Common.UploadingProgress` and `Media.*`; the two `Upload` pairs were
  character-identical, so four entries became two.
- The stale `GospelPresenter.E2ETests` directory was deleted.
