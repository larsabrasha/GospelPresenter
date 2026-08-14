using System.Net;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Fixtures;

/// <summary>
/// Boots the real application in-process against an in-memory SQLite database.
///
/// No connection string is supplied, which puts the app in mock-authentication mode — the only
/// mode a test can sign in to, since the real providers need Google or OIDC. The session rules
/// under test (cookie validation, deleted accounts) are wired identically in both modes.
///
/// The application seeds its own mock data on startup, so the test signs in as that user rather
/// than creating one.
/// </summary>
public class WebAppFixture : WebApplicationFactory<Program>
{
    public const string MockUserId = "mock-user-sv";
    private const string MockUserCookie = "mock-user-id";
    private const string AuthCookie = ".AspNetCore.Cookies";

    // The authentication cookie is issued with the Secure flag, so a client on http would never
    // send it back. Production runs behind TLS, so https is also the realistic base address.
    private static readonly Uri BaseAddress = new("https://localhost/");

    private readonly SqliteConnection connection;
    private CookieContainerHandler? cookies;

    public DatabaseQueryCounter Queries { get; } = new();

    /// <summary>The cookies the client currently holds, after any redirects have been followed.</summary>
    public CookieCollection CurrentCookies => cookies is null
        ? []
        : cookies.Container.GetCookies(BaseAddress);

    /// <summary>Zero disables the revalidation cache, so every request asks the database.</summary>
    public int RevalidationCacheSeconds { get; init; } = 30;

    /// <summary>Zero disables the preferred-language cache, so every request asks the database.</summary>
    public int PreferredLanguageCacheSeconds { get; init; } = 300;

    public WebAppFixture()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        builder.UseSetting("ConnectionStrings:postgresdb", "");
        builder.UseSetting("Settings:SessionRevalidationCacheSeconds", RevalidationCacheSeconds.ToString());
        builder.UseSetting("Settings:PreferredLanguageCacheSeconds", PreferredLanguageCacheSeconds.ToString());

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IDbContextFactory<PresentationContext>>();
            services.RemoveAll<DbContextOptions<PresentationContext>>();
            services.AddDbContextFactory<PresentationContext>(options => options
                .UseSqlite(connection)
                .AddInterceptors(new CountingCommandInterceptor(Queries)));
        });
    }

    /// <summary>
    /// Signs in as the seeded mock user and returns a client holding the resulting authentication
    /// cookie.
    ///
    /// The auto-sign-in cookie that mock mode also hands out is dropped afterwards: it would
    /// silently re-authenticate the user on every later request and hide whether the cookie itself
    /// is still being accepted, which is what these tests are about.
    /// </summary>
    public async Task<HttpClient> CreateAuthenticatedClientAsync()
    {
        // Redirect handler first, cookie handler inside it: the sign-in endpoint answers with a 302
        // carrying the authentication cookie, and only the inner handler sees that response.
        cookies = new CookieContainerHandler();
        var client = CreateDefaultClient(BaseAddress, new RedirectHandler(), cookies);

        var response = await client.GetAsync($"/mock-signin/{MockUserId}");
        response.IsSuccessStatusCode.ShouldBeTrue(
            $"mock sign-in should succeed, got {(int)response.StatusCode}");

        var jar = cookies.Container.GetCookies(BaseAddress);
        jar.Any(c => c.Name == AuthCookie).ShouldBeTrue(
            "sign-in should have set an authentication cookie, otherwise every later assertion "
            + $"passes for the wrong reason; cookies were: {string.Join(", ", jar.Select(c => c.Name))}");

        foreach (Cookie cookie in jar)
            if (cookie.Name == MockUserCookie)
                cookie.Expired = true;

        return client;
    }

    public async Task SetPreferredLanguageAsync(string language)
    {
        await using var context = Services.GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        context.UserSettings.Add(new UserSetting
        {
            UserId = MockUserId,
            Key = UserSetting.PreferredLanguage,
            Value = language
        });
        await context.SaveChangesAsync();
    }

    public async Task DeleteMockUserAsync()
    {
        await using var context = Services.GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        await context.Users.Where(u => u.Id == MockUserId).ExecuteDeleteAsync();
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) connection.Dispose();
    }
}
