using CommunityToolkit.Mvvm.Messaging;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.State;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Auth;

/// <summary>
/// Mirrors the cached identity into the local database whenever it is stored. A seam rather than a
/// direct dependency because <see cref="DeviceAuthService"/> is otherwise a file and a token, and
/// because a host that has no local database (or a test that wants none) simply does not register
/// one — the service resolves it optionally.
/// </summary>
public interface IDeviceIdentityStore
{
    Task SaveAsync(DeviceIdentity identity, CancellationToken ct = default);
}

/// <summary>
/// The device hosts' implementation: writes the two rows through
/// <see cref="DeviceIdentityRows.UpsertAsync"/> and tells the UI when they moved, so a menu already
/// on screen picks up a name that arrived after it was drawn — which is what happens on every start,
/// since the identity is refreshed from /api/me in the background.
/// </summary>
public sealed class LocalDeviceIdentityStore(
    IDbContextFactory<ClientDataContext> contextFactory,
    ILogger<LocalDeviceIdentityStore> logger) : IDeviceIdentityStore
{
    public async Task SaveAsync(DeviceIdentity identity, CancellationToken ct = default)
    {
        try
        {
            await using var db = await contextFactory.CreateDbContextAsync(ct);
            if (await DeviceIdentityRows.UpsertAsync(db, identity, ct))
                WeakReferenceMessenger.Default.Send(new CurrentUserChangedMessage());
        }
        catch (Exception ex)
        {
            // Never fail a sign-in over this. The rows are also written by every pull, so the worst
            // case is the blank-looking menu this exists to prevent, not a user who cannot get in.
            logger.LogError(ex, "Could not mirror the device identity into the local database");
        }
    }
}
