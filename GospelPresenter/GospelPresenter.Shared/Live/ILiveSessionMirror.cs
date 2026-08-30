namespace GospelPresenter.Shared.Live;

/// <summary>
/// A host that can mirror its live presentation to the server, so that it shows up alongside the
/// ones started in a browser: controllable from a phone, and able to feed a public output.
///
/// Only the device hosts register one. The web needs none — a presentation started in a browser is
/// already in the server's live state, because that is where it is running.
///
/// Every method is safe to call whether or not the device is online. Mirroring is an extra that
/// comes and goes with the network; what the projector shows never depends on it.
/// </summary>
public interface ILiveSessionMirror
{
    /// <summary>Begins mirroring a session that has just gone live.</summary>
    Task StartAsync(string sessionId);

    /// <summary>Ends the mirrored session. The server stops offering it for control.</summary>
    Task StopAsync();

    /// <summary>Whether the server is currently reachable. False while a session sits frozen.</summary>
    bool IsConnected { get; }

    /// <summary>
    /// Applies a controller's command to the local live state. The host sets this once the UI that
    /// knows how to turn a selection into a slide is on screen; until then the device mirrors
    /// upward but cannot be driven.
    /// </summary>
    Func<MirroredSessionCommand, Task>? CommandHandler { get; set; }

    /// <summary>Raised when the connection comes or goes.</summary>
    event Action? Changed;
}
