FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["GospelPresenter.E2ETests/GospelPresenter.E2ETests.csproj", "GospelPresenter.E2ETests/"]
RUN dotnet restore "GospelPresenter.E2ETests/GospelPresenter.E2ETests.csproj"
COPY . .
WORKDIR "/src/GospelPresenter.E2ETests"
RUN dotnet publish "GospelPresenter.E2ETests.csproj" \
    -c Release \
    -o /app/publish \
    --self-contained false

FROM mcr.microsoft.com/playwright/dotnet:v1.52.0-noble AS final
RUN apt-get update && apt-get install -y --no-install-recommends libfontconfig1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
ENV E2E_BASE_URL=http://web:8080
ENTRYPOINT ["dotnet", "test", "GospelPresenter.E2ETests.dll", "--logger:console;verbosity=normal"]
