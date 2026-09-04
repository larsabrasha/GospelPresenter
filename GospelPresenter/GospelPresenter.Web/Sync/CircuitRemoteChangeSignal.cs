using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Sync;

namespace GospelPresenter.Web.Sync;

/// <summary>
/// How a browser hears about another user's edit. No socket of its own: a circuit already runs in
/// this process, so it subscribes to the notifier directly and the views holding
/// <c>&lt;RefreshOnSync/&gt;</c> reload.
///
/// Scoped, so one of these belongs to each circuit and dies with it. Singleton would mean either
/// handing every user every organisation's announcements, or pushing the organisation into
/// <c>RefreshOnSync</c> — and which organisation a user may hear about is an authorisation decision,
/// which has no business inside a view.
///
/// The organisation is read when an announcement arrives rather than at construction: a circuit is
/// built before the user's identity is resolved, and a super admin can switch organisation without
/// the circuit being rebuilt.
///
/// A circuit hears its own writes too, and reloading a view that already shows the change is
/// harmless. There is nothing to exclude it by: a browser write belongs to no device.
/// </summary>
public sealed class CircuitRemoteChangeSignal : IRemoteChangeSignal, IDisposable
{
    private readonly IOrganizationChangeNotifier notifier;
    private readonly ActiveOrganizationState organization;

    public event Action? RemoteChangesApplied;

    public CircuitRemoteChangeSignal(
        IOrganizationChangeNotifier notifier, ActiveOrganizationState organization)
    {
        this.notifier = notifier;
        this.organization = organization;
        this.notifier.Announced += OnAnnounced;
    }

    private void OnAnnounced(OrganizationChange change)
    {
        // A change with no organisation concerns everybody — see OrganizationChange.
        if (change.OrganizationId is not null &&
            change.OrganizationId != organization.ActiveOrganizationId)
            return;

        RemoteChangesApplied?.Invoke();
    }

    public void Dispose() => notifier.Announced -= OnAnnounced;
}
