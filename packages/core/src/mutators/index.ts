// The mutators, one file per domain; the registry (`mutators`) lists them all. The TS core's (ADR 0008), reached as
// `@gp/core/mutators`; the names, versions and argument types the shells use are `../mutator-args.ts`'s.
export { requirePermission, type Tx } from './base.ts';
export { LABEL_LIMIT } from './labels.ts';
export { imageEditSchema } from './media.ts';
export { getMutator, mutators, runMutator, type Mutator, type Mutators } from './registry.ts';
