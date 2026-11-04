import { useState } from 'react';
import { useData, useDb } from '../../db/react.tsx';
import { listImages } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { IMAGE_ACCEPT } from '../../media/imports.ts';
import { processImage } from '../../media/process.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { ArrowDownTrayIcon } from '../../ui/icons.tsx';
import { ListSearch, matches } from '../../ui/ListSearch.tsx';
import { ImageThumb } from '../Images.tsx';
import type { PickedPicture } from './slideModel.ts';

/**
 * A picture for a page of a slideshow or an overlay (docs/custom-slides.md): one of Bilder, tapped, or a file of
 * this device. Either way the page keeps it as its own, as Keynote does: one of Bilder is copied (the same blobs,
 * named by their content), and a file goes into the slideshow only, not into Bilder.
 */
export function ImagePicker({ onPick, onClose }: { onPick: (picked: PickedPicture) => void; onClose: () => void }) {
  const db = useDb();
  const images = useData(listImages, []);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shown = images?.filter((i) => matches(query, i.fileName)) ?? [];
  const fromDevice = async (file: File | undefined) => {
    if (!file) return;
    setFailed(false);
    setBusy(true);
    try {
      const image = await processImage(file, newId());
      onPick({ picture: await db.keepPicture(image), width: image.width, height: image.height });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('slideEditor.chooseImage')} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <AppButton asLabel variant="secondary" disabled={busy} className="inline-flex items-center gap-1.5">
            <ArrowDownTrayIcon className="size-4 shrink-0" />
            {t('slideEditor.fromDevice')}
            <input type="file" accept={IMAGE_ACCEPT} hidden data-testid="picture-file" onChange={(e) => (void fromDevice(e.target.files?.[0]), (e.target.value = ''))} />
          </AppButton>
          {!!images?.length && (
            <div className="flex-1 min-w-48">
              <ListSearch query={query} onChange={setQuery} />
            </div>
          )}
        </div>
        {failed && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {t('slideEditor.pictureFailed')}
          </p>
        )}
        {images && !images.length && <p className="text-sm text-stone-500 dark:text-stone-400">{t('slideEditor.noImages')}</p>}
        <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60svh] overflow-y-auto" aria-label={t('images.title')}>
          {shown.map((image) => (
            <li key={image.id}>
              <AppButton
                variant="plain"
                aria-label={image.fileName}
                className="w-full flex justify-center rounded-lg cursor-pointer hover:opacity-80"
                onClick={() => onPick({ picture: { full: image.fullHash, thumb: image.thumbHash }, width: image.width, height: image.height })}
              >
                <ImageThumb image={image} />
              </AppButton>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
