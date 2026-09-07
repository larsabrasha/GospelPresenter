using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Postgres;

/// <summary>
/// What only the production database can prove. Each test seeds its own organisation, because the
/// database is shared across the collection.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PostgresBehaviourTests(PostgresFixture postgres)
{
    private readonly IDbContextFactory<PresentationContext> factory = postgres.Factory;

    [Fact]
    public async Task Migrations_ApplyCleanly_AndLeaveNothingPending()
    {
        await using var context = await factory.CreateDbContextAsync();

        (await context.Database.GetPendingMigrationsAsync()).ShouldBeEmpty();
        (await context.Database.GetAppliedMigrationsAsync()).ShouldContain(m => m.EndsWith("AddTombstoneEntityIndex"));
    }

    [Fact]
    public async Task TheTombstoneLookupIndex_Exists()
    {
        await using var context = await factory.CreateDbContextAsync();

        var indexes = await context.Database
            .SqlQueryRaw<string>("""SELECT indexname AS "Value" FROM pg_indexes WHERE tablename = 'SyncTombstones' """)
            .ToListAsync();

        indexes.ShouldContain("IX_SyncTombstones_OrganizationId_EntityType_EntityId");
    }

    /// <summary>The trigger, not the application, maintains Version — including through ExecuteUpdate.</summary>
    [Fact]
    public async Task TheVersionTrigger_CountsEveryWrite_IncludingExecuteUpdate()
    {
        var org = await SeedOrganizationAsync();
        string songId;
        await using (var context = await factory.CreateDbContextAsync())
        {
            var song = new DbSong { Name = "Trigger", OrganizationId = org.Id };
            context.Songs.Add(song);
            await context.SaveChangesAsync();
            songId = song.Id;
        }

        await using (var context = await factory.CreateDbContextAsync())
        {
            (await context.Songs.SingleAsync(s => s.Id == songId)).Version.ShouldBe(1);
            await context.Songs.Where(s => s.Id == songId).ExecuteUpdateAsync(s => s.SetProperty(x => x.Name, "Renamed"));
        }

        await using (var verify = await factory.CreateDbContextAsync())
            (await verify.Songs.SingleAsync(s => s.Id == songId)).Version.ShouldBe(2);
    }

    [Fact]
    public async Task ThemeDefinitions_RoundTripThroughJsonb()
    {
        var org = await SeedOrganizationAsync();
        var theme = new Theme
        {
            OrganizationId = org.Id,
            Name = "Jsonb",
            Definition = new SlideTheme { Song = new SlideStyle { MainText = new SlideTextStyle { FontSize = 77, Align = SlideTextAlign.Left } } },
        };
        await using (var context = await factory.CreateDbContextAsync())
        {
            context.Themes.Add(theme);
            await context.SaveChangesAsync();
        }

        await using var verify = await factory.CreateDbContextAsync();
        var stored = await verify.Themes.SingleAsync(t => t.Id == theme.Id);
        stored.Definition.Song.MainText.FontSize.ShouldBe(77);
        stored.Definition.Song.MainText.Align.ShouldBe(SlideTextAlign.Left);
    }

    /// <summary>
    /// Rows from before sync tracking carry ModifiedAt = -infinity (CLAUDE.md, "Offline sync
    /// tracking"). An unbounded first pull must deliver them; a later pull must not.
    /// </summary>
    [Fact]
    public async Task RowsStampedMinusInfinity_ArePulledOnce_ByAnUnboundedPull()
    {
        var org = await SeedOrganizationAsync();
        string songId;
        await using (var context = await factory.CreateDbContextAsync())
        {
            var song = new DbSong { Name = "Ancient", OrganizationId = org.Id };
            context.Songs.Add(song);
            await context.SaveChangesAsync();
            songId = song.Id;
            await context.Songs.Where(s => s.Id == songId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, DateTimeOffset.MinValue));
        }

        await using (var verify = await factory.CreateDbContextAsync())
            (await verify.Songs.SingleAsync(s => s.Id == songId)).ModifiedAt.ShouldBe(DateTimeOffset.MinValue);

        var sync = CreateSyncService();
        var caller = new CallerContext("user", UserRole.User, org.Id);
        var first = await sync.PullAsync(org.Id, new SyncPullRequest(null, null), caller);
        var later = await sync.PullAsync(org.Id, new SyncPullRequest(DateTimeOffset.UtcNow.AddMinutes(-30), null), caller);

        first.Changes.Songs.Select(s => s.Id).ShouldContain(songId);
        later.Changes.Songs.Select(s => s.Id).ShouldNotContain(songId);
    }

    /// <summary>
    /// The explicit detach in DeleteLabelAsync on the real trigger: the part's Version moves (the
    /// trigger) and its ModifiedAt moves (the application) — both, or the pull never tells anyone.
    /// </summary>
    [Fact]
    public async Task DeletingALabel_StampsTheDetachedParts_AndTheTriggerBumpsThem()
    {
        var org = await SeedOrganizationAsync();
        var past = DateTimeOffset.UtcNow.AddHours(-1);
        string labelId, partId;
        await using (var context = await factory.CreateDbContextAsync())
        {
            var label = new DbSongPartLabel { Text = "Vers", OrganizationId = org.Id };
            var song = new DbSong { Name = "Labelled", OrganizationId = org.Id };
            var part = new DbSongPart { Content = "Text", SortOrder = 0, Label = label };
            song.Parts.Add(part);
            context.SongPartLabels.Add(label);
            context.Songs.Add(song);
            await context.SaveChangesAsync();
            labelId = label.Id;
            partId = part.Id;
            await context.SongParts.Where(p => p.Id == partId).ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, past));
        }
        long versionBefore;
        await using (var read = await factory.CreateDbContextAsync())
            versionBefore = (await read.SongParts.SingleAsync(p => p.Id == partId)).Version;

        await new SongPartLabelService(factory).DeleteLabelAsync(org.Id, labelId, new CallerContext("user", UserRole.Admin, org.Id));

        await using var verify = await factory.CreateDbContextAsync();
        var detached = await verify.SongParts.SingleAsync(p => p.Id == partId);
        detached.LabelId.ShouldBeNull();
        detached.ModifiedAt.ShouldBeGreaterThan(past);
        detached.Version.ShouldBeGreaterThan(versionBefore);
        (await verify.SongPartLabels.AnyAsync(l => l.Id == labelId)).ShouldBeFalse();
    }

    private async Task<Organization> SeedOrganizationAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        var org = new Organization { Name = $"Org {Guid.NewGuid():N}" };
        context.Organizations.Add(org);
        await context.SaveChangesAsync();
        return org;
    }

    private SyncService CreateSyncService()
    {
        var storage = new NoObjectStorage();
        return new SyncService(
            factory, storage, new FixedLocalizer(),
            new PresentationService(factory, storage),
            new SongService(factory),
            new SongPartLabelService(factory),
            new OrganizationImageService(factory, storage),
            new OrganizationAudioService(factory, storage));
    }

    private sealed class FixedLocalizer : IStringLocalizer<SharedResource>
    {
        public LocalizedString this[string name] => new(name, name);
        public LocalizedString this[string name, params object[] arguments] => new(name, name);
        public IEnumerable<LocalizedString> GetAllStrings(bool includeParentCultures) => [];
    }
}
