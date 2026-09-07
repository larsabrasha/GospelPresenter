using GospelPresenter.Shared.Services;

namespace GospelPresenter.Shared.State;

/// <summary>
/// What the anonymous live and watch image proxies may hand out: the media of the slide that is on
/// screen right now, and the overlay over it — not every image the organisation owns. A session id
/// or a watch code gets a visitor exactly what the congregation is looking at, which is what the
/// proxies exist for; without this, either would also have been a key to the whole library for as
/// long as a service was live.
///
/// The path compared is the tail after the live prefix, so the same check serves both proxies: a
/// watch URL is a live URL with its prefix swapped (see ImageUrlHelper.ToWatchUrl).
/// </summary>
public static class LiveMediaScope
{
    public static bool IsOnScreen(SharedAppState state, string sessionId, string mediaPath)
    {
        var prefix = ImageUrlHelper.LiveImagePrefix(sessionId);
        return Matches(state.GetLiveSlide(sessionId).ImageUrl, prefix, mediaPath)
               || Matches(state.GetActiveOverlay(sessionId)?.ImageUrl, prefix, mediaPath);
    }

    private static bool Matches(string? url, string prefix, string mediaPath) =>
        url is not null
        && url.StartsWith(prefix, StringComparison.Ordinal)
        && url.AsSpan(prefix.Length).SequenceEqual(mediaPath);
}
