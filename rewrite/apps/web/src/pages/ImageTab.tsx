import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LibraryImage } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { IMAGE_ACCEPT, useMediaImport } from '../media/imports.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { DropZone } from '../ui/DropZone.tsx';
import { CheckIcon, PhotoIcon } from '../ui/icons.tsx';
import { useView, VIEW_ITEM, VIEW_LIST, ViewPicker } from '../ui/ViewPicker.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../ui/Picker.tsx';
import { ctrlLabel } from '../ui/shortcuts.ts';
import { useToast } from '../ui/Toast.tsx';
import { ImageThumb } from './Images.tsx';
import { PictureMenu } from '../ui/RemoveMenu.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

/** When a file goes to the trash: this device's clock. */
const trashedAt = () => Date.now();

/**
 * The add-item modal's picture tab (AddItem/Image/ImageTab.razor): the library, where a click
 * picks or unpicks a picture, and the picked ones go in as one item, a slide each. Importera
 * and a drop put new pictures in the library first. With `toItemId`, the picked pictures go
 * last in that image item instead ("Lägg till bilder" in the editor).
 */
export function ImageTab({
  presentationId,
  afterItemId,
  onAdded,
  active,
  toItemId,
}: {
  presentationId: string;
  afterItemId: string | null;
  onAdded: (itemId: string) => void;
  active: boolean;
  toItemId?: string;
}) {
  const db = useDb();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  // A list, a grid or large, as in Bilder (ui/ViewPicker.tsx), this device's choice: small ones are hard to tell apart.
  const [view, setView] = useView('imagePicker:view', 'grid');
  const toast = useToast();
  const images = useData(listImages, []);
  const imports = useMediaImport('image');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useFocusWhenShown(search, active);
  const [picked, setPicked] = useState<string[]>([]);
  const adding = useRef(false);
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = images?.filter((i) => !q || i.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const chosen = (images ?? []).filter((i) => picked.includes(i.id)).toSorted((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id));
  const grid = useRovingList(shown.length, 'grid');
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const add = async () => {
    // Once at a time, as ImageTab.razor's isAdding: a held key adds one item.
    if (!chosen.length || adding.current) return;
    adding.current = true;
    try {
      const imageIds = chosen.map((i) => i.id);
      if (toItemId) {
        if (!(await trySave(db.mutate('addImagesToItem', { itemId: toItemId, imageIds })))) return;
        onAdded(toItemId);
      } else {
        const itemId = newId();
        const title = chosen.length === 1 ? undefined : t('presentation.imagesWord', { n: chosen.length });
        if (!(await trySave(db.mutate('addImageToPresentation', { itemId, presentationId, imageIds, title, afterItemId })))) return;
        onAdded(itemId);
      }
      toast(chosen.length === 1 ? t('presentation.added', { name: chosen[0]!.fileName }) : t('presentation.imagesAdded', { n: chosen.length }));
      setPicked([]);
    } finally {
      adding.current = false;
    }
  };

  // To the trash after a question, as every deletion asks (Lars, 2026-11-03).
  const remove = (image: LibraryImage) =>
    ask(
      deleteAsk(t('images.trashConfirm', { name: image.fileName }), image.fileName, async () => {
        if (!(await trySave(db.mutate('trashImage', { id: image.id, at: trashedAt() })))) return;
        setPicked((p) => p.filter((x) => x !== image.id));
        toast(t('images.trashed', { name: image.fileName }));
      }),
    );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isAddKey(e)) {
      e.preventDefault();
      void add();
    }
  };

  return (
    <DropZone className="flex-1 min-h-0 flex flex-col" label={t('images.drop')} accept={IMAGE_ACCEPT} onFiles={(files) => void imports.run(files)}>
      {dialog}
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="shrink-0 flex flex-wrap items-center gap-3 pb-4">
          {!!imports.failures.length && (
            <span className="text-red-500 dark:text-red-400 text-sm" role="alert">
              {t('images.failed', { n: imports.failures.length })}
            </span>
          )}
          {imports.progress && <span className="text-stone-400 text-sm">{t('images.importing', imports.progress)}</span>}
          <SearchField className="max-sm:basis-full" inputRef={search} label={t('presentation.searchImages')} value={query} onChange={setQuery} />
          <ViewPicker value={view} onChange={setView} />
          <ImportFilesButton secondary short accept={IMAGE_ACCEPT} busy={!!imports.progress} testId="image-tab-file" onFiles={(files) => void imports.run(files)} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!images && <p className="loading-line flex items-center justify-center py-12 text-stone-400 text-sm">{t('presentation.loadingImages')}</p>}
          {images && !images.length && (
            <EmptyTab icon={<PhotoIcon className="size-12 text-stone-300 dark:text-stone-600" />}>
              <p>{t('presentation.noImages')}</p>
            </EmptyTab>
          )}
          <ul className={VIEW_LIST[view]} aria-label={t('images.title')} data-testid="image-picker" onKeyDown={grid.onKeyDown}>
            {shown.map((image, i) => {
              const isPicked = picked.includes(image.id);
              return (
                <li key={image.id} className={VIEW_ITEM[view]}>
                  <PictureMenu name={image.fileName} onRemove={() => void remove(image)}>
                  <span className={`relative block ${view === 'large' ? 'w-full' : ''}`}>
                    <AppButton
                      variant="plain"
                      {...grid.item(i)}
                      aria-pressed={isPicked}
                      aria-label={image.fileName}
                      onClick={() => toggle(image.id)}
                      className={`relative block ${view === 'large' ? 'w-full' : ''} rounded-lg cursor-pointer transition-shadow ring-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${isPicked ? 'ring-sky-500' : 'ring-transparent'}`}
                    >
                      {/* Large, the picture itself: its thumbnail (400 × 225) would be soft at that size. */}
                      <ImageThumb
                        image={view === 'large' ? { thumbHash: image.fullHash, fileName: image.fileName } : image}
                        className={view === 'list' ? 'block w-16 aspect-video object-cover rounded' : view === 'large' ? 'block w-full rounded-lg' : undefined}
                      />
                      {isPicked && (
                        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <span className="size-8 flex items-center justify-center rounded-full bg-sky-500 text-white">
                            <CheckIcon className="size-5" />
                          </span>
                        </span>
                      )}
                    </AppButton>
                  </span>
                  </PictureMenu>
                  <p className={view === 'list' ? 'flex-1 min-w-0 text-sm truncate' : 'text-xs text-stone-500 dark:text-stone-400 truncate mt-1 text-center w-full'} title={image.fileName}>
                    {image.fileName}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
        <AddFooter
          hint={t('presentation.addHint', { key: ctrlLabel('Enter') })}
          name={chosen.length === 1 ? chosen[0]!.fileName : chosen.length ? t('presentation.imagesWord', { n: chosen.length }) : undefined}
          label={chosen.length ? t('presentation.addImage', { name: chosen.length === 1 ? chosen[0]!.fileName : t('presentation.imagesWord', { n: chosen.length }) }) : undefined}
          onAdd={chosen.length ? () => void add() : undefined}
        />
      </div>
    </DropZone>
  );
}
