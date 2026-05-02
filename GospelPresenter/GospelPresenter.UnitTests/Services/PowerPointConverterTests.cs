using System.Net;
using System.Text;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class PowerPointConverterTests
{
    [Fact]
    public void IsConfigured_NoBaseAddress_ReturnsFalse()
    {
        // Arrange
        var factory = new StubHttpClientFactory(handler: null, baseAddress: null);
        var converter = new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);

        // Act
        var result = converter.IsConfigured;

        // Assert
        result.ShouldBeFalse();
    }

    [Fact]
    public void IsConfigured_WithBaseAddress_ReturnsTrue()
    {
        // Arrange
        var factory = new StubHttpClientFactory(handler: null, baseAddress: new Uri("http://gotenberg:3000"));
        var converter = new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);

        // Act
        var result = converter.IsConfigured;

        // Assert
        result.ShouldBeTrue();
    }

    [Fact]
    public async Task ConvertToPdfAsync_WithoutBaseAddress_ThrowsNotSupported()
    {
        // Arrange
        var factory = new StubHttpClientFactory(handler: null, baseAddress: null);
        var converter = new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);

        // Act
        var act = async () => await converter.ConvertToPdfAsync(new MemoryStream([1, 2, 3]), "deck.pptx", CancellationToken.None);

        // Assert
        await act.ShouldThrowAsync<NotSupportedException>();
    }

    [Fact]
    public async Task ConvertToPdfAsync_PostsToLibreOfficeEndpoint()
    {
        // Arrange
        var handler = new RecordingHandler(HttpStatusCode.OK, "%PDF-1.7 fake-pdf"u8.ToArray());
        var factory = new StubHttpClientFactory(handler, new Uri("http://gotenberg:3000"));
        var converter = new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);
        var input = new MemoryStream("fake-pptx-bytes"u8.ToArray());

        // Act
        await using var pdf = await converter.ConvertToPdfAsync(input, "slides.pptx", CancellationToken.None);

        // Assert
        handler.LastRequest.ShouldNotBeNull();
        handler.LastRequest!.Method.ShouldBe(HttpMethod.Post);
        handler.LastRequest.RequestUri!.AbsolutePath.ShouldBe("/forms/libreoffice/convert");
        handler.LastRequestBody.ShouldContain("slides.pptx");
        handler.LastRequestBody.ShouldContain("fake-pptx-bytes");
    }

    [Fact]
    public async Task ConvertToPdfAsync_GotenbergReturnsError_ThrowsInvalidOperation()
    {
        // Arrange
        var handler = new RecordingHandler(HttpStatusCode.InternalServerError, "boom"u8.ToArray());
        var factory = new StubHttpClientFactory(handler, new Uri("http://gotenberg:3000"));
        var converter = new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);
        var input = new MemoryStream([0]);

        // Act
        var act = async () => await converter.ConvertToPdfAsync(input, "slides.pptx", CancellationToken.None);

        // Assert
        await act.ShouldThrowAsync<InvalidOperationException>();
    }

    [Fact]
    public async Task ConvertToPdfAsync_OnSuccess_ReturnsResponseBody()
    {
        // Arrange
        var pdfBytes = "%PDF-1.7 hello"u8.ToArray();
        var handler = new RecordingHandler(HttpStatusCode.OK, pdfBytes);
        var factory = new StubHttpClientFactory(handler, new Uri("http://gotenberg:3000"));
        var converter = new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);

        // Act
        await using var result = await converter.ConvertToPdfAsync(new MemoryStream([0]), "x.pptx", CancellationToken.None);
        using var copy = new MemoryStream();
        await result.CopyToAsync(copy);

        // Assert
        copy.ToArray().ShouldBe(pdfBytes);
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler? handler;
        private readonly Uri? baseAddress;

        public StubHttpClientFactory(HttpMessageHandler? handler, Uri? baseAddress)
        {
            this.handler = handler;
            this.baseAddress = baseAddress;
        }

        public HttpClient CreateClient(string name)
        {
            var client = handler is not null ? new HttpClient(handler, disposeHandler: false) : new HttpClient();
            client.BaseAddress = baseAddress;
            return client;
        }
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode statusCode;
        private readonly byte[] responseBody;

        public RecordingHandler(HttpStatusCode statusCode, byte[] responseBody)
        {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
        }

        public HttpRequestMessage? LastRequest { get; private set; }
        public string LastRequestBody { get; private set; } = string.Empty;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            if (request.Content is not null)
            {
                var bytes = await request.Content.ReadAsByteArrayAsync(cancellationToken);
                LastRequestBody = Encoding.UTF8.GetString(bytes);
            }

            return new HttpResponseMessage(statusCode)
            {
                Content = new ByteArrayContent(responseBody),
            };
        }
    }
}
