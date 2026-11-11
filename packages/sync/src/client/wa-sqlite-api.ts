import * as SQLite from '@journeyapps/wa-sqlite';
import type { ClientSqlite } from './sqlite.ts';

/** A ClientSqlite over an open wa-sqlite connection, whatever the VFS. No Node or browser APIs. */
export function waSqliteConnection(sqlite3: SQLiteAPI, db: number): ClientSqlite {
  return {
    async query(sql, params = []) {
      let columns: string[] = [];
      const rows: unknown[][] = [];
      for await (const stmt of sqlite3.statements(db, sql)) {
        if (params.length) sqlite3.bind_collection(stmt, params.map((p) => (p === undefined ? null : p)) as never);
        columns = sqlite3.column_names(stmt);
        while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) rows.push(sqlite3.row(stmt));
      }
      return { columns, rows };
    },
    async close() {
      await sqlite3.close(db);
    },
  };
}
