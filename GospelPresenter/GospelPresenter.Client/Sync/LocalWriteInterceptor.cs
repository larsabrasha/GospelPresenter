using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Tells the sync scheduler that the local database was touched, so an edit reaches the server in
/// about half a second instead of waiting out the poll.
///
/// A command interceptor rather than a hook on SaveChanges, and rather than a call at each mutation
/// site. SaveChanges sees only half the writes — renaming a presentation, renaming an item,
/// changing the theme, the date or a template's schedule all go through ExecuteUpdate, which exists
/// precisely because it bypasses the change tracker. And there are 109 mutation call sites in the
/// shared services: this repository has already been bitten twice by "every call site must
/// remember" (see ISyncTracked on why the row version moved into a database trigger). Every command
/// EF runs passes through here, ExecuteUpdate and raw SQL included.
///
/// Every command, not just the ones that look like writes: EF runs SaveChanges batches through
/// ExecuteReader on SQLite when it needs the affected-row count back, so filtering on NonQuery
/// would miss ordinary saves. The scheduler answers a signal with a journal read that costs six
/// microseconds and says "nothing" when nothing was written, so the cheapest correct filter is
/// none at all — with the pleasant side effect that the app looks often while someone is using it
/// and not at all while it sits idle.
/// </summary>
public sealed class LocalWriteInterceptor(LocalWriteSignal signal) : DbCommandInterceptor
{
    public override DbDataReader ReaderExecuted(
        DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    {
        signal.Raise();
        return result;
    }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        signal.Raise();
        return ValueTask.FromResult(result);
    }

    public override int NonQueryExecuted(
        DbCommand command, CommandExecutedEventData eventData, int result)
    {
        signal.Raise();
        return result;
    }

    public override ValueTask<int> NonQueryExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        signal.Raise();
        return ValueTask.FromResult(result);
    }

    public override object? ScalarExecuted(
        DbCommand command, CommandExecutedEventData eventData, object? result)
    {
        signal.Raise();
        return result;
    }

    public override ValueTask<object?> ScalarExecutedAsync(
        DbCommand command, CommandExecutedEventData eventData, object? result,
        CancellationToken cancellationToken = default)
    {
        signal.Raise();
        return ValueTask.FromResult(result);
    }
}
