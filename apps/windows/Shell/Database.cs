// SQLite for the Rust core, which asks for every statement it needs (an effect) and never opens a database itself:
// the Windows shell's Database, as apps/mac/Sources/Shell/Shell.swift's. SQLite's own API (SQLitePCLRaw) rather than
// ADO.NET: the core's statements mix `?` and `?1`, which only binding by position takes as SQLite does.
using GospelPresenter.Shell.Ffi;
using SQLitePCL;

namespace GospelPresenter.Shell;

/// <summary>SQLite refused a statement: its message.</summary>
public sealed class SqlException(string message) : Exception(message);

/// <summary>One SQLite file, open for the core's statements.</summary>
public sealed class Database : IDisposable
{
    static Database() => Batteries_V2.Init();

    readonly sqlite3 db;

    public Database(string path)
    {
        if (raw.sqlite3_open(path, out db) != raw.SQLITE_OK)
        {
            var message = raw.sqlite3_errmsg(db).utf8_to_string();
            db.Dispose();
            throw new SqlException($"cannot open {path}: {message}");
        }
    }

    public void Dispose() => db.Dispose();

    string Message => raw.sqlite3_errmsg(db).utf8_to_string();

    /// <summary>Runs statements without rows; SQLite's refusal is thrown.</summary>
    public void Exec(string sql)
    {
        if (raw.sqlite3_exec(db, sql) != raw.SQLITE_OK) throw new SqlException(Message);
    }

    /// <summary>Rows as SQLite holds them; a blob as null (the core reads no bytes).</summary>
    public SqlValue[][] Query(string sql, IReadOnlyList<SqlValue> parameters)
    {
        if (raw.sqlite3_prepare_v2(db, sql, out var st) != raw.SQLITE_OK) throw new SqlException(Message);
        using (st)
        {
            for (var i = 0; i < parameters.Count; i++) Bind(st, i + 1, parameters[i]);
            var rows = new List<SqlValue[]>();
            while (true)
            {
                var rc = raw.sqlite3_step(st);
                if (rc == raw.SQLITE_DONE) return [.. rows];
                if (rc != raw.SQLITE_ROW) throw new SqlException(Message);
                var count = raw.sqlite3_column_count(st);
                var row = new SqlValue[count];
                for (var c = 0; c < count; c++) row[c] = Column(st, c);
                rows.Add(row);
            }
        }
    }

    static void Bind(sqlite3_stmt st, int at, SqlValue value)
    {
        switch (value)
        {
            case SqlValue.Integer v: raw.sqlite3_bind_int64(st, at, v.Value); break;
            case SqlValue.Real v: raw.sqlite3_bind_double(st, at, v.Value); break;
            case SqlValue.Text v: raw.sqlite3_bind_text(st, at, v.Value); break;
            default: raw.sqlite3_bind_null(st, at); break;
        }
    }

    static SqlValue Column(sqlite3_stmt st, int c) => raw.sqlite3_column_type(st, c) switch
    {
        raw.SQLITE_INTEGER => new SqlValue.Integer(raw.sqlite3_column_int64(st, c)),
        raw.SQLITE_FLOAT => new SqlValue.Real(raw.sqlite3_column_double(st, c)),
        raw.SQLITE_TEXT => new SqlValue.Text(raw.sqlite3_column_text(st, c).utf8_to_string()),
        _ => new SqlValue.Null(),
    };
}
