FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libfontconfig1 libkrb5-3 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data-protection-keys && chown $APP_UID /app/data-protection-keys
USER $APP_UID
EXPOSE 8080

# Pinned to the exact SDK global.json asks for, not the floating 10.0 tag. global.json holds
# rollForward at latestPatch for the workload reasons documented there, so it accepts 10.0.2xx and
# nothing else — while mcr's 10.0 tag has since moved on to 10.0.400 and the build died on
# "A compatible .NET SDK was not found". Raise this together with global.json, never on its own.
# Note that this is not the same patch CI runs: setup-dotnet takes latestPatch at its word and
# installs the newest in the band, so the runners are on 10.0.204 while this image is on 10.0.201.
# Both satisfy the pin, and the difference is deliberate -- mcr publishes no floating tag for a
# patch band, and there is no 10.0.204 image to pin to.
FROM mcr.microsoft.com/dotnet/sdk:10.0.201 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src

# Tailwind.MSBuild downloads the standalone CLI from GitHub during the build, unauthenticated. The
# actions/cache step in CI does not help here: it caches on the runner, and this build runs inside a
# container that never sees it -- so every image build fetched it again, from the shared runner
# address pool, and failed the whole build on a 403 or a 100s timeout for a reason unrelated to the
# change under test. Fetching it in its own layer, before any source is copied, means buildx's gha
# cache carries it between runs and it is downloaded once rather than every build.
#
# The path layout is the package's own: <TailwindInstallPath>/<TailwindVersion>/<asset>. The version
# directory is v4.2.2 because GospelPresenter.Shared.csproj pins TailwindVersion to it -- put the
# binary anywhere else and the package downloads as before, with the build still green and nothing
# to show that the cache was never used. Keep this in step with that property. The package only
# downloads when the file is absent, and only defaults TailwindInstallPath when the variable is
# empty, so this wins without touching any project file -- the same seam CI uses.
ARG TAILWIND_VERSION=v4.2.2
ENV TailwindInstallPath=/tailwind-cli/
RUN mkdir -p "/tailwind-cli/${TAILWIND_VERSION}" \
    && curl -fsSL -o "/tailwind-cli/${TAILWIND_VERSION}/tailwindcss-linux-x64" \
       "https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/tailwindcss-linux-x64" \
    && chmod +x "/tailwind-cli/${TAILWIND_VERSION}/tailwindcss-linux-x64"

COPY ["GospelPresenter.Web/GospelPresenter.Web.csproj", "GospelPresenter.Web/"]
COPY ["GospelPresenter.Shared/GospelPresenter.Shared.csproj", "GospelPresenter.Shared/"]
COPY ["GospelPresenter.ServiceDefaults/GospelPresenter.ServiceDefaults.csproj", "GospelPresenter.ServiceDefaults/"]
RUN dotnet restore "GospelPresenter.Web/GospelPresenter.Web.csproj"
COPY . .
WORKDIR "/src/GospelPresenter.Web"
RUN dotnet build "GospelPresenter.Web.csproj" -c $BUILD_CONFIGURATION -o /app/build

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
RUN dotnet publish "GospelPresenter.Web.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false \
    /p:Version="$APP_VERSION" /p:SourceRevisionId="$SOURCE_REVISION"

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "GospelPresenter.Web.dll"]
