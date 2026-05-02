using System.Net.Http;
using System.Text;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.IntegrationTests.Helpers;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

[Collection(GotenbergCollection.Name)]
public class GotenbergPowerPointConverterIntegrationTests
{
    private readonly GotenbergFixture gotenberg;

    public GotenbergPowerPointConverterIntegrationTests(GotenbergFixture gotenberg)
    {
        this.gotenberg = gotenberg;
    }

    [Fact]
    public async Task ConvertToPdfAsync_ValidPptx_ReturnsPdf()
    {
        // Arrange
        var converter = CreateConverter();
        var pptxBytes = MinimalPptxFactory.Create("Hello from integration test");

        // Act
        await using var pdfStream = await converter.ConvertToPdfAsync(
            new MemoryStream(pptxBytes), "test.pptx", CancellationToken.None);
        var pdfBytes = await ReadAllAsync(pdfStream);

        // Assert
        pdfBytes.Length.ShouldBeGreaterThan(0);
        var header = Encoding.ASCII.GetString(pdfBytes, 0, Math.Min(5, pdfBytes.Length));
        header.ShouldStartWith("%PDF-");
    }

    [Fact]
    public async Task ConvertToPdfAsync_MultiSlidePptx_ReturnsValidPdf()
    {
        // Arrange
        var converter = CreateConverter();
        var pptxBytes = MinimalPptxFactory.Create("Slide 1", "Slide 2", "Slide 3");

        // Act
        await using var pdfStream = await converter.ConvertToPdfAsync(
            new MemoryStream(pptxBytes), "deck.pptx", CancellationToken.None);
        var pdfBytes = await ReadAllAsync(pdfStream);

        // Assert
        pdfBytes.Length.ShouldBeGreaterThan(0);
        Encoding.ASCII.GetString(pdfBytes, 0, 5).ShouldBe("%PDF-");
    }

    [Fact]
    public void IsConfigured_WhenBaseAddressSet_ReturnsTrue()
    {
        // Arrange
        var converter = CreateConverter();

        // Act / Assert
        converter.IsConfigured.ShouldBeTrue();
    }

    private GotenbergPowerPointConverter CreateConverter()
    {
        var factory = new SimpleHttpClientFactory(gotenberg.BaseAddress);
        return new GotenbergPowerPointConverter(factory, NullLogger<GotenbergPowerPointConverter>.Instance);
    }

    private static async Task<byte[]> ReadAllAsync(Stream stream)
    {
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms);
        return ms.ToArray();
    }

    private sealed class SimpleHttpClientFactory : IHttpClientFactory
    {
        private readonly Uri baseAddress;

        public SimpleHttpClientFactory(Uri baseAddress)
        {
            this.baseAddress = baseAddress;
        }

        public HttpClient CreateClient(string name) => new()
        {
            BaseAddress = baseAddress,
            Timeout = TimeSpan.FromSeconds(120),
        };
    }
}
