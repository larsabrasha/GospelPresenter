// The TS core the checks compare with: packages/core at 238d481b (docs/rust-core.md "The reference"), which build.sh
// takes from git into @REF@; the app's packages/core no longer has its mutators, schema or slides.
export { getMutator, runMutator } from '@REF@/packages/core/src/mutators/registry.ts';
export { migrateOrgSchemaSync, migrateOrgSchema, orgDdl, orgMigrations, orgIndexes, schemaMetaDdl } from '@REF@/packages/core/src/org-schema.ts';
export * as schema from '@REF@/packages/core/src/schema.ts';
export { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
export { labelSeedSql } from '@REF@/packages/core/src/labels.ts';
export { songSlides, bibleItemSlides } from '@REF@/packages/core/src/slides.ts';
export { presentingKey, slideMarks, slideOrder } from '@REF@/packages/core/src/presenting.ts';
export { applyLiveChange, followItemOverlay } from '@REF@/packages/core/src/live.ts';
export { readItemSlides } from '@REF@/packages/core/src/item-slides.ts';
export { parseCustomPages } from '@REF@/packages/core/src/custom-slides.ts';
export { parseProPresenter } from '@REF@/packages/core/src/propresenter.ts';
export { importBibleZip } from '@REF@/packages/core/src/bible-import.ts';
