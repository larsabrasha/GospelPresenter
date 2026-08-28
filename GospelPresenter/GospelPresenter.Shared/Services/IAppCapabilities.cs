namespace GospelPresenter.Shared.Services;

/// <summary>
/// What this host can offer. The web has everything; the device app hides what only makes sense
/// against the server — remote displays pair with the SERVER's SignalR hub, calendar feeds are
/// served by the web host, and the Users table does not sync, so administering it (or editing the
/// own profile stored in it) on the device would silently diverge. Components read these flags to
/// hide the corresponding UI; permanently absent features are hidden, never disabled-with-a-hint.
/// </summary>
public interface IAppCapabilities
{
    /// <summary>Paired remote displays, ad-hoc pairing, public QR outputs and remote control.</summary>
    bool RemoteDisplays { get; }

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
    public bool RemoteDisplays => true;
    public bool CalendarSubscriptions => true;
    public bool UserAdministration => true;
    public bool ProfileEditing => true;
}
