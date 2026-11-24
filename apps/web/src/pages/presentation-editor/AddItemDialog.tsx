import type { Theme } from '@gp/core';
import { useState, type ReactNode } from 'react';
import type { Db } from '../../db/db.ts';
import { useDb } from '../../db/react.tsx';
import { FIRST_PART_LABEL } from '../songEditorLook.ts';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Modal } from '../../ui/Dialog.tsx';
import { PageFill } from '../../ui/PageContainer.tsx';
import { BookOpenIcon, MusicalNoteIcon, PhotoIcon, SlideshowIcon, SpeakerWaveIcon, VideoIcon } from '../../ui/icons.tsx';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';
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

/** A song made in the dialog and not added: thrown away, not to the trash, as it was only ever a draft there. */
function discardSong(db: Db, id: string) {
  void db.mutate('trashSong', { id, at: Date.now() }).then(
    () => db.mutate('purgeSong', { id }),
    () => undefined,
  );
}

/** The kinds an item is, each its name in +'s menu and its icon, Bildspel last: singular, as Keynote's Infoga names its
 * choices (Lars, 2026-11-05). */
export function addKinds(): [AddKind, string, (p: { className?: string }) => ReactNode][] {
  return [
    ['songs', t('add.song'), MusicalNoteIcon],
    ['bible', t('add.bible'), BookOpenIcon],
    ['images', t('add.image'), PhotoIcon],
    ['audio', t('presentation.audioTab'), SpeakerWaveIcon],
    ['video', t('presentation.videoTab'), VideoIcon],
    ['slides', t('add.slides'), SlideshowIcon],
  ];
}

export function AddItemDialog({ toItemId, kind, ...props }: Omit<TabProps, 'active'> & { toItemId?: string; kind: AddKind }) {
  useShortcutGroup(KEYS);
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  /** The song open in the editor here; `isNew` when it was just made here, to be added or thrown away. */
  const [editing, setEditing] = useState<{ id: string; isNew: boolean; focusName?: boolean } | null>(null);
  const editingSongId = editing?.id ?? null;
  /** Counts the songs added from the new song's editor: the song tab starts over, its search empty. */
  const [addedNew, setAddedNew] = useState(0);

  // Skapa in the song tab: a song named as the search, with its first part, Verse 1, to type in, opened here.
  const newSong = async (query: string) => {
    const id = newId();
    const name = query || t('song.newTitle');
    if (!(await trySave(db.mutate('createSong', { id, name })))) return;
    await trySave(db.mutate('addSongPart', { id: newId(), songId: id, labelText: FIRST_PART_LABEL, content: '' }));
    setEditing({ id, isNew: true, focusName: !query });
  };
  const discard = (id: string) => discardSong(db, id);
  const addNew = async (id: string, name: string) => {
    const itemId = newId();
    if (!(await trySave(db.mutate('addSongToPresentation', { itemId, presentationId: props.presentationId, songId: id, arrangementId: null, afterItemId: props.afterItemId }))))
      return;
    toast(t('presentation.added', { name }));
    props.onAdded(itemId);
    setEditing(null);
    setAddedNew((n) => n + 1);
  };
  // Closed while a new song is open: it goes, as with Avbryt.
  const close = () => {
    if (editing?.isNew) discard(editing.id);
    props.onClose();
  };
  const tabProps: TabProps = { ...props, onClose: close, active: !editingSongId };
  const label = addKinds().find(([key]) => key === kind)![1];
  return (
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
                  onAdd: (name) => void addNew(editing.id, name),
                  onCancel: () => {
                    discard(editing.id);
                    setEditing(null);
                  },
                  focusName: !!editing.focusName,
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
          {kind === 'songs' && <SongTab key={addedNew} {...tabProps} onEditSong={(id) => setEditing({ id, isNew: false })} onNewSong={(q) => void newSong(q)} />}
          {kind === 'bible' && <BibleTab {...tabProps} />}
          {kind === 'images' && <ImageTab {...tabProps} toItemId={toItemId} />}
          {kind === 'audio' && <AudioTab {...tabProps} />}
          {kind === 'slides' && <SlidesTab {...tabProps} />}
          {kind === 'video' && <VideoTab {...tabProps} />}
        </div>
      </div>
    </Modal>
  );
}
