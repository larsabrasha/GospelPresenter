using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

using static GospelPresenter.IntegrationTests.Sync.SyncTestEnvironment;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// Two machines and a server holding one church's library between them, put through the shapes of
/// change that are not a single row being renamed: a deletion, a child row, a whole new
/// presentation, and a delete racing an edit of the same thing.
///
/// <see cref="DeviceSyncEndToEndTests"/> proves the loop works. This proves it works for everything
/// the loop carries — which is where a missing announcement hides, because a change that is late
/// rather than lost is the kind of bug nobody reports.
///
/// The two devices take turns on purpose. The test server's database is one shared in-memory
/// connection, so a test awaits one machine's cycle before provoking the other rather than letting
/// them race for it.
/// </summary>
[Collection(WebAppCollection.Name)]
public class TwoDeviceLibraryTests
{
    [Fact]
    public async Task ASongDeletedOnOneDevice_LeavesTheOthersLibrary()
    {
        using var app = new WebAppFixture();
        await using var laptop = await DeviceHarness.CreateAsync(app);
        await using var deskMachine = await DeviceHarness.CreateAsync(app);

        var songId = await FirstSongIdAsync(app);
        await laptop.Scheduler.SyncNowAsync();
        await deskMachine.Scheduler.SyncNowAsync();
        (await deskMachine.HasLiveSongAsync(songId)).ShouldBeTrue("both machines should start with the song");

        deskMachine.Doorbell.Start();
        await deskMachine.WaitUntilListeningAsync();

        await laptop.DeleteSongLocallyAsync(songId);
        await laptop.Scheduler.SyncNowAsync();

        await WaitUntilAsync(
            async () => !await deskMachine.HasLiveSongAsync(songId),
            "a song sent to the trash on one machine should leave the other machine's library");

        // A soft delete, so the row is still there to be restored from the trash — on both ends.
        (await deskMachine.HasSongAsync(songId)).ShouldBeTrue(
            "the song is in the trash, not gone: restoring it must still be possible");
        (await ServerSongIsLiveAsync(app, songId)).ShouldBeFalse();
    }

    [Fact]
    public async Task APresentationTrashedOnTheServer_ReachesTheDeviceTrashWhole()
    {
        // Deleting a presentation is soft: DeletedAt travels as an ordinary column, so the device
        // hides it from the library and offers the same trash the server does. No tombstone, and
        // the aggregate underneath it is untouched — that is what a restore needs to find.
        using var app = new WebAppFixture { ObjectStorageConfigured = true };
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        (await device.HasPresentationAsync(PresentationId)).ShouldBeTrue();
        var itemsBefore = await device.ItemCountAsync(PresentationId);
        itemsBefore.ShouldBeGreaterThan(0, "the seeded presentation should have arrived with its items");

        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        using (var scope = app.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IPresentationService>()
                .DeletePresentationAsync(OrganizationId, PresentationId, Caller());

        await WaitUntilAsync(
            async () => !await device.HasPresentationAsync(PresentationId),
            "the trashing should have reached the device");

        (await device.HasTrashedPresentationAsync(PresentationId)).ShouldBeTrue(
            "the device should offer the same trash as the server");
        (await device.ItemCountAsync(PresentationId)).ShouldBe(itemsBefore,
            "trashing destroys nothing, so the items must still be there to restore");
    }

    [Fact]
    public async Task APresentationPurgedOnTheServer_IsRemovedFromTheDevice()
    {
        // Emptying the trash is the delete that is final: a tombstone for the aggregate root, which
        // the device cascades to the items and parts underneath it.
        //
        // With storage, because this presentation owns slides and purging it clears their blobs —
        // incidental to the sync, and the default fixture's storage throws.
        using var app = new WebAppFixture { ObjectStorageConfigured = true };
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        (await device.HasPresentationAsync(PresentationId)).ShouldBeTrue();
        (await device.ItemCountAsync(PresentationId)).ShouldBeGreaterThan(0,
            "the seeded presentation should have arrived with its items");

        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        using (var scope = app.Services.CreateScope())
        {
            var presentations = scope.ServiceProvider.GetRequiredService<IPresentationService>();
            await presentations.DeletePresentationAsync(OrganizationId, PresentationId, Caller());
            await presentations.PermanentlyDeletePresentationAsync(OrganizationId, PresentationId, Caller());
        }

        await WaitUntilAsync(
            async () => !await device.HasTrashedPresentationAsync(PresentationId)
                && !await device.HasPresentationAsync(PresentationId),
            "the tombstone should have reached the device");

        (await device.ItemCountAsync(PresentationId)).ShouldBe(0,
            "one tombstone for the root; the device cascades to what hung off it");
    }

    [Fact]
    public async Task AnItemAddedOnOneDevice_ReachesTheOther()
    {
        // A child row carries no organisation of its own. It is announced only because adding it
        // bumps the presentation that does — the convention this codebase enforces everywhere and
        // that nothing would complain about if it were dropped.
        using var app = new WebAppFixture();
        await using var laptop = await DeviceHarness.CreateAsync(app);
        await using var deskMachine = await DeviceHarness.CreateAsync(app);

        await laptop.Scheduler.SyncNowAsync();
        await deskMachine.Scheduler.SyncNowAsync();
        var before = await deskMachine.ItemCountAsync(PresentationId);

        deskMachine.Doorbell.Start();
        await deskMachine.WaitUntilListeningAsync();

        await laptop.AddItemLocallyAsync(PresentationId, "Tillagd på laptopen");
        await laptop.Scheduler.SyncNowAsync();

        await WaitUntilAsync(
            async () => await deskMachine.ItemCountAsync(PresentationId) == before + 1,
            "adding an item should have woken the other machine through its presentation");

        await using var db = deskMachine.Factory.CreateDbContext();
        (await db.PresentationItems.AnyAsync(i => i.Title == "Tillagd på laptopen")).ShouldBeTrue(
            "and the item itself should have come with it, not only the count");
    }

    [Fact]
    public async Task APresentationCreatedOnTheServer_ReachesBothDevices()
    {
        using var app = new WebAppFixture();
        await using var laptop = await DeviceHarness.CreateAsync(app);
        await using var deskMachine = await DeviceHarness.CreateAsync(app);

        await laptop.Scheduler.SyncNowAsync();
        await deskMachine.Scheduler.SyncNowAsync();

        laptop.Doorbell.Start();
        deskMachine.Doorbell.Start();
        await laptop.WaitUntilListeningAsync();
        await deskMachine.WaitUntilListeningAsync();

        string created;
        using (var scope = app.Services.CreateScope())
        {
            var presentation = await scope.ServiceProvider.GetRequiredService<IPresentationService>()
                .CreatePresentationAsync("Nyskapad på webben", OrganizationId, WebAppFixture.MockUserId, Caller());
            created = presentation.Id;
        }

        await WaitUntilAsync(
            async () => await laptop.HasPresentationAsync(created),
            "a whole new aggregate should reach the first machine");
        await WaitUntilAsync(
            async () => await deskMachine.HasPresentationAsync(created),
            "and the second one too");
    }

    [Fact]
    public async Task ADeleteMadeOffline_AndAnEditOnTheServer_LeaveBothEndsAgreeing()
    {
        // Somebody has to lose. Which one matters less than that the two ends stop disagreeing:
        // a device holding a row the server has dropped, or the reverse, is a library that shows a
        // different service depending on which machine the operator is standing at.
        //
        // With storage, because the delete this device pushes reaches a presentation that owns
        // slides, and clearing their blobs is incidental to the sync.
        using var app = new WebAppFixture { ObjectStorageConfigured = true };
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Connectivity.GoOffline();

        await device.DeletePresentationLocallyAsync(PresentationId);
        (await device.HasPresentationAsync(PresentationId)).ShouldBeFalse("the delete applies locally at once");

        using (var scope = app.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IPresentationService>()
                .RenamePresentationAsync(OrganizationId, PresentationId, "Ändrad medan enheten raderade", Caller());

        device.Connectivity.GoOnline();
        await device.Scheduler.SyncNowAsync();
        await device.WaitUntilQuietAsync();

        var onServer = await ServerHasPresentationAsync(app, PresentationId);
        var onDevice = await device.HasPresentationAsync(PresentationId);
        onDevice.ShouldBe(onServer,
            $"the two ends must agree; the server {(onServer ? "kept" : "dropped")} it and the device " +
            $"{(onDevice ? "kept" : "dropped")} it");

        if (onServer)
        {
            (await device.PresentationNameAsync()).ShouldBe(await ServerPresentationNameAsync(app, PresentationId),
                "and the row that survived should read the same on both");
        }

        (await device.PendingJournalRowsAsync()).ShouldBe(0, "the device should be able to push again");
    }

    [Fact]
    public async Task AfterEditsFromAllThreeEnds_BothDevicesMatchTheServerRowForRow()
    {
        // The end state, which is the only assertion that catches a row quietly left behind. Counts
        // match for the wrong reasons often enough to be worth avoiding, so this compares ids and
        // names.
        using var app = new WebAppFixture();
        await using var laptop = await DeviceHarness.CreateAsync(app);
        await using var deskMachine = await DeviceHarness.CreateAsync(app);

        await laptop.Scheduler.SyncNowAsync();
        await deskMachine.Scheduler.SyncNowAsync();

        laptop.Doorbell.Start();
        deskMachine.Doorbell.Start();
        await laptop.WaitUntilListeningAsync();
        await deskMachine.WaitUntilListeningAsync();

        var songId = await FirstSongIdAsync(app);
        var otherId = await SecondPresentationIdAsync(app);

        // One edit from each end, of a different shape each time.
        using (var scope = app.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IPresentationService>()
                .RenamePresentationAsync(OrganizationId, PresentationId, "Ändrad på servern", Caller());
        await WaitUntilAsync(async () => await laptop.PresentationNameAsync() == "Ändrad på servern", "the laptop");
        await WaitUntilAsync(async () => await deskMachine.PresentationNameAsync() == "Ändrad på servern", "the desk machine");

        await laptop.AddItemLocallyAsync(PresentationId, "Tillagd på laptopen");
        await laptop.Scheduler.SyncNowAsync();
        await laptop.WaitUntilQuietAsync();
        await WaitUntilAsync(
            async () => (await deskMachine.SnapshotAsync()).Items.Exists(i => i.EndsWith("|Tillagd på laptopen")),
            "the desk machine should have the laptop's item");

        await deskMachine.RenameSongLocallyAsync(songId, "Ändrad på skrivbordsmaskinen");
        await deskMachine.Scheduler.SyncNowAsync();
        await deskMachine.WaitUntilQuietAsync();
        await WaitUntilAsync(
            async () => await laptop.SongNameAsync(songId) == "Ändrad på skrivbordsmaskinen",
            "the laptop should have the desk machine's song edit");

        await deskMachine.RenameLocallyAsync(otherId, "Ännu en ändring");
        await deskMachine.Scheduler.SyncNowAsync();
        await deskMachine.WaitUntilQuietAsync();
        await WaitUntilAsync(
            async () => await laptop.PresentationNameAsync(otherId) == "Ännu en ändring",
            "and the last one too");

        // Read the server only once both devices have gone quiet: its database is one shared
        // connection, and reading it mid-sync is a locked database rather than a slow one.
        await laptop.WaitUntilQuietAsync();
        await deskMachine.WaitUntilQuietAsync();

        var expected = await ServerSnapshotAsync(app);
        foreach (var (name, device) in new[] { ("the laptop", laptop), ("the desk machine", deskMachine) })
        {
            var snapshot = await device.SnapshotAsync();
            snapshot.Presentations.ShouldBe(expected.Presentations, $"{name}'s presentations should match the server");
            snapshot.Songs.ShouldBe(expected.Songs, $"{name}'s songs should match the server");
            snapshot.Items.ShouldBe(expected.Items, $"{name}'s presentation items should match the server");
        }
    }

    // --- The server side ---

    /// <summary>
    /// The organisation's library as the server holds it. Scoped to the one organisation, because a
    /// device holds only its own and the two would otherwise never be comparable.
    /// </summary>
    private static async Task<LibrarySnapshot> ServerSnapshotAsync(WebAppFixture app)
    {
        await using var context = Context(app);
        return new LibrarySnapshot(
            await context.Presentations
                .Where(p => p.OrganizationId == OrganizationId)
                .OrderBy(p => p.Id).Select(p => p.Id + "|" + p.Name).ToListAsync(),
            await context.Songs
                .Where(s => s.OrganizationId == OrganizationId && s.DeletedAt == null)
                .OrderBy(s => s.Id).Select(s => s.Id + "|" + s.Name).ToListAsync(),
            await context.PresentationItems
                .Where(i => i.Presentation.OrganizationId == OrganizationId)
                .OrderBy(i => i.Id).Select(i => i.Id + "|" + i.Title).ToListAsync());
    }

    private static async Task<string> FirstSongIdAsync(WebAppFixture app)
    {
        await using var context = Context(app);
        return await context.Songs
            .Where(s => s.OrganizationId == OrganizationId && s.DeletedAt == null)
            .OrderBy(s => s.Id).Select(s => s.Id).FirstAsync();
    }

    private static async Task<string> SecondPresentationIdAsync(WebAppFixture app)
    {
        await using var context = Context(app);
        return await context.Presentations
            .Where(p => p.OrganizationId == OrganizationId && p.Id != PresentationId && !p.IsTemplate)
            .OrderBy(p => p.Id).Select(p => p.Id).FirstAsync();
    }

    private static async Task<bool> ServerSongIsLiveAsync(WebAppFixture app, string songId)
    {
        await using var context = Context(app);
        return await context.Songs.AnyAsync(s => s.Id == songId && s.DeletedAt == null);
    }

    private static async Task<bool> ServerHasPresentationAsync(WebAppFixture app, string id)
    {
        await using var context = Context(app);
        return await context.Presentations.NotDeleted().AnyAsync(p => p.Id == id);
    }

    private static async Task<string?> ServerPresentationNameAsync(WebAppFixture app, string id)
    {
        await using var context = Context(app);
        return await context.Presentations.Where(p => p.Id == id).Select(p => p.Name).FirstOrDefaultAsync();
    }

    private static PresentationContext Context(WebAppFixture app) =>
        app.Services.GetRequiredService<IDbContextFactory<PresentationContext>>().CreateDbContext();
}
