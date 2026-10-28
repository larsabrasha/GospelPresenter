// The sync mutators, one file per domain; the registry (`mutators`) lists them all.
export { LIMITS, MutationError, type MutatorCtx, type Tx } from './base.ts';
export { MAX_VERSES_PER_ITEM } from './presentations.ts';
export { DEFAULT_THEME_SETTING } from './bibles-and-themes.ts';
export { DISPLAY_MUTATORS } from './displays.ts';
export { getMutator, mutators, runMutator, type Mutator, type MutatorArgs, type MutatorName, type Mutators } from './registry.ts';
