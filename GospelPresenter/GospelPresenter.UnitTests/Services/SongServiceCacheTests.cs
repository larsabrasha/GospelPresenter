using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The song cache is one dictionary for every organisation on the server. Reloading it used to mean
/// reading every organisation's songs — on every sync push — and hard-deleting expired trash on the
/// way, from a read path with no caller. The reload is now per organisation and the purge is its
/// own, permission-checked operation.
/// </summary>
public class SongServiceCacheTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly SongService service;
    private readonly Organization orgA = new() { Name = "A" };
    private readonly Organization orgB = new() { Name = "B" };

    public SongServiceCacheTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options;
        factory = new TestDbContextFactory(options);
        service = new SongService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();
        context.Organizations.AddRange(orgA, orgB);
        context.Songs.AddRange(
            new DbSong { Id = "a-1", Name = "A one", OrganizationId = orgA.Id },
            new DbSong { Id = "b-1", Name = "B one", OrganizationId = orgB.Id });
        context.SaveChanges();
    }

    public void Dispose() => connection.Dispose();

    [Fact]
    public async Task LoadSongsAsync_ForOneOrganization_ReplacesOnlyThatSlice()
    {
        await service.LoadSongsAsync();
        await using (var context = await factory.CreateDbContextAsync())
        {
            context.Songs.Add(new DbSong { Id = "a-2", Name = "A two", OrganizationId = orgA.Id });
            context.Songs.Add(new DbSong { Id = "b-2", Name = "B two", OrganizationId = orgB.Id });
            await context.SaveChangesAsync();
        }

        await service.LoadSongsAsync(orgA.Id);

        service.GetSongsByOrganization(orgA.Id, Caller(orgA)).Select(s => s.Id).ShouldBe(["a-1", "a-2"]);
        // B was not reloaded: its slice is what the full load left there.
        service.GetSongsByOrganization(orgB.Id, Caller(orgB)).Select(s => s.Id).ShouldBe(["b-1"]);
    }

    [Fact]
    public async Task LoadSongsAsync_DoesNotDeleteAnything()
    {
        await using (var context = await factory.CreateDbContextAsync())
            await context.Songs.Where(s => s.Id == "a-1").ExecuteUpdateAsync(s => s.SetProperty(x => x.DeletedAt, DateTime.UtcNow.AddDays(-90)));

        await service.LoadSongsAsync();

        await using var verify = await factory.CreateDbContextAsync();
        (await verify.Songs.AnyAsync(s => s.Id == "a-1")).ShouldBeTrue();
        (await verify.SyncTombstones.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task PurgeExpiredSongsAsync_RemovesOnlyTheOrganizationsExpiredTrash_WithTombstones()
    {
        await using (var context = await factory.CreateDbContextAsync())
        {
            context.Songs.Add(new DbSong { Id = "a-fresh", Name = "Fresh", OrganizationId = orgA.Id, DeletedAt = DateTime.UtcNow.AddDays(-1) });
            await context.SaveChangesAsync();
            await context.Songs.Where(s => s.Id == "a-1" || s.Id == "b-1")
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.DeletedAt, DateTime.UtcNow.AddDays(-AppConstraints.TrashRetentionDays - 1)));
        }

        await service.PurgeExpiredSongsAsync(orgA.Id, Caller(orgA));

        await using var verify = await factory.CreateDbContextAsync();
        (await verify.Songs.Select(s => s.Id).ToListAsync()).OrderBy(x => x).ShouldBe(["a-fresh", "b-1"]);
        var tombstone = await verify.SyncTombstones.SingleAsync();
        tombstone.EntityId.ShouldBe("a-1");
        tombstone.OrganizationId.ShouldBe(orgA.Id);
    }

    [Fact]
    public async Task PurgeExpiredSongsAsync_WithoutManageSongs_Throws()
    {
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.PurgeExpiredSongsAsync(orgA.Id, new CallerContext("u", UserRole.User, orgB.Id)));
    }

    private static CallerContext Caller(Organization org) => new("user", UserRole.Admin, org.Id);

    private sealed class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
