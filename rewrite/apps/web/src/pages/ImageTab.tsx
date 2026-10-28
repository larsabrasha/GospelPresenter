import { useState } from 'react';
import type { LibraryImage } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { CheckIcon, PhotoIcon } from '../ui/icons.tsx';
import { AddFooter, EmptyTab, SearchField } from '../ui/Picker.tsx';
import { useToast } from '../ui/Toast.tsx';

/** A picture's thumbnail in the picker, once this device has it (AddItem/Image/ImageTab.razor). */
function PickThumb({ image }: { image: LibraryImage }) {
  const url = useBlobUrl(image.thumbHash);
  return url ? (
    <img src={url} alt={image.fileName} draggable={false} className="block max-w-full max-h-32 rounded-lg" />
  ) : (
    <span className="flex aspect-video w-32 max-w-full items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-700 text-xs text-neutral-400">{t('images.fetching')}</span>
  );
}

/** The add-item modal's picture tab: the library, to add one picture as an item (spec 03 2d, spec 05). */
export function ImageTab({ presentationId, afterItemId, onAdded }: { presentationId: string; afterItemId: string | null; onAdded: (itemId: string) => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const images = useData(listImages, []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = images?.filter((i) => !q || i.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const selected = shown.find((i) => i.id === selectedId) ?? null;

  const add = async (image: LibraryImage) => {
    const itemId = newId();
    if (!(await trySave(db.mutate('addImageToPresentation', { itemId, presentationId, imageId: image.id, afterItemId })))) return;
    toast(t('presentation.added', { name: image.fileName }));
    onAdded(itemId);
    setSelectedId(null);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex pb-4">
        <SearchField autoFocus label={t('presentation.searchImages')} value={query} onChange={setQuery} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {images && !images.length && (
          <EmptyTab icon={<PhotoIcon className="size-12 text-neutral-300 dark:text-neutral-600" />}>
            <p>{t('presentation.noImages')}</p>
          </EmptyTab>
        )}
        <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 items-center" aria-label={t('images.title')} data-testid="image-picker">
          {shown.map((image) => {
            const isSelected = image.id === selected?.id;
            return (
              <li key={image.id} className="relative p-2 flex flex-col items-center min-w-0">
                <AppButton
                  variant="plain"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(image.id)}
                  onDoubleClick={() => void add(image)}
                  className="flex flex-col items-center w-full min-w-0 cursor-pointer focus:outline-none group"
                >
                  <span className={`relative rounded-lg transition-shadow ring-3 group-focus-visible:ring-sky-500 ${isSelected ? 'ring-sky-500' : 'ring-transparent'}`}>
                    <PickThumb image={image} />
                    {isSelected && (
                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="size-8 flex items-center justify-center rounded-full bg-sky-500 text-white">
                          <CheckIcon className="size-5" />
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400 truncate mt-1 text-center w-full" title={image.fileName}>
                    {image.fileName}
                  </span>
                </AppButton>
              </li>
            );
          })}
        </ul>
      </div>
      <AddFooter
        name={selected?.fileName}
        label={selected ? t('presentation.addImage', { name: selected.fileName }) : undefined}
        onAdd={selected ? () => void add(selected) : undefined}
      />
    </div>
  );
}
