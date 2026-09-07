using System.Net;
using System.Net.Http.Headers;
using System.Text;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The API-key middleware in front of /mcp, which nothing tested: a missing or unknown key must be
/// turned away before any tool runs, and a known key must get through it.
/// </summary>
[Collection(WebAppCollection.Name)]
public class McpAuthIntegrationTests
{
    private const string InitializeRequest =
        """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}""";

    [Fact]
    public async Task Mcp_WithoutAnApiKey_IsNotLetIn()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient(new() { AllowAutoRedirect = false });

        var response = await client.SendAsync(Initialize(bearer: null));

        // In mock mode the sign-in middleware sends a header-less request to /mock-login before
        // the key check sees it; in production there is no such redirect and the key check
        // answers 401. Either way, no tool runs.
        response.StatusCode.ShouldBeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Redirect);
    }

    [Fact]
    public async Task Mcp_WithAnUnknownApiKey_IsUnauthorized()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient();

        var response = await client.SendAsync(Initialize(bearer: McpApiKey.GenerateKey()));

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Mcp_WithAKnownApiKey_GetsPastTheKeyCheck()
    {
        using var app = new WebAppFixture();
        var key = McpApiKey.GenerateKey();
        await using (var context = app.Services.GetRequiredService<IDbContextFactory<PresentationContext>>().CreateDbContext())
        {
            context.McpApiKeys.Add(new McpApiKey { KeyHash = McpApiKey.HashKey(key), Name = "Test", UserId = WebAppFixture.MockUserId, OrganizationId = "mock-org-sv" });
            await context.SaveChangesAsync();
        }
        var client = app.CreateClient();

        var response = await client.SendAsync(Initialize(bearer: key));

        // Whatever the MCP transport answers an initialize with, it is the transport answering — the
        // key check let the request through.
        response.StatusCode.ShouldNotBe(HttpStatusCode.Unauthorized);
        response.StatusCode.ShouldNotBe(HttpStatusCode.TooManyRequests);
    }

    private static HttpRequestMessage Initialize(string? bearer)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = new StringContent(InitializeRequest, Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (bearer is not null)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return request;
    }
}
