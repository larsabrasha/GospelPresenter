import type { PresentationItem, Theme } from '@gp/core';
import { useState, type ReactNode } from 'react';
import type { Db } from '../../db/db.ts';
import { useDb } from '../../db/react.tsx';
import { songPage } from '../../db/views.ts';
import { FIRST_PART_LABEL } from '../songEditorLook.ts';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { Modal } from '../../ui/Dialog.tsx';
import { PageFill } from '../../ui/PageContainer.tsx';
import { BookOpenIcon, MusicalNoteIcon, PhotoIcon, SlideshowIcon, SpeakerWaveIcon, VideoIcon } from '../../ui/icons.tsx';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';
import { AddContext } from '../../ui/Picker.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { AudioTab } from '../AudioTab.tsx';
import { BibleTab } from '../BibleTab.tsx';
import { ImageTab } from '../ImageTab.tsx';
import { SongEditor } from '../SongEditor.tsx';
import { VideoTab } from '../VideoTab.tsx';
import { SlidesTab } from './SlidesTab.tsx';
import { SongTab } from './SongTab.tsx';

export interface TabProps {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
  onClose: () => void;
  /** Whether the tab is the one shown: it keeps its search and selection while another is. */
  active: boolean;
}

export type AddKind = 'songs' | 'bible' | 'images' | 'audio' | 'slides' | 'video';
/** What + offers: a kind from the dialog, or a heading of the running order, made at once (spec 03 2f). */
export type AddChoice = AddKind | 'header';

/**
 * The add-item modal (spec 03 2d): one kind, the one chosen in +'s menu, titled "Lägg till sång" and so on, without a
 * row of tabs (Lars, 2026-11-05: a computer as a phone). It never closes after an add (D15). The new item goes after
 * the selected one and becomes selected. A song's pencil opens its editor here, with a way back to the list.
 */
/** The add dialog's keys in the help dialog (AddItemModal.razor's scope); the editor's are off behind it. */
const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.addItem'),
  blocks: true,
  lines: [
    { keys: ['Ctrl+Enter'], text: t('shortcuts.add') },
    { keys: ['ArrowDown'], text: t('shortcuts.moveThroughResults') },
  ],
};

/**
 * A song made here is a draft until Skapa (Lars, 2026-11-25): kept as it is typed, in no list. Its id is kept on this
 * device until then, so a draft left by a closed dialog or a crash is offered again at the next Skapa.
 */
const DRAFT_KEY = 'gp.songDraft';
const draftId = () => {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
};
const keepDraftId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(DRAFT_KEY, id);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // no storage: a draft left behind is not offered again
  }
};

/** A draft thrown away (Avbryt): deleted at once, never by way of the trash. */
function discardDraft(db: Db, id: string) {
  keepDraftId(null);
  void db.mutate('purgeSong', { id }).catch(() => undefined);
}

/** The kinds an item is, each its name in +'s menu and its icon, Bildspel last: singular, as Keynote's Infoga names its
 * choices (Lars, 2026-11-05). */
export function addKinds(): [AddKind, string, (p: { className?: string }) => ReactNode, PresentationItem['type']][] {
  return [
    ['songs', t('add.song'), MusicalNoteIcon, 'song'],
    ['bible', t('add.bible'), BookOpenIcon, 'bible'],
    ['images', t('add.image'), PhotoIcon, 'image'],
    ['audio', t('presentation.audioTab'), SpeakerWaveIcon, 'audio'],
    ['video', t('presentation.videoTab'), VideoIcon, 'video'],
    ['slides', t('add.slides'), SlideshowIcon, 'custom'],
  ];
}

export function AddItemDialog({
  toItemId,
  kind,
  items,
  ...props
}: Omit<TabProps, 'active'> & {
  toItemId?: string;
  kind: AddKind;
  /** The presentation's items: a tab says when what is chosen is among them already (ui/Picker.tsx `usePresentationItems`). */
  items: readonly PresentationItem[];
}) {
  useShortcutGroup(KEYS);
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  /** The song open in the editor here; `isNew` for a draft made here, to be created or thrown away. */
  const [editing, setEditing] = useState<{ id: string; isNew: boolean; focusName?: boolean; resumed?: boolean } | null>(null);
  const editingSongId = editing?.id ?? null;
  /** The song last created here: the song tab starts over with it chosen, ready to add. */
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  /** Counts every add here: Lägg till says "Tillagd" for a moment after each (ui/Picker.tsx `AddFooter`). */
  const [lastAdd, setLastAdd] = useState({ n: 0, at: 0 });
  const onAdded = (itemId: string) => {
    setLastAdd((was) => ({ n: was.n + 1, at: Date.now() }));
    props.onAdded(itemId);
  };

  // A draft left behind here: offered again, or thrown away for a new one. One with no text yet just goes.
  const resumeDraft = async () => {
    const id = draftId();
    if (!id) return false;
    const page = await songPage(db, id).catch(() => null);
    if (!page?.song?.draft) {
      keepDraftId(null);
      return false;
    }
    const name = page.song.name;
    if (page.parts.some((p) => p.content.trim()) && (await ask({ title: t('song.draftTitle'), text: t('song.draftText', { name }), bold: name, confirm: t('song.draftResume'), primary: true }))) {
      setEditing({ id, isNew: true, resumed: true });
      return true;
    }
    discardDraft(db, id);
    return false;
  };
  // Skapa in the song tab: a draft named as the search, with its first part, Verse 1, to type in, opened here.
  const newSong = async (query: string) => {
    if (await resumeDraft()) return;
    const id = newId();
    const name = query || t('song.newTitle');
    if (!(await trySave(db.mutate('createSong', { id, name, draft: true })))) return;
    keepDraftId(id);
    await trySave(db.mutate('addSongPart', { id: newId(), songId: id, labelText: FIRST_PART_LABEL, content: '' }));
    setEditing({ id, isNew: true, focusName: !query });
  };
  // Skapa in the draft's editor: a song of the library now, chosen in the list, to be added as any other.
  const create = async (id: string, name: string) => {
    if (!(await trySave(db.mutate('publishSong', { id })))) return;
    keepDraftId(null);
    toast(t('song.created', { name }));
    setCreated({ id, name });
    setEditing(null);
  };
  // Closed while a draft is open: it is kept, offered again at the next Skapa.
  const close = () => props.onClose();
  const tabProps: TabProps = { ...props, onAdded, onClose: close, active: !editingSongId };
  const label = addKinds().find(([key]) => key === kind)![1];
  return (
    <AddContext value={{ ...lastAdd, items }}>
    <Modal title={t('presentation.addKind', { kind: label.toLocaleLowerCase() })} onClose={close} className="max-w-4xl" bare={!!editingSongId}>
      <div className="flex-1 min-h-0 flex flex-col">
        {editingSongId && (
          // The same page as in Inställningar, filling the dialog.
          <PageFill value>
          <div className="flex-1 min-h-0 flex flex-col bg-ground">
            {editing?.isNew ? (
              <SongEditor
                id={editing.id}
                onBack={() => setEditing(null)}
                adding={{
                  onCreate: (name) => void create(editing.id, name),
                  onCancel: () => {
                    discardDraft(db, editing.id);
                    setEditing(null);
                  },
                  focusName: !!editing.focusName,
                  resumed: !!editing.resumed,
                }}
              />
            ) : (
              <SongEditor id={editingSongId} onBack={() => setEditing(null)} />
            )}
          </div>
          </PageFill>
        )}
        {/* The song list stays as it was under its song's editor. */}
        <div className={editingSongId ? 'hidden' : 'flex-1 min-h-0 flex flex-col'}>
          {kind === 'songs' && <SongTab key={created?.id ?? ''} {...tabProps} created={created} onEditSong={(id) => setEditing({ id, isNew: false })} onNewSong={(q) => void newSong(q)} />}
          {kind === 'bible' && <BibleTab {...tabProps} />}
          {kind === 'images' && <ImageTab {...tabProps} toItemId={toItemId} />}
          {kind === 'audio' && <AudioTab {...tabProps} />}
          {kind === 'slides' && <SlidesTab {...tabProps} />}
          {kind === 'video' && <VideoTab {...tabProps} />}
        </div>
      </div>
      {dialog}
    </Modal>
    </AddContext>
  );
}
