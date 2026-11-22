// The TS core being ported back (ADR 0008, docs/core-back-to-typescript.md): the working tree's packages/core, which
// port.sh bundles for the checks, now the candidate the Rust core is the reference for.
export { getMutator, runMutator } from '../../../packages/core/src/mutators/registry.ts';
export { migrateOrgSchemaSync, migrateOrgSchema, orgDdl, orgMigrations, orgIndexes, schemaMetaDdl } from '../../../packages/core/src/org-schema.ts';
export * as schema from '../../../packages/core/src/schema.ts';
export { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
export { labelSeedSql } from '../../../packages/core/src/labels.ts';
