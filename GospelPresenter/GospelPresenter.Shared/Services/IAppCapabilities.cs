namespace GospelPresenter.Shared.Services;

/// <summary>
/// What this host can offer. The web has everything; the device apps hide what only makes sense
/// against the server — calendar feeds are served by the web host, and the Users table does not
/// sync, so administering it (or editing the own profile stored in it) on the device would silently
/// diverge. Components read these flags to hide the corresponding UI; permanently absent features
/// are hidden, never disabled-with-a-hint.
/// </summary>
public interface IAppCapabilities
{
    /// <summary>
    /// A phone can drive a presentation running on this host. The desktop app earns this by
    /// mirroring its live session to the server — see adr/0004-mirrored-desktop-live-sessions.md.
    /// </summary>
    bool RemoteControl { get; }

    /// <summary>
    /// Public QR outputs: a link a congregation can follow to read along. Rides on the same
    /// mirroring, since what a visitor loads is rendered and served by the web host.
    /// </summary>
    bool PublicOutput { get; }

    /// <summary>
    /// Paired screens and ad-hoc pairing — a browser somewhere else on the network showing this
    /// session's slides. Still web-only: the pairing is held by the server that both ends reach.
    /// </summary>
    bool PairedDisplays { get; }

    /// <summary>Calendar subscription feeds (served over the web host's HTTP endpoints).</summary>
    bool CalendarSubscriptions { get; }

    /// <summary>The users/organisations/API-keys administration (tables outside the sync protocol).</summary>
    bool UserAdministration { get; }

    /// <summary>The own-profile page (name and picture live in the unsynced Users table).</summary>
    bool ProfileEditing { get; }
}

/// <summary>The web host: everything is available.</summary>
public class FullAppCapabilities : IAppCapabilities
{
    public bool RemoteControl => true;
    public bool PublicOutput => true;
    public bool PairedDisplays => true;
    public bool CalendarSubscriptions => true;
    public bool UserAdministration => true;
    public bool ProfileEditing => true;
}
