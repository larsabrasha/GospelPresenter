# Offline sync, desktop app and platform

## Overview

Gospel Presenter runs in three hosts today: the **web app** (Blazor Server against PostgreSQL, the
system of record), the **desktop app** (Electron wrapping the same UI, served from localhost against
a local SQLite copy of the organisation's data) and a **MAUI mobile app** (iOS/Android, same UI in a
BlazorWebView, same local SQLite). The device apps work fully offline: every edit is applied locally
at once and synced to the server in the background; edits made elsewhere arrive within about a second
when online. A church computer is expected to run for weeks without anyone touching it, update itself
without ever interrupting a live service, and never lose something an operator typed. This section
also covers the operational platform (Docker Compose stack, migrations, health, logging, release
tagging, CI) and the UI conventions that apply to every screen.

All paths below are relative to the repository root; code lives under `GospelPresenter/`.

## Concepts

### Synced data (what travels between server and devices)

Scope is **one organisation per device sign-in** plus the signed-in **user's own settings**.

| Entity (wire name) | Direction | Unit pushed | Notes |
|---|---|---|---|
| Song part label (`DbSongPartLabel`) | both | own row | text unique per organisation |
| Song (`DbSong`) + parts + arrangements | both | whole aggregate | soft-delete via `DeletedAt` (trash) |
| Song version (history snapshot) | server → device | — | written server-side, e.g. by conflicts |
| Presentation/template (`Presentation`) + items + item parts + slide decks | both | whole aggregate | trash via `DeletedAt` column |
| Theme | server → device | — | built-in themes (no organisation) go to every device |
| Overlay slide | both | own row | |
| Organisation image / audio (metadata) | both | own row | trash via `DeletedAt`; blobs travel separately |
| Organisation setting (`DefaultThemeId`, `CcliCollectionEnabled`) | both | own row | keyed by `Key` |
| User setting (e.g. preferred language, last org) | both | own row | user-scoped, follows the user to all their devices |
| Bible (metadata only) | server → device | — | verses downloaded on demand per translation |
| Remote display / output (`RemoteDisplay`) | both | own row | public code unique across all organisations |
| CCLI report entries | device → server | append-only | separate idempotent endpoint |
| Media blobs (images, audio, overlay images, slide pages) | both | per object key | separate endpoints |

Not synced: users, organisations, invites, API keys, device tokens, calendar feeds. Those can only be
administered on the web (see App capabilities).

Sources: `GospelPresenter/GospelPresenter.Shared/Sync/SyncDtos.cs:44-63`,
`GospelPresenter/GospelPresenter.Client/Sync/SyncTriggerInstaller.cs:32-48` (bidirectional tables; themes
pull-only, song versions and Bibles have no upstream path), `GospelPresenter/GospelPresenter.Shared/Services/IAppCapabilities.cs:3-9`.

### Per-row sync metadata (behavioural meaning only)

- **Change stamp** (`ModifiedAt`): moves on every server-side change of a row, whatever the reason;
  drives "what changed since my watermark". Separate from user-visible "last edited" fields.
- **Version**: opaque per-row counter the server bumps on every write. The device stores the value it
  last saw (its **base**) and hands it back on push; equality = "nobody else changed it". The device
  never generates or interprets it. (`GospelPresenter/GospelPresenter.Shared/Models/ISyncTracked.cs:1-36`)
- **Tombstone**: record of a hard delete (entity type, id, organisation or user, time) so offline
  devices learn of deletions. Kept **90 days** (`GospelPresenter/GospelPresenter.Shared/Models/SyncTombstone.cs:21`).
- **Trash** (soft delete) is an ordinary column (`DeletedAt`) on songs, presentations/templates,
  images and audio — it syncs like any edit, so every device shows the same trash and restore travels
  like an edit. Only purging ("empty trash"/permanent delete) produces a tombstone.
  (`GospelPresenter/GospelPresenter.Shared/Sync/SyncDtos.cs:86-88,115-117`)

### Device-side state

- **Watermark**: server time up to which the device has everything.
- **Journal**: every local insert/update/delete on a synced table, recorded automatically (including
  bulk updates), coalesced per aggregate root at push time. Pending count = distinct journaled rows.
- **Bases**: last acknowledged Version per root row.
- **Media store**: blobs on disk keyed like S3; `PendingUpload` (exists only here, never evicted) or
  `Cached` (LRU, **2 GB** budget, pinned blobs never evicted) (`GospelPresenter/GospelPresenter.Client/Media/MediaStore.cs:7-20`).
- **Device identity**: token (secure storage) + cached identity JSON (user id, name, email, role,
  organisation id/name, device id). Signed-in state survives offline indefinitely; there is no client
  expiry (`GospelPresenter/GospelPresenter.Client/Auth/DeviceAuthService.cs:6-12`).

### Sync status (shown to the user)

`Idle` (Synkad), `Syncing` (Synkar…), `Offline`, `AuthRequired` (Logga in igen för att synka),
`Error` (Synkfel), plus **pending changes** count (`GospelPresenter/GospelPresenter.Shared/Services/ISyncStatusSource.cs:5-15`).

### Installations / build schemes (desktop)

| Scheme | Server | Callback scheme | Data folder | Bundle id | Updates |
|---|---|---|---|---|---|
| Prod | `https://app.gospelpresenter.com` | `gospelpresenter://` | `GospelPresenter` | `com.gospelpresenter.app` | GitHub Releases |
| Test | `https://apptest.gospelpresenter.com` | `gospelpresenter-test://` | `GospelPresenter Test` | `com.gospelpresenter.app.test` | none |
| Local (default) | `GP_API_BASE_URL`, else none | `gospelpresenter-local://` | `GospelPresenter Local` | `com.gospelpresenter.app.local` | none |

Display names: "Gospel Presenter", "Gospel Presenter Test", "Gospel Presenter Local". Sources:
`GospelPresenter/GospelPresenter.Desktop/Directory.Build.GospelPresenter{Prod,Test,Local}.props`, `README.md:255-267`, `adr/0005-desktop-build-schemes.md`.

### App capabilities (what differs per host)

| Capability | Web | Desktop | MAUI mobile |
|---|---|---|---|
| Remote control (phone drives presentation) | yes | yes (via mirroring) | no |
| Public QR output | yes | yes (via mirroring) | no |
| Paired displays / ad-hoc pairing | yes | no | no |
| Calendar subscriptions | yes | no | no |
| User/organisation/API-key administration | yes | no | no |
| Own-profile editing | yes | no | no |
| `/api/upload` endpoints (PowerPoint/PDF import) | yes | no | no |

Absent features are **hidden**, never shown disabled-with-a-hint — except PowerPoint/PDF import, whose
tab says "PowerPoint- och PDF-import görs i webbappen. Den här appen kan inte omvandla filerna själv."
Images, audio, songs and Bibles import locally on devices (also with no server).
Sources: `GospelPresenter/GospelPresenter.Shared/Services/IAppCapabilities.cs:10-58`,
`GospelPresenter/GospelPresenter.Desktop/Services/DesktopAppCapabilities.cs:29-35`,
`GospelPresenter/GospelPresenter/Services/DeviceAppCapabilities.cs:14-20`,
`GospelPresenter/GospelPresenter.Shared/Components/Presentations/AddItem/Slides/SlidesTab.razor:18-27`,
`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Songs.razor:218-223`.

## Screens and flows

### Header sync indicator (`SyncStatusIndicator`) — device apps only

Location: main header, right side, order: update button, sync indicator, admin menu, org switcher,
user menu (`GospelPresenter/GospelPresenter.Shared/Layout/MainLayout.razor:37-43`). Not rendered on
web (no sync source) nor in a desktop build without a server.

- Icon states (`GospelPresenter/GospelPresenter.Shared/Components/SyncStatusIndicator.razor:13-48`):
  - Syncing (only after it has lasted **≥ 1.5 s**): spinning arrows, sky-blue. Shorter syncs never
    show a spinner (avoids flicker after every save). A component created mid-sync (cold start) seeds
    the timer so the long first sync does show (`:59,83-87`).
  - AuthRequired or Error: amber warning triangle.
  - Offline: struck-through cloud, grey.
  - Idle: cloud with check mark, grey.
  - Pending changes > 0 and no spinner: small sky-blue dot top-right.
- Tooltip: `<state>[ · N ändringar väntar] · Synka nu` (`:90-102`).
- Click: "Sync now" (immediate sync attempt). It does **not** open sign-in even in AuthRequired.
- Conflict/outcome toasts (`:157-178`), one per affected push unit:
  - Presentation merged: "Presentationen ändrades även på annat håll medan du var offline. Båda ändringarna slogs ihop."
  - Song lost to server: "En sång ändrades på servern. Din offlineversion sparades i sångens versionshistorik."
  - Other ServerWins (e.g. presentation deleted on server): "Presentationen raderades på annat håll medan du var offline, och dina offlineändringar i den försvann med den." (used for every non-song ServerWins — see Open questions)
  - Failed: "En ändring kunde inte synkas."
  - Output code replaced: "Utflödets kod var redan upptagen och har fått en ny. Kontrollera koden innan du skriver ut den."

### Live list refresh (`RefreshOnSync`) — all hosts

Views that list data reload themselves when remote changes land, without losing dialog state, typed
text or scroll position: dashboard, presentation page, songs, labels, themes, overlays, images, audios,
templates (`GospelPresenter/GospelPresenter.Shared/Pages/...` grep `<RefreshOnSync`). On a device the
trigger is "a pull wrote ≥ 1 row"; on the web it is "an organisation-change announcement for the
circuit's active organisation". Only one reload runs at a time per view (`GospelPresenter/GospelPresenter.Shared/Components/RefreshOnSync.razor:56-59`).

### Update-available button (`UpdateAvailableIndicator`) — desktop Prod only

Secondary button "Starta om för att uppdatera" with cloud-download icon; tooltip "Version {0} är
nedladdad och installeras vid omstart. Den installeras även av sig själv nästa gång appen startas."
Shown only when an update is downloaded **and nothing is being presented**; hides (not disables) the
moment a presentation becomes active; re-checks at click time; shows loading while restarting
(`GospelPresenter/GospelPresenter.Shared/Components/UpdateAvailableIndicator.razor:19-64`).

### Device sign-in (desktop, MAUI)

(Login screen itself is in the authentication area.) Flow: user presses "Logga in" → system browser
opens `{server}/app-login?device={machine name}&callback_scheme={scheme}` → after web sign-in the
server mints a device token and redirects to `{scheme}://…#token=…` → app fetches `/api/me` with it →
stores token + identity → first sync starts. Waits at most **5 minutes** for the callback; only one
sign-in can wait at a time; abandoning is silent (returns to login). A callback with nobody waiting
is ignored. Failure text: "Inloggningen misslyckades. Kontrollera uppkopplingen och försök igen."
(`GospelPresenter/GospelPresenter.Desktop/Services/ElectronDeviceSignIn.cs:36-154`). Server rejects an
unknown `callback_scheme` with 400 **before** minting a token; allowed: `gospelpresenter`,
`gospelpresenter-test`, `gospelpresenter-local`; absent → `gospelpresenter`
(`GospelPresenter/GospelPresenter.Web/DeviceTokenEndpoints.cs:20-77`).

Sign-out (user menu): removes token and cached identity; **local data is kept**
(`GospelPresenter/GospelPresenter.Client/Auth/DeviceAuthService.cs:74-82`, `adr/0002-app-distribution-and-updates.md` (29)).

### Admin → Devices (`/admin/devices`) — web, permission ViewUsers

Read-only table: device name (+ "Återkallad" for revoked, row dimmed), user, reported app version
("Ej rapporterad" if none; "För gammal för att synka" below floor), last seen ("Aldrig"). Header note
"Synk kräver protokoll {0} eller senare". Empty state: "Ingen app har loggat in ännu. Enheter dyker upp
här när någon installerat appen och loggat in." (`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Devices.razor`).
Revoking a device is the owner's action via `/api/device-tokens/{id}` (auth area).

### Desktop app start-up

1. Splash window (frameless, logo + "GOSPEL PRESENTER" wordmark, indeterminate track; follows OS
   light/dark, honours reduced motion) from process start until the operator window is created
   (`GospelPresenter/GospelPresenter.Desktop/splash.html`, `GospelPresenter.Desktop.csproj` `ElectronSplashScreen`).
2. Local database migrated + journal triggers installed (blocks UI); song/Bible caches load in background.
3. Stored sign-in restored before first paint (a signed-in user never sees the login page flash).
4. Language resolved: user's stored setting → OS language (from Electron) → OS culture → English;
   supported `en`, `sv` (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopCultureService.cs:24-83`).
5. Operator window 1280×860, min 900×600, hidden menu bar, shown when painted; closing it quits the
   app (`GospelPresenter/GospelPresenter.Desktop/Program.cs:402-422`).
6. Sync scheduler + change-announcement listener start; identity refreshed from `/api/me` in the
   background (silent on failure).

Changing language in Settings posts `/culture`, stores the user setting (which syncs to the user's
other devices), and reloads the page (`GospelPresenter/GospelPresenter.Desktop/Program.cs:290-295`).

### Desktop standalone mode (no server configured)

When the resolved server URL is empty (Local scheme without `GP_API_BASE_URL`): no sign-in, a fixed
developer identity (user "Utvecklare", Admin, organisation "Utvecklingsmiljö") is seeded and signed in
with an in-memory token that is never persisted; no sync, no indicator, no live mirroring, no updater;
media served from local store only (`GospelPresenter/GospelPresenter.Desktop/Services/DevIdentity.cs:21-89`,
`GospelPresenter/GospelPresenter.Desktop/Program.cs:119-125,160-252,322-325`).

### Desktop projector window

(Live presentation behaviour is in the live area.) Desktop opens the projector as a second
frameless window on the first non-primary display, kiosk/fullscreen applied after ready-to-show; title
prefixed with a fixed non-localized marker so window managers can match it (Wayland placement is
compositor-controlled and unresolved) (`GospelPresenter/GospelPresenter.Desktop/Services/ElectronLiveWindowLauncher.cs:10-41`, `adr/0003-desktop-host-on-electron.md` (7)).

### MAUI mobile app today

Same Blazor UI in a BlazorWebView; same local SQLite, sync engine and doorbell as desktop; sign-in via
system browser (`WebAuthenticator`) on `gospelpresenter://` only (Prod and Test share it — known
collision); token in Keychain/Keystore via `SecureStorage` (Preferences fallback when the keychain
entitlement is missing). Capabilities all false (no remote control/public output — it does not mirror
live sessions; no updater — stores update it). Projector = second app window where the platform
allows; never placed on a chosen display. Platform specifics: media served through a `gpmedia://`
scheme handler on **iOS only** (offline media broken on Android/Windows), Android overscroll disabled,
iOS status-bar height measured so the live view avoids the clock/battery, Windows target only
compiled in CI. Targets: iOS ≥ 17, Android ≥ 33 (API), Windows 10.0.17763.
Sources: `GospelPresenter/GospelPresenter/MauiProgram.cs`, `.../Services/*.cs`,
`.../MainPage.xaml.cs:19-42`, `.../Handlers/GpMediaSchemeHandler.cs:1`, `.../Platforms/Android/WebAuthenticationCallbackActivity.cs:15-18`,
`.../Configuration/Settings.cs`, `.../GospelPresenter.csproj:4-24`.

### Marketing site (`docs/`, www.gospelpresenter.com)

Static Vite + Tailwind landing page (en/sv via build-time i18n): screenshot carousel, features, FAQ,
get-started, and a **download section** that detects the visitor's OS in the browser and reads the
latest release from the GitHub Releases API (no redeploy per release). Phones/tablets (incl. iPadOS
reporting as Mac, Android reporting as Linux) are pointed at the web app instead of a file; macOS
visitors get the Gatekeeper first-launch warning; API failure falls back to the releases page.
Deployed to GitHub Pages on push to `main` touching `docs/**` (`docs/src/download.js:1-116`,
`.github/workflows/static.yml`).

## Rules and invariants

### Sync protocol — scope and permissions (server-enforced)

- **SYNC-R1** Every sync call requires authentication (device token or cookie) and an organisation
  claim; no user → 401, no organisation → 403. The organisation is always the caller's, never chosen
  by the client (`GospelPresenter/GospelPresenter.Web/SyncEndpoints.cs:33-35,56-58,169-177`).
- **SYNC-R2** A pull contains only tables the caller may read: labels/songs/parts/arrangements/versions
  need ViewSongs; presentations/items/parts/slides and outputs need ViewPresentations; themes need
  ViewThemes; overlays ViewOverlays; images ViewOrganizationImages; audio ViewOrganizationAudios;
  Bibles ViewBibles; organisation settings need membership only; user settings are the caller's own.
  Unreadable tables are silently absent (`GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:146-300`).
- **SYNC-R3** Built-in themes (no organisation) are delivered to every organisation
  (`SyncService.cs:205-222`); tombstones delivered are the organisation's, the caller's user-scoped
  ones, and organisation-less ones (`SyncService.cs:274-280`).
- **SYNC-R4** Push permissions per unit: labels/songs ManageSongs; presentation ManagePresentations,
  template ManageTemplates; images ManageOrganizationImages; audio ManageOrganizationAudios; overlays
  ManageOverlays; organisation settings ManageUsers; outputs ManageRemoteDisplays; user settings: own
  user only (`SyncService.cs:465,518,631,1015,1058,1101,1147,1236`). Deletes go through the same domain
  services as the web, so they get identical permission checks (`SyncService.cs:1309-1453`).
- **SYNC-R5** Pushed content is validated with the same limits as the web (name/description/location
  lengths, max items per presentation, parts per item, parts/arrangements per song, label text/colour,
  file-name length, setting key **200** / value **1000** chars, per-organisation count caps for songs,
  presentations, templates, images, audio, overlays, outputs, **50** settings per org and per user)
  (`SyncService.cs:1455-1505`, `GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:20-21,60-61`).
  Exact per-entity limits are owned by the respective areas.
- **SYNC-R6** A theme id pushed on a presentation is kept only if it is built-in or the organisation's
  own; otherwise the presentation falls back to the organisation default and a warning is returned
  (`SyncService.cs:1508-1518`). A pushed song-part label reference that cannot be satisfied is nulled
  rather than failing the song (`SyncService.cs:1521-1526`).
- **SYNC-R7** Each pushed unit succeeds or fails on its own; one invalid aggregate is rolled back and
  reported `Failed` without affecting the rest of the batch (`SyncService.cs:443-458`; test
  `Push_AnInvalidAggregate_FailsAloneWithoutTakingTheBatchDown`). Push processing order: labels → songs
  → images → audio → overlays → presentations → org settings → user settings → outputs → deletes
  (`SyncService.cs:351-417`).

### Sync protocol — pull guarantees

- **SYNC-R8** First pull (no watermark) returns everything the caller may read in the organisation,
  including trashed rows. Incremental pull returns rows changed since the watermark **minus 10 s**
  overlap; duplicates are harmless because the device upserts by id (`GospelPresenter/GospelPresenter.Shared/Sync/SyncDtos.cs:26-41`, `SyncService.cs:98`).
- **SYNC-R9** Pull is paged, max **500** rows per page, stable while new writes arrive (bounded above by
  the server time at pull start), with an opaque cursor; a garbage cursor → 400 "Invalid sync cursor."
  The device fetches all pages and applies them as **one atomic transaction** (`SyncService.cs:83-137`,
  `GospelPresenter/GospelPresenter.Web/SyncEndpoints.cs:42-45`, `GospelPresenter/GospelPresenter.Client/Sync/SyncPullApplier.cs:46-98`).
- **SYNC-R10** Referenced rows arrive before rows referencing them; tombstones last, so a row is never
  deleted and re-created within one pull (`SyncService.cs:69-81`).
- **SYNC-R11** The advertised watermark never runs ahead of what was served, so a backwards clock step
  cannot hide rows (`SyncService.cs:130-134`; test `Pull_TheAdvertisedWatermark_PicksUpWritesCommittedJustBeforeIt`).
- **SYNC-R12** If the watermark is older than **85 days** (90-day tombstone retention − 5 days), the
  server answers "full resync required"; the device then wipes all synced tables, bases, journal and
  watermark **after** having pushed, and re-downloads everything (`SyncDtos.cs:41`, `SyncService.cs:91-96`,
  `GospelPresenter/GospelPresenter.Client/Sync/ClientSyncService.cs:229-234,289-313`). Tombstones older
  than 90 days are purged daily (`GospelPresenter/GospelPresenter.Web/Services/SyncMaintenanceBackgroundService.cs:17-29`).
- **SYNC-R13** Applying a tombstone on the device removes the row and cascades to its children
  (presentation → items → parts; song → parts/arrangements) and clears dangling optional references
  (part label, presentation theme) exactly as the server did (`GospelPresenter/GospelPresenter.Shared/Models/SyncTombstone.cs:10-14`;
  test `ATombstone_CascadesToChildrenAndNullsLabelReferences`).
- **SYNC-R14** Rows applied from the server are not recorded as local edits (no echo), keep the
  server's change stamp, and set the device's base to the server Version
  (`GospelPresenter/GospelPresenter.Client/Sync/SyncTriggerInstaller.cs:91`, test
  `APull_AppliesServerRowsWithoutJournalEcho_AndReloadsTheCaches`).
- **SYNC-R15** A pulled row whose aggregate root still has unpushed local edits is **skipped** (local
  edit wins locally until pushed; the stale base makes the next push resolve it server-side).
  Tombstones are never skipped — a server deletion always wins (`SyncPullApplier.cs:31-34,163`; test
  `RowsEditedWhileThePushIsInFlight_SurviveThePull`).
- **SYNC-R16** Uniqueness collisions on pull are skipped, not errors: incoming label whose text exists
  locally under another id; setting whose key exists locally under another id; output whose code
  collides with a local offline-created one; Bible whose abbreviation exists locally (local import
  stands) (`SyncPullApplier.cs:192-194,336-338,599-601,618-620`).

### Sync protocol — push and conflict behaviour (as the user experiences it)

- **SYNC-R17** Push sends the **current local state** of every touched aggregate root (not a diff),
  with its base (none = created offline). Child edits push their whole parent aggregate
  (`GospelPresenter/GospelPresenter.Client/Sync/SyncPushBuilder.cs:7-13`, `GospelPresenter/GospelPresenter.Client/Sync/SyncTables.cs:59-104`).
- **SYNC-R18** Created offline (no base) → inserted with the device's ids (`Applied`). If a created-offline
  label's text already exists on the server, or a setting's key already exists, the server keeps its
  row and answers `Remapped` with the surviving id; references later in the same push are repointed
  server-side; the device deletes its duplicate and the next pull brings the survivor
  (`SyncService.cs:473-484,1152-1181,1221-1223`, `ClientSyncService.cs:153-166`).
- **SYNC-R19** Base matches → applied as-is, including child removals (parts/items/arrangements absent
  from the push are deleted on the server) (`SyncService.cs:582-623,688-761`).
- **SYNC-R20** **Song** changed on both sides → server version stands; the pushed state is saved as a
  new entry in the song's version history; device adopts the server song immediately (toast)
  (`SyncService.cs:572-580`, test `Push_ASongWithAStaleBase_KeepsTheServerVersionAndSnapshotsThePushedState`).
- **SYNC-R21** **Presentation** changed on both sides → **merge**, never a duplicate copy: items, parts and
  slide decks are unioned by id; a row both have takes the newer one; the presentation's own fields
  follow whichever side changed later; a row only the device has is kept unless the server tombstoned
  it. Cost: an item deleted offline reappears if someone else edited that presentation meanwhile
  (additions beat deletions). Device adopts the merged result (toast "…slogs ihop")
  (`SyncService.cs:770-902`, test `Push_APresentationBothSidesChanged_CombinesTheItemsInsteadOfDuplicatingIt`).
- **SYNC-R22** Presentation edited offline but **deleted (purged) on the server** → deletion wins, the
  offline edits are discarded (`ServerWins`, no state to adopt; the tombstone removes it locally)
  (`SyncService.cs:673-679`, test `Push_APresentationDeletedOnTheServer_StaysDeleted`). Same for any
  other entity with a tombstone and a base ("Deleted on the server.").
- **SYNC-R23** All other single-row entities (labels, overlays, images, audio, settings, outputs) on
  base mismatch → server row stands (`ServerWins`); offline edit is lost (toast).
- **SYNC-R24** Offline **delete** vs server edit (base mismatch) → delete rejected, row comes back on the
  device via the next pull; both ends end up agreeing (`SyncService.cs:1313-1314`, test
  `ADeleteMadeOffline_AndAnEditOnTheServer_LeaveBothEndsAgreeing`). Delete of a row already gone →
  `Applied`.
- **SYNC-R25** A delete push of a **presentation/template** lands in the server **trash** (recoverable from
  any device), it does not purge (`SyncService.cs:1317-1331`, test `Push_ADeleteWithAMatchingBase_TrashesThePresentation`).
  A delete push of a **song** is only honoured if the song is already in the server's trash, else
  `ServerWins` "The song is not in the trash on the server." (`SyncService.cs:1333-1350`).
- **SYNC-R26** After any lost or merged outcome the device must end up byte-for-byte on the server's
  version with a fresh base, and be able to push again (no permanent "zombie" divergence); the server
  returns the surviving aggregate in the push response for this because a later pull would not
  re-serve an untouched row (`SyncDtos.cs:224-247`, `ClientSyncService.cs:87-116`; tests
  `AConflict_MakesTheClientAdoptTheServersVersionAndItsNewBase`, `ATwoSidedEdit_ConvergesAndLeavesTheDeviceAbleToPushAgain`).
- **SYNC-R27** Push results update the base to the new server Version so edits made while a push was in
  flight push cleanly next time (`SyncDtos.cs:226-228`).
- **SYNC-R28** The journal up to the push snapshot is consumed whatever the outcomes (a rejected unit is
  never retried verbatim). Network failure / 401 leaves the journal untouched — nothing is lost by
  syncing eagerly (`ClientSyncService.cs:25-27,183-186`; test `ARevokedToken_SurfacesAsAuthFailure_AndKeepsTheJournal`).
- **SYNC-R29** Output (remote display) codes are unique across all organisations: a device-invented or
  regenerated code that is taken is replaced by a fresh one and the push is `Applied` with a warning
  (toast). A regenerated code from a device with a stale base is refused (`ServerWins`) so an old code
  cannot be put back (`SyncService.cs:1226-1307`; tests `AnOutputWhoseCodeIsAlreadyTaken_IsGivenANewOne`,
  `ARegeneratedCodeFromADeviceThatMissedTheLastChange_IsRefused`).
- **SYNC-R30** Push of songs/labels refreshes the server's in-memory song cache so web screens are
  current (`SyncService.cs:419-422`).

### Side channels

- **SYNC-R31** Bible verses: `GET /api/sync/bibles/{id}` (ViewBibles, own organisation), gzipped when the
  client accepts gzip; 404 if not in the organisation. Translations are opt-in per device ("pin for
  offline"); re-downloaded after a sync when the server copy changed (`SyncEndpoints.cs:74-97`,
  `GospelPresenter/GospelPresenter.Client/Bibles/BibleOfflineService.cs:9-15`).
- **SYNC-R32** CCLI song-display entries recorded offline: `POST /api/sync/ccli-reports`, max **500** per
  batch, append-only and idempotent on (organisation, song, date, presentation); nothing recorded when
  the organisation's CCLI collection is disabled; the client's date is kept (`SyncEndpoints.cs:99-113`,
  tests in `GospelPresenter/GospelPresenter.UnitTests/Sync/SyncBibleAndCcliTests.cs`). Journaled even
  while server rows are applied (`SyncTriggerInstaller.cs:61-70`).
- **SYNC-R33** Media blobs: `PUT /api/sync/media/{key}` where key must match
  `org/{own org}/{images|audios|overlays|slides}/{id}/{file}` (charset `[A-Za-z0-9-]`, file `[A-Za-z0-9._-]`,
  ≤ 64 chars each); permission by kind (images/overlays/slides/audio manage perms); size ≤ **10 MB**
  images/overlays, **20 MB** audio, **50 MB** slides; empty/oversized → 400; other org → 403; no object
  storage → 503 (`SyncEndpoints.cs:16-160`, `AppConstraints.cs:69-71`). Order-independent with metadata:
  a reference to a not-yet-uploaded blob degrades gracefully. Refused blobs stay pending and retry each
  cycle (`GospelPresenter/GospelPresenter.Client/Media/MediaSynchronizer.cs:11-16`).
- **SYNC-R34** Offline media pin set (downloaded and kept): every image, audio and slide page referenced
  by any local presentation, every overlay image, every library thumbnail — including trashed files
  still referenced (`GospelPresenter/GospelPresenter.Client/Media/MediaPinService.cs:10-73`).

### Versioning / protocol floor

- **SYNC-R35** Device requests carry `X-Client-Version` (free text, recorded, truncated to 32 chars) and
  `X-Client-Protocol` (integer, current **1**, minimum **1**). Below the floor or unparseable → **426**
  JSON `{error:"This version of the app is too old to sync with this server.", clientProtocol, minimumProtocol}`
  on all five sync endpoints; a missing header is treated as current (`GospelPresenter/GospelPresenter.Shared/Sync/SyncProtocol.cs:12-48`,
  `GospelPresenter/GospelPresenter.Web/Auth/ClientProtocolFloorFilter.cs:16-43`, `SyncEndpoints.cs:162-166`,
  `GospelPresenter/GospelPresenter.Web/Auth/DeviceTokenAuthenticationHandler.cs:68-90`). The change hub is
  exempt (it carries no data).
- **SYNC-R36** A device token stops working (401) when revoked or when its user has moved to another
  organisation (`DeviceTokenAuthenticationHandler.cs:59-65`).

### Change announcements ("doorbell", ADR 0006)

- **SYNC-R37** Any server-side change to synced data in an organisation is announced to that
  organisation's signed-in devices (SignalR hub `/hubs/organization-changes`, device-token only) and to
  the organisation's open web sessions (in-process). The announcement carries **no data**; receivers
  re-sync over HTTP (`GospelPresenter/GospelPresenter.Shared/Sync/IOrganizationChangeNotifier.cs:1-19`,
  `GospelPresenter/GospelPresenter.Shared/Sync/OrganizationChangesHubMethods.cs:15`).
- **SYNC-R38** The first change of a quiet spell is announced **at once**; further changes within the next
  **500 ms** are announced once, at the end of that window, which starts a new one: at most two announcements
  per organisation per window. (Changed with Lars on 2026-10-30 so a change shows on other devices in tens of
  ms; the current app announces trailing edge only, so the first change waits 500 ms:
  `GospelPresenter/GospelPresenter.Shared/Sync/OrganizationChangeNotifier.cs:5-21`; test
  `ABurstOfSavesOnTheServer_CostsTheDeviceOneRound`.)
- **SYNC-R39** The device whose push caused the change is not woken by it: not by the announcement at once,
  and not by the one at the end of the window when it was the only writer since — when two or more wrote,
  nobody is excluded (`OrganizationChangeNotifier.cs:57-64`; tests `ADevicesOwnPush_DoesNotWakeItAgain`,
  `TwoWritersInOneWindow_ExcludeNobody`). Web sessions also hear their own writes (harmless reload).
- **SYNC-R40** Another organisation's change never wakes a device or web session; a change with no
  derivable organisation (built-in theme) is announced to everyone; a **user setting** change is
  announced only to the writer's organisation, never server-wide (`GospelPresenter/GospelPresenter.Shared/Sync/OrganizationChangeInterceptor.cs:96-122`,
  `GospelPresenter/GospelPresenter.Web/Sync/CircuitRemoteChangeSignal.cs:39-47`; tests in `SyncAudienceTests`).
  A web session filters by the organisation active **when the announcement arrives** (super-admin org switch).
- **SYNC-R41** A failed save announces nothing (`OrganizationChangeInterceptor.cs:58-66`).
- **SYNC-R42** Target latency: server edit → row in device database < **3 s** (measured ~0.64 s)
  (`adr/0006-organization-change-notifications.md` Consequences; test `AnEditOnTheServer_ReachesTheDeviceInAboutASecond`).
- **SYNC-R43** Announcements are an optimisation only: devices still poll the server at least every
  **5 minutes** when idle; a missed announcement costs latency, never correctness (`GospelPresenter/GospelPresenter.Client/Sync/SyncScheduler.cs:55-73`).
- **SYNC-R44** Nothing about the doorbell connection is shown in the UI (ADR 0006 (14)).

### Device scheduling (when sync happens)

- **SYNC-R45** Sync triggers: app start; network becoming available; sign-in; "Sync now"; a local edit
  (within **500 ms**, max-wait not restarting debounce, bursts coalesce into one sync); an announcement;
  doorbell (re)connect; idle timer (**5 min** since last attempt, success or not); a journal poll every
  **10 s** as backstop (`SyncScheduler.cs:10-73,118-287`; tests `ALocalWrite_SyncsWithoutWaitingForThePoll`,
  `ABurstOfWrites_BecomesOneSync`, `ASteadyStreamOfSignals_DoesNotHoldAWriteHostage`).
- **SYNC-R46** Order within a sync: push first, then pull, then media/Bible leg; lists refresh as soon as
  metadata is applied, before blobs download (`ClientSyncService.cs:41-52`, `SyncScheduler.cs:312-321`).
- **SYNC-R47** A local-write trigger with nothing journaled does not contact the server
  (`SyncScheduler.cs:166-170`; test `ASignalWithNothingJournalled_DoesNotReachTheServer`). An idle machine
  makes no requests except the 5-minute poll and its open doorbell socket.
- **SYNC-R48** Only one sync runs at a time; an announcement arriving during a sync causes exactly one
  more sync afterwards; a sync that fails after an announcement retries on the next 10 s tick
  (`SyncScheduler.cs:185-217,297-383`; tests `TheScheduler_SyncsAgain_WhenAnAnnouncementArrivesDuringASync`,
  `TheScheduler_RetriesPromptly_WhenTheSyncAnAnnouncementAskedForFailed`). Edits made during a push
  are pushed immediately after it, not at the next poll.
- **SYNC-R49** Failures never surface as exceptions: not signed in or no network → Offline; unreachable
  server → Offline; 401 → AuthRequired (doorbell stops retrying); anything else → Error. Next trigger
  retries (`SyncScheduler.cs:289-348`).
- **SYNC-R50** Doorbell reconnects forever (0, 2, 5, 10, then every 30 s; initial connect backoff
  1→32 s capped at 30 s); a 401 stops it only if the sync engine also says AuthRequired; signing in
  again restarts it; reconnect counts as an announcement (`GospelPresenter/GospelPresenter.Client/Sync/OrganizationChangesClient.cs:126-281`;
  tests `ARevokedDevice_StopsKnockingAndSaysSoInItsStatus`, `ADoorbell_RejectedWhileTheSyncEngineIsHappy_KeepsTrying`).
- **SYNC-R51** Restart resumes from the stored watermark; edits made before a restart are still pushed
  after it (`GospelPresenter/GospelPresenter.IntegrationTests/Sync/DeviceRestartSyncTests.cs`).
- **SYNC-R52** "Online" means a network interface is up, not that the server is reachable
  (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopConnectivityMonitor.cs:9-20`).
- **SYNC-R53** Starting a live session from the desktop first runs a full sync + media upload so the
  server (which renders mirrored/public output) has everything (`GospelPresenter/GospelPresenter.Desktop/Program.cs:227-234`).

### Desktop app

- **DESK-R1** Server URL precedence: `GP_API_BASE_URL` → `appsettings.json` `Server:BaseUrl` → scheme's URL;
  trailing `/` trimmed; empty → standalone mode (`GospelPresenter/GospelPresenter.Desktop/DesktopSettings.cs:22-31`).
  There is **no in-app server switch**; changing server means a different installation (ADR 0005 (1)-(2)).
- **DESK-R2** Each scheme is a separate installation: own bundle id, name, icon, data directory, keychain
  entry, device token and callback scheme; Test and Prod can be installed side by side and cannot
  receive each other's sign-ins (`adr/0005-desktop-build-schemes.md` (1),(5),(8)).
- **DESK-R3** Build guards: unknown scheme fails the build (GP0002); Local cannot be packaged (GP0003);
  the callback scheme declared in packaging must equal the runtime one (GP0004)
  (`GospelPresenter/GospelPresenter.Desktop/GospelPresenter.Desktop.csproj`).
- **DESK-R4** Data locations: macOS `~/Library/Application Support/{folder}/`, logs `~/Library/Logs/{folder}/`;
  Windows `%LOCALAPPDATA%\{folder}\` with `logs\`; Linux `$XDG_DATA_HOME` or `~/.local/share/{folder}/` with `logs/`.
  Contains `gospelpresenter.db`, `identity.json`, `media/`, `device-token` (Win/Linux)
  (`GospelPresenter/GospelPresenter.Desktop/DesktopPaths.cs:1-52`, `Program.cs:65,104,133`).
  Folder name is fixed per scheme and **must never be derived from the display name** (would orphan data).
- **DESK-R5** Device token at rest: macOS login keychain (service name = folder name, account
  `device-token`); Windows DPAPI current-user; Linux owner-only (0600) **unencrypted** file. Unreadable
  token → user signs in again, app keeps working (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopSecureTokenStore.cs:8-131`).
- **DESK-R6** Corrupt identity file → treated as signed out, never crashes (`DeviceAuthService.cs:40-46`).
- **DESK-R7** Logs: daily rolling `log.txt`, 10 MB per file, 7 files kept; app namespace at Debug,
  Microsoft/HttpClient at Warning (`GospelPresenter/GospelPresenter.Desktop/Program.cs:28-38`).
- **DESK-R8** Links and QR codes generated on desktop point at the server URL, never at the local
  host/port; standalone falls back to local (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopServerUrlProvider.cs:17`).
- **DESK-R9** The desktop's live session id is derived from its device id, so it survives restarts
  (projector/public output URLs and phone controllers keep working); without a device id the
  per-window browser id is used (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopSessionIdProvider.cs:13-21`).
- **DESK-R10** Single instance: a second launch forwards its arguments (the sign-in callback URL on
  Windows/Linux) to the running instance; macOS receives callbacks as open-url events
  (`ElectronDeviceSignIn.cs:45-60`).
- **DESK-R11** Status-bar inset is 0 on desktop (and web) (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopStatusBarService.cs:13`).
- **DESK-R12** Auto-update (Prod only): first check **2 min** after start, then every **6 h**; check
  times out after **5 min**; download silent; installs at next quit/start whether or not the button
  is pressed; button applies silently and relaunches; no check while checking/downloading/staged;
  failures never shown (`GospelPresenter/GospelPresenter.Desktop/Services/ElectronAppUpdater.cs:26-169`,
  `GospelPresenter/GospelPresenter.Desktop/Program.cs:269-273`).
- **DESK-R13** **While anything is being presented there is no restart, no update prompt and no update
  toast** (`adr/0002-app-distribution-and-updates.md` (17); `UpdateAvailableIndicator.razor:19,56`).
- **DESK-R14** Feed is compiled in (this repo's GitHub Releases); a server cannot redirect the update
  feed (`adr/0003-desktop-host-on-electron.md` (13)). Test/Local never look for updates.
- **DESK-R15** Packaging targets: macOS arm64 only (dmg + zip, min macOS 14), Windows x64 NSIS
  one-click per-user, Linux AppImage/deb/rpm/pacman (package name `gospel-presenter`). Only AppImage,
  macOS and Windows self-update; deb/rpm/pacman need manual reinstall. Unsigned macOS cannot self-update
  (restart returns on same version) (`GospelPresenter/GospelPresenter.Desktop/Properties/electron-builder.yml`,
  `.github/workflows/desktop-release.yml`, ADR 0003 Consequences).
- **DESK-R16** Desktop serves media at `/api/images`, `/api/live-images`, `/api/audio`, `/api/theme-images`
  from the local store with HTTP Range support (audio seeking) (`GospelPresenter/GospelPresenter.Desktop/Program.cs:301-353`).
- **DESK-R17** Imports on desktop/MAUI: images, audio, songs, Bibles run locally through the domain
  services (work offline / without server); PowerPoint/PDF requires the web app (see Capabilities).

### Platform / operations

- **PLAT-R1** Docker Compose services: `postgres:17` (healthcheck `pg_isready`, 5 s), `dxflrs/garage:v2.2.0`
  (S3; healthcheck `garage stats -a`), `gotenberg/gotenberg:8` (API timeout 120 s, LibreOffice restart
  after 10 conversions; healthcheck `/health`), `migrations` (runs once after postgres+garage healthy),
  `web` (after migrations completed successfully and gotenberg healthy; container port 8080 published
  on `WEB_PORT`, default **8082**) (`GospelPresenter/docker-compose.yml`).
- **PLAT-R2** Required env: `POSTGRES_PASSWORD` (compose fails without it), `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`; optional `S3_BUCKET_NAME` (default `gospelpresenter`), `S3_ADMIN_TOKEN`, `WEB_PORT`,
  `GP_VERSION`, Google (`GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID/SECRET`) and OIDC (`OIDC_ENABLED`,
  `OIDC_AUTHORITY`, `OIDC_CLIENT_ID/SECRET`, `OIDC_DISPLAY_NAME`, default "OpenID Connect"). Bible data
  mounted read-only from `./bibles` (`GospelPresenter/.env.example`, `GospelPresenter/docker-compose.yml:56-90`).
- **PLAT-R3** Web refuses to start unless at least one auth provider is enabled **and** has a client id
  ("At least one authentication provider must be enabled and configured (Google or OpenID Connect).");
  in Production a missing DB connection string is fatal (mock mode is never allowed in Production)
  (`GospelPresenter/GospelPresenter.Web/Program.cs:61-79`).
- **PLAT-R4** Migration job order: initialise Garage (layout, key, bucket; non-fatal), migrate legacy image
  bytes from DB to S3 (non-fatal, retried next start), apply schema migrations, upsert built-in themes,
  upload theme art (non-fatal; fallback to embedded copy) (`GospelPresenter/GospelPresenter.MigrationService/Program.cs:30-100`).
- **PLAT-R5** Health: `/health/ready` and `/health/live` anonymous, always healthy (no checks evaluated);
  Development additionally `/health` and `/alive`. Prometheus metrics on a separate port **1337**
  (Release builds) (`GospelPresenter/GospelPresenter.Web/Program.cs:289-290,367-372,943-944`,
  `GospelPresenter/GospelPresenter.ServiceDefaults/Extensions.cs:105-125`).
- **PLAT-R6** Logging: console, Information default, Microsoft at Warning, request logging excluding
  `/health*` and `/version*` paths; never log secrets (`GospelPresenter/GospelPresenter.Web/appsettings.json:2-28`,
  `GospelPresenter/CLAUDE.md:67-68`).
- **PLAT-R7** Behind a TLS-terminating proxy (Cloudflare tunnel) every non-Development request is treated
  as https; HSTS + error page outside Development; data-protection keys persisted to a volume in
  Production; session timeout default **240 min** (`GospelPresenter/GospelPresenter.Web/Program.cs:51-58,396-420`).
- **PLAT-R8** First-run gate: while no user exists, every non-static, non-`/health` request redirects to
  `/setup` (only `/setup` and `/invite/*` reachable) and any stale auth cookie is cleared; once a user
  exists the result is cached for the process lifetime (`GospelPresenter/GospelPresenter.Web/Program.cs:478-503`,
  `GospelPresenter/GospelPresenter.Shared/Services/SetupStatusService.cs:7-19`). Setup page itself: auth area.
- **PLAT-R9** Image channels: `GP_VERSION` unset → `:latest` (newest release), `1.4.0` → pinned,
  `main` → trunk. Tag `web-vX.Y.Z` publishes `:X.Y.Z`, `:X.Y`, `:latest`; every build also
  `:sha-<commit>`; branch builds `:<branch>`; PRs build but don't push. Both `gospelpresenter` and
  `gospelpresenter-migrations` images. Unit + integration tests gate tag/dispatch builds
  (`README.md:129-147`, `.github/workflows/docker-publish.yml`).
- **PLAT-R10** Desktop releases: tag `v*` → draft GitHub Release (never auto-published; there is no
  rollback) with all three platforms; `Desktop test build` is manual (workflow_dispatch, platform
  choice, version `0.0.<run>`), artifacts only (`.github/workflows/desktop-release.yml`, `desktop-test.yml`).
  `maui-build.yml`: tests + desktop build + stylesheet presence check on every main/PR; iOS/Android
  builds on manual dispatch.
- **PLAT-R11** Displayed version: informational version with commit sha shortened to **7** chars;
  falls back to assembly version; nothing rendered if no metadata; Debug builds append
  "(utvecklingsbygge)". Shown on the login screen and Settings ("Version {0}")
  (`GospelPresenter/GospelPresenter.Shared/Services/AppVersion.cs:22-90`, `GospelPresenter/GospelPresenter.Shared/Components/AppVersionLabel.razor`).
- **PLAT-R12** Organisation settings: read requires organisation membership; write requires ManageUsers
  + membership; key ≤ 200, value ≤ 1000 chars; ≤ 50 per org; upsert by key. Known keys
  `DefaultThemeId`, `CcliCollectionEnabled` (`GospelPresenter/GospelPresenter.Shared/Services/OrganizationSettingService.cs:15-71`,
  `GospelPresenter/GospelPresenter.Shared/Models/OrganizationSetting.cs:9-11`).

### Cross-cutting UI rules (apply to every screen; from `GospelPresenter/CLAUDE.md`)

- **PLAT-R13** Toasts for confirmations/short messages: non-interactive, one at a time (a new one
  replaces the current after a 200 ms exit animation), auto-dismiss after **3 s**, two kinds: success
  (green check) and warning (amber triangle); rendered as a top-layer popover
  (`GospelPresenter/GospelPresenter.Shared/Components/ToastContainer.razor:42-90`, `GospelPresenter/GospelPresenter.Shared/Services/ToastService.cs:1-26`, `CLAUDE.md:17-19`).
- **PLAT-R14** Confirmation dialog **only** for operations that cannot be undone (`CLAUDE.md:19`).
- **PLAT-R15** Every view that can be empty: loading ("Laddar...") → empty state (SVG icon + short Swedish
  text) → content (`CLAUDE.md:9-12`).
- **PLAT-R16** Light and dark mode everywhere; all interactive elements always visible (no hover-only);
  responsive layouts, no fixed pixel widths (`CLAUDE.md:3-7`).
- **PLAT-R17** Async buttons show loading (disabled + spinner) and prevent double submit; prefer optimistic
  updates with rollback (`CLAUDE.md:21-23`).
- **PLAT-R18** "Add" modals: items added only on the sticky bottom-right "Lägg till" button, which closes
  the modal; `Ctrl+Enter` add and close, `Shift+Enter` add and keep open (`CLAUDE.md:25-32`).
- **PLAT-R19** Search filters in real time (debounced), shows result count and a reset control (`CLAUDE.md:34-35`).
- **PLAT-R20** Accessibility: labelled fields, keyboard reachable, focus returns to opener when a modal
  closes, new items focused/scrolled into view, shortcuts shown in tooltips and non-conflicting (`CLAUDE.md:37-40`).
- **PLAT-R21** All actions permission-checked server-side; UI hiding is never the only guard; validate
  in UI and on server; user-friendly Swedish errors, never stack traces; UI must never end in a broken
  state on failed calls (`CLAUDE.md:42-44,62-65`).
- **PLAT-R22** Multi-write operations atomic; user-reorderable lists persist their order (`CLAUDE.md:46-48`).
- **PLAT-R23** All UI text localized (en, sv); default from `Accept-Language`, fallback English; user data
  never injected unencoded into localized markup (`CLAUDE.md:70-78`).
- **PLAT-R24** Changes affecting the live presentation propagate in real time to all clients; important
  views have bookmarkable URLs and navigation does not lose state (`CLAUDE.md:80-84`).
- **PLAT-R25** Uploaded images validated (type, size), compressed, previewed before upload (`CLAUDE.md:14-15`).

## Edge cases

- **Overlap re-serves**: incremental pulls deliberately re-serve the last 10 s; the device deduplicates
  by id (last occurrence wins) (`SyncPullApplier.cs:141-149`).
- **Pre-sync rows**: rows that predate sync tracking carry a "minus infinity" stamp; first pull delivers
  them, later pulls skip them; re-stamping them would cause a false conflict on each device's next
  edit (`GospelPresenter/CLAUDE.md:55`). New system must not produce false conflicts on migrated data.
- **Long transactions**: a server transaction held open longer than the 10 s overlap can hide its rows
  from a pull — known, unfixed hazard (ADR 0006 Consequences).
- **Child-only change**: editing a song part / presentation item must also count as a change of the
  aggregate (both for conflict detection and announcement addressing) — pinned by ~40 tests in
  `GospelPresenter/GospelPresenter.UnitTests/Services/SyncTrackingCallSiteTests.cs` (e.g. rename item,
  reorder parts, change arrangement, change theme/event/schedule, rename output). Song/presentation
  trash = soft delete, no tombstone, bumps root; permanent delete tombstones only the root (children
  cascade); deleting a Slides item also tombstones its slide deck.
- **Song and its parts deleted together** → only the song is tombstoned (`GospelPresenter/GospelPresenter.UnitTests/Contexts/SyncTrackingTests.cs:145`).
- **Item part edited alone** → resolved to its presentation via its item, even if the item was deleted
  in the same batch (`SyncTables.cs:53-104`). Unresolvable orphan journal rows are silently consumed
  (`SyncPushBuilder.cs:157-163`).
- **Remapped label**: briefly the device's parts lose their label (SET NULL) until the next pull brings
  the surviving label and repointed parts (`ClientSyncService.cs:153-166`; test `ARemappedLabel_IsDroppedLocallyAndHealedByThePull`).
- **Presentation trashed on server** reaches the device trash **whole** (items intact so restore works);
  **purged** on server → removed from device including items (`TwoDeviceLibraryTests.cs:58,89`).
- **Song soft-deleted on one device** stays restorable on the other (`TwoDeviceLibraryTests.cs:30`).
- **Merge resurrects offline deletions** of items if the server also changed the presentation (SYNC-R21).
- **Deleted-on-server + offline edit of a song/label/overlay/media/output** → ServerWins "Deleted on the
  server." and the toast wrongly says a *presentation* was deleted (see Open questions).
- **Offline-created output code collides** with another org's code → device's code replaced; toast tells
  the operator to re-check before printing.
- **Web circuit organisation** is read at announcement time; a super admin switching org mid-session
  hears the new org's changes (`CircuitRemoteChangeSignal.cs:16-19`; test `TheOrganizationIsReadWhenTheChangeArrives_NotWhenTheCircuitWasBuilt`).
- **401 on the hub while sync is fine** (e.g. a proxy/redirect ate the header) → keep retrying
  (commit `6ba5f20`; test `Negotiate_ForAUserWithAStoredLanguage_IsNotRedirected`).
- **Self-induced sync loop**: the device's own sync reads must not count as local writes (was 59 pulls/min
  on an idle machine) (`SyncScheduler.cs:89-101`).
- **First sync on a new device** can take minutes (measured 871 songs / 3527 parts); spinner shown; lists
  refresh when it lands (dashboard opened before it would otherwise show "no presentations").
- **Revoked token offline**: no lockout while offline; revocation surfaces only on the next online call as
  AuthRequired; journal kept.
- **Standalone → server build**: dev token is never written to the real store so the fake identity cannot
  leak into a server-configured run (`DevIdentity.cs:61-71`).
- **Desktop shutdown**: disposing updater/scheduler after Electron is gone must not crash the exit
  (`ElectronAppUpdater.cs:180-218`, `SyncScheduler.cs:429-449`).
- **Language on a fresh desktop install** comes from the OS; the stored user language takes over at the
  next start (after first sync) or immediately if chosen in Settings (`DesktopCultureService.cs:61-66`).
- **macOS language**: OS language must win over the shell's `LANG` (`adr/0003-desktop-host-on-electron.md` (15)).
- **Desktop reconnect**: if the local UI connection drops, it retries 10× immediately, 10× every 5 s, then
  every 30 s up to 260 attempts (~2 h) (`GospelPresenter/GospelPresenter.Desktop/Components/App.razor:84-99`).
- **Setup gate cache**: once users exist it never re-checks; if all users were deleted the gate would not
  re-engage until restart.

## Acceptance scenarios

Device scenarios assume the new local-first client (desktop/PWA) with a "simulate offline" control.

- **SYNC-A1** Given a signed-in device with an empty local DB, When it starts, Then all songs,
  presentations (incl. trashed), templates, themes (incl. built-in), overlays, media metadata, settings,
  outputs and Bible metadata of its organisation appear, and nothing from another organisation.
- **SYNC-A2** Given a user without ViewSongs, When their device syncs, Then no songs/labels arrive.
- **SYNC-A3** Given two devices online in the same org, When device A renames a presentation, Then
  device B shows the new name within 3 s without reload, and an open dialog on B stays open.
- **SYNC-A4** Given a browser on the dashboard, When another user adds a presentation in the same org,
  Then the dashboard lists it within 3 s; When a user in another org adds one, Then nothing reloads.
- **SYNC-A5** Given a device offline, When the user edits a song and a presentation, Then the indicator
  shows Offline with a pending dot and "2 ändringar väntar"; When the network returns, Then both edits
  reach the server and the dot disappears.
- **SYNC-A6** Given a device offline that edited song S, and the server edited S meanwhile, When the
  device syncs, Then S shows the server's text, the song's version history contains the device's text,
  and toast "En sång ändrades på servern…" appears.
- **SYNC-A7** Given device offline added item X to presentation P and the server renamed P, When the
  device syncs, Then P has the server's name (or the later edit) and contains X on both ends, with
  toast "…Båda ändringarna slogs ihop.", and no duplicate presentation exists.
- **SYNC-A8** Given device offline removed item Y from P while the server edited P, When it syncs, Then
  Y is present again on both ends (documented resurrection).
- **SYNC-A9** Given device offline edited P and the server permanently deleted P, When it syncs, Then P
  is gone on the device and a toast says the offline changes were lost.
- **SYNC-A10** Given device offline permanently deleted P while the server renamed P, When it syncs,
  Then both ends agree (P exists with server name) and the device can push again.
- **SYNC-A11** Given device deletes presentation P online (base current), When synced, Then P is in the
  server trash and in every device's trash (restorable), not purged.
- **SYNC-A12** Given device offline created label "Bridge" and the server already has "Bridge", When it
  syncs, Then one "Bridge" label exists on the device, and song parts that used the device label point
  at the server label.
- **SYNC-A13** Given device offline created an output with code C already used by another org, When it
  syncs, Then the output gets a new code on device and server, and the code-replaced toast appears.
- **SYNC-A14** Given a device whose last sync was > 85 days ago, When it syncs, Then it first pushes its
  pending edits, then local data is replaced by a fresh full copy.
- **SYNC-A15** Given a device token revoked on the web, When the device next syncs, Then status becomes
  "Logga in igen för att synka" (amber), local edits remain pending, and the app stays usable offline.
- **SYNC-A16** Given a client sending `X-Client-Protocol: 0` (or `abc`), When it calls any sync endpoint,
  Then the server returns 426 with the JSON error; with no header it is served.
- **SYNC-A17** Given a device pushes, Then it is not sent an announcement for its own change; a second
  device is.
- **SYNC-A18** Given 20 rapid server saves in one org, Then each device performs one sync round, not 20.
- **SYNC-A19** Given the device is idle and online with nothing to push, Then it makes no sync request
  for 5 min except via announcements, and does sync after 5 min.
- **SYNC-A20** Given an edit, When the user keeps typing, Then the change is pushed within ~0.5 s of the
  first write (not held back by continuous activity).
- **SYNC-A21** Given a sync shorter than 1.5 s, Then no spinner is shown; given a long first sync, Then a
  spinner is shown even if the page loaded mid-sync.
- **SYNC-A22** Given a media upload `PUT /api/sync/media/org/{otherOrg}/images/x/y.png`, Then 403; with an
  11 MB image body, Then 400; with storage unconfigured, Then 503.
- **SYNC-A23** Given CCLI entries re-pushed after a lost response, Then each is recorded once; with CCLI
  collection disabled, Then nothing is recorded.
- **SYNC-A24** Given a device restarted mid-session with a pending edit, Then the edit is pushed after
  restart and server changes made meanwhile arrive.
- **SYNC-A25** Given a pinned Bible translation updated on the server, When the device syncs, Then the
  new verses are downloaded; unpinned translations are never downloaded.
- **DESK-A1** Given the Prod build with an update downloaded and no active presentation, Then "Starta om
  för att uppdatera" is visible; When a presentation starts, Then it disappears; When it ends, it returns.
- **DESK-A2** Given the button is visible, When the operator starts presenting and then clicks it (race),
  Then no restart happens.
- **DESK-A3** Given a Test or Local build, Then no update check is ever made and no button is shown.
- **DESK-A4** Given no server URL configured, Then the app opens directly as "Utvecklare" in
  "Utvecklingsmiljö" with no sync indicator, and data persists locally across restarts.
- **DESK-A5** Given a fresh install on a Swedish OS with an English shell locale, Then the UI is Swedish;
  When the user picks English in Settings, Then the UI reloads in English and their other devices use
  English after their next start.
- **DESK-A6** Given sign-in started, When the browser hands back `gospelpresenter-test://…#token=…` to the
  Test build, Then it is signed in; When no callback arrives in 5 min, Then it returns to the login
  screen without an error; When `/app-login?callback_scheme=evil` is requested, Then 400 and no token.
- **DESK-A7** Given the user signs out, Then the login screen shows and local library data is still
  present after signing in again as the same user.
- **DESK-A8** Given a QR code/link generated on desktop, Then it uses the server origin, not localhost.
- **DESK-A9** Given the desktop app on desktop/mobile hosts, Then Users/Organizations admin, profile
  editing, calendar subscriptions and paired displays are hidden; the Slides tab shows the "görs i
  webbappen" message; image/audio/song/Bible import works offline.
- **DESK-A10** Given a second display attached, When a presentation goes live, Then the projector window
  opens fullscreen on the non-primary display and the operator window stays on the primary.
- **PLAT-A1** Given an empty database, When visiting any page, Then redirect to `/setup`; `/health/live`
  still answers 200.
- **PLAT-A2** Given no auth provider configured, Then the server refuses to start with the stated message.
- **PLAT-A3** Given a toast is showing and another is triggered, Then the first is replaced; each
  disappears by itself after 3 s and cannot be clicked.
- **PLAT-A4** Given the login page and Settings, Then the app version is shown ("Version 1.4.0" or
  "Version 1.0.0+abc1234 (utvecklingsbygge)").

## Implementation artefacts

- **EF `ModifiedAt` stamping, `ExecuteUpdate` bypass, `TouchSong`/`BumpPresentationAsync`, manual
  `AddTombstones`, `SyncTrackingCallSiteTests`**: exist because of EF change-tracker gaps. Need behind
  it: every mutation, including child edits, must be visible to sync and to change notification. In a
  mutation-based design this falls out of mutations naturally — but child mutations must still be
  attributable to their aggregate for conflict semantics.
- **Postgres `Version` trigger vs SQLite**: implementation of "row changed since I saw it"; the user need
  is no false conflicts (an Aug 2026 timestamp-equality bug made 9/13 presentations conflict forever).
- **SQLite journal triggers, `SyncState['applying']` echo guard, rowid consumption watermark,
  `LocalWriteInterceptor` reading every command**: plumbing for "every local write is queued exactly
  once and server writes are not echoed back". Mutation logs replace all of it.
- **Aggregate-shaped push / flat pull, keyset cursors with append-only table numbers, overlap window,
  advertised-watermark clamp**: state-based protocol mechanics; carry over only the guarantees
  (SYNC-R8…R16, R26).
- **`ServerState` in push responses**: needed because a server-winning row is never re-served by pulls;
  the need is "device converges immediately after a losing push".
- **SignalR doorbell, `OrganizationChangeConnectionRegistry`, in-memory groups (single replica only),
  `DeviceWriteScope` AsyncLocal, `CircuitRemoteChangeSignal`**: the need is low-latency fan-out of
  "org changed" with self-exclusion and org isolation. Any push channel (WebSocket/SSE/Durable Object)
  will do; the 5-minute backstop poll should stay.
- **`syncGate.WaitAsync(0)` drop + dirty-flag + re-arm logic**: the need is "no announcement is lost and
  no sync storm happens".
- **Blazor `RefreshOnSync` per-view loader, `InvokeAsync`/`CircuitCulture.Restore`, Blazor reconnect
  options**: need = reactive lists that update in place without losing UI state; React local-first
  queries make this implicit. Reconnect modal belongs to Blazor Server only.
- **In-memory song/Bible caches refreshed after push/pull** (`ISyncCacheRefresher`, `LoadSongsAsync`):
  current-tech caching.
- **Electron.NET (.NET process + Electron), `AssemblyMetadata` scheme values, GP0002–GP0004 MSBuild
  checks, ReadyToRun, splash covering .NET start-up, `DeviceAuthenticationHandler` antiforgery
  quirks, socket-bridge dispose crashes**: host-specific. Keep the needs: per-environment
  installations with distinct id/data/callback scheme, build-time consistency of the callback scheme,
  a branded splash until first paint, clean shutdown.
- **macOS keychain via `security` CLI, DPAPI, 0600 file**: need = token stored in the OS secure store
  per installation.
- **MAUI**: `gpmedia://` scheme handler (iOS only), Mac Catalyst plist/entitlement issues,
  `app://0.0.0.0` non-secure context polyfills, `SecureStorage` Preferences fallback, `#if SCHEME_*`
  constants, Tizen stub. The rewrite targets Capacitor/PWA; carry over only: offline library, system-
  browser sign-in with app callback, secure token storage, safe-area insets.
- **Velopack / `.pkg` per-user rewrite (ADR 0002)**: superseded; need = silent per-user install/update.
- **Aspire AppHost, ServiceDefaults, Tailwind CLI caching in CI, Garage admin initialisation, legacy
  image DB→S3 migration**: current-stack ops; the rewrite targets Workers/D1 + Node self-host.
- **Mock mode (`isMockMode`), `/mock-signin`**: dev convenience; must stay impossible in production.

## Open questions

1. **Signing in as a different user/organisation on the same device does not clear local data.** The
   journal of the previous account would be pushed under the new token's organisation and the old org's
   rows stay in the local DB. ADR 0002 (29) says signing out keeps data by design. Decide: wipe on
   account/org change (with confirmation) or partition per account.
2. **Generic ServerWins toast** says "Presentationen raderades på annat håll…" for every non-song
   ServerWins (labels, overlays, media, settings, outputs, offline delete rejected by a server edit) —
   misleading copy (`SyncStatusIndicator.razor:170-171`).
3. **Offline permanent delete of a presentation only trashes it on the server** (SYNC-R25) and the next
   pull brings it back into the device's trash — intended ("recoverable from any device") but means
   "empty trash" offline is not final. Confirm desired semantics.
4. **Merge resurrects offline item deletions** (SYNC-R21); the code notes carrying removed ids would fix
   it. With mutation-based sync this can be exact — decide whether to keep the "additions win" rule.
5. Presentation-level fields in a merge are all-or-nothing by the root's change time, not per field.
   Should the new design merge per field?
6. Single-row entities lose offline edits silently except for a toast; no history. Acceptable?
7. `Sync.OfflineChangesSuffix` "(offline-ändringar)" string and the endpoint comment mentioning
   `CopiedAsNew` are leftovers of the removed "conflict copy" policy — drop.
8. The SyncStatusIndicator click in AuthRequired just retries; there is no path from the indicator to
   sign in again. Should it navigate to login?
9. Server-side **multi-replica** announcements are not supported (in-memory groups). Relevant for
   Workers (Durable Objects?) and Node self-host.
10. Long-transaction hazard (rows hidden from a pull) is unfixed; the new design should avoid it
    (e.g. server-assigned monotonic sequence instead of timestamps).
11. ADR 0002 (29)–(30) decided but not built: **server field on the sign-in screen** (self-hosted servers;
    today only via `appsettings.json` on desktop) and **server-provided update feed** (gated on code
    signing). Is the rewrite's embedded-server/LAN mode replacing these?
12. Linux token storage is unencrypted; macOS unsigned → no self-update and Gatekeeper first-launch
    friction; Intel Macs unsupported; release pipeline has never run a real upload.
13. MAUI app shares `gospelpresenter://` between Prod and Test (sign-in collision); Android/Windows
    offline media broken; no remote control/public output. Is MAUI simply dropped in favour of
    Capacitor/PWA?
14. `.env.example` does not mention `GOOGLE_ENABLED`/`OIDC_ENABLED`, while compose defaults both to
    `false` — following the example literally yields a server that refuses to start (PLAT-R3).
15. Health endpoints evaluate no checks (always healthy, even with DB down); compose web service has no
    healthcheck of its own. Intended?
16. Logging filter excludes `/version*` but no `/version` endpoint was found in the web host.
17. Setup-complete status is cached forever per process (PLAT-R8 edge case).
18. Desktop "online" detection is interface-based; captive portals read as online (harmless today, but
    the indicator then shows Offline only after a failed request).
19. Update check runs every 6 h; with deb/rpm/pacman installs the updater cannot apply — is the button
    ever shown there? (electron-updater behaviour not verified in code.)
