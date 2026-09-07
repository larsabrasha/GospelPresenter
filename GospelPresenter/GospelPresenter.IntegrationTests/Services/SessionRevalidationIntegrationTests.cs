using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Localization;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// Covers the middleware that runs for every authenticated request: the cookie validation that
/// keeps deleted accounts from outliving their session, and the preferred-language lookup.
///
/// Both sit before the static-file endpoints, so they run for each CSS file, script and image as
/// well — the cost per request matters as much as the behaviour, and these tests assert both.
/// </summary>
[Collection(WebAppCollection.Name)]
public class SessionRevalidationIntegrationTests
{
    private const string AnyPath = "/no-such-page";
    private const string StaticAssetPath = "/version.json";
    private const int RepeatedRequests = 10;

    // The account lookup reads the Users table; other per-request queries in the pipeline read
    // other tables, so this is enough to tell the revalidation cost apart from the rest.
    private const string AccountLookup = "FROM \"Users\"";

    // The preferred-language lookup is the only thing reading UserSettings on a request that
    // renders no page.
    private const string LanguageLookup = "FROM \"UserSettings\"";

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
    public async Task StaticAssetRequests_CostNoDatabaseQueries()
    {
        // Arrange -- authenticated requests run the whole pre-endpoint pipeline even for files.
        // Moving that middleware after MapStaticAssets does not help: app.Use always runs before
        // endpoints execute, whatever order the Map calls appear in. Caching is what makes it free.
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();
        app.Queries.Reset();

        // Act
        for (var i = 0; i < RepeatedRequests; i++)
            (await client.GetAsync(StaticAssetPath)).EnsureSuccessStatusCode();

        // Assert
        app.Queries.Count.ShouldBe(0,
            "a static file should not touch the database, but saw: "
            + string.Join(" | ", app.Queries.Commands));
    }

    [Fact]
    public async Task RepeatedRequests_WithoutStoredLanguage_LookUpTheSettingAtMostOnce()
    {
        // Arrange -- the seeded user has never chosen a language, so there is nothing to find
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();
        app.Queries.Reset();

        // Act
        for (var i = 0; i < RepeatedRequests; i++)
            await client.GetAsync(AnyPath);

        // Assert
        app.Queries.CountContaining(LanguageLookup).ShouldBeLessThanOrEqualTo(1,
            "expected the miss to be remembered, but saw: " + string.Join(" | ", app.Queries.Commands));
    }

    [Fact]
    public async Task RepeatedRequests_WithoutLanguageCache_LookUpTheSettingEveryTime()
    {
        // Arrange -- guards the test above: it must pass because the miss is remembered, not
        // because the lookup stopped happening
        using var app = new WebAppFixture { PreferredLanguageCacheSeconds = 0 };
        var client = await app.CreateAuthenticatedClientAsync();
        app.Queries.Reset();

        // Act
        for (var i = 0; i < RepeatedRequests; i++)
            await client.GetAsync(AnyPath);

        // Assert
        app.Queries.CountContaining(LanguageLookup).ShouldBe(RepeatedRequests);
    }

    [Fact]
    public async Task Request_WithStoredLanguage_StillRestoresTheCultureCookie()
    {
        // Arrange -- the lookup exists to restore a stored language for a browser that has lost
        // its culture cookie; remembering misses must not break that. The cache is disabled
        // because the sign-in request already recorded a miss for this user.
        using var app = new WebAppFixture { PreferredLanguageCacheSeconds = 0 };
        var client = await app.CreateAuthenticatedClientAsync();
        await app.SetPreferredLanguageAsync("sv");

        // Act
        await client.GetAsync(AnyPath);

        // Assert
        var culture = app.CurrentCookies
            .FirstOrDefault(c => c.Name == CookieRequestCultureProvider.DefaultCookieName);
        culture.ShouldNotBeNull("the stored language should have been written to a culture cookie");
        culture.Value.ShouldContain("sv");
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

    /// <summary>
    /// A cookie used to carry the role it was issued with until it expired — four hours in which a
    /// demoted admin kept every admin page. The revalidation now refreshes role and organisation
    /// from the database at the same cadence it checks that the account still exists.
    /// </summary>
    [Fact]
    public async Task ADemotedAdmin_LosesTheAdminPagesOnTheNextRevalidatedRequest()
    {
        // Arrange -- no cache, so the very next request revalidates
        using var app = new WebAppFixture { RevalidationCacheSeconds = 0 };
        var client = await app.CreateAuthenticatedClientAsync();
        var asAdmin = await client.GetAsync(AdminOnlyPage);
        asAdmin.StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
        asAdmin.RequestMessage!.RequestUri!.AbsolutePath.ShouldBe(AdminOnlyPage);

        await using (var context = app.Services
                         .GetRequiredService<IDbContextFactory<PresentationContext>>().CreateDbContext())
        {
            await context.Users.Where(u => u.Id == WebAppFixture.MockUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, UserRole.User));
        }

        // Act -- the page is gated on the cookie's role claim, which is what the revalidation refreshes
        var asUser = await client.GetAsync(AdminOnlyPage);

        // Assert -- turned away (the client follows the redirect, so the final address tells)
        asUser.RequestMessage!.RequestUri!.AbsolutePath.ShouldNotBe(AdminOnlyPage);
    }

    private const string AdminOnlyPage = "/admin/users";
}
