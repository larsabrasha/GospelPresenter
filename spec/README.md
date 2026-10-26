# Behaviour specification

What Gospel Presenter does today, as seen by its users and as enforced by its server — written so the
app can be rebuilt from scratch (TypeScript, React + Vite, Hono on Cloudflare Workers and Node,
SQLite/D1, local-first clients) without porting the C# code.

The spec describes **behaviour, not implementation**. The C# code is the evidence; it is not the
blueprint. Each section separates what users depend on from what exists only because of Blazor, EF,
SignalR or MAUI ("Implementation artefacts").

The decision to rewrite, and the stack it is rewritten on, is recorded in
[ADR 0007](../adr/0007-rewrite-on-typescript-local-first.md).

## Sections

| # | Section | Rule prefix | What it covers |
|---|---|---|---|
| 1 | [Organizations, users, auth](01-organizations-users-auth.md) | `ORG-` `AUTH-` `PERM-` | tenancy, roles and the permission matrix, invites, `/setup`, Google/OIDC, device tokens, MCP keys, calendar feeds, super admin |
| 2 | [Songs](02-songs.md) | `SONG-` | library, parts, labels, arrangements, history, ProPresenter import, CCLI reporting |
| 3 | [Presentations](03-presentations.md) | `PRES-` | dashboard, editor, add-item modal, templates, overlays, trash, editor shortcuts, PDF/PowerPoint to slides |
| 4 | [Live and displays](04-live-and-displays.md) | `LIVE-` | live state, operator view, slide rendering, outputs (live windows, paired screens, public `/watch`), remote control, stage mode, desktop sessions |
| 5 | [Bibles, themes, media](05-bibles-themes-media.md) | `BIBLE-` `THEME-` `MEDIA-` | Bible import and verse search syntax, built-in themes and every themable property, images, audio, upload limits |
| 6 | [Sync, desktop, platform](06-sync-desktop-platform.md) | `SYNC-` `DESK-` `PLAT-` | offline sync guarantees and conflict cases, desktop app, MAUI, deployment, cross-cutting UI rules |

Every section has the same layout: Overview, Concepts, Screens and flows, Rules and invariants, Edge
cases, Acceptance scenarios, Implementation artefacts, Open questions.

## How to use it

- **Rules** (`SONG-R12`) are requirements for the new app unless a decision below says otherwise.
  Cite the id in commits and tests that implement one.
- **Acceptance scenarios** (`LIVE-A7`) are written Given/When/Then to become Playwright tests. A
  section is done when its scenarios pass against the new app.
- **Edge cases** are the behaviours most likely to be lost in a rewrite. Read them before building a
  feature.
- **Implementation artefacts** must not be carried over as requirements. Build for the user-visible need
  the section names instead.
- **Open questions** are decided below, or still open. Apparent bugs in the current app are fixed in
  the new one by default, not reproduced.

Citations are `path:line` against commit `5b7e224`. Section 2 cites paths relative to the
`GospelPresenter/` solution folder; section 3 uses the path legend at its top; the others cite from the
repository root. Line numbers drift as the current app changes, so look them up at that commit.

## Themes across sections

- **The server is the only place permissions hold — and today several checks are missing.** The new app
  puts every permission check in one shared policy module that both the mutation layer and the UI use,
  so a visible link always means an allowed action.
- **Errors have no contract.** Limits and validation failures surface as generic error bars or 500s in
  several places. The new app needs one error shape with Swedish/English messages.
- **Everything assumes one server process** (live sessions, change notifications, the Bible cache, the
  setup flag). On Workers each of these needs an explicit home, such as a Durable Object per
  organisation.
- **Times use the server's time zone or UTC** (dashboard "today", CCLI dates). The new app should use
  the organisation's time zone.
- **Concurrent edits are last-write-wins** in many places without telling the user. Mutation-based sync
  can make most of these exact.

## Decisions needed

Grouped by how much they shape the architecture. Each has a recommendation; nothing is decided until
it is recorded here or in an ADR. A **Decided** entry in the recommendation column is final.

### Shape the architecture

| # | Question | Recommendation | Sources |
|---|---|---|---|
| D1 | One organisation per user (super admins switch), or membership in several? | **Decided:** one organisation per user for now, super admins switch; the data model has a membership table (user, organisation, role) so several organisations can be enabled later without a migration | 01 Q5 |
| D2 | Where does live state live on Workers? | **Decided:** one Durable Object per organisation, holding any number of concurrent sessions, outputs and controllers; in-process on Node and in the desktop's embedded server. Public `/watch` fan-out may move to a Durable Object per output if it grows | 04 Q16, 06 Q9 |
| D3 | Signing in as another account on a device: wipe local data or partition per account? | **Decided:** one local database per account and organisation; switching back resumes unsynced work | 06 Q1 |
| D4 | Sync conflict semantics: keep "additions win" and whole-presentation merges? | **Decided:** client mutations replay against the server's latest state; deletions are exact, fields merge individually | 06 Q4–Q6, Q10 |
| D5 | Are `/live` and `/display` and remote control open to anyone with a session id / any org member? | **Decided:** live windows and paired screens carry a capability token; starting and controlling need `ManagePresentations`; public `/watch` stays open and read-only | 04 Q1–Q2 |
| D6 | Drop MAUI for Capacitor/PWA? | **Decided:** drop MAUI; PWA first, Capacitor when app stores or native plugins are needed (ADR 0007) | 06 Q13 |
| D7 | Should edits during live update what is on screen? | **Decided:** yes — outputs render from local data plus the live pointer (ADR 0007) | 04 Q4, 05 Q8 |
| D8 | Does the embedded LAN server replace the planned server field and server-provided update feed? | **Decided:** a discreet "Other server" link on the sign-in screen, prefilled with the hosted server; one installed app works against the cloud and any self-hosted server. Updates keep coming from GitHub Releases; a server-provided feed waits for code signing | 06 Q11 |
| D29 | How are PDF and PowerPoint files turned into slides without a server-side renderer? | **Decided:** see ADR 0007 | 05, 03 (PdfRenderService) |

### Product behaviour

| # | Question | Recommendation | Sources |
|---|---|---|---|
| D9 | Should song history cover the whole song (metadata, arrangements)? | **Decided:** history covers the whole song (metadata, parts, arrangements); restore keeps arrangements intact; replacing a song on import saves a version first | 02 Q2–Q3 |
| D10 | Should templates keep song arrangements and own their slide decks? | **Decided:** templates keep the chosen arrangement and own their slide decks (content-addressed files are shared, never deleted while referenced) | 03 Q1–Q2 |
| D11 | Logo screen in addition to black? | **Decided:** yes — a logo screen (organisation logo or a chosen image) with a button and a shortcut, like black | 04 Q6–Q7 |
| D12 | Record the Bible translation on items and show it as credits; English book names? | **Decided:** yes to both — items record their translation and show it as credits; book names resolve in the translation's language and in English | 05 Q1, Q3 |
| D13 | 500-verse cap: keep, raise, or warn? | **Decided:** keep a cap, show "showing N of M verses" and never add a truncated passage without asking | 05 Q2 |
| D14 | Offline "delete permanently": final, or recoverable from other devices? | **Decided:** final once synced; the server trash is the only trash | 06 Q3 |
| D15 | Ctrl+Enter: add and close (CLAUDE.md) or follow the "add more" checkbox? | **Decided:** remove "Lägg till fler"; add modals never close after adding — the user closes them (Esc or close). Ctrl+Enter and Shift+Enter just add. New app only; the current app and its CLAUDE.md rule stay as they are | 03 Q8 |
| D16 | Preview before upload for every image upload? | **Decided:** preview only where the user crops or positions; the media library uploads directly | 05 Q13 |
| D17 | Trashed songs still used in presentations: warn? | **Decided:** flag the item in the editor with a restore action and skip it live; deleting a song that is in use shows where it is used | 02 Q18 |
| D18 | Real-time co-editing of a song, or conflict warnings? | **Decided:** the editor updates live from sync; edits to different parts merge; a clash in the same part shows a clear warning. No CRDT co-editing | 02 Q16 |
| D30 | Where does an imported Bible live: on the device (BIBLE-R16) or on the server? | **Decided:** always on the server the device belongs to — the hosted server, a self-hosted one, or the desktop app's own embedded server when running alone. An offline import is stored locally and uploaded when connected. No device-only Bibles (ADR 0007) | 05 BIBLE-R16 |
| D31 | Where is media stored when self-hosted without Garage? | **Decided:** a folder on disk by default (and in the desktop app); S3 as an option; R2 through its binding on Cloudflare (ADR 0007) | 05 MEDIA-R14, 06 PLAT-R1 |
| D32 | How is each platform packaged and distributed? | **Decided:** electron-builder for macOS (signed, notarized), Windows (NSIS, not signed) and Linux (AppImage); Capacitor for Android and later iOS (TestFlight and App Store); static assets with the Worker on Cloudflare; a Docker image with a `/data` volume when self-hosted (ADR 0007) | 06 PLAT-R1 |

### Security and permissions

| # | Question | Recommendation | Sources |
|---|---|---|---|
| D19 | `/setup` claimable by the first visitor | **Decided:** setup token from configuration, generated and logged once if unset — already fixed in the current app (PR #59) | 01 Q16 |
| D20 | Admin can demote or delete a SuperAdmin; deleting your home org deletes you | **Decided:** forbid both; keep at least one SuperAdmin — already fixed in the current app (PR #59) | 01 Q4 |
| D21 | Invite, login-link and profile-image actions only check the organisation | **Decided:** require `ManageUsers` for anyone but yourself | 01 Q3 |
| D22 | Role changes take up to 240 minutes on the web | **Decided:** apply immediately (role read per request) | 01 Q6 |
| D23 | Devices cannot be revoked | **Decided:** users see and revoke their own devices on the profile page; admins revoke any in the organisation; a revoked device signs out on next contact and keeps its local data unsynced | 01 Q7 |
| D24 | `User` role can import and delete Bibles; template items editable by URL | **Decided:** importing/deleting Bibles and editing templates require Admin; everyone can still use Bibles and create from templates | 05 Q4, 03 Q3 |
| D25 | Bible HTML rendered raw on the public `/watch` page | **Decided:** store Bible text as structured data, never HTML (the current app sanitises against an allow-list, PR #59) | 04 Q5 |
| D26 | `returnUrl` and `/culture` not validated | **Decided:** local URLs and known cultures only — already fixed in the current app (PR #59) | 01 Q11–Q12 |
| D27 | MCP keys never expire and are SuperAdmin-only | **Decided:** Admins manage keys for their organisation, with optional expiry and revocation; a key acts with its creator's current role, never more | 01 Q8 |
| D28 | Authenticated media served `Cache-Control: public` | **Decided:** `private, immutable` with content-addressed keys | 05 Q11 |

Everything else under each section's Open questions is an apparent bug or a leftover: fix it in the new
app and note the rule it falls under, without a separate decision.
