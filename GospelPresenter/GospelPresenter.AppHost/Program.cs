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

var migrations = builder
    .AddProject<Projects.GospelPresenter_MigrationService>("migrations")
    .WithReference(postgresdb)
    .WaitFor(postgresdb);

builder
    .AddProject<Projects.GospelPresenter_Web>("gospelpresenter-web")
    .WithReference(postgresdb)
    .WaitForCompletion(migrations);

builder.Build().Run();
