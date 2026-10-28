// The global tables (D1 on Workers, global.sqlite on Node): users, their
// linked logins (Google accounts and passkeys), organisations, memberships,
// sessions, invites, sign-ins in progress, throttling and the desktop host's
// paired devices. Written once,
// in SQL, against `GlobalSql`.
//
// D1 has no interactive transactions, so nothing here reads, decides and then
// writes across awaits where a race would matter: each such step is one
// conditional statement, or a `batch` of them, which both runtimes run atomically.
//
// One file per concern, each a service on the database and the clock:
// members, sign-in, logins, passkeys, throttle, pairing and debug. `Accounts`
// (accounts.ts) builds them and holds them; only debug uses another (members).
export type { GlobalSql, Row } from './sql.ts';
export { GLOBAL_SCHEMA_VERSION, globalDdl, globalMigrations, globalSchemaPlan, migrateGlobal } from './schema.ts';
export type { SessionInfo } from './members.ts';
export { LOGIN_FLOW, type LoginFlow, type NewLogin } from './sign-in.ts';
export { PASSKEY_FLOW, type PasskeyFlow } from './passkeys.ts';
export { THROTTLE, type ThrottlePolicy } from './throttle.ts';
export { Accounts, type AccountOptions } from './accounts.ts';
