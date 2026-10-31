import { z } from 'zod';
import { MutationError, type MutatorCtx, type Tx } from './base.ts';
import {
  createSongArgs,
  createSong,
  updateSongArgs,
  updateSong,
  trashSongArgs,
  trashSong,
  restoreSongArgs,
  restoreSong,
  purgeSongArgs,
  purgeSong,
  addSongPartArgs,
  addSongPart,
  updateSongPartArgs,
  updateSongPart,
  removeSongPartArgs,
  removeSongPart,
  moveSongPartArgs,
  moveSongPart,
} from './songs.ts';
import {
  createArrangementArgs,
  createArrangement,
  updateArrangementArgs,
  updateArrangement,
  appendArrangementPartArgs,
  appendArrangementPart,
  removeArrangementPartArgs,
  removeArrangementPart,
  moveArrangementPartArgs,
  moveArrangementPart,
  removeArrangementArgs,
  removeArrangement,
} from './arrangements.ts';
import {
  createPresentationArgs,
  createPresentation,
  renamePresentationArgs,
  renamePresentation,
  updatePresentationArgs,
  updatePresentation,
  addSongToPresentationArgs,
  addSongToPresentation,
  addBibleToPresentationArgs,
  addBibleToPresentation,
  renameItemArgs,
  renameItem,
  setItemArrangementArgs,
  setItemArrangement,
  setItemOverlayArgs,
  setItemOverlay,
  reorderItemsArgs,
  reorderItems,
  moveItemArgs,
  moveItem,
  removeItemArgs,
  removeItem,
  trashPresentationArgs,
  trashPresentation,
  restorePresentationArgs,
  restorePresentation,
  purgePresentationArgs,
  purgePresentation,
} from './presentations.ts';
import {
  createTemplateArgs,
  createTemplate,
  updateTemplateArgs,
  updateTemplate,
  saveAsTemplateArgs,
  saveAsTemplate,
  createFromTemplateArgs,
  createFromTemplate,
  trashTemplateArgs,
  trashTemplate,
  restoreTemplateArgs,
  restoreTemplate,
  purgeTemplateArgs,
  purgeTemplate,
} from './templates.ts';
import {
  addImageArgs,
  addImage,
  trashImageArgs,
  trashImage,
  restoreImageArgs,
  restoreImage,
  purgeImageArgs,
  purgeImage,
  addImageToPresentationArgs,
  addImageToPresentation,
  addImagesToItemArgs,
  addImagesToItem,
  removeItemImageArgs,
  removeItemImage,
  moveItemImageArgs,
  moveItemImage,
  addAudioArgs,
  addAudio,
  trashAudioArgs,
  trashAudio,
  restoreAudioArgs,
  restoreAudio,
  purgeAudioArgs,
  purgeAudio,
  addAudioToPresentationArgs,
  addAudioToPresentation,
  addVideoArgs,
  addVideo,
  trashVideoArgs,
  trashVideo,
  restoreVideoArgs,
  restoreVideo,
  purgeVideoArgs,
  purgeVideo,
  addVideoToPresentationArgs,
  addVideoToPresentation,
  addSlidesArgs,
  addSlides,
} from './media.ts';
import {
  createOverlayArgs,
  createOverlay,
  updateOverlayArgs,
  updateOverlay,
  deleteOverlayArgs,
  deleteOverlay,
} from './overlays.ts';
import {
  importBibleArgs,
  importBible,
  deleteBibleArgs,
  deleteBible,
  setDefaultThemeArgs,
  setDefaultTheme,
} from './bibles-and-themes.ts';
import {
  setRemoteControlArgs,
  setRemoteControl,
} from './org-settings.ts';
import {
  createDisplayArgs,
  createDisplay,
  newDisplayCodeArgs,
  newDisplayCode,
  deleteDisplayArgs,
  deleteDisplay,
} from './displays.ts';
import {
  purgeExpiredTrashArgs,
  purgeExpiredTrash,
  emptyTrashArgs,
  emptyTrash,
} from './trash.ts';
import {
  probeArgs,
  probeWriteThenThrow,
} from './probe.ts';

// ------------------------------------------------------------------ registry

export interface Mutator<S extends z.ZodType = z.ZodType> {
  /** Current version. */
  v: number;
  /** Oldest version the server still accepts. */
  minV: number;
  args: S;
  run: (tx: Tx, args: z.output<S>, ctx: MutatorCtx) => Promise<void>;
}

const m = <S extends z.ZodType>(args: S, run: Mutator<S>['run']): Mutator<S> => ({ v: 1, minV: 1, args, run });

/** Every mutator. Arguments are validated with `args` on both ends before `run`. */
export const mutators = {
  createSong: m(createSongArgs, createSong),
  updateSong: m(updateSongArgs, updateSong),
  trashSong: m(trashSongArgs, trashSong),
  restoreSong: m(restoreSongArgs, restoreSong),
  purgeSong: m(purgeSongArgs, purgeSong),
  addSongPart: m(addSongPartArgs, addSongPart),
  updateSongPart: m(updateSongPartArgs, updateSongPart),
  removeSongPart: m(removeSongPartArgs, removeSongPart),
  moveSongPart: m(moveSongPartArgs, moveSongPart),
  createArrangement: m(createArrangementArgs, createArrangement),
  updateArrangement: m(updateArrangementArgs, updateArrangement),
  removeArrangement: m(removeArrangementArgs, removeArrangement),
  appendArrangementPart: m(appendArrangementPartArgs, appendArrangementPart),
  removeArrangementPart: m(removeArrangementPartArgs, removeArrangementPart),
  moveArrangementPart: m(moveArrangementPartArgs, moveArrangementPart),
  createPresentation: m(createPresentationArgs, createPresentation),
  renamePresentation: m(renamePresentationArgs, renamePresentation),
  updatePresentation: m(updatePresentationArgs, updatePresentation),
  addSongToPresentation: m(addSongToPresentationArgs, addSongToPresentation),
  addBibleToPresentation: m(addBibleToPresentationArgs, addBibleToPresentation),
  addImageToPresentation: m(addImageToPresentationArgs, addImageToPresentation),
  addImagesToItem: m(addImagesToItemArgs, addImagesToItem),
  removeItemImage: m(removeItemImageArgs, removeItemImage),
  moveItemImage: m(moveItemImageArgs, moveItemImage),
  addAudioToPresentation: m(addAudioToPresentationArgs, addAudioToPresentation),
  addVideoToPresentation: m(addVideoToPresentationArgs, addVideoToPresentation),
  addSlides: m(addSlidesArgs, addSlides),
  renameItem: m(renameItemArgs, renameItem),
  setItemArrangement: m(setItemArrangementArgs, setItemArrangement),
  setItemOverlay: m(setItemOverlayArgs, setItemOverlay),
  reorderItems: m(reorderItemsArgs, reorderItems),
  moveItem: m(moveItemArgs, moveItem),
  removeItem: m(removeItemArgs, removeItem),
  trashPresentation: m(trashPresentationArgs, trashPresentation),
  restorePresentation: m(restorePresentationArgs, restorePresentation),
  purgePresentation: m(purgePresentationArgs, purgePresentation),
  createTemplate: m(createTemplateArgs, createTemplate),
  updateTemplate: m(updateTemplateArgs, updateTemplate),
  saveAsTemplate: m(saveAsTemplateArgs, saveAsTemplate),
  createFromTemplate: m(createFromTemplateArgs, createFromTemplate),
  trashTemplate: m(trashTemplateArgs, trashTemplate),
  restoreTemplate: m(restoreTemplateArgs, restoreTemplate),
  purgeTemplate: m(purgeTemplateArgs, purgeTemplate),
  purgeExpiredTrash: m(purgeExpiredTrashArgs, purgeExpiredTrash),
  emptyTrash: m(emptyTrashArgs, emptyTrash),
  importBible: m(importBibleArgs, importBible),
  deleteBible: m(deleteBibleArgs, deleteBible),
  setDefaultTheme: m(setDefaultThemeArgs, setDefaultTheme),
  setRemoteControl: m(setRemoteControlArgs, setRemoteControl),
  addImage: m(addImageArgs, addImage),
  trashImage: m(trashImageArgs, trashImage),
  restoreImage: m(restoreImageArgs, restoreImage),
  purgeImage: m(purgeImageArgs, purgeImage),
  addAudio: m(addAudioArgs, addAudio),
  trashAudio: m(trashAudioArgs, trashAudio),
  restoreAudio: m(restoreAudioArgs, restoreAudio),
  purgeAudio: m(purgeAudioArgs, purgeAudio),
  addVideo: m(addVideoArgs, addVideo),
  trashVideo: m(trashVideoArgs, trashVideo),
  restoreVideo: m(restoreVideoArgs, restoreVideo),
  purgeVideo: m(purgeVideoArgs, purgeVideo),
  createOverlay: m(createOverlayArgs, createOverlay),
  updateOverlay: m(updateOverlayArgs, updateOverlay),
  deleteOverlay: m(deleteOverlayArgs, deleteOverlay),
  createDisplay: m(createDisplayArgs, createDisplay),
  newDisplayCode: m(newDisplayCodeArgs, newDisplayCode),
  deleteDisplay: m(deleteDisplayArgs, deleteDisplay),
  probeWriteThenThrow: m(probeArgs, probeWriteThenThrow),
};

export type Mutators = typeof mutators;
export type MutatorName = keyof Mutators;
/** What a caller passes: the schema's input, before trimming and defaults. */
export type MutatorArgs<N extends MutatorName> = z.input<Mutators[N]['args']>;

export function getMutator(mutatorName: string): Mutator | undefined {
  return Object.hasOwn(mutators, mutatorName) ? (mutators[mutatorName as MutatorName] as unknown as Mutator) : undefined;
}

/** Validates the arguments and runs the mutator. Invalid arguments are a refusal, not a crash. */
export async function runMutator(mutator: Mutator, tx: Tx, rawArgs: unknown, ctx: MutatorCtx): Promise<void> {
  const parsed = mutator.args.safeParse(rawArgs);
  if (!parsed.success) throw new MutationError('invalid-args', parsed.error.message);
  await mutator.run(tx, parsed.data, ctx);
}
