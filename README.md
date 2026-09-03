# Gospel Presenter

Delightfully simple presentation software for churches. Free and open-source.

Gospel Presenter is a free and open-source presentation app built for churches. It makes it easy to display song lyrics and Bible verses on a second screen during services.

## Deployment

### Docker Compose

The [`docker-compose.yml`](docker-compose.yml) uses pre-built images from GitHub Container Registry and handles PostgreSQL, database migrations, and the web app.

1. Copy the example environment file and edit it:

    ```shell
    cp .env.example .env
    ```

    At minimum, set `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY`. Enable at least one authentication provider (Google or OpenID Connect). See [`.env.example`](.env.example) for all available options.

2. Copy the Garage configuration and edit it:

    ```shell
    cp garage.toml.example garage.toml
    ```

    For production, generate unique secrets for `rpc_secret` and `admin_token` (the latter must match `S3_ADMIN_TOKEN` in `.env`):

    ```shell
    openssl rand -hex 32
    ```

3. Place your bible data in `bibles/` next to the compose file (mounted read-only into the container).

4. Start everything:

    ```shell
    docker compose up -d
    ```

    The app is available at `http://localhost:8082` (or whatever `WEB_PORT` you set).

On startup, the migrations container runs automatically — it creates the database schema and provisions the S3 bucket in Garage. The web app starts after migrations have completed.

### Image channels

`GP_VERSION` in `.env` decides which images the stack runs:

| `GP_VERSION` | Image | Use |
| --- | --- | --- |
| unset | `:latest` | the newest release — the default for self-hosting |
| `1.4.0` | `:1.4.0` | production, pinned so upgrades and rollbacks are both a one-line edit |
| `main` | `:main` | a test environment tracking the trunk |

Releases are cut by tagging `main`:

```shell
git tag web-v1.4.0 && git push origin web-v1.4.0
```

That publishes `:1.4.0`, `:1.4` and `:latest`. Every build also publishes an immutable `:sha-<commit>` tag — the moving tags cannot tell you afterwards which build is running, and that one can.

(The `web-` prefix keeps server releases apart from the desktop app's `v*` tags, which build the Electron installers.)

---

## Tech stack

- [Blazor](https://dotnet.microsoft.com/apps/aspnet/web-apps/blazor) (Server) — UI framework
- [Tailwind CSS](https://tailwindcss.com) — Styling
- [PostgreSQL](https://www.postgresql.org) — Database
- [Garage](https://garagehq.deuxfleurs.fr) — S3-compatible object storage for uploaded images
- [.NET Aspire](https://learn.microsoft.com/dotnet/aspire/) — Local orchestration and observability
- [SignalR](https://dotnet.microsoft.com/apps/aspnet/signalr) — Real-time sync

## Development

### Requirements

* .NET 10 SDK
    <https://dotnet.microsoft.com/en-us/download/dotnet/10.0>
* Docker — Aspire runs PostgreSQL, Garage, Gotenberg and pgweb as containers.

    On Linux your user must be in the `docker` group. The membership only applies to new logins, so either log out and back in or start the shell with `newgrp docker`:

    ```shell
    sudo usermod -aG docker $USER
    ```

* Node.js — only for the desktop client, whose build downloads Electron through npm.
* A trusted HTTPS development certificate:

    ```shell
    dotnet dev-certs https --trust
    ```

    On Linux `--trust` only writes the certificate to `~/.aspnet/dev-certs/trust`, which OpenSSL — and therefore the desktop client's `HttpClient` — does not read. Either follow the instructions the command prints for your distribution, or point OpenSSL at both stores when running the client:

    ```shell
    export SSL_CERT_DIR="$HOME/.aspnet/dev-certs/trust:/etc/ssl/certs"
    ```

### Run with .NET Aspire

The recommended way to run the full stack locally (web app + PostgreSQL) is with .NET Aspire.

On a fresh clone, create the Garage config first — the AppHost bind-mounts it into the Garage container, and it is not in the repository because the real file holds secrets:

```shell
cd GospelPresenter
cp garage.toml.example garage.toml
dotnet run --project GospelPresenter.AppHost
```

This starts:
- A PostgreSQL container with a persistent data volume
- A Garage container for S3-compatible image storage
- A Gotenberg container for PDF export
- Database migrations (`GospelPresenter.MigrationService`)
- The web app (`GospelPresenter.Web`) on <https://localhost:7175>
- pgweb on <http://localhost:5050> for database browsing

The Aspire dashboard opens automatically and shows logs, traces, and health for all resources.

The web port is pinned to 7175 and left unproxied on purpose: it is the redirect URI registered with Google, so it has to stay stable.

### Configure sign-in for local development

`appsettings.Development.json` enables Google but ships no credentials, so the web app refuses to start with *"At least one authentication provider must be enabled and configured"* until you supply them. Put them in user secrets — never in `appsettings*.json`:

```shell
cd GospelPresenter/GospelPresenter.Web
dotnet user-secrets set "Authentication:Google:ClientId" "<client id>"
dotnet user-secrets set "Authentication:Google:ClientSecret" "<client secret>"
```

The credentials live in the Google Cloud Console under **APIs & Services → Credentials** (<https://console.cloud.google.com/apis/credentials>). The OAuth client needs `https://localhost:7175/signin-google` as an authorized redirect URI.

### First sign-in

On an empty database, open <https://localhost:7175/setup>, name the first administrator, and the app redirects to `/invite/{token}`. **Signing in with Google through that invite link is what links your Google account to the user.** Until that has happened, plain "Sign in with Google" ends on `/authentication-error` — the server log then says:

```
Rejecting google sign-in: no user is linked to google subject …
```

The same applies to every later user: an admin creates them, and they sign in through their invite link once.

### Run the desktop client

The desktop app hosts the same Blazor UI in Electron (see [ADR 0003](adr/0003-desktop-host-on-electron.md)). Point it at a running server with `GP_API_BASE_URL`, or `Server:BaseUrl` in `GospelPresenter.Desktop/appsettings.json`:

```shell
cd GospelPresenter
export GP_API_BASE_URL="https://localhost:7175"
export SSL_CERT_DIR="$HOME/.aspnet/dev-certs/trust:/etc/ssl/certs"   # Linux, see Requirements
dotnet run --project GospelPresenter.Desktop
```

Leaving `GP_API_BASE_URL` empty runs the client standalone against its local database with a developer identity and no server at all.

The client signs in through the browser (device flow), so the account must already be linked as described above. The browser hands the token back on a custom URL scheme, which a packaged build registers with the desktop environment itself. A `dotnet run` build registers nothing, so on Linux the sign-in ends in "No apps available" and the client waits for a callback that never comes. Register it once per build directory:

```shell
./scripts/register-url-scheme-linux.sh          # Debug; pass Release for a release build
./scripts/register-url-scheme-linux.sh --remove # undo
```

Re-run it after moving the repository — the handler it writes names an absolute path. It registers `gospelpresenter-local://`, which is the scheme a default build answers on; pass `GP_CALLBACK_SCHEME` for a build made with another `-p:Scheme`.

#### Build schemes

Which server the desktop app talks to is a build parameter, not a setting a user changes (see [ADR 0005](adr/0005-desktop-build-schemes.md)) — the same three names the MAUI app uses, selected with `-p:Scheme`:

| `-p:Scheme=` | Server | Callback scheme | Data under | Updates |
|---|---|---|---|---|
| `GospelPresenterProd` | `app.gospelpresenter.com` | `gospelpresenter://` | `GospelPresenter` | GitHub Releases |
| `GospelPresenterTest` | `apptest.gospelpresenter.com` | `gospelpresenter-test://` | `GospelPresenter Test` | none |
| `GospelPresenterLocal` (default) | `GP_API_BASE_URL`, else none | `gospelpresenter-local://` | `GospelPresenter Local` | none |

Each is a separate installation with its own bundle identifier, name, icon, database, media library and device token, so a test build sits beside the real app rather than replacing it — and neither can answer the other's sign-in, because an operating system routes a URL scheme to exactly one application. The values live in `GospelPresenter.Desktop/Directory.Build.GospelPresenter*.props`; the server allow-lists the three callback schemes in `DeviceTokenEndpoints`.

`Local` is the default so a bare build never signs in against a real server, and it refuses to be packaged (`GP0003`). `Prod` is what a `v*` tag builds; `Test` is built on demand by the **Desktop test build** workflow, which leaves the installers as workflow artifacts.

### Run or Debug from Rider or Visual Studio

The primary target is the web app; the desktop client is the same UI hosted in Electron.

* For local dev on Mac/Windows for Web:
    - **GospelPresenter.Web: Hot Reload** — For fast GUI development with mocked data (no database required).\
    Starts the web app together with two scripts: Hot Reload Helper and Tailwindcss watch.\
    Three tabs will open with the three separate processes.\
    If something doesn't work, try running the scripts separately to see any errors.

    Install "fswatch":

    ```
    brew install fswatch
    ```

### Screenshots

Capture screenshots of the app across languages, themes, and viewports using the `GospelPresenter.Screenshots` tool.

**First-time setup** — install Playwright's Chromium browser:

```shell
cd GospelPresenter/GospelPresenter.Screenshots
dotnet run -- --install
```

**Take screenshots** (requires the web app to be running):

```shell
dotnet run -- --base-url https://localhost:7175 --output ../../screenshots
```

Options:

| Flag | Description |
|---|---|
| `--base-url <url>` | Web app URL (default: `http://localhost:5253`) |
| `--output <dir>` | Output directory (default: `./screenshots`) |
| `--headed` | Show the browser window |
| `--install` | Install Playwright's Chromium browser and exit |

The tool captures every combination of language (en, sv), theme (light, dark), and viewport (desktop, tablet, mobile). Screenshots are captured at 2× resolution (Retina).

### Troubleshooting

For Rider:
* Verify that the same .NET version is used in terminal `which dotnet` (eg. when restoring workloads) and in Rider -> Settings -> Build, Execution, Deployment -> Toolset and Build.

**The build fails with `GP0001: Electron was downloaded but never unpacked`**

Electron's `install.js` can exit successfully without unpacking the download (seen with Node 26). The zip in `~/.cache/electron` is fine — unpack it by hand:

```shell
D=GospelPresenter.Desktop/bin/Debug/net10.0/.electron/node_modules/electron
Z=$(ls ~/.cache/electron/*/electron-*.zip | head -1)
rm -rf "$D/dist" && mkdir -p "$D/dist"
unzip -q "$Z" -d "$D/dist"
chmod +x "$D/dist/electron"
printf 'electron' > "$D/path.txt"
```
