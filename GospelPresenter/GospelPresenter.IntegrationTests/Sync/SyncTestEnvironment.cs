using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// What every device-level sync test shares: the seeded organisations it works against, and the
/// two ways of waiting that these tests are allowed to use.
///
/// Imported with <c>using static</c> rather than inherited, so the test classes stay independent of
/// each other and a call site reads the same as it did when these were private members of
/// <see cref="DeviceSyncEndToEndTests"/>.
/// </summary>
internal static class SyncTestEnvironment
{
    /// <summary>
    /// The authentication cookie is issued Secure, so a client on http would never send it back,
    /// and production runs behind TLS anyway.
    /// </summary>
    public static readonly Uri BaseAddress = new("https://localhost/");

    /// <summary>
    /// How long a test will wait for something it expects. Generous, because it only ever bounds a
    /// failure: everything here arrives in well under a second on a developer machine, and the
    /// headroom is for a loaded build agent.
    /// </summary>
    public static readonly TimeSpan Patience = TimeSpan.FromSeconds(15);

    public const string OrganizationId = "mock-org-sv";
    public const string PresentationId = "sv-pres-main";

    /// <summary>The other seeded church, which exists here to prove it hears nothing.</summary>
    public const string OtherOrganizationId = "mock-org-en";

    public const string OtherUserId = "mock-user-en";

    public static CallerContext Caller(string? organizationId = null, string? userId = null) =>
        new(userId ?? WebAppFixture.MockUserId, UserRole.Admin, organizationId ?? OrganizationId);

    public static async Task WaitUntilAsync(Func<Task<bool>> condition, string because)
    {
        var deadline = DateTimeOffset.UtcNow + Patience;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (await condition())
                return;
            await Task.Delay(TimeSpan.FromMilliseconds(100));
        }

        (await condition()).ShouldBeTrue(because);
    }

    /// <summary>
    /// Waits out a window in which something must <em>not</em> happen. Long enough for an
    /// announcement to have arrived — the server coalesces for 500 ms and the client adds no delay
    /// of its own — and it is the only sleep these tests are allowed, because a negative cannot be
    /// polled for.
    /// </summary>
    public static Task LongEnoughForAnAnnouncementAsync() => Task.Delay(TimeSpan.FromSeconds(2));
}
