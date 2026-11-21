// The Rust core run on a database, as apps/mac/Sources/Shell/Shell.swift's Core: each call's statements answered from
// SQLite until the core is done or refuses. A call waits in its thread's own state between its steps, so every call
// must come from one thread, one at a time: the app's UI thread.
using System.Text.Json;
using GospelPresenter.Shell.Ffi;

namespace GospelPresenter.Shell;

/// <summary>A refusal of the core's: its code (forbidden, not-found, invalid-args, limit, sql-error: …).</summary>
public sealed class Refusal(string code) : Exception(code)
{
    public string Code { get; } = code;
}

/// <summary>The Rust core, run on one database.</summary>
public sealed class Core(Database db)
{
    public Database Db { get; } = db;

    /// <summary>Runs one call to its end in whatever transaction the caller holds: a view's JSON text, or none for a
    /// command. A refusal is thrown.</summary>
    public string? Call(string name, string args = "{}", Caller? caller = null)
    {
        var step = GpCoreFfiMethods.Start(name, args, caller);
        while (true)
        {
            switch (step)
            {
                case Step.Done done: return done.Json;
                case Step.Refused refused: throw new Refusal(refused.Code);
                case Step.Sql sql:
                    SqlAnswer answer;
                    try { answer = new SqlAnswer.Rows(Db.Query(sql.SqlValue, sql.Params)); }
                    catch (SqlException e) { answer = new SqlAnswer.Failed(e.Message); }
                    step = GpCoreFfiMethods.Resume(answer);
                    break;
                default: throw new InvalidOperationException($"a step the shell does not know: {step}");
            }
        }
    }

    /// <summary>Runs <paramref name="body"/> in one transaction: committed when it returns, rolled back when it throws
    /// or the commit is refused, as the web's SyncClient does.</summary>
    public T Transaction<T>(Func<T> body)
    {
        Db.Exec("BEGIN");
        try
        {
            var result = body();
            Db.Exec("COMMIT");
            return result;
        }
        catch
        {
            try { Db.Exec("ROLLBACK"); } catch (SqlException) { /* nothing open to roll back */ }
            throw;
        }
    }

    /// <summary>A command in a transaction of its own; a refusal is thrown, the transaction rolled back.</summary>
    public string? Command(string name, string args = "{}", Caller? caller = null) =>
        Transaction(() => Call(name, args, caller));

    /// <summary>A view's answer decoded as <typeparamref name="T"/>, with the arguments as an object of JSON's.</summary>
    public T View<T>(string name, object? args = null, Caller? caller = null)
    {
        var json = Call(name, JsonSerializer.Serialize(args ?? new { }, Json.Options), caller)
            ?? throw new Refusal($"{name} answered nothing");
        return JsonSerializer.Deserialize<T>(json, Json.Options) ?? throw new Refusal($"{name} answered null");
    }
}

/// <summary>JSON as the core writes it: camelCase names.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
