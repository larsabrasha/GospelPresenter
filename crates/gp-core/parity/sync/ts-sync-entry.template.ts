// What the sync check takes from the TS app: the client on the Rust core as it is, the TS client before it was switched
// (the reference, frozen by build.sh from git), the server's engine, and the SQL they share.
export { SyncClient } from '@REPO@/packages/sync/src/client/client.ts';
export { SyncClient as ReferenceSyncClient } from './reference-client.ts';
export { openNodeSqliteClient } from '@REPO@/packages/sync/src/client/node-sqlite-db.ts';
export { handlePush, handlePull } from '@REPO@/packages/sync/src/server/engine.ts';
export { RustCore } from '@REPO@/packages/rust-core/src/index.ts';
export { clientSyncDdl, clientUndoTriggers, clientUndoRestore, changeTrackingDdl, serverSyncDdl, serverChangeTriggers, tableInfo, upsertSql } from '@REPO@/packages/core/src/sync-sql.ts';
export { migrateOrgSchemaSync } from '@REPO@/packages/core/src/org-schema.ts';
export { labelSeedSql } from '@REPO@/packages/core/src/labels.ts';
export * as schema from '@REPO@/packages/core/src/schema.ts';
export { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
export { PROTOCOL_VERSION } from '@REPO@/packages/core/src/protocol.ts';
export { SCHEMA_VERSION } from '@REPO@/packages/core/src/org-schema.ts';
