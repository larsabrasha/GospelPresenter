using GospelPresenter.Shared.Sync;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// Records announcements instead of coalescing and delivering them. Synchronous on purpose: the
/// real notifier's half-second window is its own business and is pinned separately, and a test that
/// waited for it would be slow for no reason.
/// </summary>
public sealed class RecordingChangeNotifier : IOrganizationChangeNotifier
{
    private readonly List<OrganizationChange> announcements = [];

    public IReadOnlyList<OrganizationChange> Announcements
    {
        get
        {
            lock (announcements)
                return announcements.ToList();
        }
    }

    public IReadOnlyList<string?> Organizations =>
        Announcements.Select(a => a.OrganizationId).ToList();

    public void Notify(string? organizationId, string? sourceDeviceId = null)
    {
        var change = new OrganizationChange(
            organizationId, sourceDeviceId ?? DeviceWriteScope.CurrentDeviceId);
        lock (announcements)
            announcements.Add(change);

        Announced?.Invoke(change);
    }

    public event Action<OrganizationChange>? Announced;

    public void Clear()
    {
        lock (announcements)
            announcements.Clear();
    }
}
