import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from '@journeyapps/wa-sqlite';
import type { ClientSqlite } from './sqlite.ts';
import { waSqliteConnection } from './wa-sqlite-api.ts';

const require = createRequire(import.meta.url);

/**
 * wa-sqlite (the WebAssembly SQLite browsers use) in memory, for tests in Node.
 * The browser opens it on OPFS instead; see apps/web.
 */
export async function openWaSqlite(): Promise<ClientSqlite> {
  const dist = join(dirname(require.resolve('@journeyapps/wa-sqlite')), '..', 'dist');
  const module = await SQLiteESMFactory({ wasmBinary: await readFile(join(dist, 'wa-sqlite.wasm')) });
  const sqlite3 = SQLite.Factory(module);
  return waSqliteConnection(sqlite3, await sqlite3.open_v2(':memory:'));
}
