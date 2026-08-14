# 1. Slide themes

- **Status:** Accepted
- **Date:** 2026-08-14
- **Supersedes:** the per-organization slide style settings (`/admin/slide-settings`)

## Context

Slide appearance is currently configured per organization as 16 key-value rows in
`OrganizationSetting` (`SongFontSize`, `SongFontFamily`, `SongFontWeight`, `SongLineHeight`, and the
same four for song credits, Bible text and Bible credits). They are edited on
`Pages/Admin/SlideSettings.razor` and modelled as `SlideTextStyle(FontSize, FontFamily, FontWeight,
LineHeight)`, which renders to inline CSS via `ToCss()`. There is no control over colour and no
control over backgrounds at all — `bg-black` and `text-white` are hardcoded in `Slide.razor`,
`LiveDisplay.razor`, `PublicSlideView.razor` and in `Class` strings passed by callers.

The styles reach every render surface as four `SlideTextStyle` fields on the `LiveSlide` record,
which travels through the in-memory `SharedAppState` to the operator view, remote displays, stage
mode and the anonymous public output.

We want themes instead: a named, product-provided bundle that controls how each *type* of slide is
displayed — text sizes, fonts, colours, and a background colour or background image per slide type.
A theme is chosen for a whole presentation, not per slide, and it replaces the current way of
setting text size.

Constraints that shaped the decisions below:

- Bible text is split into slides on a hardcoded `MaxCharsPerSlide = 250` in `BibleTextService`,
  tuned for 85px Tahoma, and the resulting parts are **frozen** in `PresentationItemPart.Content`
  when the item is added. Changing theme afterwards does not re-chunk anything.
- `Slide.razor` clips overflowing text silently (`overflow-hidden`, `items-center`).
- Permissions are role-derived only (no per-user grants), and policies are registered automatically
  from the `Permission` enum, so adding a permission is nearly free.
- Object storage is optional: `NullObjectStorageService` is registered when S3 is unconfigured,
  which is the case in mock mode, in `GospelPresenter.Screenshots` and in the integration tests.
- The mock SQLite database is deleted and reseeded whenever the EF model changes
  (`MockDatabaseInitializer` schema fingerprint), and integration tests run on SQLite.

## Decision

### Data model

1. **A `Theme` table with a nullable `OrganizationId`.** `null` means built-in and global.
   Organization-owned themes later reuse the same table, so there is one lookup path, one admin
   page and one permission model.
2. **The 16 `OrganizationSetting` keys and `SlideSettings.razor` are removed.** Existing values are
   *not* converted — they were not in real use. One new key replaces them:
   `OrganizationSetting.DefaultThemeId`.
3. **The theme content is stored as JSON in one column while staying plain C# in the model**, not as
   normalized tables and not as a hand-serialized string at the call sites. The tree is nested and is
   never queried in SQL. `SlideTextStyle` is reused as the text-role type, extended with colour,
   alignment and shadow.

   *Implementation note (amended during PR (a)):* this is a **value converter** on
   `Theme.Definition`, not `OwnsOne(...).ToJson()` as originally written. EF requires every nested
   type inside a JSON-owned entity to be configured explicitly — it otherwise treats
   `SlideBackground` as an entity needing a primary key — which would mean editing
   `PresentationContext` for each property the theme editor adds later. The converter is one mapping
   with a `ValueComparer`, the column is `jsonb` on Postgres, and enums are written as names so a new
   enum value cannot renumber stored data.
4. **Built-in theme values are authored in C# and upserted idempotently**, keyed by stable slugs
   (`classic`, `midnight`, `daylight`, `aurora`). Built-in themes are therefore **live**: improving
   one changes the look for every presentation using it, without any user action. This is accepted;
   the discipline is to make only backwards-compatible adjustments.
5. **Slide types are `Song`, `BibleText` and `Media`** (`Image` and `Slides` share one type — they
   render identically). Credits are a **role inside** a type, not a type of their own. Overlays, the
   black screen and audio items are outside the theme: overlays are a separate legibility problem,
   and the black screen must stay black so that blanking remains a safe panic button.
6. **Properties.** Per slide type: background colour, background image, image fit
   (`cover`/`contain`), and **scrim opacity 0–100%** over the image. Per text role: font family,
   size, weight, line height, colour, text alignment, text shadow on/off. Deliberately excluded:
   padding/safe area, element positioning, gradients, letter spacing, text transform. A theme that
   wants a gradient uses a background *image*.
7. **`Presentation.ThemeId` is nullable and `null` means "inherit the organization default"**,
   resolved at render time. A value on the presentation is an override. Falling back when the
   `DefaultThemeId` key is missing uses the slug `"classic"` from code — never "the first row in the
   table", which would make appearance depend on seeding order. Creating a presentation from a
   template **copies the template's `ThemeId`**.

### Text that does not fit

8. **Sizes stay fixed; overflow keeps being clipped — but with an invariant:** no built-in theme may
   render main text wider or taller than today's 85px Tahoma does, compensated for the font's glyph
   width (Oswald is narrow, Merriweather wide). Nothing that fits today starts clipping.

   The invariant is **enforced by a unit test**, not by good behaviour: for every built-in theme, a
   worst-case text (a 250-character Bible slide per `MaxCharsPerSlide`, and the longest song part we
   intend to support) must fit the canvas minus padding with the same margin `Classic` has today.

   Shrink-to-fit is a separate future feature. When it lands, a theme's `FontSize` is reinterpreted
   from "the size" to "the ceiling" — no schema change, no theme rewritten. Making the Bible chunk
   limit theme-derived was rejected: chunking and theme have different lifetimes, and the parts are
   frozen in the database.

### Background images

9. **Images live in Garage** under the global prefix `themes/{slug}/`, in the existing `full`
   (1920×1080) and `thumb` (400×225) variants. Built-in themes have no organization, so they cannot
   live under `org/{orgId}/…` — and because they have no `OrganizationImage` row they can never
   appear in an organization's image list, which is what we wanted.
10. **A theme references an image as a discriminated value**, never as a URL:
    `{ Kind: BuiltInAsset | OrganizationImage, Value: … }`. A single helper owns the translation to a
    URL for each context (editing, live session, public output), so adding user-uploaded theme
    backgrounds later is a change in one place rather than across five render surfaces.
11. **Served from `/api/theme-images/{slug}/{variant}`** — anonymous, `Cache-Control: immutable`,
    with a **content hash in the object key and URL** because built-in themes are live. Built-in
    theme art is product graphics, not congregation data; proxying it through session-scoped URLs
    would add a branch to the public-output proxy for no security gain.
12. **The endpoint falls back to the asset shipped with the application when the object is missing
    from S3.** The shipped asset is the source of truth, Garage is the delivery path. Without this,
    `Aurora` is broken in mock mode, in the screenshot tool and in the integration tests, all of which
    get `NullObjectStorageService` — and that implementation *throws* rather than returning nothing,
    so the fallback catches `NotSupportedException` as well as a missing object.

    *Implementation note (PR (b)):* the assets are **embedded resources** in
    `GospelPresenter.Shared`, not static web assets, so the web app, the migration service that
    uploads them, the tests and the screenshot tool all read the same bytes. The art itself is
    generated by `scripts/generate-theme-backgrounds.py` — deterministic, original, and therefore
    safe to redistribute with every self-hosted installation. A unit test ties each file's hash to the
    constant in `BuiltInThemes`, so regenerating the art without updating the URL fails the build.
    In mock mode `/api/theme-images/` is added to the public-path list, otherwise the projector page
    and the screenshot tool are redirected to the mock sign-in page.
13. **A `Purpose` column on `OrganizationImage`** (to keep theme backgrounds out of the image list
    and picker) is **deferred** until users can upload their own theme backgrounds. Unlike the
    discriminated reference in (10), it saves nothing by existing early.

### Rendering

14. **`LiveSlide` carries one resolved, immutable `SlideTheme`** in place of the four
    `SlideTextStyle` fields. The public output renders one server-side HTML fragment shared by all
    viewers, so it needs the definition in hand at render time; and since built-in themes are
    immutable per deployment, this is a shared reference rather than a copy. Resolution happens once
    per presentation through an `IThemeService` with a singleton cache.
15. **`SharedAppState.OrganizationSlideStylesChanged` is replaced by an event on the presentation's
    theme**, which pushes a new `LiveSlide` so displays, stage mode and the public output update in
    real time.
16. **`bg-black` is removed** from `Slide.razor`'s `BaseClass` and from every caller's `Class`
    string, and the theme background is applied to the **inner 1920×1080 canvas** — not the outer
    scaled div — so `cover` behaves identically in a thumbnail and in full screen. "Black" becomes
    `Classic`'s background colour rather than a CSS class, which means a lookup bug yields a white
    slide; `SlideTheme` therefore has a hardcoded fallback instance in code, used **only** on lookup
    failure.
17. **Outside a presentation context, render with the organization's default theme** — not
    `Classic`, and not the code fallback. This covers `Admin/SongHistory.razor`. The add-song preview
    (`AddItem/Song/SongTab.razor`) uses the presentation's theme, so the preview shows what will
    actually be displayed.
18. **Stage mode needs no special handling**: `StageView` renders a scaled `LiveDisplay`, so it
    mirrors the audience output and is themed automatically.

### Permissions and UI

19. **Two new permissions, `ViewThemes` and `ManageThemes`**, following the repository's
    View/Manage-per-resource convention. `UserRole.User` gets `ViewThemes`; `Admin` gets both;
    `SuperAdmin` gets everything automatically.

    | Action | Permission |
    |---|---|
    | See the theme list / theme picker | `ViewThemes` |
    | Set the theme on a presentation | `ManagePresentations` + `ViewThemes` |
    | Set the organization default theme | `ManageThemes` |
    | `/admin/themes` | `ManageThemes` |
    | (later) create/edit organization themes | `ManageThemes` |

    Reusing `ManageTemplates` was rejected: `UserRole.User` does not have it, but ordinary users do
    pick themes for their own presentations.
20. **`/admin/themes` replaces `/admin/slide-settings`** (nav key `Nav.Themes`). In this version it
    lists themes, previews them with real `SongSlide`/`BibleTextSlide` components, and points out
    the organization default. **No CRUD.** "Duplicate into an editable theme" is the bridge to
    organization-owned themes and should be designed together with the editor.
21. **The theme is chosen in `PresentationDetailsDialog`**, with "Follow the organization default" as
    the preselected option. Not in `Sidebar`, where it could be changed by accident mid-service.
22. **Built-in theme names come from resx by convention** — `Theme.Name.{slug}` and
    `Theme.Description.{slug}` in both `SharedResource.resx` and `SharedResource.sv.resx`. The
    `Name` column stays empty for built-in themes and is reserved for organization-owned themes,
    where the name is user data.
23. **The MCP server exposes nothing about themes.** The existing tools build *content*; slide
    styling has never been exposed. Inheritance (7) makes agent-created presentations correct by
    default.

### The four built-in themes

Chosen for **coverage of the model** — every property must be exercised by at least one theme,
otherwise it is untested code that breaks when the editor arrives.

| Theme | Covers | Content |
|---|---|---|
| `Classic` | the reference point | Exactly today's values: Tahoma 85/400/1.2, black background, white text, credits 40px white/40% |
| `Midnight` | non-black background colour, heavier weight | Inter 600, deep blue background, white text |
| `Daylight` | **dark text on a light background** | Lato 400, warm white background, near-black text |
| `Aurora` | **background image + scrim + text shadow** | Montserrat, background image in `Themes/aurora/`, scrim 45%, shadow on |

It was called `Photo` while this ADR was being written. The art turned out to be an abstract
gradient rather than a photograph, and a built-in slug is permanent, so the theme is named after what
it actually is.

`Classic` keeps Tahoma even though it is the one font that is **not** self-hosted (the other six are
in `wwwroot/fonts`), so it degrades to Geneva → Verdana → sans-serif on Linux and Android displays.
That is a pre-existing problem and fixing it inside `Classic` would break the invariant in (8)
silently. All new themes use self-hosted fonts; Tahoma gets its own issue.

### Seeding and verification

24. **One `BuiltInThemeSeeder` in `GospelPresenter.Shared`**, plain idempotent `DbContext` code,
    called from `MigrationService` (Postgres) and from `MockDatabaseInitializer` (SQLite, rebuilt on
    every model change). It is invoked outside `MockDataSeeder`'s seed-once guard, so the themes are
    upserted on every start exactly as they are on every deploy. The integration tests inherit it for
    free: `WebAppFixture` boots the real application, which runs the mock initializer. Without that,
    every test opening a presentation would fall through to the code fallback and mask the bugs the
    tests exist for.
25. **Unit tests:** the resolution chain (presentation → organization default → code fallback), the
    invariant from (8), seeder idempotency, and that every built-in slug has `Theme.Name.{slug}` and
    `Theme.Description.{slug}` in **both** resx files.

    **Component tests (bUnit):** the two render surfaces where a theme can go missing without anything
    failing — `LiveSlideView` (projector, operator preview, stage mode) and `PublicSlideView` (the
    public output, which reflows instead of using the canvas and therefore re-implements the sizing).
    Each asserts that a slide type picks its own block, that the background and text colours come from
    the theme, that overlays keep their own legibility-first style, and that a slide with no theme falls
    back to Classic rather than rendering unstyled. `PublicSlideView` additionally asserts that the
    responsive size is capped at the theme's size and that the scrim is layered over the image.
    **Integration tests:** the permission gates, that the presentation's theme persists, and that
    nothing still reads the removed settings keys.
    **Screenshots** are regenerated — slides look identical (`Classic` equals today's values), but
    the admin sidebar nav item changes name in both languages × light/dark × desktop/mobile.

## Consequences

- Changing the organization default theme is **retroactive**: it changes last Christmas' service and
  the draft someone created yesterday. Accepted — a church has one look, not one per service, and
  presentations are short-lived here.
- We cannot promise a congregation that their slides will look exactly the same next year, because
  built-in themes are live.
- Built-in themes cannot differ much in text *size* until shrink-to-fit exists; they vary in font,
  colour and background around a common size.
- Background image bytes exist in two places (repository asset and Garage object). This is the
  price of one URL shape and one key space for built-in and user-uploaded backgrounds alike.

## Out of scope / follow-ups

- Shrink-to-fit (auto-scaling text), which turns a theme's size into a ceiling.
- The theme editor, "duplicate into an editable theme", and organization-owned themes — together
  with the `Purpose` column on `OrganizationImage`.
- Themed overlays and a themed blank screen.
- Self-hosting Tahoma or migrating `Classic` off it.
- Exposing themes over MCP (`list_themes`, a `themeId` on `create_presentation`).

## Open questions

Both are resolved:

- **Colour and font values** for `Midnight`, `Daylight` and `Aurora` were chosen in PR (b). The
  invariant in (8) constrained them more than expected: raising a line height or picking a wide face
  (Montserrat) costs vertical room Classic does not have, so `Daylight` and `Aurora` pay for their
  airier setting with a slightly smaller font size (80px and 78px) rather than with room they do not
  have. The test caught every one of these; none was caught by eye.
- **The background image and its licence** — the art is generated in-house, see (12).

## Implementation order

1. **PR (a):** model, migration, `BuiltInThemeSeeder`, `Classic`, the rendering path, permissions.
   No change to how a slide looks. The old `/admin/slide-settings` page and its navigation entry are
   removed here, so themes have no user interface at all until (b).

   Two pieces of the decisions above are deliberately **not** in (a), because nothing exercises them
   until a theme ships an image: the `/api/theme-images/{slug}/{variant}` endpoint (with its
   repository-asset fallback) and the deploy-time upload of theme art to Garage. The discriminated
   image reference and the URL helper are in place, so both land in (b) without touching the render
   surfaces.
2. **PR (b):** `Midnight`, `Daylight`, `Aurora`, the theme-image endpoint and upload, `/admin/themes`,
   the picker in `PresentationDetailsDialog`, the real-time theme-changed event, regenerated
   screenshots.
