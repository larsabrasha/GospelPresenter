import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import type { ClientSqlite } from './sqlite.ts';

const require = createRequire(import.meta.url);

/** Node's built-in node:sqlite behind the async ClientSqlite interface (the Electron main process). */
export function openNodeSqliteClient(file = ':memory:'): ClientSqlite {
  const { DatabaseSync: Db } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  const db = new Db(file);
  return {
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.setReturnArrays(true);
      const rows = stmt.all(...(params as never[])) as unknown as unknown[][];
      return { columns: stmt.columns().map((c) => c.name), rows };
    },
    async close() {
      db.close();
    },
  };
}
