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
/// Who a change wakes, and how often. These are the claims most easily broken without anyone
/// noticing, because getting them wrong costs traffic and privacy rather than data — a device that
/// is woken by another church's edit still ends up with the right library, and nothing in the app
/// says otherwise.
///
/// The hub's own filtering is covered by <see cref="OrganizationChangesHubIntegrationTests"/> and
/// the interceptor's by the unit tests. What is proved here is the thing those cannot: that a real
/// device, with the real scheduler behind it, does not so much as ask.
/// </summary>
[Collection(WebAppCollection.Name)]
public class SyncAudienceTests
{
    [Fact]
    public async Task AnEditInAnotherOrganization_DoesNotWakeThisOnesDevice()
    {
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        var pullsBefore = device.Pulls;
        await RenameOtherOrganizationsPresentationAsync(app, "Another church edited this");
        await LongEnoughForAnAnnouncementAsync();

        device.Pulls.ShouldBe(pullsBefore,
            "a device must not even ask the server about another organisation's edit");

        await using var db = device.Factory.CreateDbContext();
        (await db.Presentations.AnyAsync(p => p.OrganizationId == OtherOrganizationId)).ShouldBeFalse(
            "and none of that organisation's rows may be on this machine");
    }

    [Fact]
    public async Task AnotherUsersSetting_DoesNotWakeThisOrganizationsDevice()
    {
        // A UserSetting is the one synced kind of row that carries a user instead of an
        // organisation, so the save interceptor cannot address it and leaves it to its writer.
        // Announced by the interceptor's fallback instead, it would ring every connection on the
        // server — on every language switch, and during onboarding.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        var pullsBefore = device.Pulls;

        using (var scope = app.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IUserService>().SetUserSettingAsync(
                OtherUserId, UserSetting.PreferredLanguage, "en",
                Caller(OtherOrganizationId, OtherUserId));

        await LongEnoughForAnAnnouncementAsync();

        device.Pulls.ShouldBe(pullsBefore,
            "another church's user changing their language is nothing to do with this machine");
    }

    [Fact]
    public async Task TheSignedInUsersOwnSetting_ReachesTheirDevice()
    {
        // The other half of the same decision: the writer announces with the organisation it knows
        // exactly, so the user's own machines do hear about it.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        using (var scope = app.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IUserService>().SetUserSettingAsync(
                WebAppFixture.MockUserId, UserSetting.PreferredLanguage, "sv", Caller());

        await WaitUntilAsync(
            async () => await device.UserSettingAsync(UserSetting.PreferredLanguage) == "sv",
            "the signed-in user's own setting should reach the machine they are signed in on");
    }

    [Fact]
    public async Task ABurstOfSavesOnTheServer_CostsTheDeviceOneRound()
    {
        // A push applies one SaveChanges per aggregate, and a first sync into an empty device was
        // measured at 871 songs and 3527 song parts. Without the notifier's window that is a burst
        // of socket traffic to every machine in the organisation, and a round of HTTP behind each.
        using var app = new WebAppFixture();
        await using var device = await DeviceHarness.CreateAsync(app);

        await device.Scheduler.SyncNowAsync();
        device.Doorbell.Start();
        await device.WaitUntilListeningAsync();

        var pullsBefore = device.Pulls;
        var songId = await FirstSongIdAsync(app);

        // Five saves with nothing between them, which on an in-memory database is comfortably
        // inside the notifier's 500 ms window.
        var songs = app.Services.GetRequiredService<ISongService>();
        for (var i = 1; i <= 5; i++)
            await songs.UpdateSongAsync(
                songId, OrganizationId, $"Snabb ändring {i}",
                author: null, publisher: null, year: null, ccli: null, Caller());

        await WaitUntilAsync(
            async () => await device.SongNameAsync(songId) == "Snabb ändring 5",
            "the device should end up on the last of the five");
        await LongEnoughForAnAnnouncementAsync();

        (device.Pulls - pullsBefore).ShouldBeLessThanOrEqualTo(2,
            $"five saves inside the coalescing window should not be five rounds of traffic, " +
            $"but the device pulled {device.Pulls - pullsBefore} times");
    }

    // --- The server side ---

    private static async Task RenameOtherOrganizationsPresentationAsync(WebAppFixture app, string name)
    {
        string id;
        await using (var context = app.Services
                         .GetRequiredService<IDbContextFactory<PresentationContext>>()
                         .CreateDbContext())
        {
            id = await context.Presentations
                .Where(p => p.OrganizationId == OtherOrganizationId && !p.IsTemplate)
                .OrderBy(p => p.Id).Select(p => p.Id).FirstAsync();
        }

        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<IPresentationService>()
            .RenamePresentationAsync(OtherOrganizationId, id, name, Caller(OtherOrganizationId, OtherUserId));
    }

    private static async Task<string> FirstSongIdAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.Songs
            .Where(s => s.OrganizationId == OrganizationId && s.DeletedAt == null)
            .OrderBy(s => s.Id).Select(s => s.Id).FirstAsync();
    }
}
