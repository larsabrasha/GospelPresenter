import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LibraryAudio } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AUDIO_ACCEPT, useMediaImport } from '../media/imports.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { Dropdown, MENU_ITEM_DANGER } from '../ui/Dropdown.tsx';
import { ArrowDownTrayIcon, CheckIcon, EllipsisIcon, SpeakerWaveIcon, TrashIcon } from '../ui/icons.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../ui/Picker.tsx';
import { ctrlLabel } from '../ui/shortcuts.ts';
import { useToast } from '../ui/Toast.tsx';

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
          <AppButton variant="secondary" asLabel disabled={!!imports.progress} className="inline-flex items-center gap-1.5">
            <ArrowDownTrayIcon className="size-4 shrink-0" />
            {t('images.import')}
            <input
              type="file"
              accept={AUDIO_ACCEPT}
              multiple
              hidden
              disabled={!!imports.progress}
              data-testid="audio-tab-file"
              onChange={(e) => {
                void imports.run([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </AppButton>
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
            {shown.map((a, i) => {
              const isPicked = picked.includes(a.id);
              return (
                <li
                  key={a.id}
                  {...list.item(i)}
                  role="button"
                  aria-pressed={isPicked}
                  aria-label={a.fileName}
                  onClick={() => toggle(a.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey) return;
                    e.preventDefault();
                    toggle(a.id);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ring-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    isPicked ? 'ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'ring-transparent hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }`}
                >
                  {isPicked ? (
                    <span className="size-5 flex items-center justify-center rounded-full bg-sky-500 text-white shrink-0">
                      <CheckIcon className="size-4" />
                    </span>
                  ) : (
                    <SpeakerWaveIcon className="size-5 text-neutral-400 shrink-0" />
                  )}
                  <span className="text-sm truncate flex-1">{a.fileName}</span>
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Dropdown
                      menuClassName="min-w-36"
                      button={{
                        className: 'size-7 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer',
                        'aria-label': t('images.more', { name: a.fileName }),
                      }}
                      trigger={<EllipsisIcon className="size-4" />}
                    >
                      <AppButton variant="plain" role="menuitem" className={MENU_ITEM_DANGER} onClick={() => void remove(a)}>
                        <TrashIcon className="size-4" />
                        {t('images.remove')}
                      </AppButton>
                    </Dropdown>
                  </span>
                </li>
              );
            })}
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
