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
FROM mcr.microsoft.com/dotnet/sdk:10.0.201 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY ["GospelPresenter.Web/GospelPresenter.Web.csproj", "GospelPresenter.Web/"]
COPY ["GospelPresenter.Shared/GospelPresenter.Shared.csproj", "GospelPresenter.Shared/"]
COPY ["GospelPresenter.ServiceDefaults/GospelPresenter.ServiceDefaults.csproj", "GospelPresenter.ServiceDefaults/"]
RUN dotnet restore "GospelPresenter.Web/GospelPresenter.Web.csproj"
COPY . .
WORKDIR "/src/GospelPresenter.Web"
RUN dotnet build "GospelPresenter.Web.csproj" -c $BUILD_CONFIGURATION -o /app/build

FROM build AS publish
ARG BUILD_CONFIGURATION=Release
RUN dotnet publish "GospelPresenter.Web.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "GospelPresenter.Web.dll"]
