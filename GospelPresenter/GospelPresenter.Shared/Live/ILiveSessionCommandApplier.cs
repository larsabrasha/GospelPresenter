namespace GospelPresenter.Shared.Live;

/// <summary>
/// Applies a controller's command to this device's own live state.
///
/// Deliberately not a UI concern. Whether a phone can drive this machine has to depend on one thing
/// only — that the machine is presenting — and a Blazor component's lifetime is unrelated to that:
/// the session lives in <c>SharedAppState</c> and the connection in the mirror, both for as long as
/// the service lasts, while the presentation page comes and goes as the operator navigates. Wiring
/// the two together through the page meant a command arriving while the operator happened to be
/// looking at another screen was dropped without a trace, leaving the server's replica — and so the
/// congregation's screens — showing a slide the projector was not.
/// </summary>
public interface ILiveSessionCommandApplier
{
    /// <summary>
    /// Puts the session where the command says. Absolute, so applying the same command twice lands
    /// in the same place, and safe to call when nothing is presenting — it then does nothing.
    /// </summary>
    Task ApplyAsync(string sessionId, MirroredSessionCommand command);
}
