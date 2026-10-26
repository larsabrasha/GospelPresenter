using System.Net;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Web.Services;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// POST /culture stores its value as the user's language and then redirects to a returnUrl taken from
/// the form, so both are input anyone can craft.
/// </summary>
[Collection(WebAppCollection.Name)]
public class CultureEndpointIntegrationTests
{
    [Fact]
    public async Task PostCulture_WithAnUnsupportedCulture_IsRejectedAndStoresNothing()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        // Act
        var response = await PostCultureAsync(app, client, "xx-not-a-language", "/settings");

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await StoredLanguageAsync(app)).ShouldBeNull();
    }

    [Fact]
    public async Task PostCulture_WithAnExternalReturnUrl_StaysOnThisSite()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        // Act
        var response = await PostCultureAsync(app, client, "SV", "https://evil.example/");

        // Assert -- the language is stored in its canonical form, and the redirect lands at home
        // rather than failing as LocalRedirect used to on a non-local URL
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.RequestMessage!.RequestUri!.Host.ShouldBe("localhost");
        (await StoredLanguageAsync(app)).ShouldBe("sv");
    }

    private static async Task<HttpResponseMessage> PostCultureAsync(
        WebAppFixture app, HttpClient client, string culture, string returnUrl)
    {
        // The form is antiforgery-protected. The settings page only renders it once the circuit is
        // up, so the token pair is minted here instead, for the same signed-in user.
        await using var scope = app.Services.CreateAsyncScope();
        var user = await scope.ServiceProvider.GetRequiredService<IUserService>().GetByLoginAsync("mock", "mock-sv");
        var httpContext = new DefaultHttpContext
        {
            RequestServices = scope.ServiceProvider,
            User = MockAuthenticationStateProvider.CreatePrincipal(user!),
        };
        var tokens = app.Services.GetRequiredService<IAntiforgery>().GetAndStoreTokens(httpContext);
        var cookieName = app.Services.GetRequiredService<IOptions<AntiforgeryOptions>>().Value.Cookie.Name!;
        app.AddCookie(cookieName, tokens.CookieToken!);

        return await client.PostAsync("/culture", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["culture"] = culture,
            ["returnUrl"] = returnUrl,
            [tokens.FormFieldName] = tokens.RequestToken!,
        }));
    }

    private static async Task<string?> StoredLanguageAsync(WebAppFixture app)
    {
        await using var context = app.Services.GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.UserSettings
            .Where(s => s.UserId == WebAppFixture.MockUserId && s.Key == UserSetting.PreferredLanguage)
            .Select(s => s.Value)
            .FirstOrDefaultAsync();
    }
}
