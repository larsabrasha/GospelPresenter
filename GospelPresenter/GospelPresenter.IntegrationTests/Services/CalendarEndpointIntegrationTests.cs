using System.Net;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

[Collection(WebAppCollection.Name)]
public class CalendarEndpointIntegrationTests
{
    [Fact]
    public async Task CalendarFeed_WithAValidToken_ServesTheOrganizationsCalendar()
    {
        using var app = new WebAppFixture();
        string token;
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<IUserService>();
            var caller = new CallerContext(WebAppFixture.MockUserId, UserRole.Admin, "mock-org-sv");
            (_, token) = await users.CreateCalendarSubscriptionAsync("Phone", WebAppFixture.MockUserId, "mock-org-sv", caller);
        }
        var client = app.CreateClient();

        var response = await client.GetAsync($"/api/calendar/{token}.ics");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("text/calendar");
        (await response.Content.ReadAsStringAsync()).ShouldStartWith("BEGIN:VCALENDAR");
    }

    [Fact]
    public async Task CalendarFeed_WithAnUnknownToken_IsNotFound()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient();

        (await client.GetAsync("/api/calendar/no-such-token.ics")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
