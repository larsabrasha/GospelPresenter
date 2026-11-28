// The mutators as the shells call them: their names and versions, and what each takes. The mutators themselves, and
// the checks of their arguments, are the Rust core's (crates/gp-core, docs/rust-core.md 2.5); these types are the
// TS mutators' argument types as they were at 238d481b (their zod schemas' input), the reference the core is checked
// against. A new mutator, or a new version of one, is added here beside its port to the core.
import type { FieldEntry, Visibility } from './calendar.ts';
import type { CustomPage } from './custom-slides.ts';
import type { ImageEdit } from './mutation.ts';
import type { ThemeDefinition } from './themes.ts';

/** Each mutator's version, which a push carries. The server takes from this version up: none has a second yet. */
export const MUTATOR_VERSIONS = {
  createSong: 1, publishSong: 1, updateSong: 1, trashSong: 1, restoreSong: 1, purgeSong: 1, addSongPart: 1, importSongs: 1, restoreSongVersion: 1,
  addSongFile: 1, addSongLink: 1, renameSongMaterial: 1, removeSongMaterial: 1, setCcliCollection: 1, recordCcliUse: 1, setCcliReported: 1,
  createLabel: 1, updateLabel: 1, deleteLabel: 1, moveLabel: 1, updateSongPart: 1, removeSongPart: 1, moveSongPart: 1,
  createArrangement: 1, updateArrangement: 1, removeArrangement: 1, appendArrangementPart: 1, removeArrangementPart: 1, moveArrangementPart: 1,
  createPresentation: 1, renamePresentation: 1, updatePresentation: 1, addSongToPresentation: 1, addBibleToPresentation: 1,
  addImageToPresentation: 1, addImagesToItem: 1, removeItemImage: 1, moveItemImage: 1, addAudioToPresentation: 1, addVideoToPresentation: 1,
  addSlides: 1, addHeaderToPresentation: 1, renameItem: 1, setItemNote: 1, setItemArrangement: 1, setItemOverlay: 1, reorderItems: 1,
  moveItem: 1, removeItem: 1, trashPresentation: 1, restorePresentation: 1, purgePresentation: 1,
  createTemplate: 1, updateTemplate: 1, saveAsTemplate: 1, createFromTemplate: 1, trashTemplate: 1, restoreTemplate: 1, purgeTemplate: 1,
  purgeExpiredTrash: 1, emptyTrash: 1, importBible: 1, deleteBible: 1, renameBible: 1,
  setDefaultTheme: 1, createTheme: 1, updateTheme: 1, deleteTheme: 1, setRemoteControl: 1,
  addImage: 1, editImage: 1, revertImage: 1, trashImage: 1, renameImage: 1, restoreImage: 1, purgeImage: 1,
  addAudio: 1, trashAudio: 1, renameAudio: 1, restoreAudio: 1, purgeAudio: 1,
  addVideo: 1, trashVideo: 1, renameVideo: 1, restoreVideo: 1, purgeVideo: 1,
  createCustomSlide: 1, updateCustomSlide: 1, trashCustomSlide: 1, restoreCustomSlide: 1, purgeCustomSlide: 1, addCustomSlideToPresentation: 1,
  createOverlay: 1, updateOverlay: 1, deleteOverlay: 1, createDisplay: 1, newDisplayCode: 1, deleteDisplay: 1,
  createEvent: 1, updateEvent: 1, trashEvent: 1, restoreEvent: 1, purgeEvent: 1,
  addEventField: 1, updateEventField: 1, moveEventField: 1, removeEventField: 1,
  linkEventPresentation: 1, createPresentationForEvent: 1, createEventFromPresentation: 1, importEvents: 1,
  probeWriteThenThrow: 1,
} as const;

export type MutatorName = keyof typeof MUTATOR_VERSIONS;
/** What a caller passes to the mutator `N`: its arguments before the core trims them and fills in defaults. */
export type MutatorArgs<N extends MutatorName> = AllMutatorArgs[N];

type ImportedSongArgs = {
  id: string; name: string; author: string | null; publisher: string | null; ccli: string | null;
  parts: { id: string; labelText: string | null; content: string }[];
  arrangements: { id: string; name: string | null; partIds: string[] }[];
  replaces: string | null;
};
type FromItem = { from: string; id: string };
type EventFields = { eventDate?: string | null; time?: string | null; location?: string | null; description?: string | null };
type CalendarDetails = {
  title?: string; time?: string | null; endDate?: string | null; endTime?: string | null; place?: string | null;
  description?: string | null; visibility?: Visibility; busyWord?: string | null;
};
export type ImportedEventArgs = {
  id: string; title: string; date: string; time: string | null; endDate: string | null; endTime: string | null;
  description: string | null; fields: { name: string; entries: FieldEntry[] }[];
};
type AudioType = 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/mp4' | 'audio/webm' | 'audio/x-m4a';

interface AllMutatorArgs {
  createSong: { id: string; name: string; author?: string | null; draft?: boolean };
  publishSong: { id: string };
  updateSong: { id: string; name?: string; author?: string | null; publisher?: string | null; year?: number | null; ccli?: string | null };
  trashSong: { id: string; at: number };
  restoreSong: { id: string };
  purgeSong: { id: string };
  addSongPart: { id: string; songId: string; labelText: string | null; content: string };
  importSongs: { songs: ImportedSongArgs[] };
  restoreSongVersion: { songId: string; versionId: string };
  addSongFile: { id: string; songId: string; title: string; hash: string; contentType: 'application/pdf' | AudioType; size: number; createdAt: number };
  addSongLink: { id: string; songId: string; title: string; url: string; createdAt: number };
  renameSongMaterial: { id: string; title: string };
  removeSongMaterial: { id: string };
  setCcliCollection: { on: boolean };
  recordCcliUse: { songId: string; songName: string; ccli: string; presentationId: string; presentationName: string; date: string };
  setCcliReported: { ids: string[]; reported: boolean; at: number };
  createLabel: { text: string; color: string };
  updateLabel: { id: string; text?: string; color?: string };
  deleteLabel: { id: string };
  moveLabel: { id: string; toIndex: number };
  updateSongPart: { id: string; content?: string; labelText?: string | null };
  removeSongPart: { id: string };
  moveSongPart: { id: string; toIndex: number };
  createArrangement: { id: string; songId: string; name?: string | null; partIds: string[] };
  updateArrangement: { id: string; name?: string | null; partIds?: string[] };
  removeArrangement: { id: string };
  appendArrangementPart: { id: string; partId: string };
  removeArrangementPart: { id: string; index: number; partId: string };
  moveArrangementPart: { id: string; index: number; partId: string; by: number };
  createPresentation: { id: string; name: string } & EventFields;
  renamePresentation: { id: string; name: string };
  updatePresentation: { id: string; name?: string; themeId?: string | null } & EventFields;
  addSongToPresentation: { itemId: string; presentationId: string; songId: string; arrangementId?: string | null; afterItemId?: string | null };
  addBibleToPresentation: { itemId: string; presentationId: string; bibleId: string; translation: string; verses: { b: string; c: number; v: number; t: string }[]; afterItemId?: string | null };
  addImageToPresentation: { itemId: string; presentationId: string; imageIds?: string[]; imageId?: string; title?: string; afterItemId?: string | null };
  addImagesToItem: { itemId: string; imageIds: string[] };
  removeItemImage: { itemId: string; index: number };
  moveItemImage: { itemId: string; from: number; to: number };
  addAudioToPresentation: { itemId: string; presentationId: string; audioId: string; afterItemId?: string | null };
  addVideoToPresentation: { itemId: string; presentationId: string; videoId: string; afterItemId?: string | null };
  addSlides: { itemId: string; presentationId: string; deckId?: string; fileName: string; pages: { full: string; thumb: string }[]; afterItemId?: string | null; at?: number };
  addHeaderToPresentation: { itemId: string; presentationId: string; title: string; afterItemId?: string | null; beforeItemId?: string | null };
  renameItem: { itemId: string; title: string };
  setItemNote: { itemId: string; note: string | null };
  setItemArrangement: { itemId: string; arrangementId: string | null };
  setItemOverlay: { itemId: string; overlayId: string | null };
  reorderItems: { presentationId: string; itemIds: string[] };
  moveItem: { itemId: string; by: number };
  removeItem: { itemId: string };
  trashPresentation: { id: string; at: number };
  restorePresentation: { id: string };
  purgePresentation: { id: string };
  createTemplate: { id: string; name: string; weekday?: number | null; time?: string | null; location?: string | null };
  updateTemplate: { id: string; name?: string; weekday?: number | null; time?: string | null; location?: string | null };
  saveAsTemplate: { id: string; presentationId: string; name: string; items: FromItem[] };
  createFromTemplate: { id: string; templateId: string; name: string; items: FromItem[]; at: number } & EventFields;
  trashTemplate: { id: string; at: number };
  restoreTemplate: { id: string };
  purgeTemplate: { id: string };
  purgeExpiredTrash: { now: number };
  emptyTrash: Record<string, never>;
  importBible: { name: string; abbreviation: string; language: string | null; contentHash: string };
  deleteBible: { id: string };
  renameBible: { id: string; name: string };
  setDefaultTheme: { themeId: string };
  createTheme: { id: string; name: string; definition: ThemeDefinition; at: number };
  updateTheme: { id: string; name?: string; definition?: ThemeDefinition; at: number };
  deleteTheme: { id: string };
  setRemoteControl: { policy: 'never' | 'presenter' | 'always' };
  addImage: { id: string; fileName: string; contentType: 'image/jpeg' | 'image/webp'; fullHash: string; thumbHash: string; width: number; height: number; createdAt: number };
  editImage: { id: string; fullHash: string; thumbHash: string; width: number; height: number; edit: ImageEdit };
  revertImage: { id: string };
  trashImage: { id: string; at: number };
  renameImage: { id: string; fileName: string };
  restoreImage: { id: string };
  purgeImage: { id: string };
  addAudio: { id: string; fileName: string; contentType: AudioType; hash: string; size: number; createdAt: number };
  trashAudio: { id: string; at: number };
  renameAudio: { id: string; fileName: string };
  restoreAudio: { id: string };
  purgeAudio: { id: string };
  addVideo: {
    id: string; fileName: string; contentType: 'video/mp4' | 'video/quicktime'; codec: 'h264' | 'hevc'; hash: string; size: number;
    duration: number; width: number; height: number; stillHash: string; thumbHash: string; createdAt: number;
  };
  trashVideo: { id: string; at: number };
  renameVideo: { id: string; fileName: string };
  restoreVideo: { id: string };
  purgeVideo: { id: string };
  createCustomSlide: { id: string; name: string; pages: CustomPage[]; at: number };
  updateCustomSlide: { id: string; name?: string; pages?: CustomPage[]; at: number };
  trashCustomSlide: { id: string; at: number };
  restoreCustomSlide: { id: string };
  purgeCustomSlide: { id: string };
  addCustomSlideToPresentation: { itemId: string; presentationId: string; slideId: string; afterItemId?: string | null };
  createOverlay: { id: string; title: string; page?: CustomPage; at: number };
  updateOverlay: { id: string; title?: string; page?: CustomPage; at: number };
  deleteOverlay: { id: string };
  createDisplay: { id: string; name: string; code: string; kind: 'public' | 'screen' };
  newDisplayCode: { id: string; code: string };
  deleteDisplay: { id: string };
  createEvent: CalendarDetails & { id: string; title: string; date: string | null; isTemplate?: boolean; template?: string; at: number };
  updateEvent: CalendarDetails & { id: string; date?: string; at: number };
  trashEvent: { id: string; at: number };
  restoreEvent: { id: string };
  purgeEvent: { id: string };
  addEventField: { id: string; eventId: string; name: string; entries?: FieldEntry[] };
  updateEventField: { id: string; name?: string; entries?: FieldEntry[] };
  moveEventField: { id: string; to: number };
  removeEventField: { id: string };
  linkEventPresentation: { eventId: string; presentationId: string | null; at: number };
  createPresentationForEvent: { eventId: string; presentationId: string; name: string; at: number };
  createEventFromPresentation: { presentationId: string; eventId: string; at: number };
  importEvents: { events: ImportedEventArgs[]; at: number };
  probeWriteThenThrow: { songId: string };
}

/** Whether `name` is a mutator's. */
export function isMutatorName(name: string): name is MutatorName {
  return Object.hasOwn(MUTATOR_VERSIONS, name);
}
