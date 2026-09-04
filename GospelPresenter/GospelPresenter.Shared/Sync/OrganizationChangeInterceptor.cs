using System.Runtime.CompilerServices;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GospelPresenter.Shared.Sync;

/// <summary>
/// Announces every save that touched synced data.
///
/// An interceptor rather than a line in <c>PresentationContext.SaveChanges</c>, and the reason is
/// the opposite of the one written above <c>ApplySyncTrackingAsync</c>: stamping must be impossible
/// for a host to drop, whereas announcing must be trivial for a host to drop. <c>ClientDataContext</c>
/// inherits the same context, so a device would otherwise ring a bell at itself on every row a pull
/// applies. Only the web adds this interceptor.
///
/// It runs immediately after <c>ApplySyncTrackingAsync</c> and therefore sees what that method just
/// did — including the <see cref="SyncTombstone"/> rows it added, which is how deletions are
/// announced with an exact organisation even when the deleted row was a child.
///
/// Registered as one instance for many contexts, so the organisations collected between saving and
/// saved are keyed by context. A weak table because a context that is abandoned without saving —
/// thrown out of, disposed mid-transaction — must not keep its entry alive.
/// </summary>
public sealed class OrganizationChangeInterceptor(IOrganizationChangeNotifier notifier) : SaveChangesInterceptor
{
    private readonly ConditionalWeakTable<DbContext, HashSet<string?>> collected = new();

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        Collect(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Collect(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Announce(eventData.Context);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        Announce(eventData.Context);
        return ValueTask.FromResult(result);
    }

    /// <summary>
    /// A failed save changed nothing, so what was collected is dropped rather than announced. The
    /// caller may well go on to save something else through the same context.
    /// </summary>
    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (eventData.Context is not null)
            collected.Remove(eventData.Context);
    }

    public override Task SaveChangesFailedAsync(
        DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        SaveChangesFailed(eventData);
        return Task.CompletedTask;
    }

    private void Collect(DbContext? context)
    {
        if (context is null)
            return;

        HashSet<string?>? organizations = null;

        foreach (var entry in context.ChangeTracker.Entries())
        {
            // Deleted synced rows are not read here. They are covered by the tombstones the same
            // save is inserting, which know the organisation exactly — a deleted child would answer
            // null and turn a one-organisation deletion into an announcement to everybody.
            var isSyncedWrite =
                entry.State is EntityState.Added or EntityState.Modified &&
                entry.Entity is ISyncTracked;
            var isTombstone =
                entry.State == EntityState.Added && entry.Entity is SyncTombstone;

            if (!isSyncedWrite && !isTombstone)
                continue;

            // User-scoped rows are skipped here, and announced by the services that write them.
            // They carry a user rather than an organisation, so this would have to announce them to
            // everybody — and a preferred language, which is written on every language switch, would
            // then wake every device on the server. The writers know the caller's organisation
            // exactly. Measured: the mock seed's one user setting rang every connection.
            if (IsUserScoped(entry.Entity))
                continue;

            organizations ??= [];
            organizations.Add(SyncedEntityOrganization.For(entry.Entity));
        }

        if (organizations is null)
        {
            // Nothing synced in this save — a login, a device token, an invite. Clear any earlier
            // collection for this context so it cannot be announced by a later unrelated save.
            collected.Remove(context);
            return;
        }

        // A save that touched only child rows collected nothing but nulls, and one announcement to
        // everyone is then the answer. Alongside a row that did name its organisation, though, the
        // null is that same aggregate seen from its children and is dropped — at the cost of
        // under-announcing a built-in theme saved in the same unit of work as an organisation's own
        // row, which is a thing only seeding does.
        if (organizations.Count > 1)
            organizations.Remove(null);

        collected.AddOrUpdate(context, organizations);
    }

    /// <summary>
    /// A row that belongs to a user rather than to an organisation, including the tombstone written
    /// when one is deleted.
    /// </summary>
    private static bool IsUserScoped(object entity) => entity switch
    {
        UserSetting => true,
        SyncTombstone { OrganizationId: null, UserId: not null } => true,
        _ => false,
    };

    private void Announce(DbContext? context)
    {
        if (context is null || !collected.TryGetValue(context, out var organizations))
            return;

        collected.Remove(context);
        foreach (var organizationId in organizations)
            notifier.Notify(organizationId);
    }
}
