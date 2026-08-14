using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GospelPresenter.IntegrationTests.Fixtures;

/// <summary>
/// Counts every SQL command the application sends, so a test can assert how many database
/// round-trips a request costs. Registered as an EF Core interceptor by <see cref="WebAppFixture"/>.
/// </summary>
public class DatabaseQueryCounter
{
    private readonly Lock gate = new();
    private readonly List<string> commands = [];

    public int Count
    {
        get
        {
            lock (gate) return commands.Count;
        }
    }

    public IReadOnlyList<string> Commands
    {
        get
        {
            lock (gate) return commands.ToList();
        }
    }

    /// <summary>Counts the recorded commands whose SQL contains <paramref name="fragment"/>.</summary>
    public int CountContaining(string fragment)
    {
        lock (gate) return commands.Count(c => c.Contains(fragment, StringComparison.Ordinal));
    }

    public void Reset()
    {
        lock (gate) commands.Clear();
    }

    internal void Record(string commandText)
    {
        lock (gate) commands.Add(commandText);
    }
}

public class CountingCommandInterceptor(DatabaseQueryCounter counter) : DbCommandInterceptor
{
    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        counter.Record(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        counter.Record(command.CommandText);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<object> ScalarExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
    {
        counter.Record(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        counter.Record(command.CommandText);
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        counter.Record(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        counter.Record(command.CommandText);
        return ValueTask.FromResult(result);
    }
}
