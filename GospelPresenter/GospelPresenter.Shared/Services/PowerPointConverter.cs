using System.Net.Http;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

public interface IPowerPointConverter
{
    bool IsConfigured { get; }
    Task<Stream> ConvertToPdfAsync(Stream input, string fileName, CancellationToken cancellationToken);
}

public class GotenbergPowerPointConverter : IPowerPointConverter
{
    public const string HttpClientName = "Gotenberg";
    private const string ConvertEndpoint = "/forms/libreoffice/convert";

    private readonly IHttpClientFactory httpClientFactory;
    private readonly ILogger<GotenbergPowerPointConverter> logger;

    public GotenbergPowerPointConverter(IHttpClientFactory httpClientFactory, ILogger<GotenbergPowerPointConverter> logger)
    {
        this.httpClientFactory = httpClientFactory;
        this.logger = logger;
    }

    public bool IsConfigured
    {
        get
        {
            var client = httpClientFactory.CreateClient(HttpClientName);
            return client.BaseAddress is not null;
        }
    }

    public async Task<Stream> ConvertToPdfAsync(Stream input, string fileName, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        if (client.BaseAddress is null)
            throw new NotSupportedException("PowerPoint conversion is not configured. Set Gotenberg:Endpoint to enable it.");

        using var content = new MultipartFormDataContent();
        var fileContent = new StreamContent(input);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Add(fileContent, "files", fileName);

        using var response = await client.PostAsync(ConvertEndpoint, content, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            logger.LogWarning("Gotenberg conversion failed for {FileName}: {Status} {Body}", fileName, response.StatusCode, body);
            throw new InvalidOperationException("Could not convert the PowerPoint file. The file may be corrupted or password-protected.");
        }

        var pdfBytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        return new MemoryStream(pdfBytes, writable: false);
    }
}
