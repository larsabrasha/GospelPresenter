using System.Globalization;
using System.Security.Claims;
using System.Text.Encodings.Web;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;

namespace GospelPresenter.Web;

public static class DeviceTokenEndpoints
{
    /// <summary>The custom URL scheme the MAUI app registers; /app-login hands the token over on it.</summary>
    private const string AppCallbackScheme = "gospelpresenter";

    public static void MapDeviceTokenEndpoints(this WebApplication app)
    {
        // The desktop app's entry point: it opens this URL in the system browser. An unauthenticated
        // visit is challenged into the ordinary login flow and lands back here, so the browser is
        // signed in with a cookie by the time the body runs. The device token travels back to the
        // app in the fragment of a custom-scheme URL — fragments never reach any server log.
        //
        // The answer is a page rather than a redirect. A browser that follows a redirect to an
        // external scheme hands the URL to the operating system without navigating, which leaves
        // the tab sitting on whatever it last rendered — for most people the Google account
        // chooser, looking like the sign-in never finished. A page can hand over and then say what
        // happened. It cannot close itself: only a window opened by script may do that.
        app.MapGet("/app-login", async (
            HttpContext context,
            [FromServices] IUserService userService,
            [FromServices] IStringLocalizer<SharedResource> localizer,
            [FromQuery] string? device) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();
            if (caller.OrganizationId is null) return Results.Forbid();

            var name = string.IsNullOrWhiteSpace(device)
                ? "App"
                : device.Trim();
            if (name.Length > AppConstraints.NameMaxLength)
                name = name[..AppConstraints.NameMaxLength];

            var (_, plaintextToken) = await userService.CreateDeviceTokenAsync(
                name, caller.UserId, caller.OrganizationId, caller);

            var callback =
                $"{AppCallbackScheme}://auth#token={Uri.EscapeDataString(plaintextToken)}" +
                $"&user_id={Uri.EscapeDataString(caller.UserId)}" +
                $"&organization_id={Uri.EscapeDataString(caller.OrganizationId)}";

            return Results.Content(HandoverPage(callback, localizer), "text/html; charset=utf-8");
        }).RequireAuthorization();

        // Who the caller is, resolved fresh from the database. The app fetches this right after
        // /app-login to build its cached offline identity, and again on later syncs so a changed
        // role or organisation name eventually reaches the device.
        app.MapGet("/api/me", async (
            HttpContext context,
            [FromServices] IUserService userService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var user = await userService.GetByIdAsync(caller.UserId, caller);
            if (user is null) return Results.Unauthorized();

            return Results.Ok(new
            {
                user.Id,
                user.Name,
                user.Email,
                Role = user.Role.ToString(),
                user.OrganizationId,
                OrganizationName = user.Organization?.Name,
            });
        }).RequireAuthorization();

        app.MapGet("/api/device-tokens", async (
            HttpContext context,
            [FromServices] IUserService userService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var tokens = await userService.GetDeviceTokensAsync(caller.UserId, caller);
            return Results.Ok(tokens.Select(t => new
            {
                t.Id,
                t.Name,
                t.CreatedAt,
                t.LastUsedAt,
                t.RevokedAt,
            }));
        }).RequireAuthorization();

        app.MapDelete("/api/device-tokens/{id}", async (
            string id,
            HttpContext context,
            [FromServices] IUserService userService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            // RevokeDeviceTokenAsync verifies the token belongs to the caller.
            await userService.RevokeDeviceTokenAsync(id, caller);
            return Results.NoContent();
        }).RequireAuthorization();
    }

    /// <summary>
    /// Hands the callback URL to the operating system and tells the reader the tab has done its
    /// job. The link is the fallback for a browser that refuses the scripted navigation, and it is
    /// what the integration tests read the token out of, so keep the id.
    /// </summary>
    private static string HandoverPage(string callback, IStringLocalizer<SharedResource> localizer)
    {
        var href = HtmlEncoder.Default.Encode(callback);
        var script = JavaScriptEncoder.Default.Encode(callback);
        var title = HtmlEncoder.Default.Encode(localizer["AppLogin.Title"]);
        var body = HtmlEncoder.Default.Encode(localizer["AppLogin.CloseTab"]);
        var open = HtmlEncoder.Default.Encode(localizer["AppLogin.OpenApp"]);

        // $$""" so the CSS braces stay literal and interpolation is written {{ }}.
        return $$"""
                <!DOCTYPE html>
                <html lang="{{HtmlEncoder.Default.Encode(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName)}}">
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>{{title}}</title>
                <style>
                :root { color-scheme: light dark; }
                body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
                       align-items: center; justify-content: center; gap: 1rem; text-align: center;
                       font-family: system-ui, sans-serif; padding: 2rem; }
                h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
                p { margin: 0; opacity: 0.7; }
                a { color: #0ea5e9; }
                </style>
                </head>
                <body>
                <h1>{{title}}</h1>
                <p>{{body}}</p>
                <p><a id="app-callback" href="{{href}}">{{open}}</a></p>
                <script>location.replace("{{script}}");</script>
                </body>
                </html>
                """;
    }

    private static CallerContext? GetCaller(HttpContext context)
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return null;

        var orgId = context.User.FindFirst("organization_id")?.Value;
        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        return new CallerContext(userId, role, orgId);
    }
}
