// What a view of the TS core reads with (ADR 0008): the shell's statements, as the Rust core's views asked for them.

/** A statement's rows as arrays, in column order. */
export type Rows = unknown[][];
/** Runs one statement in the caller's transaction: synchronous on the server's drivers, async on wa-sqlite. */
export type RunSql = (sql: string, params: unknown[]) => Rows | Promise<Rows>;

/** A view that reads the database through the shell's statements. */
export type View = (args: unknown, sql: RunSql) => Promise<unknown>;
/** A view that reads nothing but its arguments. */
export type PureView = (args: unknown) => unknown;
