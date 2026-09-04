var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder
    .AddPostgres("postgres")
    // .WithPgAdmin(pgAdmin => pgAdmin
    //     .WithHostPort(5051)
    //     .WithLifetime(ContainerLifetime.Persistent)
    // )
    .WithPgWeb(pgAdmin => pgAdmin
        .WithHostPort(5050)
        .WithLifetime(ContainerLifetime.Persistent)
    )
    .WithDataVolume(isReadOnly: false)
    .WithLifetime(ContainerLifetime.Persistent);

var postgresdb = postgres
    .AddDatabase("postgresdb");

// Docker answers a missing bind-mount source by silently creating a directory in its place, so a
// forgotten garage.toml becomes a container that starts, finds a directory where its configuration
// should be, and dies with nothing anywhere saying why. A worktree makes it likelier: the file is
// gitignored, so a fresh checkout never has it and the README step is easy to skip. Fail here, with
// the fix in the message, rather than leaving it to be read out of container logs.
var garageConfigPath = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "..", "garage.toml"));
if (!File.Exists(garageConfigPath))
{
    throw new InvalidOperationException(
        $"There is no garage.toml at {garageConfigPath}. Run 'cp garage.toml.example garage.toml' "
        + "in the GospelPresenter directory first (see the README). If a directory of that name is "
        + "in the way, an earlier run without the file made it — remove it before copying.");
}

var garage = builder
    .AddContainer("garage", "dxflrs/garage", "v2.2.0")
    .WithBindMount("../garage.toml", "/etc/garage.toml", isReadOnly: true)
    .WithVolume("garage-data", "/var/lib/garage/data")
    .WithVolume("garage-meta", "/var/lib/garage/meta")
    .WithEnvironment("GARAGE_ALLOW_WORLD_READABLE_SECRETS", "true")
    .WithHttpEndpoint(port: 3900, targetPort: 3900, name: "s3")
    .WithHttpEndpoint(port: 3903, targetPort: 3903, name: "admin")
    .WithLifetime(ContainerLifetime.Persistent);

var garageEndpoint = garage.GetEndpoint("s3");
var garageAdminEndpoint = garage.GetEndpoint("admin");
const string garageAccessKey = "GK881013861324c22156c5f3f6";
const string garageSecretKey = "7e810979b9b599935fa54b936660b2a34e688777180f043fcc2c3d107ac63ce6";

var migrations = builder
    .AddProject<Projects.GospelPresenter_MigrationService>("migrations")
    .WithReference(postgresdb)
    .WaitFor(postgresdb)
    .WaitFor(garage)
    .WithS3Environment(garageEndpoint, garageAccessKey, garageSecretKey)
    .WithEnvironment("S3__AdminEndpoint", garageAdminEndpoint)
    .WithEnvironment("S3__AdminToken", "gospelpresenter-admin-token");

var gotenberg = builder
    .AddContainer("gotenberg", "gotenberg/gotenberg", "8")
    .WithArgs("gotenberg", "--api-timeout=120s", "--libreoffice-restart-after=10")
    .WithHttpEndpoint(targetPort: 3000, name: "http")
    .WithLifetime(ContainerLifetime.Persistent);

var gotenbergEndpoint = gotenberg.GetEndpoint("http");

var web = builder
    .AddProject<Projects.GospelPresenter_Web>("gospelpresenter-web")
    .WithReference(postgresdb)
    .WaitForCompletion(migrations)
    .WithS3Environment(garageEndpoint, garageAccessKey, garageSecretKey)
    .WithEnvironment("Gotenberg__Endpoint", gotenbergEndpoint)
    // Pinned, and not for tidiness: Google only redirects back to a URI it has on file, and
    // Aspire's proxy picks a new port every run, so https://localhost:<random>/signin-google could
    // never match one. Any sign-in through the local stack — the desktop app's device flow, the
    // MAUI app's, or just opening the web app — fails with redirect_uri_mismatch until this is
    // fixed. 7175 is the port the Web project uses when run on its own, so it is the one already
    // registered. Unproxied, because the proxy is what was reassigning it.
    .WithEndpoint("https", endpoint =>
    {
        endpoint.Port = 7175;
        endpoint.TargetPort = 7175;
        endpoint.IsProxied = false;
    });

// The desktop app, pointed at the local server through GP_API_BASE_URL
// (GospelPresenter.Desktop/DesktopSettings.cs) — so it runs the real device flow (browser
// sign-in, device token, sync, the change hub) against this stack rather than the offline
// developer identity, and a change to either half can be seen working without tagging a release
// and waiting for a deploy.
//
// It replaces a mac-app resource that built net10.0-maccatalyst: that target left the MAUI
// project when the desktop moved to Electron (adr/0003), so the resource had been unbuildable
// ever since. The MAUI clients are dormant and are not started from here.
//
// Run rather than AddProject: this is an Electron host, and it picks its own port for the local
// Kestrel that serves the UI into the window — an injected ASPNETCORE_URLS would fight it. The
// scheme defaults to GospelPresenterLocal, which is what keeps this installation's database,
// callback scheme and keychain entry apart from a real one.
//
// Explicit start, because the first build takes a while and web-only sessions should not pay for
// it — press play on the resource in the dashboard when the client is wanted.
builder
    .AddExecutable("desktop", "dotnet", workingDirectory: "..",
        "run", "--project", "GospelPresenter/GospelPresenter.Desktop/GospelPresenter.Desktop.csproj")
    // The https endpoint (the dev certificate is trusted locally): pointing the app at http
    // would bounce every API call through UseHttpsRedirection's 307, and HttpClient drops the
    // Authorization header on cross-origin redirects.
    .WithEnvironment("GP_API_BASE_URL", web.GetEndpoint("https"))
    .WithExplicitStart()
    .WaitFor(web);

builder.Build().Run();

static class S3Extensions
{
    public static IResourceBuilder<T> WithS3Environment<T>(
        this IResourceBuilder<T> resource,
        EndpointReference endpoint, string accessKey, string secretKey)
        where T : IResourceWithEnvironment
    {
        return resource
            .WithEnvironment("S3__Endpoint", endpoint)
            .WithEnvironment("S3__AccessKey", accessKey)
            .WithEnvironment("S3__SecretKey", secretKey)
            .WithEnvironment("S3__BucketName", "gospelpresenter")
            .WithEnvironment("S3__Region", "garage");
    }
}
