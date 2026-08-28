using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Client.Media;

/// <summary>What the webview scheme handler answers a media request with.</summary>
public record MediaResponse(int Status, string ContentType, byte[] Data, string? ContentRange = null);

/// <summary>
/// Serves the webview's media requests — the platform scheme handlers (WKUrlSchemeHandler on
/// Catalyst/iOS) are thin marshalling shells around this. Built-in theme art comes straight from
/// the embedded resources; everything else resolves to an object key and is read from the local
/// store (with an on-demand server fetch behind it). Audio needs HTTP range support: WKWebView
/// refuses to play media from a handler that ignores its Range header.
/// </summary>
public class MediaRequestHandler(
    IObjectStorageService storage,
    IThemeAssetService themeAssets,
    DeviceAuthService auth)
{
    public async Task<MediaResponse?> HandleAsync(string path, string? rangeHeader, CancellationToken cancellationToken = default)
    {
        if (MediaUrlResolver.ThemeAssetRequest(path) is { } themeRequest)
        {
            var assetPath = ThemeAssetService.AssetPathFromRequest(themeRequest.Slug, themeRequest.FileName);
            var bytes = assetPath is null ? null : themeAssets.ReadAsset(assetPath);
            return bytes is null ? null : Respond(bytes, "image/webp", rangeHeader);
        }

        var organizationId = auth.CurrentIdentity?.OrganizationId;
        if (organizationId is null)
            return null;

        var key = MediaUrlResolver.KeyForRequestPath(path, organizationId);
        if (key is null)
            return null;

        var result = await storage.GetAsync(key, cancellationToken);
        if (result is null)
            return null;

        await using var stream = result.Value.Stream;
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        return Respond(buffer.ToArray(), result.Value.ContentType, rangeHeader);
    }

    private static MediaResponse Respond(byte[] data, string contentType, string? rangeHeader)
    {
        if (MediaByteRange.TryParse(rangeHeader, data.Length) is not { } range)
            return new MediaResponse(200, contentType, data);

        var slice = data[(int)range.Start..(int)(range.End + 1)];
        return new MediaResponse(206, contentType, slice,
            ContentRange: $"bytes {range.Start}-{range.End}/{data.Length}");
    }
}

/// <summary>An inclusive byte range, parsed from an HTTP Range header.</summary>
public readonly record struct MediaByteRange(long Start, long End)
{
    /// <summary>
    /// Parses "bytes=start-end", "bytes=start-" and "bytes=-suffixLength". Null for anything else
    /// (including an unsatisfiable range), which callers answer with the whole body — the lenient
    /// reading every browser accepts.
    /// </summary>
    public static MediaByteRange? TryParse(string? header, long totalLength)
    {
        if (header is null || totalLength == 0 || !header.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
            return null;

        var spec = header["bytes=".Length..].Trim();
        if (spec.Contains(','))
            return null;

        var dash = spec.IndexOf('-');
        if (dash < 0)
            return null;

        var startPart = spec[..dash];
        var endPart = spec[(dash + 1)..];

        if (startPart.Length == 0)
        {
            // "bytes=-500": the last 500 bytes
            if (!long.TryParse(endPart, out var suffixLength) || suffixLength <= 0)
                return null;
            var start = Math.Max(0, totalLength - suffixLength);
            return new MediaByteRange(start, totalLength - 1);
        }

        if (!long.TryParse(startPart, out var from) || from < 0 || from >= totalLength)
            return null;

        if (endPart.Length == 0)
            return new MediaByteRange(from, totalLength - 1);

        if (!long.TryParse(endPart, out var to) || to < from)
            return null;

        return new MediaByteRange(from, Math.Min(to, totalLength - 1));
    }
}
