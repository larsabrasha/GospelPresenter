using GospelPresenter.IntegrationTests.Fixtures;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// Covers the cookie-validation path added to keep deleted accounts from outliving their session.
/// It fires on every request that carries the cookie, so the cost per request matters as much as
/// the behaviour — these tests assert both.
/// </summary>
public class SessionRevalidationIntegrationTests
{
    private const string AnyPath = "/no-such-page";
    private const int RepeatedRequests = 10;

    // The account lookup reads the Users table; other per-request queries in the pipeline read
    // other tables, so this is enough to tell the revalidation cost apart from the rest.
    private const string AccountLookup = "FROM \"Users\"";

    [Fact]
    public async Task RepeatedRequests_WithValidSession_RevalidateTheAccountAtMostOnce()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();
        app.Queries.Reset();

        // Act
        for (var i = 0; i < RepeatedRequests; i++)
            await client.GetAsync(AnyPath);

        // Assert -- one lookup per request would mean a page load costs one query per static file
        app.Queries.CountContaining(AccountLookup).ShouldBeLessThanOrEqualTo(1,
            "expected the revalidation cache to absorb repeated requests, but saw: "
            + string.Join(" | ", app.Queries.Commands));
    }

    [Fact]
    public async Task RepeatedRequests_WithoutCache_RevalidateTheAccountEveryTime()
    {
        // Arrange -- guards the test above: it must pass because of the cache, not because the
        // lookup never runs at all
        using var app = new WebAppFixture { RevalidationCacheSeconds = 0 };
        var client = await app.CreateAuthenticatedClientAsync();
        app.Queries.Reset();

        // Act
        for (var i = 0; i < RepeatedRequests; i++)
            await client.GetAsync(AnyPath);

        // Assert
        app.Queries.CountContaining(AccountLookup).ShouldBe(RepeatedRequests);
    }

    [Fact]
    public async Task Request_AfterUserIsDeleted_IsNoLongerAuthenticated()
    {
        // Arrange -- no cache, so the deletion takes effect on the very next request
        using var app = new WebAppFixture { RevalidationCacheSeconds = 0 };
        var client = await app.CreateAuthenticatedClientAsync();

        // Act
        await app.DeleteMockUserAsync();
        var response = await client.GetAsync(AnyPath);

        // Assert -- an anonymous request is redirected to the login page instead of reaching the app
        response.RequestMessage?.RequestUri?.AbsolutePath.ShouldBe("/mock-login");
    }

    [Fact]
    public async Task Request_WithValidSession_ReachesTheApplication()
    {
        // Arrange -- guards the test above: the redirect must come from the deletion, not the setup
        using var app = new WebAppFixture { RevalidationCacheSeconds = 0 };
        var client = await app.CreateAuthenticatedClientAsync();

        // Act
        var response = await client.GetAsync(AnyPath);

        // Assert
        response.RequestMessage?.RequestUri?.AbsolutePath.ShouldBe(AnyPath);
    }
}
