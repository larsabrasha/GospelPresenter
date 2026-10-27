import { useState } from 'react';
import type { LibraryImage } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { useToast } from '../ui/Toast.tsx';
import { ImageThumb } from './Images.tsx';

/** The add-item modal's picture tab: the library, to add one picture as an item (spec 03 2d, spec 05). */
export function ImageTab({
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
  const images = useData(listImages, []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = images?.filter((i) => !q || i.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const selected = shown.find((i) => i.id === selectedId) ?? null;

  const add = async (image: LibraryImage) => {
    const itemId = newId();
    await db.mutate('addImageToPresentation', { itemId, presentationId, imageId: image.id, afterItemId });
    toast(t('presentation.added', { name: image.fileName }));
    onAdded(itemId);
    setSelectedId(null);
  };

  return (
    <>
      <div className="row">
        <input
          autoFocus
          className="grow"
          type="search"
          maxLength={100}
          aria-label={t('presentation.searchImages')}
          placeholder={t('presentation.searchImages')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {images && !images.length && <p className="muted">{t('presentation.noImages')}</p>}
      <ul className="image-grid" aria-label={t('images.title')} data-testid="image-picker">
        {shown.map((image) => (
          <li key={image.id} className="image-card">
            <Button className="image-pick" aria-pressed={image.id === selected?.id} onClick={() => setSelectedId(image.id)} onDoubleClick={() => void add(image)}>
              <ImageThumb image={image} />
              <div className="name" title={image.fileName}>
                {image.fileName}
              </div>
            </Button>
          </li>
        ))}
      </ul>
      <div className="row end">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {selected && (
          <Button variant="primary" onClick={() => void add(selected)}>
            {t('presentation.addImage', { name: selected.fileName })}
          </Button>
        )}
      </div>
    </>
  );
}
