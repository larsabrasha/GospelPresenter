using System.Collections.Concurrent;

namespace GospelPresenter.Web.Sync;

/// <summary>
/// Which hub connections belong to which device, so an announcement can leave out the device whose
/// push caused it.
///
/// In memory, like <c>MirroredSessionRegistry</c>, and with the same consequence: a second web
/// replica would keep its own half of the picture. The failure mode is a device told about its own
/// change — one wasted sync cycle — rather than anything wrong.
///
/// A device can hold more than one connection for a moment: a reconnection registers before the old
/// connection's disconnect is processed, and excluding only the newest would let the echo through on
/// the older one.
/// </summary>
public class OrganizationChangeConnectionRegistry
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> byDevice = new();
    private readonly ConcurrentDictionary<string, string> deviceByConnection = new();

    public void Register(string deviceId, string connectionId)
    {
        deviceByConnection[connectionId] = deviceId;
        byDevice.GetOrAdd(deviceId, _ => new ConcurrentDictionary<string, byte>())[connectionId] = 0;
    }

    public void Forget(string connectionId)
    {
        if (!deviceByConnection.TryRemove(connectionId, out var deviceId))
            return;

        if (!byDevice.TryGetValue(deviceId, out var connections))
            return;

        connections.TryRemove(connectionId, out _);
        if (connections.IsEmpty)
            byDevice.TryRemove(deviceId, out _);
    }

    /// <summary>
    /// The connections to exclude from an announcement. Empty for an unknown device, and for a
    /// change that came from a browser — a browser belongs to no device and excludes nobody.
    /// </summary>
    public IReadOnlyList<string> ConnectionsFor(string? deviceId) =>
        deviceId is not null && byDevice.TryGetValue(deviceId, out var connections)
            ? connections.Keys.ToList()
            : [];
}
