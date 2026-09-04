using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

using static GospelPresenter.IntegrationTests.Sync.SyncTestEnvironment;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// A machine that is switched off and started again. Everything in memory goes; the database, the
/// watermark and the journal stay.
///
/// The interesting claim is not that it catches up — it would do that from an empty database too —
/// but that it catches up <em>from where it was</em>. A device that lost its watermark would refetch
/// the whole library on every launch, which nobody would notice on a church laptop with eight songs
/// and everybody would notice on one with nine hundred.
/// </summary>
[Collection(WebAppCollection.Name)]
public class DeviceRestartSyncTests
{
    [Fact]
    public async Task ARestartedDevice_ResumesFromItsWatermarkAndPicksUpWhatItMissed()
    {
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        var before = await device.SnapshotAsync();
        var watermarkBefore = await device.WatermarkAsync();
        watermarkBefore.ShouldNotBeNullOrEmpty("the first sync should have left a watermark");
        before.Songs.ShouldNotBeEmpty("the first sync should have brought the library");

        // The machine is off. Nothing can be announced to it.
        await device.RestartAsync();

        using (var scope = app.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IPresentationService>()
                .RenamePresentationAsync(OrganizationId, PresentationId, "Ändrad medan enheten var avstängd", Caller());

        var pullsBefore = device.Pulls;

        // Started again, exactly as Program.cs starts it: the scheduler first, then the doorbell.
        device.Scheduler.Start();
        device.Doorbell.Start();

        await WaitUntilAsync(
            async () => await device.PresentationNameAsync() == "Ändrad medan enheten var avstängd",
            "a restarted machine should pick up what changed while it was off");

        var watermarkAfter = await device.WatermarkAsync();
        string.CompareOrdinal(watermarkAfter, watermarkBefore).ShouldBeGreaterThanOrEqualTo(0,
            "the watermark must move forward across a restart, never back to the beginning");

        var after = await device.SnapshotAsync();
        after.Songs.ShouldBe(before.Songs, "a restart is not a reason to fetch the song library again");
        after.Items.Count.ShouldBe(before.Items.Count, "nor the presentation items");

        await device.WaitUntilQuietAsync();
        (device.Pulls - pullsBefore).ShouldBeLessThanOrEqualTo(3,
            $"starting up should cost a catch-up round or two — the scheduler's and the doorbell's — " +
            $"not a stream of them, but this device pulled {device.Pulls - pullsBefore} times");
    }

    [Fact]
    public async Task AnEditMadeBeforeTheRestart_IsStillPushedAfterIt()
    {
        // The journal is on disk for exactly this reason. An edit made in the church hall and then
        // followed by closing the laptop must not be the edit that disappears.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();

        device.Connectivity.GoOffline();
        await device.RenameLocallyAsync("Ändrad innan datorn stängdes av");
        (await device.PendingJournalRowsAsync()).ShouldBeGreaterThan(0,
            "the edit should be waiting in the journal");

        // Switched off with the edit still unsent, and started again with a network.
        await device.RestartAsync();
        device.Connectivity.GoOnline();
        device.Scheduler.Start();

        await WaitUntilAsync(
            async () => await ServerPresentationNameAsync(app) == "Ändrad innan datorn stängdes av",
            "the edit should survive the restart and go on the next start-up sync");

        await device.WaitUntilQuietAsync();
        (await device.PendingJournalRowsAsync()).ShouldBe(0, "and the journal should be consumed");
    }

    private static async Task<string?> ServerPresentationNameAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.Presentations
            .Where(p => p.Id == PresentationId).Select(p => p.Name).FirstOrDefaultAsync();
    }
}
