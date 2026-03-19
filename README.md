# Gospel Presenter

Delightfully simple presentation software for churches. Free and open-source.

Gospel Presenter is a free and open-source presentation app built for churches. It makes it easy to display song lyrics and Bible verses on a second screen during services.

## Deployment

### Docker Compose

The [`docker-compose.yml`](docker-compose.yml) uses pre-built images from GitHub Container Registry and handles PostgreSQL, database migrations, and the web app.

1. Create a `.env` file next to the compose file:

    ```env
    POSTGRES_PASSWORD=<strong-password>
    WEB_PORT=8082

    # Google (optional)
    GOOGLE_ENABLED=true
    GOOGLE_CLIENT_ID=
    GOOGLE_CLIENT_SECRET=

    # OpenID Connect (optional)
    OIDC_ENABLED=true
    OIDC_AUTHORITY=
    OIDC_CLIENT_ID=
    OIDC_CLIENT_SECRET=
    OIDC_DISPLAY_NAME=Pocket ID
    ```

    Enable at least one authentication provider. If both are enabled, users can choose which one to use on the login page.

2. Place your bible and song data in `bibles/` and `songs/` next to the compose file (these are mounted read-only into the container).

3. Start everything:

    ```shell
    docker compose up -d
    ```

    The app is available at `http://localhost:8082` (or whatever `WEB_PORT` you set).

On startup, the migrations container runs automatically and exits once the database is up to date. The web app starts after migrations have completed.

---

## Tech stack

- [Blazor](https://dotnet.microsoft.com/apps/aspnet/web-apps/blazor) (Server) — UI framework
- [Tailwind CSS](https://tailwindcss.com) — Styling
- [PostgreSQL](https://www.postgresql.org) — Database
- [.NET Aspire](https://learn.microsoft.com/dotnet/aspire/) — Local orchestration and observability
- [SignalR](https://dotnet.microsoft.com/apps/aspnet/signalr) — Real-time sync

## Development

### Requirements

* .NET 10 SDK
    <https://dotnet.microsoft.com/en-us/download/dotnet/10.0>
* MAUI workload (optional — needed only if building the MAUI target, which may be supported in the future)

    ```shell
    dotnet workload install maui
    ```

    If it already is installed check if it needs an upgrade:

    ```shell
    dotnet workload restore
    ```

### Run with .NET Aspire

The recommended way to run the full stack locally (web app + PostgreSQL) is with .NET Aspire:

```shell
dotnet run --project GospelPresenter.AppHost
```

This starts:
- A PostgreSQL container with a persistent data volume
- Database migrations (`GospelPresenter.MigrationService`)
- The web app (`GospelPresenter.Web`)
- pgweb on <http://localhost:5050> for database browsing

The Aspire dashboard opens automatically and shows logs, traces, and health for all resources.

### Run or Debug from Rider or Visual Studio

The primary target is the web app. MAUI support may be added later.

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
