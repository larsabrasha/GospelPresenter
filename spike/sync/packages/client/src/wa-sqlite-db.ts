import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from '@journeyapps/wa-sqlite';
import type { ClientSqlite } from './sqlite.ts';

const require = createRequire(import.meta.url);

/**
 * wa-sqlite (the WebAssembly SQLite browsers use) in memory, for tests in Node.
 * The browser build would open it on OPFS instead; that VFS is not exercised here.
 */
export async function openWaSqlite(): Promise<ClientSqlite> {
  const dist = join(dirname(require.resolve('@journeyapps/wa-sqlite')), '..', 'dist');
  const module = await SQLiteESMFactory({ wasmBinary: await readFile(join(dist, 'wa-sqlite.wasm')) });
  const sqlite3 = SQLite.Factory(module);
  const db = await sqlite3.open_v2(':memory:');
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
