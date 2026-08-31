FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libkrb5-3 && rm -rf /var/lib/apt/lists/*

# Pinned to the exact SDK global.json asks for — see the note in GospelPresenter.Web/Dockerfile.
FROM mcr.microsoft.com/dotnet/sdk:10.0.201 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY ["GospelPresenter.MigrationService/GospelPresenter.MigrationService.csproj", "GospelPresenter.MigrationService/"]
COPY ["GospelPresenter.Shared/GospelPresenter.Shared.csproj", "GospelPresenter.Shared/"]
COPY ["GospelPresenter.ServiceDefaults/GospelPresenter.ServiceDefaults.csproj", "GospelPresenter.ServiceDefaults/"]
RUN dotnet restore "GospelPresenter.MigrationService/GospelPresenter.MigrationService.csproj"
COPY . .
WORKDIR "/src/GospelPresenter.MigrationService"
RUN dotnet build "GospelPresenter.MigrationService.csproj" -c $BUILD_CONFIGURATION -o /app/build

FROM build AS publish
ARG BUILD_CONFIGURATION=Release
RUN dotnet publish "GospelPresenter.MigrationService.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "GospelPresenter.MigrationService.dll"]
