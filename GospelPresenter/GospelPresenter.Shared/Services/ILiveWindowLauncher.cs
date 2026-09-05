using System.Text.Json.Serialization;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// What a live window is for. The operator sees the two as different rows — a numbered live view
/// they can open several of, and the one projector output — so a window that reports itself has to
/// say which of the two it is, or a projector rediscovered after a reload turns into "Live view (1)".
/// </summary>
/// <remarks>
/// Written and read as its name rather than as a number: it crosses into a window's URL and back
/// out of the script's answer, where a bare 0 or 1 would be unreadable and a reordering of this
/// enum would silently turn every projector into a live view.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum LiveWindowRole
{
    Live,
    Projector,
}

/// <summary>
/// One live window: what it shows, which session it belongs to, and the number the operator reads
/// on its row. Carried into the window's own URL so the window can say all of it back when asked
/// who is out there — that answer, not this host's bookkeeping, is what survives an operator page
/// that reloaded.
/// </summary>
public record LiveWindowEntry(string SessionId, string WindowId, string Title, LiveWindowRole Role, int Index);

/// <summary>
/// Opens and closes local live (projector) windows natively. The desktop and MAUI hosts register an
/// implementation — a second app window of their own on /live; the web keeps its synchronous
/// window.open() path, which must run inside the click gesture or Safari blocks it, so components
/// resolve this optionally and fall back to the JS route without it.
/// </summary>
public interface ILiveWindowLauncher
{
    /// <summary>Opens a live window. False when the window could not be created.</summary>
    Task<bool> OpenAsync(LiveWindowEntry window);

    Task CloseAsync(string windowId);

    /// <summary>
    /// The windows this host has open for a session, whoever opened them. A launcher outlives the
    /// circuit that asked for a window — it belongs to the process — so this is what an operator
    /// page coming back from a reload asks instead of opening a second set.
    /// </summary>
    IReadOnlyList<LiveWindowEntry> OpenWindowsFor(string sessionId);

    /// <summary>
    /// Whether there is a display to present on that the operator is not working on. Where this is
    /// true, <see cref="OpenAsync"/> puts the window there and fills it; where it is false, a live
    /// window is just a second window on the one screen.
    ///
    /// The web asks the browser's Presentation API the same question instead. That API exists in a
    /// desktop webview too, but has nothing to offer there — it looks for Cast receivers, not the
    /// monitor on the desk — so a host that answers true here is saying "ignore it and ask me".
    /// </summary>
    Task<bool> HasExternalDisplayAsync();

    /// <summary>Raised with the window id when a live window closed, whoever closed it.</summary>
    event Action<string>? WindowClosed;
}
