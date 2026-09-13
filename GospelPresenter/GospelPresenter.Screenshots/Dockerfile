# Pinned for the same reason as the two server Dockerfiles, and this one was missed when they were:
# global.json holds rollForward at latestPatch, so it accepts 10.0.2xx and nothing else, while mcr's
# floating 10.0 tag has moved on to 10.0.401 and the build dies on "A compatible .NET SDK was not
# found". Raise this together with global.json, never on its own.
FROM mcr.microsoft.com/dotnet/sdk:10.0.201 AS build
WORKDIR /src
COPY ["GospelPresenter.Screenshots/GospelPresenter.Screenshots.csproj", "GospelPresenter.Screenshots/"]
RUN dotnet restore "GospelPresenter.Screenshots/GospelPresenter.Screenshots.csproj"
COPY . .
WORKDIR "/src/GospelPresenter.Screenshots"
RUN dotnet publish "GospelPresenter.Screenshots.csproj" \
    -c Release \
    -o /app/publish \
    --self-contained true \
    /p:PublishSingleFile=false

FROM mcr.microsoft.com/playwright/dotnet:v1.52.0-noble AS final
RUN apt-get update && apt-get install -y --no-install-recommends libfontconfig1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["./GospelPresenter.Screenshots"]
