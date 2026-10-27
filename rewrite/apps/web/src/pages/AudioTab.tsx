import { useState } from 'react';
import type { LibraryAudio } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { PlusIcon, SpeakerWaveIcon } from '../ui/icons.tsx';
import { EmptyTab, SearchField } from '../ui/Picker.tsx';
import { useToast } from '../ui/Toast.tsx';

/** The add-item modal's audio tab (spec 03 2d): one file per item, each added from its own row (AddItem/Audio/AudioTab.razor). */
export function AudioTab({ presentationId, afterItemId, onAdded }: { presentationId: string; afterItemId: string | null; onAdded: (itemId: string) => void }) {
  const db = useDb();
  const toast = useToast();
  const audios = useData(listAudios, []);
  const [query, setQuery] = useState('');
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = audios?.filter((a) => !q || a.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  const add = async (a: LibraryAudio) => {
    const itemId = newId();
    await db.mutate('addAudioToPresentation', { itemId, presentationId, audioId: a.id, afterItemId });
    toast(t('presentation.added', { name: a.fileName }));
    onAdded(itemId);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex pb-4">
        <SearchField autoFocus label={t('presentation.searchImages')} value={query} onChange={setQuery} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {audios && !audios.length && (
          <EmptyTab icon={<SpeakerWaveIcon className="size-12 text-neutral-300 dark:text-neutral-600" />}>
            <p>{t('presentation.noAudios')}</p>
          </EmptyTab>
        )}
        <ul className="flex flex-col gap-1 p-3" aria-label={t('audios.title')}>
          {shown.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700">
              <SpeakerWaveIcon className="size-5 text-neutral-400 shrink-0" />
              <span className="text-sm truncate flex-1">{a.fileName}</span>
              <AppButton variant="secondary" aria-label={t('presentation.addImage', { name: a.fileName })} onClick={() => void add(a)} className="shrink-0 inline-flex items-center gap-1.5 py-1.5!">
                <PlusIcon className="size-4" />
                {t('presentation.add')}
              </AppButton>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
