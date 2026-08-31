using GospelPresenter.Client.Media;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// Pins the pure mapping layer: webview paths → object keys, keys → server download URLs, and the
/// Range header parsing WKWebView's audio playback depends on.
/// </summary>
public class MediaResolutionTests
{
    [Theory]
    [InlineData("/api/images/org-image/img-1/full", "org/org-1/images/img-1/full")]
    [InlineData("/api/images/org-image/img-1/thumb", "org/org-1/images/img-1/thumb")]
    [InlineData("/api/images/overlay/ovl-1/image", "org/org-1/overlays/ovl-1/image")]
    [InlineData("/api/images/slides/deck-1/3", "org/org-1/slides/deck-1/page-3.webp")]
    [InlineData("/api/audio/org-audio/aud-1", "org/org-1/audios/aud-1/file")]
    [InlineData("/api/live-images/session-x/org-image/img-1/full", "org/org-1/images/img-1/full")]
    [InlineData("/api/live-images/session-x/slides/deck-1/0", "org/org-1/slides/deck-1/page-0.webp")]
    [InlineData("/api/live-images/session-x/overlay/ovl-1/image", "org/org-1/overlays/ovl-1/image")]
    public void RequestPaths_ResolveToTheSameKeysTheServerUses(string path, string expectedKey)
    {
        MediaUrlResolver.KeyForRequestPath(path, "org-1").ShouldBe(expectedKey);
    }

    [Theory]
    [InlineData("/api/images/slides/deck-1/not-a-number")]
    [InlineData("/api/theme-images/aurora/background-full-abc.webp")]
    [InlineData("/api/sync/pull")]
    [InlineData("/index.html")]
    public void OtherPaths_ResolveToNothing(string path)
    {
        MediaUrlResolver.KeyForRequestPath(path, "org-1").ShouldBeNull();
    }

    [Theory]
    [InlineData("org/org-1/images/img-1/full", "/api/images/org-image/img-1/full")]
    [InlineData("org/org-1/overlays/ovl-1/image", "/api/images/overlay/ovl-1/image")]
    [InlineData("org/org-1/audios/aud-1/file", "/api/audio/org-audio/aud-1")]
    [InlineData("org/org-1/slides/deck-1/page-3.webp", "/api/images/slides/deck-1/3")]
    public void Keys_ResolveToTheirDownloadUrls(string key, string expectedUrl)
    {
        MediaUrlResolver.ServerUrlForKey(key).ShouldBe(expectedUrl);
    }

    [Fact]
    public void ThemeAssetRequests_AreRecognized()
    {
        MediaUrlResolver.ThemeAssetRequest("/api/theme-images/aurora/background-full-abc123.webp")
            .ShouldBe(("aurora", "background-full-abc123.webp"));
        MediaUrlResolver.ThemeAssetRequest("/api/images/org-image/x/full").ShouldBeNull();
    }

    [Theory]
    [InlineData("bytes=0-499", 1000, 0, 499)]
    [InlineData("bytes=500-", 1000, 500, 999)]
    [InlineData("bytes=-200", 1000, 800, 999)]
    [InlineData("bytes=0-5000", 1000, 0, 999)]
    public void ByteRanges_Parse(string header, long total, long start, long end)
    {
        MediaByteRange.TryParse(header, total).ShouldBe(new MediaByteRange(start, end));
    }

    [Theory]
    [InlineData(null, 1000)]
    [InlineData("bytes=1000-", 1000)]
    [InlineData("bytes=5-2", 1000)]
    [InlineData("bytes=0-100,200-300", 1000)]
    [InlineData("items=0-1", 1000)]
    [InlineData("bytes=0-", 0)]
    public void UnusableRanges_FallBackToTheWholeBody(string? header, long total)
    {
        MediaByteRange.TryParse(header, total).ShouldBeNull();
    }
}
