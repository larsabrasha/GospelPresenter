namespace GospelPresenter.Shared.Sync;

/// <summary>
/// The contract version between an installed app and this server, and the headers that carry it.
/// See adr/0002-app-distribution-and-updates.md (24)–(25).
///
/// Deliberately separate from the app's version number. The app can go 1.2.0 → 1.9.0 in bug fixes
/// without the sync contract changing once, and the server should not have to care; conversely a
/// protocol break is a fact about the wire format, not about how much the app has changed. Keeping
/// them apart means the floor below is raised for a reason someone can name.
/// </summary>
public static class SyncProtocol
{
    /// <summary>The app's own semantic version, for the admin device list. Free-text, never compared.</summary>
    public const string VersionHeader = "X-Client-Version";

    /// <summary>The wire contract version, which <see cref="Minimum"/> is compared against.</summary>
    public const string ProtocolHeader = "X-Client-Protocol";

    /// <summary>
    /// What this build speaks. Raise it only when the wire format changes in a way an older server
    /// or client cannot handle — not when an app release happens.
    /// </summary>
    public const int Current = 1;

    /// <summary>
    /// The oldest protocol this server still serves. Requests below it are answered
    /// 426 Upgrade Required rather than served, because a client that misunderstands the format
    /// does not fail loudly — it fails as wrong data on someone's machine.
    ///
    /// Raise this only against a measured version distribution (/admin/devices): every device below
    /// the new floor stops syncing until its user updates, and on a shared church computer nobody
    /// is watching for that.
    /// </summary>
    public const int Minimum = 1;

    /// <summary>
    /// Reads the protocol version a request claims. A request with no header at all is treated as
    /// <see cref="Current"/>: the header was introduced alongside the floor, so its absence means a
    /// caller that predates both — including the web app's own tests and any manual curl — and
    /// locking those out would be enforcing a contract against callers who never agreed to one.
    /// A header that is present but unparseable is a client bug, and reads as 0 so the floor
    /// catches it.
    /// </summary>
    public static int Parse(string? headerValue) =>
        headerValue is null ? Current
        : int.TryParse(headerValue, out var value) ? value
        : 0;
}
