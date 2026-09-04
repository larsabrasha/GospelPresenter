using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Sync;

/// <summary>
/// Collects change announcements and delivers at most one per organisation per window.
///
/// The window is not only about traffic. A push applies one save per aggregate, and a first sync
/// into an empty device was measured at 871 songs and 3527 song parts — without coalescing that is a
/// burst of socket messages to every other device in the organisation. It also buys the ordering the
/// announcement needs: <c>ModifiedAt</c> is stamped in <c>SaveChanges</c>, before the commit, so an
/// announcement delivered instantly could arrive before the row it describes is visible. Half a
/// second is far longer than a commit, and <see cref="SyncDefaults.PullOverlap"/> covers the rest.
///
/// Trailing edge on purpose: the first write in a window waits, rather than being delivered
/// immediately and the rest suppressed. Delivering the first one at once is exactly the case that
/// would race the commit.
/// </summary>
public sealed class OrganizationChangeNotifier : IOrganizationChangeNotifier, IDisposable
{
    public static readonly TimeSpan DefaultWindow = TimeSpan.FromMilliseconds(500);

    /// <summary>
    /// Dictionary key for "every organisation" — the dictionary cannot hold a null key, and an empty
    /// string is not a legal organisation id.
    /// </summary>
    private const string AllOrganizations = "";

    private readonly TimeSpan window;
    private readonly ILogger<OrganizationChangeNotifier>? logger;
    private readonly object gate = new();
    private readonly Dictionary<string, Pending> pending = [];
    private bool disposed;

    public event Action<OrganizationChange>? Announced;

    public OrganizationChangeNotifier(
        TimeSpan? window = null, ILogger<OrganizationChangeNotifier>? logger = null)
    {
        this.window = window ?? DefaultWindow;
        this.logger = logger;
    }

    public void Notify(string? organizationId, string? sourceDeviceId = null)
    {
        var key = organizationId ?? AllOrganizations;
        // Resolved here rather than at each call site: the writes that announce are several layers
        // below the endpoint that knows whose push this is, and a site that forgot to pass it would
        // simply cost that device a wasted cycle — invisible, and impossible to notice.
        sourceDeviceId ??= DeviceWriteScope.CurrentDeviceId;

        lock (gate)
        {
            if (disposed)
                return;

            if (pending.TryGetValue(key, out var existing))
            {
                // Two writes inside one window. The announcement may only exclude a device if every
                // change in it came from that device: a browser edit riding along with a device's
                // own push has to reach that device too, or it would never learn about it.
                if (existing.SourceDeviceId != sourceDeviceId)
                    existing.SourceDeviceId = null;
                return;
            }

            // Created stopped and started after it is in the dictionary. A timer that fired while
            // this method still held the reference would find nothing to deliver and drop the
            // announcement.
            var entry = new Pending { SourceDeviceId = sourceDeviceId };
            entry.Timer = new Timer(
                _ => Deliver(key), null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
            pending[key] = entry;
            entry.Timer.Change(this.window, Timeout.InfiniteTimeSpan);
        }
    }

    private void Deliver(string key)
    {
        OrganizationChange change;
        lock (gate)
        {
            if (!pending.Remove(key, out var entry))
                return;
            entry.Timer?.Dispose();
            change = new OrganizationChange(
                key == AllOrganizations ? null : key, entry.SourceDeviceId);
        }

        // Every subscriber gets its own attempt: on the web there is one per open circuit, and one
        // that throws must not stop the rest — least of all the hub broadcaster, which is how every
        // desktop in the organisation hears about this.
        foreach (var handler in Announced?.GetInvocationList() ?? [])
        {
            try
            {
                ((Action<OrganizationChange>)handler)(change);
            }
            catch (Exception e)
            {
                logger?.LogError(e, "A change announcement subscriber failed");
            }
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed)
                return;
            disposed = true;
            foreach (var entry in pending.Values)
                entry.Timer?.Dispose();
            pending.Clear();
        }
    }

    private sealed class Pending
    {
        public Timer? Timer { get; set; }
        public string? SourceDeviceId { get; set; }
    }
}
