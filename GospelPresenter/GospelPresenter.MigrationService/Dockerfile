FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libkrb5-3 && rm -rf /var/lib/apt/lists/*

# Pinned to the exact SDK global.json asks for — see the note in GospelPresenter.Web/Dockerfile.
FROM mcr.microsoft.com/dotnet/sdk:10.0.201 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# This image builds GospelPresenter.Shared too, so it runs the Tailwind target and needs the CLI
# cached for the same reason -- see the note in GospelPresenter.Web/Dockerfile.
ARG TAILWIND_VERSION=v4.2.2
ENV TailwindInstallPath=/tailwind-cli/
RUN mkdir -p "/tailwind-cli/${TAILWIND_VERSION}" \
    && curl -fsSL -o "/tailwind-cli/${TAILWIND_VERSION}/tailwindcss-linux-x64" \
       "https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/tailwindcss-linux-x64" \
    && chmod +x "/tailwind-cli/${TAILWIND_VERSION}/tailwindcss-linux-x64"

COPY ["GospelPresenter.MigrationService/GospelPresenter.MigrationService.csproj", "GospelPresenter.MigrationService/"]
COPY ["GospelPresenter.Shared/GospelPresenter.Shared.csproj", "GospelPresenter.Shared/"]
COPY ["GospelPresenter.ServiceDefaults/GospelPresenter.ServiceDefaults.csproj", "GospelPresenter.ServiceDefaults/"]
RUN dotnet restore "GospelPresenter.MigrationService/GospelPresenter.MigrationService.csproj"
COPY . .
WORKDIR "/src/GospelPresenter.MigrationService"
RUN dotnet build "GospelPresenter.MigrationService.csproj" -c $BUILD_CONFIGURATION -o /app/build

FROM build AS publish
ARG BUILD_CONFIGURATION=Release

# The version the running app reports (see AppVersion). The image is built here rather than on the
# runner, so a -p:Version on the workflow's build step would never reach dotnet -- it has to come in
# as a build arg and be forwarded by hand.
#
# SOURCE_REVISION is not redundant with the SDK's built-in SourceLink, which sets the same property
# by itself for any build that can see a .git directory. This build cannot: docker-publish.yml
# passes GospelPresenter as the context and .git sits above it, so the container gets source with no
# repository attached and the commit has to be handed in.
#
# The defaults are what a plain `docker build` gets and are deliberately the SDK's own: an image
# built outside CI claims no version and no commit rather than inheriting the last release's. Empty
# is what keeps the "+sha" suffix off entirely, because the SDK appends it only when
# SourceRevisionId is non-empty.
ARG APP_VERSION=1.0.0
ARG SOURCE_REVISION=
RUN dotnet publish "GospelPresenter.MigrationService.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false \
    /p:Version="$APP_VERSION" /p:SourceRevisionId="$SOURCE_REVISION"

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "GospelPresenter.MigrationService.dll"]
