import { useState } from 'react';
import type { LibraryAudio } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { useToast } from '../ui/Toast.tsx';

/** The add-item modal's audio tab (spec 03 2d): one file per item. */
export function AudioTab({
  presentationId,
  afterItemId,
  onAdded,
  onClose,
}: {
  presentationId: string;
  afterItemId: string | null;
  onAdded: (itemId: string) => void;
  onClose: () => void;
}) {
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
    <>
      <input
        autoFocus
        className="search"
        type="search"
        maxLength={100}
        aria-label={t('presentation.searchImages')}
        placeholder={t('presentation.searchImages')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {audios && !audios.length && <p className="muted">{t('presentation.noAudios')}</p>}
      <ul className="list" aria-label={t('audios.title')}>
        {shown.map((a) => (
          <li key={a.id} className="row">
            <span className="grow">🔊 {a.fileName}</span>
            <Button onClick={() => void add(a)}>{t('presentation.addImage', { name: a.fileName })}</Button>
          </li>
        ))}
      </ul>
      <div className="row end">
        <Button onClick={onClose}>{t('common.close')}</Button>
      </div>
    </>
  );
}
