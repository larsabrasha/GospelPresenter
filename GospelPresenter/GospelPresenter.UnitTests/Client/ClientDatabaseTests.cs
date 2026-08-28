using GospelPresenter.Client.Data;
using GospelPresenter.Client.Sync;
using GospelPresenter.Shared.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// Guards the MAUI app's local database. The drift test is the important one: devices hold
/// offline edits, so the schema can only ever move through the SQLite migration set — an entity
/// change without a matching client migration would strand every installed app. This test turns
/// that mistake into a red build. Every model change needs TWO migrations: the Npgsql set in
/// GospelPresenter.Shared (the server) and the SQLite set in GospelPresenter.Client (the app).
/// </summary>
public class ClientDatabaseTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<ClientDataContext> factory;

    public ClientDatabaseTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<ClientDataContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public void TheMigrationSet_CoversTheCurrentModel()
    {
        // Act -- diff the last migration snapshot against the current model
        using var context = factory.CreateDbContext();

        // Assert
        context.Database.HasPendingModelChanges().ShouldBeFalse(
            "the model changed without a client migration — run: dotnet ef migrations add <Name> --project GospelPresenter.Client");
    }

    [Fact]
    public async Task Initialize_MigratesInstallsTriggersAndSeedsThemes()
    {
        // Act
        var initializer = new ClientDatabaseInitializer(factory, NullLogger<ClientDatabaseInitializer>.Instance);
        await initializer.InitializeAsync();

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        (await context.Database.GetPendingMigrationsAsync()).ShouldBeEmpty();
        (await context.Themes.AnyAsync(t => t.OrganizationId == null)).ShouldBeTrue("built-in themes must work on first run offline");
    }

    [Fact]
    public async Task TheTriggers_JournalLocalWritesButNotAppliedServerRows()
    {
        // Arrange
        var initializer = new ClientDatabaseInitializer(factory, NullLogger<ClientDatabaseInitializer>.Instance);
        await initializer.InitializeAsync();

        await using var context = await factory.CreateDbContextAsync();
        var org = new Organization { Name = "Org" };
        context.Organizations.Add(org);
        await context.SaveChangesAsync();

        // Act -- a local edit is journaled...
        context.Songs.Add(new DbSong { Id = "song-local", Name = "Lokal sång", OrganizationId = org.Id });
        await context.SaveChangesAsync();

        // ...but rows written while the applying flag is set are not (echo suppression)
        context.SyncState.Add(new SyncStateEntry { Key = SyncStateEntry.ApplyingKey, Value = "1" });
        await context.SaveChangesAsync();
        context.Songs.Add(new DbSong { Id = "song-from-server", Name = "Serverns sång", OrganizationId = org.Id });
        await context.SaveChangesAsync();

        // Assert
        var journal = await context.SyncJournal.ToListAsync();
        var songEntries = journal.Where(j => j.EntityTable == "Songs").ToList();
        songEntries.ShouldHaveSingleItem();
        songEntries[0].RowId.ShouldBe("song-local");
        songEntries[0].Op.ShouldBe("I");
    }

    [Fact]
    public async Task TheTriggers_CatchExecuteUpdateAndExecuteDelete()
    {
        // Arrange -- these statements bypass every EF-level hook; only the triggers see them
        var initializer = new ClientDatabaseInitializer(factory, NullLogger<ClientDatabaseInitializer>.Instance);
        await initializer.InitializeAsync();

        await using var context = await factory.CreateDbContextAsync();
        var org = new Organization { Name = "Org" };
        context.Organizations.Add(org);
        context.Songs.Add(new DbSong { Id = "song-1", Name = "Sång", OrganizationId = org.Id });
        await context.SaveChangesAsync();
        await context.SyncJournal.ExecuteDeleteAsync();

        // Act
        await context.Songs.Where(s => s.Id == "song-1")
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Name, "Nytt namn"));
        await context.Songs.Where(s => s.Id == "song-1")
            .ExecuteDeleteAsync();

        // Assert
        var ops = await context.SyncJournal
            .Where(j => j.EntityTable == "Songs")
            .OrderBy(j => j.Id)
            .Select(j => j.Op)
            .ToListAsync();
        ops.ShouldBe(["U", "D"]);
    }

    private class TestDbContextFactory(DbContextOptions<ClientDataContext> options)
        : IDbContextFactory<ClientDataContext>
    {
        public ClientDataContext CreateDbContext() => new(options);
    }
}
