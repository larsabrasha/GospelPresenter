using System.Security.Claims;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Mvc;

namespace GospelPresenter.Web;

public static class DeviceTokenEndpoints
{
    /// <summary>The custom URL scheme the MAUI app registers; /app-login hands the token over on it.</summary>
    private const string AppCallbackScheme = "gospelpresenter";

    public static void MapDeviceTokenEndpoints(this WebApplication app)
    {
        // The MAUI app's entry point: it opens this URL in the system browser. An unauthenticated
        // visit is challenged into the ordinary login flow and lands back here, so the browser is
        // signed in with a cookie by the time the body runs. The device token travels back to the
        // app in the fragment of a custom-scheme redirect — fragments never reach any server log.
        app.MapGet("/app-login", async (
            HttpContext context,
            [FromServices] IUserService userService,
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

            return Results.Redirect(
                $"{AppCallbackScheme}://auth#token={Uri.EscapeDataString(plaintextToken)}" +
                $"&user_id={Uri.EscapeDataString(caller.UserId)}" +
                $"&organization_id={Uri.EscapeDataString(caller.OrganizationId)}");
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

    private static CallerContext? GetCaller(HttpContext context)
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return null;

        var orgId = context.User.FindFirst("organization_id")?.Value;
        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        return new CallerContext(userId, role, orgId);
    }
}
