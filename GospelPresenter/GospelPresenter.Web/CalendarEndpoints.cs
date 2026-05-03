using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Mvc;

namespace GospelPresenter.Web;

public static class CalendarEndpoints
{
    private static readonly TimeSpan TouchThrottle = TimeSpan.FromHours(1);

    public static void MapCalendarEndpoints(this WebApplication app)
    {
        app.MapGet("/api/calendar/{token}.ics", async (
            string token,
            HttpContext httpContext,
            [FromServices] IUserService userService,
            [FromServices] ICalendarFeedService feedService,
            [FromServices] ILogger<Program> logger,
            CancellationToken cancellationToken) =>
        {
            var subscription = await userService.FindCalendarSubscriptionByTokenAsync(token);
            if (subscription is null)
                return Results.NotFound();

            var request = httpContext.Request;
            var baseUrl = $"{request.Scheme}://{request.Host}";

            string ics;
            try
            {
                ics = await feedService.BuildIcsAsync(subscription.OrganizationId, baseUrl, cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to build calendar feed for subscription {SubscriptionId}", subscription.Id);
                return Results.StatusCode(500);
            }

            if (!subscription.LastAccessedAt.HasValue ||
                DateTime.UtcNow - subscription.LastAccessedAt.Value > TouchThrottle)
            {
                try
                {
                    await userService.TouchCalendarSubscriptionAsync(subscription.Id);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to update LastAccessedAt for subscription {SubscriptionId}", subscription.Id);
                }
            }

            return Results.Text(ics, "text/calendar; charset=utf-8");
        }).AllowAnonymous();
    }
}
