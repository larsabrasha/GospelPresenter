using System.Collections.Concurrent;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web.Live;

/// <summary>One open Blazor circuit and who is behind it.</summary>
public record ConnectedCircuit(
    string CircuitId,
    string UserId,
    string Name,
    string? OrganizationId,
    string Role,
    DateTimeOffset Since,
    bool IsConnected);

/// <summary>
/// Which circuits this server is holding, and who signed in on them. Fed by
/// <see cref="ConnectedUserCircuitHandler"/>, read by the superadmin view.
///
/// Circuits rather than sessions or cookies, because a circuit is the only one of the three the
/// server can actually see the end of. See <see cref="IConnectedUserDirectory"/>.
/// </summary>
public class ConnectedUserRegistry : IConnectedUserDirectory
{
    private readonly ConcurrentDictionary<string, ConnectedCircuit> circuits = new();

    public event Action? Changed;

    /// <summary>
    /// A circuit that has said who it belongs to. Called again when the authentication state
    /// arrives late — the identity is not always readable the moment the connection comes up — so
    /// it replaces rather than adds, keeping the arrival time the first call recorded.
    /// </summary>
    public void Record(string circuitId, string userId, string name, string? organizationId, string role)
    {
        circuits.AddOrUpdate(
            circuitId,
            _ => new ConnectedCircuit(
                circuitId, userId, name, organizationId, role, DateTimeOffset.UtcNow, true),
            (_, existing) => existing with
            {
                UserId = userId,
                Name = name,
                OrganizationId = organizationId,
                Role = role,
                IsConnected = true
            });

        Changed?.Invoke();
    }

    /// <summary>
    /// The connection dropped, but the server has not given up on the circuit yet. Kept and marked
    /// rather than removed: a reconnect within the retention window is the same person on the same
    /// page, and dropping the row would make a laptop lid look like a sign-out.
    /// </summary>
    public void MarkDisconnected(string circuitId)
    {
        if (!circuits.TryGetValue(circuitId, out var existing) || !existing.IsConnected) return;

        circuits[circuitId] = existing with { IsConnected = false };
        Changed?.Invoke();
    }

    public void MarkConnected(string circuitId)
    {
        if (!circuits.TryGetValue(circuitId, out var existing) || existing.IsConnected) return;

        circuits[circuitId] = existing with { IsConnected = true };
        Changed?.Invoke();
    }

    public void Remove(string circuitId)
    {
        if (!circuits.TryRemove(circuitId, out _)) return;

        Changed?.Invoke();
    }

    /// <summary>
    /// One row per person, not per tab. Somebody with the operator page open on the desk and a
    /// phone in their hand is one person here, and the tab count is what says so.
    /// </summary>
    public IReadOnlyList<ConnectedUser> All() => circuits.Values
        .GroupBy(c => c.UserId)
        .Select(group => new ConnectedUser(
            group.Key,
            group.OrderBy(c => c.Since).Last().Name,
            group.OrderBy(c => c.Since).Last().OrganizationId,
            group.OrderBy(c => c.Since).Last().Role,
            group.Count(),
            group.Min(c => c.Since),
            group.Any(c => c.IsConnected)))
        .OrderBy(u => u.Since)
        .ToList();
}
