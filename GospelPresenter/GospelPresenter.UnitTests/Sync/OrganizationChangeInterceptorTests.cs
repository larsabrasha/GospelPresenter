using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// The interceptor that announces ordinary saves, against a real SQLite database so that the
/// tombstones the context writes for tracked deletes are really there to be read.
///
/// What is pinned here is which organisation each kind of save announces — the part that decides
/// whether another user's edit reaches the right devices, or all of them, or none.
/// </summary>
public class OrganizationChangeInterceptorTests : IDisposable
{
    private const string OrganizationId = "org-1";
    private const string PresentationId = "pres-1";
    private const string ItemId = "item-1";
    private const string PartId = "part-1";

    private readonly SqliteConnection connection;
    private readonly DbContextOptions<PresentationContext> options;
    private readonly RecordingChangeNotifier notifier = new();

    public OrganizationChangeInterceptorTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .AddInterceptors(new OrganizationChangeInterceptor(notifier))
            .Options;

        using var context = NewContext();
        context.Database.EnsureCreated();

        context.Organizations.Add(new Organization { Id = OrganizationId, Name = "Församlingen" });
        context.Presentations.Add(new Presentation
        {
            Id = PresentationId, Name = "Söndag", OrganizationId = OrganizationId,
        });
        context.PresentationItems.Add(new PresentationItem
        {
            Id = ItemId, Title = "Sång", PresentationId = PresentationId,
        });
        context.PresentationItemParts.Add(new PresentationItemPart
        {
            Id = PartId, Content = "Text", PresentationItemId = ItemId,
        });
        context.SaveChanges();

        notifier.Clear();
    }

    private PresentationContext NewContext() => new(options);

    public void Dispose() => connection.Dispose();

    [Fact]
    public async Task ATrackedWrite_IsAnnouncedForItsOwnOrganization()
    {
        await using var context = NewContext();
        var presentation = await context.Presentations.SingleAsync(p => p.Id == PresentationId);
        presentation.Name = "Söndagsmässan";
        await context.SaveChangesAsync();

        notifier.Organizations.ShouldBe([OrganizationId]);
    }

    [Fact]
    public async Task ATrackedDelete_IsAnnouncedFromItsTombstone()
    {
        // The deleted row itself is deliberately not read: a deleted child would answer "no
        // organisation" and turn one organisation's deletion into an announcement to everybody. The
        // tombstone the same save writes knows the answer exactly.
        await using var context = NewContext();
        var presentation = await context.Presentations.SingleAsync(p => p.Id == PresentationId);
        context.Presentations.Remove(presentation);
        await context.SaveChangesAsync();

        notifier.Organizations.ShouldBe([OrganizationId]);
    }

    [Fact]
    public async Task ASaveWithNothingSynced_AnnouncesNothing()
    {
        // Signing in, issuing a device token, accepting an invite. None of it is anything a pulling
        // client could want, and announcing it would wake every device in the organisation.
        await using var context = NewContext();
        context.Users.Add(new User
        {
            Id = "user-9", Name = "Anna", Email = "anna@example.com", OrganizationId = OrganizationId,
        });
        await context.SaveChangesAsync();

        notifier.Announcements.ShouldBeEmpty();
    }

    [Fact]
    public async Task ASaveOfNothingButChildren_AnnouncesEverybody()
    {
        // A child row carries no organisation of its own. It is not supposed to be saved alone —
        // the convention is that a child change bumps its aggregate root, which does carry one — so
        // this is the documented fallback rather than an expected path: wasteful, and never wrong.
        await using var context = NewContext();
        var part = await context.PresentationItemParts.SingleAsync(p => p.Id == PartId);
        part.Content = "Ny text";
        await context.SaveChangesAsync();

        notifier.Organizations.ShouldBe([null]);
    }

    [Fact]
    public async Task AChildSavedWithItsRoot_IsAnnouncedForTheRootsOrganization()
    {
        await using var context = NewContext();
        var part = await context.PresentationItemParts.SingleAsync(p => p.Id == PartId);
        part.Content = "Ny text";
        var presentation = await context.Presentations.SingleAsync(p => p.Id == PresentationId);
        presentation.UpdatedAt = DateTimeOffset.UtcNow;
        await context.SaveChangesAsync();

        notifier.Organizations.ShouldBe([OrganizationId]);
    }

    [Fact]
    public async Task AFailedSave_AnnouncesNothing_AndDoesNotLeakIntoTheNextOne()
    {
        await using var context = NewContext();
        context.PresentationItems.Add(new PresentationItem
        {
            Id = "item-orphan", Title = "Ingen förälder", PresentationId = "no-such-presentation",
        });

        await Should.ThrowAsync<DbUpdateException>(() => context.SaveChangesAsync());
        notifier.Announcements.ShouldBeEmpty();

        // The same context goes on to save something real. What the failed attempt collected must
        // not ride along with it.
        context.ChangeTracker.Clear();
        var presentation = await context.Presentations.SingleAsync(p => p.Id == PresentationId);
        presentation.Name = "Söndagsmässan";
        await context.SaveChangesAsync();

        notifier.Organizations.ShouldBe([OrganizationId]);
    }

    [Fact]
    public async Task AUserScopedRow_IsLeftToItsWriterToAnnounce()
    {
        // A user setting carries a user, not an organisation, so announcing it from here could only
        // mean announcing it to everybody — and the preferred language is written on every language
        // switch. UserService and the push path know the caller's organisation and announce it
        // themselves; measured before this, the mock seed's single user setting rang every
        // connection on the server.
        await using var context = NewContext();
        context.Users.Add(new User
        {
            Id = "user-9", Name = "Anna", Email = "anna@example.com", OrganizationId = OrganizationId,
        });
        context.UserSettings.Add(new UserSetting { UserId = "user-9", Key = "language", Value = "sv" });
        await context.SaveChangesAsync();

        notifier.Announcements.ShouldBeEmpty();
    }

    [Fact]
    public async Task ADeletedUserSetting_IsAlsoLeftToItsWriter()
    {
        await using var seed = NewContext();
        seed.Users.Add(new User
        {
            Id = "user-9", Name = "Anna", Email = "anna@example.com", OrganizationId = OrganizationId,
        });
        var setting = new UserSetting { UserId = "user-9", Key = "language", Value = "sv" };
        seed.UserSettings.Add(setting);
        await seed.SaveChangesAsync();
        notifier.Clear();

        seed.UserSettings.Remove(setting);
        await seed.SaveChangesAsync();

        // The tombstone carries the user and no organisation, and is skipped for the same reason.
        (await seed.SyncTombstones.SingleAsync()).UserId.ShouldBe("user-9");
        notifier.Announcements.ShouldBeEmpty();
    }

    [Fact]
    public async Task AWriteInsideADevicePush_IsAnnouncedWithThatDeviceExcluded()
    {
        // How the pushing device stays off its own announcement. Ambient because the write happens
        // several layers below the endpoint that knows whose push it is.
        using (DeviceWriteScope.For("device-9"))
        {
            await using var context = NewContext();
            var presentation = await context.Presentations.SingleAsync(p => p.Id == PresentationId);
            presentation.Name = "Söndagsmässan";
            await context.SaveChangesAsync();
        }

        notifier.Announcements.ShouldHaveSingleItem().SourceDeviceId.ShouldBe("device-9");
    }
}
