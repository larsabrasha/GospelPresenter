using System.Net;
using System.Net.Http.Headers;
using GospelPresenter.IntegrationTests.Fixtures;
using Shouldly;
using SkiaSharp;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The upload endpoints over HTTP. Mock mode has no object storage, so a request that passes every
/// check ends in 503 — which is the proof that it passed them, distinct from the 400s and 403s a
/// request that did not gets.
/// </summary>
[Collection(WebAppCollection.Name)]
public class UploadEndpointIntegrationTests
{
    private const string OwnOrganization = "mock-org-sv";
    private const string OtherOrganization = "mock-org-en";

    [Fact]
    public async Task OrgImage_Anonymous_IsRefused()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient(new() { AllowAutoRedirect = false });

        var response = await client.PostAsync("/api/upload/org-image", Upload(TinyPng(), "image/png", "a.png", OwnOrganization));

        response.StatusCode.ShouldBeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Redirect);
    }

    [Fact]
    public async Task OrgImage_ForAnotherOrganization_IsForbidden_NotAServerError()
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/upload/org-image", Upload(TinyPng(), "image/png", "a.png", OtherOrganization));

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task OrgImage_ForOwnOrganization_PassesValidation()
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/upload/org-image", Upload(TinyPng(), "image/png", "a.png", OwnOrganization));

        // No storage in mock mode: the request got all the way to the store.
        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    }

    [Theory]
    [InlineData("image/svg+xml", "a.svg")]
    [InlineData("text/html", "a.html")]
    public async Task OrgImage_WithAnUnsupportedType_IsRejected(string contentType, string fileName)
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/upload/org-image", Upload("<svg onload=alert(1)/>"u8.ToArray(), contentType, fileName, OwnOrganization));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task OrgImage_ThatClaimsToBeAnImageButIsNot_IsRejected()
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/upload/org-image", Upload("<html>not a picture</html>"u8.ToArray(), "image/png", "a.png", OwnOrganization));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task OrgImage_OverTheSizeLimit_IsRejected()
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();
        var oversized = new byte[Shared.AppConstraints.MaxImageFileSizeBytes + 1];

        var response = await client.PostAsync("/api/upload/org-image", Upload(oversized, "image/png", "big.png", OwnOrganization));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task OrgAudio_WhoseBytesAreNotAudio_IsRejectedWhateverTheHeaderSays()
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        var response = await client.PostAsync("/api/upload/org-audio", Upload("<script>alert(1)</script>"u8.ToArray(), "audio/mpeg", "a.mp3", OwnOrganization));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    private static MultipartFormDataContent Upload(byte[] bytes, string contentType, string fileName, string organizationId)
    {
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent
        {
            { file, "file", fileName },
            { new StringContent(organizationId), "organizationId" },
        };
    }

    private static byte[] TinyPng()
    {
        using var bitmap = new SKBitmap(2, 2);
        bitmap.Erase(SKColors.Coral);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
