// The one interface every runtime's global database is reached through.
export type Row = Record<string, unknown>;

/** One global database, whichever runtime holds it. */
export interface GlobalSql {
  all(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Runs one statement; resolves to the number of rows it changed. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** Runs the statements in order, atomically; resolves to each one's changed rows. */
  batch(statements: [sql: string, params: unknown[]][]): Promise<number[]>;
}
