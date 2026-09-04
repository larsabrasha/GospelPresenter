namespace GospelPresenter.Shared.Sync;

/// <summary>
/// "Something in this organisation's synced data changed." Deliberately empty of detail: what to
/// fetch is a decision the sync engine already owns, and an announcement with no payload has no wire
/// contract for an old client to misunderstand — which is why the protocol floor
/// (<see cref="SyncProtocol.Minimum"/>) does not apply to this channel at all.
/// </summary>
/// <param name="OrganizationId">
/// Null means "every organisation". Used when the organisation cannot be derived from the change —
/// a built-in theme, a user setting — where announcing to everyone is wasteful but never wrong.
/// Dropping the announcement instead would be silent and would cost five minutes of staleness.
/// </param>
/// <param name="SourceDeviceId">
/// The device whose push produced the change, if it was a device. Excluded from the announcement, so
/// a device is not told about the change it just made. Null for a write from a browser, which
/// belongs to no device and therefore excludes nobody.
/// </param>
public readonly record struct OrganizationChange(string? OrganizationId, string? SourceDeviceId);

/// <summary>
/// Where a write says it happened, and where the hub and the web's own circuits hear about it.
///
/// The interface lives in Shared because <c>PresentationContext</c> does, but only the web host
/// registers an implementation that does anything: a device already knows about its own writes, and
/// <c>ClientDataContext</c> inherits the same context, so without the null implementation below the
/// desktop would ring a bell at itself on every row a pull applies.
/// </summary>
public interface IOrganizationChangeNotifier
{
    /// <summary>
    /// Announces a change. Called from inside a save, so it must return immediately — the
    /// implementation coalesces and delivers on its own time.
    /// </summary>
    void Notify(string? organizationId, string? sourceDeviceId = null);

    event Action<OrganizationChange>? Announced;
}

/// <summary>
/// The no-op every host gets unless it replaces it. Registered in <c>SharedServicesSetup</c> rather
/// than left unregistered so that a service can take this as an ordinary dependency: the container
/// does not honour default parameter values, and a host that forgot the registration would fail to
/// build its graph rather than quietly stop announcing.
/// </summary>
public sealed class NullOrganizationChangeNotifier : IOrganizationChangeNotifier
{
    public void Notify(string? organizationId, string? sourceDeviceId = null)
    {
    }

    public event Action<OrganizationChange>? Announced
    {
        add { }
        remove { }
    }
}
