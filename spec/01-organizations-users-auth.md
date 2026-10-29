# Organizations, users, authentication and permissions

## Overview

Gospel Presenter is multi-tenant: every church is an **organization**, and every user belongs to exactly
one. Users never register themselves. A fresh installation is claimed through a one-time `/setup`
page that creates the first super admin. After that, every account is created by an administrator
and activated through a single-use **invite link**, which the person opens and then signs in with
Google or a configured OpenID Connect provider. Access is controlled by three fixed roles (User,
Admin, SuperAdmin), each mapped to a fixed set of permissions. Desktop and mobile apps sign in
through the system browser and get a long-lived **device token**. AI assistants authenticate to the
MCP server with **MCP API keys**, and calendar apps read an organization's events through a secret
**calendar subscription** URL. Super admins can see and switch between all organizations, and also
see who is online and which presentations are live.

## Concepts

### Organization
- `Id` (GUID string), `Name` (required, ≤ 200 chars), `LogoSmall` (optional data-URI, 64×64 WebP).
  Defined in `GospelPresenter/GospelPresenter.Shared/Models/Organization.cs:3`.
- Owns all content: songs, presentations, images, audio, themes, settings, labels and so on (other areas).
- When it is created, the default song-part labels are seeded for it (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:423`, `:248`).
- **Organization settings** are key/value rows, unique per (organization, key), at most 50 per organization.
  The known keys are `DefaultThemeId` (see the Themes area) and `CcliCollectionEnabled` (see the CCLI area)
  (`GospelPresenter/GospelPresenter.Shared/Models/OrganizationSetting.cs:9-11`).
  Any member of the organization can read them. Writing needs `ManageUsers`
  (`GospelPresenter/GospelPresenter.Shared/Services/OrganizationSettingService.cs:17,26`).
  They are synced to devices (see the Sync area).

### User
- `Id`, `Name` (≤ 200), `Email` (≤ 320, may be empty, unique), `Role` (stored as a string),
  `OrganizationId` (one organization; nullable in the schema, but always set in practice).
- `ProfileImage` (256×256 WebP data-URI) and `ProfileImageSmall` (64×64), plus `ProfileImageRemoved`:
  an explicit removal blocks the provider's picture from being imported again.
  Defined in `GospelPresenter/GospelPresenter.Shared/Models/User.cs:3-17`.
- `Logins`: linked external identities (`UserLogin`: `Provider` ∈ {`google`, `oidc`, `mock`},
  `ProviderSubjectId`). The pair (Provider, ProviderSubjectId) is unique across all users
  (`GospelPresenter/GospelPresenter.Shared/Contexts/PresentationContext.cs:424`). A user can have at most 5 logins.
- There is no membership table. A user cannot belong to several organizations, and no flow moves a
  user to another organization.

### Role and permission
- Roles: `User`, `Admin`, `SuperAdmin` (`GospelPresenter/GospelPresenter.Shared/Models/UserRole.cs:3-8`).
- Permissions are derived from the role only. There are no per-user grants
  (`GospelPresenter/GospelPresenter.Shared/Models/PermissionMap.cs:5-51`). The full map:

| Permission | User | Admin | SuperAdmin |
|---|:-:|:-:|:-:|
| ViewPresentations, ManagePresentations | ✔ | ✔ | ✔ |
| ViewSongs, ManageSongs | ✔ | ✔ | ✔ |
| ViewOverlays, ManageOverlays | ✔ | ✔ | ✔ |
| ViewOrganizationImages, ManageOrganizationImages | ✔ | ✔ | ✔ |
| ViewOrganizationAudios, ManageOrganizationAudios | ✔ | ✔ | ✔ |
| ViewBibles, ManageBibles | ✔ | ✔ | ✔ |
| ViewTemplates | ✔ | ✔ | ✔ |
| ViewThemes | ✔ | ✔ | ✔ |
| ManageTemplates | – | ✔ | ✔ |
| ManageThemes | – | ✔ | ✔ |
| ViewUsers, ManageUsers | – | ✔ | ✔ |
| ViewCcliReport, ManageCcliReport | – | ✔ | ✔ |
| ManageRemoteDisplays | – | ✔ | ✔ |
| ManageOrganizations | – | – | ✔ |
| AssignSuperAdminRole | – | – | ✔ |
| CrossOrganizationAccess | – | – | ✔ |
| ManageMcpApiKeys | – | – | ✔ |

- **Caller context**: every service call carries (UserId, Role, OrganizationId). It provides three checks
  (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:8-29`):
  - `RequirePermission(p)`: the role must have permission `p`.
  - `RequireOrganizationAccess(org)`: passes for the caller's own organization, or with `CrossOrganizationAccess`.
  - `RequireUserAccess(userId)`: passes for the caller's own user, or with `CrossOrganizationAccess`.
- UI role labels (en / sv): User = "User" / "Användare", Admin = "Admin" / "Admin",
  SuperAdmin = "Super admin" / "Superadmin". Descriptions are shown in the create-user dialog, for
  example "Allt en användare kan göra, plus hantera mallar och användare."

### Active organization
- For User and Admin, the active organization is always their own (`GospelPresenter/GospelPresenter.Shared/State/ActiveOrganizationState.cs:18`).
- A SuperAdmin has a separately *selected* organization, which can be any organization. It is stored
  per user as the user setting `LastSelectedOrganizationId`. All page-level service calls use it as
  the caller's organization (`:22`).

### Invite
- `Token` (GUID string, unique), `UserId`, `Used` (bool), `CreatedAt`, `ExpiresAt = CreatedAt + 7 days`
  (`GospelPresenter/GospelPresenter.Shared/Models/Invite.cs:3-14`).
- Lifecycle: created → used (once, at a successful sign-in), or created → expired, or created → deleted.
- An invite is **valid** when it is not used and `ExpiresAt > now` (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:134`).
- A user can have at most 20 unused invites, expired ones included (`:378-380`).

### User setting
- Key/value rows per user, unique per (user, key). Key ≤ 200 chars, value ≤ 1000 chars, at most 50 per user.
- Synced to that user's devices (`GospelPresenter/GospelPresenter.Shared/Models/UserSetting.cs:3-16`,
  `GospelPresenter/GospelPresenter.Shared/Sync/SyncService.cs:252-256`).
- Known keys:
  - `LastSelectedOrganizationId` (super admin's selected organization).
  - `PreferredLanguage` (`en` or `sv`).
  - `Onboarding.WelcomeShownAt` (ISO-8601 timestamp) (`GospelPresenter/GospelPresenter.Shared/Services/OnboardingService.cs:13`).
  - Other areas may add keys.

### Device token
- A credential for an installed app (Electron desktop or MAUI).
- Plaintext form: `gpdt_` + 43 base64 characters with `+`, `/` and `=` removed. Only the SHA-256 hex
  hash is stored (`GospelPresenter/GospelPresenter.Shared/Models/DeviceToken.cs:52-66`).
- Fields:
  - `Name`: the device name, e.g. the machine name; "App" by default; ≤ 200.
  - `CreatedAt` and `LastUsedAt`.
  - `LastSeenVersion` (≤ 32 chars) and `LastSeenProtocol`.
  - `RevokedAt`: revoked tokens are kept for audit, not deleted.
  - `UserId` and `OrganizationId`. Deleting the user or the organization deletes the token (cascade).
- A token acts as its user with the user's **current** role, looked up on each request.
- A user can have at most 10 non-revoked tokens.

### MCP API key
- Plaintext form: `gp_` + 43 characters. Stored as a SHA-256 hash.
- Fields: `Name` (≤ 200), `CreatedAt`, `UserId`, `OrganizationId` (`GospelPresenter/GospelPresenter.Shared/Models/McpApiKey.cs:5-31`).
- The key always acts as **role User** in its organization, whatever role its user actually has.
- A user can have at most 10 keys.

### Calendar subscription
- Plaintext form: `gpcal_` + 43 characters. Stored as a SHA-256 hash.
- Fields: `Name` (≤ 200), `CreatedAt`, `LastAccessedAt`, `UserId`, `OrganizationId`
  (`GospelPresenter/GospelPresenter.Shared/Models/CalendarSubscription.cs:5-35`).
- A user can have at most 10. Cascade-deleted with the user or the organization.

### Sessions and claims
- Web sign-in issues a cookie whose claims are `user_id`, `organization_id`, `auth_time`,
  `login_provider` and the role (`GospelPresenter/GospelPresenter.Web/Program.cs:1127-1133`).
- The role and organization are **frozen in the cookie** at sign-in time.

## Screens and flows

### Permission matrix (pages and actions)

On the web host, `UserAdministration`, `ProfileEditing` and `CalendarSubscriptions` are always
true. The desktop and mobile apps hide users, devices, organizations, API keys, the profile page and
calendar subscriptions (`GospelPresenter/GospelPresenter.Shared/Services/IAppCapabilities.cs:1-58`).

| Route | Required | Notes |
|---|---|---|
| `/` | anonymous: landing page with sign-in; signed in: dashboard | `GospelPresenter/GospelPresenter.Shared/Pages/Home.razor:6-22` |
| `/login` | anonymous | sign-in buttons, app version |
| `/mock-login`, `GET /mock-signin/{userId}` | mock mode only | |
| `/setup` | anonymous, only until a first user exists | |
| `/invite/{Token}`, `GET /invite/{token}/signin` | anonymous | |
| `/access-denied`, `/authentication-error` | anonymous | |
| `/profile` | any signed-in user | edit own name and picture; own calendar subscriptions |
| `/settings` | any signed-in user | colour theme (local), language |
| `/admin` | ManageSongs | redirects to `/admin/songs` |
| `/admin/users`, `/admin/users/{id}` | ViewUsers (Admin+) | actions need ManageUsers server-side |
| `/admin/devices` | ViewUsers | read-only |
| `/admin/organizations`, `/admin/organizations/{id}` | ManageOrganizations (SuperAdmin) | |
| `/admin/api-keys` | ManageMcpApiKeys (SuperAdmin) | |
| `/admin/sessions` | ManageOrganizations | live sessions, all organizations |
| `/admin/settings` | ManageOrganizationSettings (Admin+) | rewrite only (2026-10-29): the organisation's settings, remote control so far (LIVE-R38) |
| `/admin/connected-users` | ManageOrganizations | |
| Other admin pages (other areas) | `/admin/songs`, `/admin/labels`, `/admin/songs/{id}`, `/admin/songs/{id}/history`: ManageSongs; `/admin/bibles`: ManageBibles; `/admin/images`: ManageOrganizationImages; `/admin/audios`: ManageOrganizationAudios; `/admin/overlays`, `/admin/overlays/{id}`: ManageOverlays; `/admin/templates`: ManageTemplates; `/admin/themes`: ManageThemes; `/admin/ccli-report`: ViewCcliReport; `/admin/displays`: ManageRemoteDisplays; `/presentations/{id}`, `/templates/{id}`, `/trash`: signed in | `@attribute [Authorize(Policy=…)]` in each page |
| `/live`, `/display`, `/watch/*` | anonymous | Live/public output area |

Server-side checks on actions in this area:

| Action | Server check (UserService unless noted) |
|---|---|
| List users of an organization | ViewUsers + organization access (`:482-493`) |
| List all users (all organizations) | ManageOrganizations (`:171-180`) |
| Get user by id | same organization, or CrossOrganizationAccess; **no permission check** (`:182-195`) |
| Create user | ManageUsers + organization access; SuperAdmin role needs AssignSuperAdminRole (`:197-203`) |
| Update user (other) | ManageUsers + same organization; setting SuperAdmin needs AssignSuperAdminRole (`:256-272`) |
| Update self | name and email allowed; the role must equal the current role (`:273-276`) |
| Delete user | ManageUsers + same organization; never yourself (`:322-337`) |
| Update profile image | target in same organization, or CrossOrganizationAccess; **no permission check** (`:307-320`) |
| List, create or delete invite; list or delete login | target user in same organization, or CrossOrganizationAccess; **no permission check** (`:344-405`) |
| Organization CRUD and logo | ManageOrganizations (`:413-480`) |
| User settings get, set, delete | RequireUserAccess: self, or CrossOrganizationAccess (`:495-589`) |
| MCP keys list, create, delete | ManageMcpApiKeys + organization access; the key's user must be in that organization (`:591-643`) |
| Device tokens: own list, create, revoke | RequireUserAccess (+ organization access on create) (`:645-716`) |
| Device tokens of an organization | ViewUsers + organization access (`:662-672`) |
| Calendar subscriptions list, create, delete | organization access + RequireUserAccess (`:718-759`) |
| Organization setting write | ManageUsers + organization access (`GospelPresenter/GospelPresenter.Shared/Services/OrganizationSettingService.cs:26-27`) |

### Navigation chrome
- **Top bar**, shown only when signed in (`GospelPresenter/GospelPresenter.Shared/Layout/MainLayout.razor:23-59`):
  - Logo, which links to `/`.
  - An orange "Beta" pill.
  - The update indicator and sync status (device hosts only).
  - The admin cog, linking to `/admin`. It is shown only to users with ManageSongs, which in practice
    means every role. Its tooltip is "Inställningar" / "Settings" (`GospelPresenter/GospelPresenter.Shared/Components/AdminMenu.razor:1-10`).
  - The organization switcher (SuperAdmin only).
  - The avatar menu.
- The page body renders only once a session id exists and the organization state has initialized.
  Until then the body is empty (`:46-53`).
- **Avatar menu** (`GospelPresenter/GospelPresenter.Shared/Components/LoginDisplay.razor`):
  - A header with the user's name and email.
  - "Min profil" → `/profile` (only when ProfileEditing).
  - "Mina inställningar" → `/settings`.
  - "Logga ut": on the web it posts a form to `POST /signout` with an antiforgery token. On a device it
    forgets the token and the cached identity, and local data stays.
  - The avatar shows `ProfileImageSmall`, falling back to a grey person icon.
  - The menu refreshes when the user edits their own profile.
- **Admin sidebar** (`GospelPresenter/GospelPresenter.Shared/Layout/AdminLayout.razor:26-157`):
  - Content links are always shown: Songs, Bibles, Images, Audio, Overlays, Templates, Labels,
    Displays (only if PairedDisplays or PublicOutput), Themes, CCLI Report. Links are **not filtered by
    permission**, so a User sees Templates, Themes, CCLI and Displays links that they cannot open.
  - When `UserAdministration` is true: "Användare", "Enheter".
  - Only with ManageOrganizations: "Organisationer", "MCP API-nycklar", "Aktiva sessioner", "Inloggade just nu".
  - Below the `lg` breakpoint the sidebar is an off-canvas drawer. A toggle button sits bottom-left;
    tapping a link or the backdrop closes it.

### `/setup`: first run
- Middleware sends **every** request to `/setup` while no user exists in the database
  (`GospelPresenter/GospelPresenter.Web/Program.cs:477-508`). The exceptions are `/setup`,
  `/invite/*`, `/_*` and `/health*`. An existing auth cookie is signed out first.
- Once setup is complete, the page itself redirects to `/` (`GospelPresenter/GospelPresenter.Shared/Pages/Setup.razor:59-65`).
- The page shows:
  - Logo.
  - Heading "Välkommen!".
  - Description: "Skapa ett superanvändarkonto för att komma igång. Superanvändaren har full kontroll
    över hela installationen:", followed by 3 bullets.
  - Inputs "Ditt namn" and "Församlingens eller organisationens namn", both maxlength 200.
  - Button "Kom igång".
  - Pressing Enter anywhere in the form submits.
- Submitting:
  1. Validation errors, shown inline in red: "Namn måste fyllas i." and "Organisationens namn måste fyllas i."
     Whitespace-only counts as empty.
  2. If a user already exists (a race), it goes to `/` and nothing is created.
  3. Otherwise it creates the organization, plus a SuperAdmin user with **no email**, in that
     organization. Values are trimmed.
  4. It seeds the default labels and creates an invite for the new user.
  5. It hard-navigates to `/invite/{token}`, where the new super admin links their Google/OIDC
     account (`:75-109`, `GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:231-250`).
- There is no authentication on `/setup`: whoever reaches a fresh installation first owns it.

### `/invite/{Token}`: accept invitation
- Loading shows "Laddar...".
- **Valid** invite:
  - Logo.
  - "Välkommen **{name}**!" and, if the organization is known, "Du har bjudits in till **{org}**."
  - "Välj hur du vill logga in".
  - One button per enabled provider. Only the first is visible; the others appear behind
    "Fler alternativ".
  - The Google button is white with the Google "G"; other providers use a sky-blue button labelled
    "Logga in med {DisplayName}".
  - Links go to `/invite/{token}/signin?provider={id}` (`GospelPresenter/GospelPresenter.Shared/Pages/InvitePage.razor:178-235`).
- **Expired** (unused, past expiry): an envelope-with-clock SVG and "Inbjudan har gått ut. Be din
  administratör skapa en ny." (`:136-157`).
- **Used or unknown**: an envelope-with-X SVG, "Ogiltig eller redan använd inbjudan." in red, and
  "Kontakta din administratör för att få en ny inbjudan." (`:158-177`).
- `GET /invite/{token}/signin?provider=`:
  - An unknown or disabled provider, or an invalid invite, redirects to `/authentication-error`.
  - Otherwise it starts the provider challenge with the invite token carried in the authentication
    state; the return URL is `/` (`GospelPresenter/GospelPresenter.Web/Program.cs:614-628`).
- On the provider callback:
  1. The invite is re-checked.
  2. The external subject is linked to the invited user.
  3. The invite is marked used.
  4. The user is signed in (`:1081-1092`).

### Sign-in (Google / OIDC)
- Configuration: `Authentication:Google {Enabled, ClientId, ClientSecret}` and
  `Authentication:OpenIdConnect {Enabled, Authority, ClientId, ClientSecret, DisplayName (default "OpenID Connect")}`.
  A provider counts as enabled only with Enabled = true and a non-empty ClientId.
  Startup fails unless at least one is enabled, outside mock mode (`GospelPresenter/GospelPresenter.Web/Program.cs:76-79`).
  Provider order is Google, then OIDC (`GospelPresenter/GospelPresenter.Web/Services/AuthProviderService.cs:25-29`).
- Entry points:
  - `/` while signed out, or `/login`: provider buttons (first visible, rest under "Fler alternativ"),
    linking to `/signin?provider=…` and keeping any `ReturnUrl` query
    (`GospelPresenter/GospelPresenter.Shared/Components/SignIn.razor:75-125,162-170`).
  - A protected page reached by a full page load goes through the cookie challenge to `/login?ReturnUrl=…`.
  - In-app navigation to a protected page the user is not authorized for renders `RedirectToLogin`.
    That hard-navigates to `/signin?returnUrl={current URL}` with no provider, so it challenges the
    first enabled provider directly (`GospelPresenter/GospelPresenter.Shared/Components/RedirectToLogin.razor`,
    `GospelPresenter/GospelPresenter.Web/Program.cs:605-612,961-982`).
- Google always asks with `prompt=select_account`; OIDC always with `prompt=login`, so the user
  re-authenticates every time (`:130-134,168-173`).
- **Callback rules** (`HandleAuthenticatedUser`, `GospelPresenter/GospelPresenter.Web/Program.cs:1054-1136`):
  - No subject claim: rejected.
  - Without an invite: the (provider, subject) pair must already be linked to a user. Otherwise the
    sign-in is rejected and the user lands on `/authentication-error`. There is **no
    self-registration and no matching by email**.
  - If the user's email is empty, it is filled from the provider's email claim.
  - If the user has no profile image and has not explicitly removed one, the provider's `picture` URL
    is downloaded. It is center-cropped square and stored as 256 px and 64 px WebP (quality 80).
    Download failures are ignored.
  - The sign-in is logged as "Signed in user {id} via {provider}".
- Any remote failure, or a rejection, goes to `/authentication-error`: "Inloggningsfel" / "Något
  gick fel vid inloggningen. Försök igen." / link "Tillbaka till start". The real reason is only in
  the server log.
- **Cookie**: HttpOnly, Secure always, SameSite=Lax. Lifetime is `Settings:SessionTimeoutMinutes`
  (default 240), **non-sliding**. `LoginPath=/login` (`:97-111`).
- **Sign-out**: `POST /signout` (authenticated). It clears the cookie. For an OIDC login it also signs
  out at the identity provider, which returns to `/`. Otherwise it redirects to `/` (`:630-643`).

### Mock / dev login (no database configured)
- Mock mode is active when no `postgresdb` connection string exists. **It refuses to start in
  Production** (`GospelPresenter/GospelPresenter.Web/Program.cs:61-69`).
- It uses SQLite and seeds two organizations, each with one **Admin** user and the welcome modal
  already dismissed (`GospelPresenter/GospelPresenter.Web/Services/MockDataSeeder.cs:36-51,513-521`):
  - "Foo Bar Kyrka" (sv), user `mock-user-sv`, login mock/`mock-sv`.
  - "Foo Bar Church" (en), user `mock-user-en`, login mock/`mock-en`.
- `/mock-login` shows two cards: "Foo Bar Kyrka · Svenska" and "Foo Bar Church · English", with the
  hard-coded English line "Mock mode — choose an organization".
- `GET /mock-signin/{userId}`:
  - Signs in as that user; any id other than `mock-user-en` maps to the Swedish user.
  - Sets the cookie `mock-user-id` for 1 year, then redirects to `/` (`:586-603`).
- A middleware does two things (`:425-473`):
  - It auto-signs-in any request that carries the `mock-user-id` cookie.
  - It redirects any unauthenticated request to `/mock-login`, except public paths and requests
    with an `Authorization` header.

### Desktop / mobile device sign-in
1. The app shows a single "Logga in" button
   (`GospelPresenter/GospelPresenter.Shared/Components/SignIn.razor:61-74`).
2. The app opens `{server}/app-login?device={machine name}&callback_scheme={scheme}` in the **system
   browser**. If the browser is not signed in, the normal cookie challenge runs and returns here.
3. `GET /app-login` (authenticated) (`GospelPresenter/GospelPresenter.Web/DeviceTokenEndpoints.cs:60-94`):
   - It needs `organization_id`, otherwise 403.
   - `callback_scheme` must be one of `gospelpresenter` (the default when absent),
     `gospelpresenter-test` or `gospelpresenter-local`. Any other value gives 400
     `{error:"Unknown callback scheme"}` **and no token is minted**.
   - The device name is trimmed and cut to 200 chars; it defaults to "App".
   - It mints a device token and returns an **HTML page** (not a redirect) titled "Du är inloggad",
     with "Gospel Presenter öppnas. Du kan stänga den här fliken." and a fallback link "Öppna Gospel
     Presenter" (`id="app-callback"`).
   - The page script navigates to
     `{scheme}://auth#token=…&user_id=…&organization_id=…`. The token travels in the URL fragment.
4. The app receives the callback through OS protocol registration. It waits up to 5 minutes and allows
   only one pending sign-in at a time
   (`GospelPresenter/GospelPresenter.Desktop/Services/ElectronDeviceSignIn.cs`). It then calls
   `GET /api/me` with the token and caches the identity: user id, name, email, role, organization id
   and name, device id.
5. Failure or cancel shows "Inloggningen misslyckades. Kontrollera uppkopplingen och försök igen."
- `GET /api/me` returns `{Id, Name, Email, Role, OrganizationId, OrganizationName, DeviceId}`, fresh
  from the database. The app re-fetches it to pick up role or name changes.
- The app stays signed in indefinitely while offline. A 401 from sync puts sync into `AuthRequired`
  (see the Sync area).
- Signing out on the device only forgets the local token. The server-side token stays valid.
- Token APIs:
  - `GET /api/device-tokens`: the caller's own tokens, newest first, with
    `{Id, Name, CreatedAt, LastUsedAt, RevokedAt}`.
  - `DELETE /api/device-tokens/{id}`: revokes the token, 204; only the token's owner (or CrossOrg) may do this.
- **Device token authentication** (`GospelPresenter/GospelPresenter.Web/Auth/DeviceTokenAuthenticationHandler.cs:256-332`):
  - Header `Authorization: Bearer gpdt_…`. Any other Bearer value is treated as a cookie request.
  - Unknown or revoked tokens fail.
  - The token fails if the user's current organization differs from the token's organization.
  - Claims: `device_id`, `device_name`, `user_id`, `organization_id`, and the user's *current* role.
  - The resulting principal is cached for 30 s.
  - `LastUsedAt` is written at most every 5 min, or immediately when the reported version changes,
    together with `X-Client-Version` (cut to 32 chars) and the protocol header.
- The SignalR hubs (live sessions, organization changes) accept only device tokens.

### `/profile`: my profile
Any signed-in user, web only (`GospelPresenter/GospelPresenter.Shared/Pages/Profile.razor`).
- **Profile card:**
  - Avatar (64 px).
  - "Välj bild" / "Byt bild" file picker and drop zone. Accepts JPEG, PNG, WebP and GIF, at most 10 MB.
    Errors: "Bildformatet stöds inte. Använd JPG, PNG, WebP eller GIF." and "Bilden är för stor (max 10 MB)".
  - Choosing a file opens a circular crop dialog with a zoom slider (0–100, start 5) and
    Avbryt / Bekräfta. On confirm the image is resized to 256 px and 64 px WebP.
  - "Ta bort bild" asks for confirmation ("Ta bort profilbild" / "Är du säker på att du vill ta bort
    profilbilden?"). Removing sets `ProfileImageRemoved`.
  - Name field (maxlength 200) **auto-saves** debounced. A blank name is not saved. The header shows
    a "saved" indicator.
  - The email field is **read-only**.
- **Calendar subscription section** (when CalendarSubscriptions is enabled):
  - Title "Kalenderprenumeration" and a description warning that the link is personal.
  - List of name, created date (`yyyy-MM-dd`), and "Senast hämtad: {yyyy-MM-dd HH:mm}" or "Inte hämtad ännu".
  - Each row has a "Ta bort" button, which asks for confirmation before deleting. A toast then says
    "Kalenderlänk borttagen".
  - Empty state: "Inga kalenderlänkar" plus a create button.
  - The create dialog has a name field (Enter creates, Escape closes). A result dialog then shows the
    URL `{base}/api/calendar/{token}.ics` once, with a copy button (toast "Kalenderlänk kopierad"),
    "Lägg till i kalender" (a `webcal://` link), and OK. "Den visas inte igen."

### `/settings`: my settings
Any signed-in user (`GospelPresenter/GospelPresenter.Shared/Pages/Settings.razor`).
- **Colour theme** (System / Ljust / Mörkt): stored in browser `localStorage['theme']`, per device.
  It is not a user setting.
- **Language** (Svenska / English):
  - Each option is a form that posts to `POST /culture` with `{culture, returnUrl=/settings}`.
  - This writes the `.AspNetCore.Culture` cookie for 1 year **and** stores the user setting
    `PreferredLanguage` (`GospelPresenter/GospelPresenter.Web/Program.cs:645-662`).
  - The selected option has a sky-blue border.
- An "Om" section shows the app version.

### Localization behaviour
- Supported cultures are `en` (the default and fallback) and `sv`. Resolution order is:
  1. culture cookie
  2. query string
  3. cookie
  4. `Accept-Language`

  (`GospelPresenter/GospelPresenter.Web/Program.cs:294-303`).
- For a signed-in browser request without a culture cookie, outside `/api`, the live-session hub and
  the organization-changes hub, the server looks up `PreferredLanguage`. If it is set, the server
  writes the cookie and redirects to the same URL. A "no preference" answer is cached for
  `PreferredLanguageCacheSeconds` (default 300) (`:525-571`).
- Desktop: the stored preference wins, then the OS language reported by Electron, then
  `CultureInfo`, then `en`. Unsupported values fall back to `en`
  (`GospelPresenter/GospelPresenter.Desktop/Services/DesktopCultureService.cs`).
- Each open page keeps the language it was opened in, even when it re-renders because of another
  user's event (`GospelPresenter/GospelPresenter.Shared/Localization/CircuitCulture.cs`).

### Welcome modal (onboarding)
- It appears on the dashboard the first time a user, with an active organization, opens it, if
  the user setting `Onboarding.WelcomeShownAt` is empty
  (`GospelPresenter/GospelPresenter.Shared/Components/Dashboard.razor:269-274`).
- Content: logo, "Välkommen till Gospel Presenter", the body "Gospel Presenter hjälper dig att visa
  sånger, bibeltexter och bilder på storbild under gudstjänster och möten.", and a "Kom igång" button.
  It also has a close (X) button.
- Closing it either way hides it and stores the timestamp (`:340-348`). It shows once per user,
  across all devices, since the setting syncs.

### `/admin/users`: user list
ViewUsers is required (`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Users.razor`).
- Lists the users of the active organization, ordered by name. Each row is a link to the detail page
  and shows the avatar, the name, and a role pill: SuperAdmin purple, Admin sky, User green.
- If there is no active organization and the caller has ManageOrganizations, the page lists all users.
- States:
  - Loading: "Laddar...".
  - Empty: an SVG, "Inga användare", and "Lägg till användare i din organisation…", plus "Skapa".
- "Skapa" (top right, when the list is non-empty) opens the dialog "Skapa användare", with Namn,
  E-post (type email), and Roll (select). The role select hides SuperAdmin unless the caller has
  AssignSuperAdminRole, and shows a description of each role below it. The name field gets focus.
  Enter in the name field creates; Escape closes.
  - Email is optional. A non-empty email must contain "@" (not first), with a "." after it that is
    neither first nor last, otherwise "Ogiltig e-postadress". It must not belong to another user,
    otherwise "E-postadressen används redan av en annan användare" (`GospelPresenter/GospelPresenter.Shared/Utils/EmailValidation.cs`).
  - "Skapa" is disabled while the name is blank or saving; its label changes to "Skapar..." while saving.
- Creating a user also creates an invite. The page then navigates to `/admin/users/{newId}`.

### `/admin/users/{id}`: user detail
ViewUsers is required (`GospelPresenter/GospelPresenter.Shared/Pages/Admin/UserDetail.razor`).
- A user from another organization (without CrossOrg) or an unknown id redirects to `/admin/users`.
- The header has a back link to `/admin/users` and the user's name as the title.
- **Profile card:**
  - Image upload, crop and remove, the same as on `/profile`.
  - Name (maxlength 200) and email (maxlength 320) auto-save, debounced, with the same email
    validation as above (the user's own email is excluded from the duplicate check).
  - The role select saves immediately. It is disabled for yourself, with the text "Du kan inte ändra
    din egen roll".
- **"Inloggning" card:**
  - If the user has linked logins, each is listed with the provider name (`google`→"Google",
    `oidc`→"Pocket ID", others raw), the subject id in monospace, and "Ta bort" with the confirmation
    "Är du säker på att du vill ta bort kopplingen till {provider}?" (`:418-423`).
  - If there are no logins:
    - Shows the newest unused invite, if any: "Inbjudningslänk" with an "Aktiv" (green) or "Utgången"
      (red) pill, plus "Ta bort", which asks for confirmation.
    - If the invite is active, also shows "Går ut om {N dagar | 1 dag | mindre än en dag}" (days rounded
      up), the full URL `{base}/invite/{token}` read-only, and a copy button (toast "Länk kopierad").
    - If there is no invite and no login: "Inga inloggningsmetoder tillagda. Skapa en inbjudningslänk
      för att lägga till ett konto."
    - If there is no invite, or it has expired: the "Skapa" button creates a new invite (`:93-161`).
- "Radera användare" (only when the user is not yourself) asks "Är du säker på att du vill ta bort
  {name}?". On confirm it deletes the user permanently and navigates to `/admin/users`.
- Editing your own record refreshes the avatar menu.

### `/admin/devices`: installed apps
ViewUsers is required (`GospelPresenter/GospelPresenter.Shared/Pages/Admin/Devices.razor`).
- A table of every device token in the active organization, including revoked ones, ordered by
  `LastUsedAt ?? CreatedAt`, newest first. Columns:

| Column | Content |
|---|---|
| Enhet | device name, plus "Återkallad" for revoked tokens (row at 50 % opacity) |
| Användare | the user's name |
| Version | `LastSeenVersion` in monospace, or "Ej rapporterad"; plus a red pill "För gammal för att synka" when `LastSeenProtocol` < SyncProtocol.Minimum |
| Senast sedd | `yyyy-MM-dd HH:mm`, or "Aldrig" |

- The header shows "Synk kräver protokoll {N} eller senare".
- Empty state: "Ingen app har loggat in ännu. Enheter dyker upp här när någon installerat appen och loggat in."
- There are **no actions**: there is no revoke button.

### `/admin/organizations` (SuperAdmin)
- Lists all organizations by name. Each row shows the avatar (logo, or the first letter of the name
  in a grey circle), the name, and "{n} användare".
- Empty: "Inga organisationer ännu".
- "Skapa" opens the dialog "Skapa organisation" with a name field (Enter creates, Escape closes).
  Creating seeds the default labels, **switches the active organization** to the new one, stores
  `LastSelectedOrganizationId`, refreshes the switcher, and navigates to `/admin/users`
  (`GospelPresenter/GospelPresenter.Shared/Pages/SuperAdmin/Organizations.razor:120-139`).

### `/admin/organizations/{id}` (SuperAdmin)
- Logo upload with crop. Only the 64 px version is stored. Errors: "Bildformatet stöds inte…" and
  "Bilden får vara max 10 MB."
- "Ta bort logga" removes the logo immediately, without confirmation.
- "Organisationsnamn" auto-saves, debounced, and updates the switcher label.
- "Medlemmar ({n})" lists members, each linking to the user detail page. Empty: "Inga medlemmar ännu".
- "Radera organisation" opens a dialog:
  - "Är du säker på att du vill ta bort **{name}**? Detta kan inte ångras."
  - "Följande kommer att tas bort permanent:" with bullets: the organization and its settings, all
    members ({n} st), all songs and song history, all presentations, all images.
  - A field "Skriv **{name}** för att bekräfta:". The Delete button is enabled only when the typed
    text equals the name exactly (case-sensitive) (`:125`).
  - After deletion: if the deleted organization was the selected one, the page switches to the first
    remaining organization alphabetically and stores it, then navigates to `/admin/organizations`.

### Organization switcher (SuperAdmin only)
- A pill in the top bar showing the selected organization's logo or a grid icon, then its name or
  "Ingen organisation vald" (`GospelPresenter/GospelPresenter.Shared/Components/OrganizationSwitcher.razor`).
- The dropdown lists all organizations (avatar and name) and checks the active one. Empty: "Inga organisationer".
- Selecting one stores `LastSelectedOrganizationId` and does a **full reload to `/`**.
- Initial selection on sign-in (`GospelPresenter/GospelPresenter.Shared/Layout/MainLayout.razor:91-122`):
  1. The stored organization, if it still exists.
  2. Otherwise the first organization by name.
  3. If none exist, go to `/admin/organizations`.

### `/admin/api-keys` (SuperAdmin; MCP server)
- The description explains MCP, with a link to modelcontextprotocol.io.
- A collapsible "Hur använder jag en MCP API-nyckel?" section shows a JSON snippet:
  `{"mcpServers":{"gospel-presenter":{"url":"{base}/mcp","headers":{"Authorization":"Bearer <API_KEY>"}}}}`.
- Lists the keys of the active organization, newest first, showing name, user name and created date,
  with a "Ta bort" button. Confirmation: "Är du säker på att du vill radera MCP API-nyckeln "{name}"?
  Alla integrationer som använder denna nyckel slutar fungera." A toast then says "MCP API-nyckel raderad".
- The create dialog has Namn and Användare (a select of the active organization's users, defaulting to
  the first). The result dialog shows the key once ("Kopiera nyckeln nu. Den visas inte igen."), with
  copy (toast "Nyckel kopierad") and OK.
- Empty state: "Inga MCP API-nycklar".
- **MCP endpoint `/mcp`** (`GospelPresenter/GospelPresenter.Web/Program.cs:909-941`):
  - A request needs `Authorization: Bearer <key>`. A missing or unknown key gives 401.
  - The caller is (key.UserId, **User role**, key.OrganizationId).
  - Tools: `list_bibles`, `get_bible_books`, `get_bible_chapters`, `get_bible_verses`,
    `search_bible` (max 50 results), `search_songs`, `list_songs`, `get_song`, `list_presentations`,
    `get_presentation`, `create_presentation` (optional templateId), `list_templates`,
    `add_song_to_presentation`, `add_bible_text_to_presentation`, `rename_presentation`,
    `reorder_items`, `rename_item`, `remove_item`, `update_item_arrangement`, `reorder_item_parts`,
    `remove_item_part`, `update_presentation_event`
    (`GospelPresenter/GospelPresenter.Web/Mcp/*.cs`). The behaviour of each tool belongs to the
    Presentations, Songs and Bibles areas.

### Calendar feed
- `GET /api/calendar/{token}.ics` is anonymous. An unknown token gives 404. A feed build failure gives 500.
- The response is `text/calendar; charset=utf-8` (`GospelPresenter/GospelPresenter.Web/CalendarEndpoints.cs:12-52`).
- `LastAccessedAt` is updated at most once per hour.
- Content (`GospelPresenter/GospelPresenter.Shared/Services/CalendarFeedService.cs:76-203`):
  - `X-WR-CALNAME` is "Gospel Presenter — {org}"; `X-WR-CALDESC` is "Kommande presentationer"
    (hard-coded Swedish).
  - It includes the organization's non-deleted, non-template presentations with an EventDate no more
    than 30 days in the past, ordered by date then time.
  - UID: `presentation-{id}@gospelpresenter`.
  - Summary = name; Location = EventLocation; Url = `{base}/presentations/{id}`.
  - Time: an event with a time gets a floating local start and lasts 1 h. Without a time it is an
    all-day event.
  - Description: the presentation description, a blank line, one line per item with an icon
    (🎵 song, 📖 Bible, 🖼️ image, 🔊 audio, 📊 slides, • other) and its title, or a fallback ("Sång",
    "Bibeltext", "Bild", "Ljud", "Slides"), then the link.

### `/admin/connected-users` (SuperAdmin)
- "Inloggade just nu": people with at least one open web page (Blazor connection), across all
  organizations, one row per user. Subtitle: "Vem som har appen öppen just nu. En sida som lämnats
  öppen räknas tills den stängs." (`GospelPresenter/GospelPresenter.Shared/Pages/SuperAdmin/ConnectedUsers.razor`)
- Each row shows the name, then "{org name or id or 'Ingen organisation'} · inne sedan {HH:mm}" (the
  oldest tab).
- Pills: "Tappat kontakten" (amber) when all of the user's tabs are disconnected but not yet closed;
  "{n} flikar" when n > 1.
- The list updates live. Ordering is by arrival (`GospelPresenter/GospelPresenter.Web/Live/ConnectedUserRegistry.cs:84-95`).
- Empty: "Ingen har appen öppen just nu." On hosts that do not track connections:
  "Den här värden räknar inga anslutningar."

### `/admin/sessions` (SuperAdmin)
- "Aktiva sessioner": every running presentation, across all organizations
  (`GospelPresenter/GospelPresenter.Shared/Pages/SuperAdmin/LiveSessions.razor`).
- Each row shows the presentation name (or "Presentation utan namn"), then "{org} · {owner} · {sessionId}".
  The owner is "Webbläsare", or a device name, or "Enhet".
- Pills: "Datorn är inte nåbar" (the device-owned session's owner is offline), "Fjärrstyrning",
  "{n} utgångar".
- "Avsluta" asks for confirmation: "**{name}** stannar för alla som tittar, och skärmarna och de
  publika utgångarna som den använder släpps." On confirm it ends the session through the same path as
  the owner's Stop.
- The list updates live. Empty: "Ingen presenterar just nu."
- Details of live sessions are in the Live area.

## Rules and invariants

**Roles and permissions**
- **PERM-R1** Permissions come from the role only, using the fixed map above. SuperAdmin has every
  permission (`GospelPresenter/GospelPresenter.Shared/Models/PermissionMap.cs:5-51`).
- **PERM-R2** Every page with a policy is guarded by the role in the caller's claims. Every mutation is
  re-checked in the service layer with the caller context (`GospelPresenter/GospelPresenter.Shared/Authorization/PermissionAuthorizationHandler.cs:13-20`,
  `GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:8-29`).
- **PERM-R3** Organization isolation: any access to another organization's data needs CrossOrganizationAccess
  (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:18-22`).
- **PERM-R4** Only a caller with AssignSuperAdminRole can create a SuperAdmin or set someone's role
  to SuperAdmin. The UI hides the option as well (`:202-203,270-271`; `GospelPresenter/GospelPresenter.Shared/Pages/Admin/Users.razor:126-128`).
- **PERM-R5** Nobody can change their own role (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:273-276`).
  Pinned by `GospelPresenter/GospelPresenter.UnitTests/Services/UserServiceTests.cs:102`.
- **PERM-R6** Nobody can delete their own account (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:325-326`).
- **PERM-R7** Users can edit their own name and email without ManageUsers (`:256`). Pinned by
  `GospelPresenter/GospelPresenter.UnitTests/Services/UserServiceTests.cs:87`.
- **PERM-R8** MCP API keys always act as role User, whatever the owner's role (`GospelPresenter/GospelPresenter.Web/Program.cs:935`).
- **PERM-R9** Only the owner can list or revoke a device token. A device token cannot be created for
  another user, or for a user outside the given organization (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:674-716`;
  `GospelPresenter/GospelPresenter.UnitTests/Services/DeviceTokenServiceTests.cs:75-137`).
- **PERM-R10** An MCP key can only be minted for a user inside the given organization
  (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:615-617`; tests `UserServiceTests.cs:193-236`).

**Organizations**
- **ORG-R1** Organization name: required (enforced in the UI) and ≤ 200 chars (enforced on the server) (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:416,449`).
- **ORG-R2** There can be at most 100 organizations in the whole installation (`GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:45`).
- **ORG-R3** Deleting an organization deletes all of its users, then the organization, in one
  transaction. All organization-owned data cascades with it. It is permanent, with no trash
  (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:456-471`).
- **ORG-R4** Organization lists and the switcher are ordered by name (`:431-434`).
- **ORG-R5** Creating an organization seeds the default song-part labels (`:423`).
- **ORG-R6** A logo is stored only as a 64×64 WebP data-URI (`GospelPresenter/GospelPresenter.Shared/Pages/SuperAdmin/OrganizationDetail.razor:289-291`).
- **ORG-R7** A SuperAdmin's selected organization persists across sessions as the user setting
  `LastSelectedOrganizationId`. Switching does a full reload (`GospelPresenter/GospelPresenter.Shared/Components/OrganizationSwitcher.razor:138-143`).
- **ORG-R8** Organization settings: unique per (organization, key); at most 50 per organization; key ≤ 200 and
  value ≤ 1000; writes need ManageUsers (`GospelPresenter/GospelPresenter.Shared/Services/OrganizationSettingService.cs:24-52`).

**Users**
- **ORG-R9** User name ≤ 200 and email ≤ 320 (server-enforced). Email is unique across the installation
  (database index) (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:204-205`;
  `GospelPresenter/GospelPresenter.Shared/Contexts/PresentationContext.cs:420-422`).
- **ORG-R10** An organization can have at most 100 users (`GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:44`).
- **ORG-R11** User lists are ordered by name (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:491`).
- **ORG-R12** Deleting a user is a hard delete. The user's logins, invites, settings, device tokens,
  MCP keys and calendar subscriptions cascade (`:339-341`; FK cascades in `GospelPresenter/GospelPresenter.Shared/Contexts/PresentationContext.cs:440,456`).
- **ORG-R13** A user can have at most 5 linked logins (`GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:59`).
  Each (provider, subject) pair can be linked to only one user.
- **ORG-R14** Profile images are center-cropped to a square and stored as 256 px and 64 px WebP at quality 80
  (`GospelPresenter/GospelPresenter.Shared/Services/ProfileImageService.cs:12-47`). Uploads accept JPEG, PNG, WebP and GIF,
  at most 10 MB, checked client-side (`GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:69,81`).
- **ORG-R15** Removing a profile image sets `ProfileImageRemoved`, so the provider's picture is not
  imported again at the next sign-in (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:297`,
  `GospelPresenter/GospelPresenter.Web/Program.cs:1111`).

**Invites**
- **AUTH-R1** An invite is valid for 7 days, until it is used, or until it is deleted
  (`GospelPresenter/GospelPresenter.Shared/Models/Invite.cs:11`). It can be used only once (`GospelPresenter/GospelPresenter.Web/Program.cs:1090`).
- **AUTH-R2** Creating a user always creates an invite for them in the same save (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:219-221`).
- **AUTH-R3** A user can have at most 20 unused invites, expired ones included (`:378-380`; `GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:58`).

**Authentication**
- **AUTH-R4** Sign-in without an invite succeeds only for an already linked (provider, subject) pair. There is
  no self-registration (`GospelPresenter/GospelPresenter.Web/Program.cs:1095-1101`).
- **AUTH-R5** Web sessions last `SessionTimeoutMinutes` (default 240 min) from sign-in and are not
  sliding (`:58,99-100`). Open pages are re-checked every minute: an expired session or a deleted
  account ends them (`GospelPresenter/GospelPresenter.Web/Services/RevalidatingAuthStateProvider.cs:99-125`).
- **AUTH-R6** A deleted user's cookie is rejected on the next request. The "still exists" answer is
  cached for `SessionRevalidationCacheSeconds` (default 30 s). If the database is unreachable, the
  session is kept (`GospelPresenter/GospelPresenter.Web/Program.cs:1006-1052`; `GospelPresenter/GospelPresenter.IntegrationTests/Services/SessionRevalidationIntegrationTests.cs:139`).
- **AUTH-R7** Role and organization in a web session are fixed at sign-in. Device tokens use the
  user's current role (cached for 30 s) (`GospelPresenter/GospelPresenter.Web/Auth/DeviceTokenAuthenticationHandler.cs:253,326`).
- **AUTH-R8** Device token: the `gpdt_` prefix, only the SHA-256 hash stored, unique, at most 10 active
  per user, revocation is soft (`RevokedAt`), and revoked tokens are rejected
  (`GospelPresenter/GospelPresenter.IntegrationTests/Services/DeviceTokenIntegrationTests.cs:126,167`).
- **AUTH-R9** A device token is rejected if the user's organization differs from the token's organization
  (`GospelPresenter/GospelPresenter.Web/Auth/DeviceTokenAuthenticationHandler.cs:285-286`).
- **AUTH-R10** `/app-login` answers only on the allow-listed callback schemes, compared exactly and
  case-sensitively, and mints no token for a rejected scheme
  (`GospelPresenter/GospelPresenter.Web/DeviceTokenEndpoints.cs:38-46,163-169`; tests `DeviceTokenIntegrationTests.cs:54-91`).
- **AUTH-R11** Mock authentication can never run in Production (`GospelPresenter/GospelPresenter.Web/Program.cs:67-69`).
- **AUTH-R12** While the database has no users, every non-static request is redirected to `/setup`,
  except `/setup` and `/invite/*` (`:477-508`).
- **AUTH-R13** Secrets (device tokens, MCP keys, calendar tokens) are shown in plaintext exactly once,
  at creation, and stored only as hashes.
- **AUTH-R14** MCP key: at most 10 per user (`GospelPresenter/GospelPresenter.Shared/AppConstraints.cs:48`).
  Calendar subscription: at most 10 per user (`:50`).
- **AUTH-R15** Calendar feed: anonymous access by token. It contains the organization's
  presentations with an event date ≥ today − 30 days, excludes templates and deleted presentations,
  and builds its links from the request's host (`GospelPresenter/GospelPresenter.Shared/Services/CalendarFeedService.cs:73-96`;
  tests `GospelPresenter/GospelPresenter.UnitTests/Services/CalendarFeedServiceTests.cs`).

**Settings and localization**
- **AUTH-R16** User settings are unique per (user, key), at most 50 per user, key ≤ 200 and value ≤ 1000. A
  write that loses a race to the sync pull is retried once (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:522-574`;
  `GospelPresenter/GospelPresenter.UnitTests/Services/UserServiceTests.cs:332`). A change is announced to the
  user's organization so devices pull it (`:539`).
- **AUTH-R17** Supported languages are en and sv; en is the fallback. A stored `PreferredLanguage` is restored
  into a new browser on its first authenticated request (`GospelPresenter/GospelPresenter.Web/Program.cs:525-571`;
  `SessionRevalidationIntegrationTests.cs:119`).
- **AUTH-R18** The stored-language redirect never applies to `/api/*` or to the two hubs. A redirect
  there would drop the Bearer header (`GospelPresenter/GospelPresenter.Web/Program.cs:995-998`).
- **AUTH-R19** The welcome modal is shown once per user, keyed on the synced user setting
  `Onboarding.WelcomeShownAt` (`GospelPresenter/GospelPresenter.Shared/Services/OnboardingService.cs:15-25`).

**Super admin views**
- **ORG-R16** Connected users are counted per open web page connection and grouped per user. A
  disconnected tab stays listed until the server closes it (`GospelPresenter/GospelPresenter.Web/Live/ConnectedUserRegistry.cs`;
  `GospelPresenter/GospelPresenter.IntegrationTests/Live/ConnectedUserRegistryTests.cs`).
- **ORG-R17** Ending a live session from `/admin/sessions` always asks for confirmation first
  (`GospelPresenter/GospelPresenter.UnitTests/Components/LiveSessionsRenderTests.cs:121-138`).

## Edge cases

- **E1. Email uniqueness and empty email.** The unique index on `Users.Email` also covers the empty
  string (`GospelPresenter/GospelPresenter.Shared/Contexts/PresentationContext.cs:420-422`). The setup
  super admin and any user created without an email all have `""`. A second user without an email
  should therefore fail at the database with an unhandled error. This has not been tested.
- **E2. Rejected access triggers a re-login, not "access denied".** `/access-denied` exists but nothing
  links to it, and no `AccessDeniedPath` is configured. In-app navigation to an unauthorized page goes
  through `RedirectToLogin` → `/signin` → provider → back to the same page
  (`GospelPresenter/GospelPresenter.Shared/Routes.razor:10-14`). A User clicking "Mallar" in the sidebar
  hits this.
- **E3. Role changes are slow on the web.** A role change takes effect for web sessions only after the
  user signs in again, up to 240 minutes later. On devices it takes effect within 30 s.
- **E4. Invite linking an identity that is already linked.** If the (provider, subject) pair is already
  linked to user A and someone opens user B's invite with it, `LinkLoginAsync` returns A's existing link
  (`GospelPresenter/GospelPresenter.Shared/Services/UserService.cs:108-111`). The invite is then marked
  used and the session is signed in as **B**, while the login stays linked to A.
- **E5. Deleting your own home organization deletes you.** A super admin deleting their home organization
  deletes themselves, with no warning beyond the member count. If it was the last organization holding
  users, the installation drops back to `/setup` after a restart. The "setup complete" flag is
  cached in memory (`GospelPresenter/GospelPresenter.Shared/Services/SetupStatusService.cs`).
- **E6. Unhandled service errors.** Many server-side refusals are thrown as exceptions that the page
  does not catch, so the generic Blazor error bar appears instead of a Swedish message:
  - creating the 101st user;
  - an invite cap reached;
  - an over-long name in the create-user dialog, which has no maxlength;
  - an Admin saving the name of a SuperAdmin user. The role value round-trips as SuperAdmin and the
    Admin lacks AssignSuperAdminRole.
- **E7. Admins can demote or delete a SuperAdmin.** An Admin can lower a SuperAdmin in their own
  organization to Admin or User, or delete them. Only *assigning* SuperAdmin is guarded.
- **E8. Server gaps on invites, logins and profile images.** These operations check only the
  organization, not ManageUsers. A User could, through the services, create or delete invites, remove
  login links or change another member's picture. The UI hides this behind the ViewUsers pages.
- **E9. A user can lock out another, or themselves.** Deleting a user's last login leaves them unable
  to sign in until a new invite is created. Nothing stops removing your own last login.
- **E10. Super admin cross-organization media.** HTTP media endpoints use the *cookie's* organization,
  but pages use the *selected* organization. Organization images and audio of a non-home organization
  may fail to load for a super admin (`GospelPresenter/GospelPresenter.Web/Program.cs:678-688`).
- **E11. Device sign-in for a super admin.** `/app-login` uses the cookie's home organization, so a desktop
  app signed in as a super admin is always bound to their home organization.
- **E12. Device sign-out is local only.** Signing out on a device does not revoke the token. No UI lists
  or revokes a user's own device tokens; only the REST endpoints exist. `/admin/devices` is read-only.
- **E13. `/culture` accepts any value.** It stores any string as `PreferredLanguage`, up to 1000 chars,
  without checking it is supported. It also requires a signed-in user: the login and landing pages
  have no language picker and follow `Accept-Language`.
- **E14. `/signin` return URL.** `/signin?returnUrl=` passes the value to the challenge unvalidated; it
  could be an absolute external URL.
- **E15. Unknown organization page.** `/admin/organizations/{unknown id}` shows "Laddar..." forever.
- **E16. Mock sign-in ids.** `/mock-signin/{anything}` other than `mock-user-en` signs in the Swedish
  mock user.
- **E17. MCP keys outlive a role change.** A key keeps working after its user is demoted, since it is
  always role User, and after the user's organization changes. It dies only when the user is deleted.
- **E18. Device-reported version.** The `X-Client-Version` header is client-controlled and truncated to
  32 chars before it is stored.
- **E19. Calendar feed is fixed at creation.** The feed is bound to the organization that was active when
  it was created. A super admin can therefore hold feeds for several organizations.

## Acceptance scenarios

**Setup and invites**
- **AUTH-A1** Given an empty database, when any page is requested, then the browser lands on `/setup`.
- **AUTH-A2** Given `/setup`, when "Kom igång" is clicked with an empty name, then "Namn måste fyllas i."
  is shown. With a name but no organization, "Organisationens namn måste fyllas i." is shown.
- **AUTH-A3** Given `/setup` filled with "Anna" and "Lilla Kyrkan", when submitted, then the browser is
  at `/invite/{token}` showing "Välkommen **Anna**!" and "Du har bjudits in till **Lilla Kyrkan**."
  A later visit to `/setup` redirects to `/`.
- **AUTH-A4** Given a valid invite, when the user completes provider sign-in, then they are signed in
  as the invited user, the invite page now shows "Ogiltig eller redan använd inbjudan.", and the user
  detail page lists the provider login.
- **AUTH-A5** Given an invite older than 7 days, when it is opened, then "Inbjudan har gått ut. Be din
  administratör skapa en ny." is shown and no provider buttons appear.
- **AUTH-A6** Given a provider identity that is not linked to any user, when it signs in via `/login`,
  then the browser ends on `/authentication-error` ("Inloggningsfel").
- **AUTH-A7** Given two enabled providers, when `/login` is opened, then only the first button is shown
  until "Fler alternativ" is clicked.

**Sessions**
- **AUTH-A8** Given a signed-in user, when an admin deletes them, then their next request (after at most
  30 s of cache) redirects to sign-in, and an open page ends its session within about 1 minute.
- **AUTH-A9** Given a session older than `SessionTimeoutMinutes`, when the user continues on an open page,
  then they are signed out.
- **AUTH-A10** Given a signed-in user, when "Logga ut" is clicked, then the cookie is cleared and `/`
  shows the sign-in landing page.

**Users and roles**
- **ORG-A1** Given an Admin on `/admin/users`, when they create "Bo" with email "bo@x.se" and role User,
  then the browser goes to `/admin/users/{id}` with an active invite link ("Går ut om 7 dagar").
- **ORG-A2** Given the create-user dialog, when the email "bo@" is entered, then "Ogiltig e-postadress"
  is shown. When another user's email is entered, then "E-postadressen används redan av en annan
  användare" is shown, and nothing is created in either case.
- **ORG-A3** Given an Admin, when the role select is opened, then "Superadmin" is not offered. Given a
  SuperAdmin, it is offered.
- **ORG-A4** Given a user viewing their own detail page, then the role select is disabled with "Du kan
  inte ändra din egen roll", and "Radera användare" is absent.
- **ORG-A5** Given an Admin of org A, when `/admin/users/{id of a user in org B}` is opened, then the
  browser is redirected to `/admin/users`.
- **ORG-A6** Given a user detail page with an expired invite, when "Skapa" is clicked, then a new active
  invite appears. The copy button shows the toast "Länk kopierad".
- **ORG-A7** Given a user with role User, then the admin sidebar shows no "Användare", "Enheter" or
  super admin links, and `/admin/users` does not render.
- **ORG-A8** Given an Admin, when another user's role is changed, then the change is saved immediately
  and the list badge shows the new role.
- **PERM-A1** Given each role, when each route in the permission matrix is opened, then exactly the
  allowed routes render.
- **PERM-A2** Given a User-role session, when calling services or APIs that need ManageUsers, ViewUsers,
  ManageOrganizations or ManageMcpApiKeys, then they are refused server-side.

**Organizations**
- **ORG-A9** Given a SuperAdmin, when they create organization "Ny" on `/admin/organizations`, then the
  switcher shows "Ny", the browser is on `/admin/users` (empty state), and after a reload "Ny" is
  still selected.
- **ORG-A10** Given the delete-organization dialog, when the typed text differs from the name in any
  way (including case), then "Radera" stays disabled. With an exact match, the organization and its
  members are deleted.
- **ORG-A11** Given a SuperAdmin, when they switch organization in the switcher, then the page reloads to `/`
  showing that organization's dashboard.
- **ORG-A12** Given a SuperAdmin whose stored organization was deleted, when they sign in, then the
  first organization alphabetically is selected.
- **ORG-A13** Given an organization logo uploaded and cropped, then the switcher and list show it.
  "Ta bort logga" reverts to the initial letter.

**Profile, settings, onboarding**
- **ORG-A14** Given `/profile`, when the name is edited, then it auto-saves and the avatar menu shows the
  new name. The email field cannot be edited.
- **ORG-A15** Given a 12 MB image, when it is chosen on `/profile`, then "Bilden är för stor (max 10 MB)"
  is shown. Given a `.bmp`, the unsupported-format message is shown.
- **ORG-A16** Given `/settings`, when "English" is clicked, then the UI switches to English. A fresh
  browser signed in as the same user also comes up in English.
- **ORG-A17** Given a first-time user, when the dashboard opens, then the welcome modal is shown. After
  "Kom igång", it never shows again, on any device.

**Devices, keys and calendar**
- **AUTH-A11** Given a signed-in browser, when `/app-login?device=Mac&callback_scheme=gospelpresenter-test`
  is opened, then an HTML page "Du är inloggad" is returned whose `#app-callback` link is
  `gospelpresenter-test://auth#token=gpdt_…&user_id=…&organization_id=…`.
- **AUTH-A12** Given `/app-login?callback_scheme=evil`, then the response is 400 and no device token row is
  created.
- **AUTH-A13** Given a device token, when `GET /api/me` is called with it, then the user's profile and
  device id are returned. After `DELETE /api/device-tokens/{id}`, the same token gets 401.
- **AUTH-A14** Given a device whose user has been demoted from Admin to User, when the device calls an
  Admin-only API after 30 s, then it is refused.
- **AUTH-A15** Given `/admin/devices` with a device reporting a protocol below the minimum, then its row
  shows "För gammal för att synka".
- **AUTH-A16** Given a SuperAdmin on `/admin/api-keys`, when a key is created, then the plaintext `gp_…`
  is shown once. `POST /mcp` with it succeeds; without it, or with a deleted key, it gets 401.
- **AUTH-A17** Given `/profile`, when a calendar link is created, then the URL ends in `.ics` and
  fetching it anonymously returns `text/calendar` with the organization's events from the last 30 days
  onward. After deleting the link, the URL returns 404.

**Super admin views**
- **ORG-A18** Given two tabs open as user X, then `/admin/connected-users` shows one row for X with
  "2 flikar". Closing both removes the row once the server closes the connections.
- **ORG-A19** Given a running presentation, when a SuperAdmin clicks "Avsluta" on `/admin/sessions`
  and confirms, then the session stops for all viewers. Cancelling leaves it running.

**Mock mode**
- **AUTH-A18** Given mock mode, when `/` is opened, then the browser goes to `/mock-login`. Choosing
  "Foo Bar Kyrka" signs in as an Admin of that organization.

## Implementation artefacts

- **Blazor circuits.** Revalidating every minute, `CircuitCulture`, the connected-user registry built
  on circuit handlers, and the `OnChange`/`OnOrganizationsChanged` events in `ActiveOrganizationState`.
  The user-visible needs behind them are: a revoked or expired session must end within about a
  minute; each viewer sees their own language; super admins see who has the app open; the switcher
  refreshes after organization edits.
- **The culture cookie and "set cookie + redirect" dance.** The need is that a user's language follows
  them across browsers and devices.
- **`HandleAuthenticatedUser` as an ASP.NET OAuth event, claims in the cookie, the policy scheme
  (`CookieOrDeviceToken`).** The need is one identity model for browser sessions and app tokens.
- **Per-request "user still exists" check and its 30 s cache, the language-miss cache, and the device
  principal cache.** These are performance tuning around ASP.NET running middleware on static assets.
  The need is that deletion and revocation take effect quickly.
- **`SetupStatusService` in-memory flag.** The need is only "first run claims the installation".
- **The HTML handover page for `/app-login` and the `callback_scheme` allow-list.** These are tied to
  OS custom-scheme routing for the Electron and MAUI apps. A Capacitor or PWA client may use a
  different hand-off, but the security properties should be kept: the token travels in the fragment,
  only allow-listed schemes are used, and nothing is minted for a rejected request.
- **`IAppCapabilities`.** It hides users, organizations, keys, profile and calendar on devices because
  the Users table does not sync. In a local-first rewrite, decide which of these become available offline.
- **`DevAuthenticationStateProvider` (MAUI) and the mock SQLite seeding with a schema fingerprint.** These
  are dev conveniences. The rewrite needs some seeded dev login for tests (the Playwright fixtures).
- **Profile images and logos stored as base64 data-URIs in the users and organizations tables.** This
  is a storage choice. The need is a small and a large avatar.
- **The `UserSetting` race retry.** It exists because of EF and the sync interceptor.
- **`ProviderDisplayName` hard-coding `oidc` → "Pocket ID".** This is deployment-specific; the configured
  `DisplayName` should be used instead.
- **Antiforgery forms for `/signout` and `/culture`.** The need is CSRF protection on state-changing GETs
  and POSTs.

## Open questions

1. **Access denied behaviour.** Should signed-in users without permission see `/access-denied` (or a 403
   page) instead of being bounced through sign-in (E2)? Should the admin sidebar hide links the role
   cannot open?
2. **Empty email uniqueness (E1).** Is it intended that a second email-less user fails? Probably the
   uniqueness should apply only to non-empty values.
3. **Server-side gaps (E8).** Should invite, login-link and profile-image operations require ManageUsers
   for targets other than yourself? The rewrite should decide explicitly.
4. **SuperAdmin protection (E7).** Should an Admin be allowed to demote or delete a SuperAdmin? Should the
   last SuperAdmin, or your own home organization, be undeletable (E5)?
5. **Multiple organizations per user.** The model is one organization per user, with super admins
   "visiting" others. Is membership in several organizations a goal for the rewrite? If not, keep the
   single-organization model and the super admin switcher.
6. **Role changes on the web (E3).** Should a role change apply immediately to web sessions, as it already
   does for device tokens?
7. **Device token management.** There is no UI to see or revoke your own devices, and `/admin/devices`
   cannot revoke (E12). `IDeviceSignIn` docs claim tokens are "revoked from the web app's device list",
   which does not exist. Should users and admins be able to revoke devices?
8. **MCP keys.** They always act as User, ignore later role or organization changes (E17) and have no
   expiry. Is that intended? Should their management also be open to Admins? Today it is SuperAdmin only.
9. **Super admin media (E10).** Should cross-organization media access for super admins work? Should the
   API caller's organization be the selected one?
10. **Calendar feed language.** Feed texts are hard-coded Swedish ("Kommande presentationer", item
    fallbacks). Should they be localized to the subscriber's language?
11. **`/culture` validation (E13).** Should the value be validated? Should anonymous users (login page)
    be able to pick a language?
12. **`/signin` return URL (E14).** Should `returnUrl` be restricted to local URLs?
13. **Invite with an already-linked identity (E4).** Should this be rejected or merged?
14. **Unhandled errors (E6).** Limit and validation errors should be shown as friendly Swedish messages.
    The rewrite needs a defined error contract.
15. **Several providers per user.** There is no UI to add a second provider to a user who already has a
    login (invites are hidden once any login exists). Is that intended?
16. **Setup claiming.** `/setup` lets the first visitor become super admin of a public deployment. Should it
    require a setup secret or token from configuration?
17. **Organization deletion and object storage.** Uploaded files in S3 are not mentioned. Are an
    organization's S3 objects removed? This was not verified; see the Media area.
