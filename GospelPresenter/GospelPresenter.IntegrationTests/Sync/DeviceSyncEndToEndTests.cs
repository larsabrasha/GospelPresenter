using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Client.Sync;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.IntegrationTests.Helpers;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

using static GospelPresenter.IntegrationTests.Sync.SyncTestEnvironment;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// The whole device sync loop against the real server: the real engine, the real scheduler, the
/// real change-hub client, and the real domain services on both ends. The only fakes are the things
/// a test cannot have — the network's up/down state and the device's secure storage.
///
/// This is where the behaviour that matters is checked rather than argued about: how quickly
/// someone else's edit arrives, that an edit made offline is not lost, that a change announced while
/// the device was unreachable is still picked up when it comes back, and that a device is not woken
/// by its own push.
///
/// Both idle intervals are set to five minutes in the harness, far longer than any test runs. That
/// is deliberate: it means nothing here can pass because a poll happened to fire, so every arrival
/// is one the announcement or the reconnection actually caused.
///
/// The test server has no sockets, so the hub runs over long polling. That is the one thing this
/// cannot prove about a real deployment.
/// </summary>
[Collection(WebAppCollection.Name)]
public class DeviceSyncEndToEndTests
{
    [Fact]
    public async Task AnEditOnTheServer_ReachesTheDeviceInAboutASecond()
    {
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        (await device.PresentationNameAsync()).ShouldNotBeNullOrEmpty("the first sync should have pulled the seeded presentation");

        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        var started = DateTimeOffset.UtcNow;
        await RenameOnServerAsync(app, "Söndagsgudstjänst med dörrklocka");

        await WaitUntilAsync(
            async () => await device.PresentationNameAsync() == "Söndagsgudstjänst med dörrklocka",
            "the device should have been told about the edit and pulled it");

        var took = DateTimeOffset.UtcNow - started;
        // Measured at 638 ms on a developer machine: half of it the server's coalescing window,
        // the rest the round trip and the pull. Three seconds is the headroom a loaded build agent
        // gets — and what it rules out is the thing this replaced, the idle pull, which in this
        // harness cannot fire for five minutes.
        took.ShouldBeLessThan(TimeSpan.FromSeconds(3), $"the edit took {took.TotalMilliseconds:F0} ms to arrive");
    }

    [Fact]
    public async Task ATrackedSaveOnTheServer_AlsoReachesTheDevice()
    {
        // The other half of the announcement's plumbing. The rename above is an ExecuteUpdate path
        // that announces by hand; a song saved through the change tracker announces through the
        // interceptor, and nothing in the device's behaviour should be able to tell the difference.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        var songId = await AddSongOnServerAsync(app, "Nyskriven lovsång");

        await WaitUntilAsync(
            async () => await device.HasSongAsync(songId),
            "a song created on the server should reach the device without an idle pull");
    }

    [Fact]
    public async Task AnEditMadeOffline_IsPushedWhenTheNetworkComesBack()
    {
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Scheduler.Start();
        // The scheduler syncs once as it starts, and that one is not awaited. Letting it finish
        // before the network is pulled away keeps the sequence of this test the one it describes.
        await device.WaitUntilQuietAsync();

        // The network goes. Everything from here on happens on a device that cannot be reached.
        device.Connectivity.GoOffline();

        await device.RenameLocallyAsync("Ändrad i kyrksalen utan nät");
        // The scheduler notices the local write and tries; there is nowhere to send it.
        await WaitUntilAsync(
            async () => await device.PendingJournalRowsAsync() > 0,
            "the offline edit should be waiting in the journal");
        (await ServerPresentationNameAsync(app)).ShouldNotBe("Ändrad i kyrksalen utan nät");

        // Meanwhile someone edits a different presentation on the server, so the reconnection has
        // work to do in both directions.
        var otherId = await RenameAnotherOnServerAsync(app, "Ändrad på webben under tiden");

        device.Connectivity.GoOnline();

        await WaitUntilAsync(
            async () => await device.PresentationNameAsync(otherId) == "Ändrad på webben under tiden",
            "the edit made while the device was away should have been pulled");
        await device.WaitUntilQuietAsync();

        // Read once the device has finished, rather than polling: the server's test database is one
        // shared in-memory connection, and reading it while a sync is using it is a locked database
        // rather than a slow one.
        (await ServerPresentationNameAsync(app)).ShouldBe("Ändrad i kyrksalen utan nät",
            "the edit made offline should have been pushed once the network returned");
        (await device.PendingJournalRowsAsync()).ShouldBe(0, "the journal should be consumed");
    }

    [Fact]
    public async Task AChangeAnnouncedWhileTheDeviceWasAway_IsPickedUpOnReconnection()
    {
        // The announcement itself is lost — it was sent to a connection that no longer existed.
        // Reconnecting has to be treated as "anything may have happened", or the change waits for
        // the five-minute backstop.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        // The socket goes away, and with it any chance of hearing about what follows.
        await device.DropTheDoorbellAsync();
        await RenameOnServerAsync(app, "Ändrad medan enheten var borta");
        await Task.Delay(TimeSpan.FromSeconds(1));
        (await device.PresentationNameAsync()).ShouldNotBe("Ändrad medan enheten var borta",
            "with no socket and no poll, the device cannot have learnt about this yet");

        await device.RestoreTheDoorbellAsync();

        await WaitUntilAsync(
            async () => await device.PresentationNameAsync() == "Ändrad medan enheten var borta",
            "reconnecting should have made the device ask what it missed");
    }

    [Fact]
    public async Task ATwoSidedEdit_ConvergesAndLeavesTheDeviceAbleToPushAgain()
    {
        // The same song edited on both sides while the device was away. The interesting part is not
        // who wins — the server does — but what the device is left holding. If it keeps the version
        // the server rejected, its conflict base can never match again: every later edit of that row
        // conflicts afresh, invisibly, for as long as the row exists.
        //
        // A song rather than a presentation, and that is not arbitrary. Conflict detection compares
        // the row's Version, which Postgres bumps with a trigger on every write. SQLite has no such
        // trigger, so this test server only bumps it through the change tracker
        // (PresentationContext.ApplySyncTrackingAsync) — and a presentation rename is an
        // ExecuteUpdate, which bypasses it. Renaming a presentation here therefore produces no
        // conflict at all, where in production it would. Song edits are tracked saves, so they
        // behave here as they do on a real server.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        var songId = await FirstSongIdAsync(app);
        await device.Scheduler.SyncNowAsync();
        device.Connectivity.GoOffline();

        await device.RenameSongLocallyAsync(songId, "Sången ändrad på enheten");
        await Task.Delay(TimeSpan.FromMilliseconds(50));
        await RenameSongOnServerAsync(app, songId, "Sången ändrad på servern");

        device.Connectivity.GoOnline();
        await device.Scheduler.SyncNowAsync();

        device.Conflicts.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.ServerWins);
        (await ServerSongNameAsync(app, songId)).ShouldBe("Sången ändrad på servern",
            "the server's copy of a song is the one that stands");
        (await device.SongNameAsync(songId)).ShouldBe("Sången ändrad på servern",
            "the device should have adopted the version that won, not kept the one that lost");
        (await ServerSongVersionCountAsync(app, songId)).ShouldBeGreaterThan(0,
            "what the device wrote offline should be in the song's version history, not thrown away");
        (await device.PendingJournalRowsAsync()).ShouldBe(0);

        // Converged: syncing again finds nothing to argue about.
        device.Conflicts.Clear();
        await device.Scheduler.SyncNowAsync();
        device.Conflicts.ShouldBeEmpty("the same conflict came back, so the device never adopted the server's row");

        // And the row is still writable. This is what a stale conflict base costs: not an error, but
        // an edit that quietly turns into a conflict every single time.
        await device.RenameSongLocallyAsync(songId, "Sången ändrad igen efteråt");
        await device.Scheduler.SyncNowAsync();

        device.Conflicts.ShouldBeEmpty("an ordinary edit after a conflict should push like any other");
        (await ServerSongNameAsync(app, songId)).ShouldBe("Sången ändrad igen efteråt");
    }

    [Fact]
    public async Task AnEditOnOneDevice_ReachesAnotherDeviceInTheSameOrganization()
    {
        // The scenario the whole thing exists for, and the one the exclusion could break: the
        // announcement leaves out the device that pushed, and must still reach every other one.
        using var app = new WebAppFixture();
        await using var laptop = await DeviceHarness.CreateAsync(app);
        await using var deskMachine = await DeviceHarness.CreateAsync(app);

        await laptop.Scheduler.SyncNowAsync();
        await deskMachine.Scheduler.SyncNowAsync();

        deskMachine.Doorbell.Start();
        await deskMachine.WaitUntilListeningAsync();

        await laptop.RenameLocallyAsync("Ändrad på laptopen");
        // Awaited rather than left to the write signal, so the laptop's whole cycle is over before
        // the other machine reacts: the server's test database is one shared in-memory connection
        // and cannot serve two devices at once.
        await laptop.Scheduler.SyncNowAsync();

        await WaitUntilAsync(
            async () => await deskMachine.PresentationNameAsync() == "Ändrad på laptopen",
            "the other device in the organisation should have been told and pulled the edit");
    }

    [Fact]
    public async Task ADevicesOwnPush_DoesNotWakeItAgain()
    {
        // The server announces to the organisation, and this device is in it. Without the exclusion
        // every push would be answered by an announcement and cost a second, pointless cycle.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();
        device.Scheduler.Start();

        var pullsBefore = device.Pulls;
        await device.RenameLocallyAsync("Ändrad på enheten");

        await device.WaitUntilQuietAsync();
        (await ServerPresentationNameAsync(app)).ShouldBe("Ändrad på enheten",
            "the local edit should have been pushed");

        // Long enough for an echo to have arrived: the server coalesces for 500 ms and the client
        // adds no delay of its own.
        await Task.Delay(TimeSpan.FromSeconds(2));

        (device.Pulls - pullsBefore).ShouldBe(1,
            "one sync cycle should have carried the push and its pull; a second means the device " +
            "was told about its own change");
    }

    [Fact]
    public async Task ARevokedDevice_StopsKnockingAndSaysSoInItsStatus()
    {
        // Retrying for ever is right for a presentation that must survive a rebooting router, and
        // wrong here: no sync will work again until someone signs in. A decommissioned machine that
        // kept knocking would only ever be noticed in the server's logs.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        // Revoked before this device has authenticated once. The token handler caches a validated
        // principal for thirty seconds, deliberately, so a device that has just been talking to the
        // server keeps working for that long after being revoked — worth knowing, and not what this
        // test is about.
        await RevokeEveryDeviceTokenAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Scheduler.Status.ShouldBe(SyncStatus.AuthRequired,
            "the sync engine owns this state, and it is what the user is shown");

        device.Doorbell.Start();

        // Long enough that a retrying client would have had several attempts.
        await Task.Delay(TimeSpan.FromSeconds(2));
        device.Doorbell.IsConnected.ShouldBeFalse("a revoked token must not reach the hub");
        device.Doorbell.StoppedByRejectedToken.ShouldBeTrue(
            "and it must have given up rather than still be retrying — IsConnected alone cannot "
            + "tell those apart");
    }

    /// <summary>
    /// The other half of the same decision. A 401 the sync engine has not also concluded is a
    /// revoked token means something in front of the hub answered for it — the stored-language
    /// redirect used to do exactly that, eating the Authorization header, and because the doorbell
    /// read it as a revocation it went silent for the rest of the session on every single start.
    /// A latency bug turned into a permanent one by a wrong inference.
    /// </summary>
    [Fact]
    public async Task ADoorbell_RejectedWhileTheSyncEngineIsHappy_KeepsTrying()
    {
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        // Revoked without ever running a sync, so the engine has formed no opinion: exactly the
        // race the retry decision has to survive.
        await RevokeEveryDeviceTokenAsync(app);
        device.Scheduler.Status.ShouldNotBe(SyncStatus.AuthRequired,
            "this test is about a 401 the engine has not agreed with");

        device.Doorbell.Start();

        await Task.Delay(TimeSpan.FromSeconds(2));
        device.Doorbell.StoppedByRejectedToken.ShouldBeFalse(
            "a 401 nothing else corroborates must leave the doorbell retrying");
    }

    // --- The server side of each test ---

    private static async Task RevokeEveryDeviceTokenAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        await context.DeviceTokens.ExecuteDeleteAsync();
    }

    private static async Task RenameOnServerAsync(WebAppFixture app, string name)
    {
        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<IPresentationService>()
            .RenamePresentationAsync(OrganizationId, PresentationId, name, Caller());
    }

    /// <summary>Renames some other presentation of the same organisation, and returns its id.</summary>
    private static async Task<string> RenameAnotherOnServerAsync(WebAppFixture app, string name)
    {
        using var scope = app.Services.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<PresentationContext>>();

        string id;
        await using (var context = await factory.CreateDbContextAsync())
        {
            id = await context.Presentations
                .Where(p => p.OrganizationId == OrganizationId && p.Id != PresentationId && !p.IsTemplate)
                .Select(p => p.Id)
                .FirstAsync();
        }

        await scope.ServiceProvider.GetRequiredService<IPresentationService>()
            .RenamePresentationAsync(OrganizationId, id, name, Caller());
        return id;
    }

    private static async Task<string> AddSongOnServerAsync(WebAppFixture app, string name)
    {
        var songs = app.Services.GetRequiredService<ISongService>();
        var song = await songs.CreateSongAsync(
            name, author: null, publisher: null, year: null, ccli: null, parts: [],
            OrganizationId, Caller());
        return song.Id;
    }

    private static async Task<string> FirstSongIdAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.Songs
            .Where(s => s.OrganizationId == OrganizationId && s.DeletedAt == null)
            .OrderBy(s => s.Id)
            .Select(s => s.Id)
            .FirstAsync();
    }

    private static async Task RenameSongOnServerAsync(WebAppFixture app, string songId, string name)
    {
        await app.Services.GetRequiredService<ISongService>().UpdateSongAsync(
            songId, OrganizationId, name, author: null, publisher: null, year: null, ccli: null,
            Caller());
    }

    private static async Task<string?> ServerSongNameAsync(WebAppFixture app, string songId)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.Songs.Where(s => s.Id == songId).Select(s => s.Name).FirstOrDefaultAsync();
    }

    private static async Task<int> ServerSongVersionCountAsync(WebAppFixture app, string songId)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.SongVersions.CountAsync(v => v.SongId == songId);
    }

    private static async Task<string?> ServerPresentationNameAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.Presentations
            .Where(p => p.Id == PresentationId)
            .Select(p => p.Name)
            .FirstOrDefaultAsync();
    }

}
