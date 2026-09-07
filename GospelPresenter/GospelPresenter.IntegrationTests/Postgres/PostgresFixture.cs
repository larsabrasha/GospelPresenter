using GospelPresenter.Shared.Contexts;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace GospelPresenter.IntegrationTests.Postgres;

/// <summary>
/// A real PostgreSQL, the database production runs on. Every other test in the repository runs on
/// SQLite, which proves the logic and nothing about what only Postgres does: the migrations (their
/// SQL does not all apply to SQLite, so nothing else ever ran them), the Version trigger, the jsonb
/// theme column and the -infinity timestamps. Applying the migrations in InitializeAsync is itself
/// the first assertion — a migration that fails on Postgres fails this fixture.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder()
        .WithImage("postgres:17")
        .Build();

    public IDbContextFactory<PresentationContext> Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await container.StartAsync();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseNpgsql(container.GetConnectionString())
            .Options;
        Factory = new NpgsqlContextFactory(options);

        await using var context = Factory.CreateDbContext();
        await context.Database.MigrateAsync();
    }

    public Task DisposeAsync() => container.DisposeAsync().AsTask();

    private sealed class NpgsqlContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}

[CollectionDefinition(Name)]
public class PostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "Postgres";
}
