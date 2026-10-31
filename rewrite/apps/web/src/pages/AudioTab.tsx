import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LibraryAudio } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AUDIO_ACCEPT, useMediaImport } from '../media/imports.ts';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { SpeakerWaveIcon } from '../ui/icons.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../ui/Picker.tsx';
import { ctrlLabel } from '../ui/shortcuts.ts';
import { useToast } from '../ui/Toast.tsx';
import { PickableFileRow } from './PickableFileRow.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

/** When a file goes to the trash: this device's clock. */
const trashedAt = () => Date.now();

/**
 * The add-item modal's audio tab (AddItem/Audio/AudioTab.razor): a click, Enter or Space picks
 * or unpicks a file; "Lägg till" puts each picked file in as an item of its own. Importera and a
 * drop put new files in the library first.
 */
export function AudioTab({ presentationId, afterItemId, onAdded, active }: { presentationId: string; afterItemId: string | null; onAdded: (itemId: string) => void; active: boolean }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const audios = useData(listAudios, []);
  const imports = useMediaImport('audio');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useFocusWhenShown(search, active);
  const [picked, setPicked] = useState<string[]>([]);
  const adding = useRef(false);
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = audios?.filter((a) => !q || a.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const chosen = (audios ?? []).filter((a) => picked.includes(a.id)).toSorted((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id));
  const list = useRovingList(shown.length);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const add = async () => {
    if (!chosen.length || adding.current) return;
    adding.current = true;
    try {
      // Each after the one before, so they keep the order they were picked in.
      let after = afterItemId;
      for (const a of chosen) {
        const itemId = newId();
        if (!(await trySave(db.mutate('addAudioToPresentation', { itemId, presentationId, audioId: a.id, afterItemId: after })))) return;
        after = itemId;
        onAdded(itemId);
      }
      toast(t('presentation.audioAdded', { name: chosen.map((a) => a.fileName).join(', ') }));
      setPicked([]);
    } finally {
      adding.current = false;
    }
  };

  const remove = async (a: LibraryAudio) => {
    if (!(await trySave(db.mutate('trashAudio', { id: a.id, at: trashedAt() })))) return;
    setPicked((p) => p.filter((x) => x !== a.id));
    toast(t('audios.trashed', { name: a.fileName }));
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isAddKey(e)) {
      e.preventDefault();
      void add();
    }
  };
  const names = chosen.map((a) => a.fileName).join(', ');

  return (
    <DropZone className="flex-1 min-h-0 flex flex-col" label={t('audios.drop')} accept={AUDIO_ACCEPT} onFiles={(files) => void imports.run(files)}>
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="shrink-0 flex flex-wrap items-center gap-3 pb-4">
          <ImportFilesButton accept={AUDIO_ACCEPT} busy={!!imports.progress} testId="audio-tab-file" secondary onFiles={(files) => void imports.run(files)} />
          <DropHint text={t('images.dropAffordance')} />
          {!!imports.failures.length && (
            <span className="text-red-500 dark:text-red-400 text-sm" role="alert">
              {t('audios.failed', { n: imports.failures.length })}
            </span>
          )}
          {imports.progress && <span className="text-neutral-400 text-sm">{t('images.importing', imports.progress)}</span>}
          <SearchField inputRef={search} label={t('presentation.searchImages')} value={query} onChange={setQuery} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!audios && <p className="flex items-center justify-center py-12 text-neutral-400 text-sm">{t('audios.loading')}</p>}
          {audios && !audios.length && (
            <EmptyTab icon={<SpeakerWaveIcon className="size-12 text-neutral-300 dark:text-neutral-600" />}>
              <p>{t('presentation.noAudios')}</p>
            </EmptyTab>
          )}
          <ul className="flex flex-col gap-1 p-3" aria-label={t('audios.title')} onKeyDown={list.onKeyDown}>
            {shown.map((a, i) => (
              <PickableFileRow key={a.id} nav={list.item(i)} picked={picked.includes(a.id)} name={a.fileName} icon={<SpeakerWaveIcon className="size-5 text-neutral-400 shrink-0" />} onToggle={() => toggle(a.id)} onRemove={() => void remove(a)}>
                <span className="text-sm truncate flex-1">{a.fileName}</span>
              </PickableFileRow>
            ))}
          </ul>
        </div>
        <AddFooter
          hint={t('presentation.addHint', { key: ctrlLabel('Enter') })}
          name={chosen.length ? names : undefined}
          label={chosen.length ? t('presentation.addImage', { name: names }) : undefined}
          onAdd={chosen.length ? () => void add() : undefined}
        />
      </div>
    </DropZone>
  );
}
