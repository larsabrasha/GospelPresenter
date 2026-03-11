# GospelPresenter

## Requirements

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

## Run with .NET Aspire

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

## Run with Docker Compose

To run the web app as a standalone Docker container:

1. Build the image from the solution root:

    ```shell
    docker build -f GospelPresenter.Web/Dockerfile -t gospelpresenter-web .
    ```

2. Run it together with PostgreSQL using Docker Compose. Create a `docker-compose.yml`:

    ```yaml
    services:
      db:
        image: postgres:17
        environment:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: gospelpresenter
        volumes:
          - pgdata:/var/lib/postgresql/data
        ports:
          - "5432:5432"

      web:
        build:
          context: .
          dockerfile: GospelPresenter.Web/Dockerfile
        ports:
          - "8080:8080"
        environment:
          ConnectionStrings__postgresdb: Host=db;Port=5432;Database=gospelpresenter;Username=postgres;Password=postgres
        depends_on:
          - db

    volumes:
      pgdata:
    ```

3. Start everything:

    ```shell
    docker compose up --build
    ```

    The app is available at <http://localhost:8080>.

## Run or Debug from Rider or Visual Studio

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

### Troubleshooting

For Rider:
* Verify that the same .NET version is used in terminal `which dotnet` (eg. when restoring workloads) and in Rider -> Settings -> Build, Execution, Deployment -> Toolset and Build.

## Build

Read more:
<https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/publish/?view=aspnetcore-9.0>

