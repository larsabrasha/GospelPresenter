FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
USER $APP_UID
WORKDIR /app
EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY ["GospelPresenter.Web/GospelPresenter.Web.csproj", "GospelPresenter.Web/"]
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
