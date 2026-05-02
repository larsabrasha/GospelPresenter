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

builder
    .AddProject<Projects.GospelPresenter_Web>("gospelpresenter-web")
    .WithReference(postgresdb)
    .WaitForCompletion(migrations)
    .WithS3Environment(garageEndpoint, garageAccessKey, garageSecretKey)
    .WithEnvironment("Gotenberg__Endpoint", gotenbergEndpoint);

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
