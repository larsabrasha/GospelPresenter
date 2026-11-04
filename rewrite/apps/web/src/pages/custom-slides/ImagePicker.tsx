import { useState } from 'react';
import type { LibraryImage } from '@gp/core';
import { useData } from '../../db/react.tsx';
import { listImages } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { ListSearch, matches } from '../../ui/ListSearch.tsx';
import { ImageThumb } from '../Images.tsx';

/** A picture of Bilder for a custom slide: tapped, it is chosen (docs/custom-slides.md). */
export function ImagePicker({ onPick, onClose }: { onPick: (image: LibraryImage) => void; onClose: () => void }) {
  const images = useData(listImages, []);
  const [query, setQuery] = useState('');
  const shown = images?.filter((i) => matches(query, i.fileName)) ?? [];
  return (
    <Dialog title={t('slideEditor.chooseImage')} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        {!!images?.length && <ListSearch query={query} onChange={setQuery} />}
        {images && !images.length && <p className="text-sm text-stone-500 dark:text-stone-400">{t('slideEditor.noImages')}</p>}
        <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60svh] overflow-y-auto" aria-label={t('images.title')}>
          {shown.map((image) => (
            <li key={image.id}>
              <AppButton variant="plain" aria-label={image.fileName} className="w-full flex justify-center rounded-lg cursor-pointer hover:opacity-80" onClick={() => onPick(image)}>
                <ImageThumb image={image} />
              </AppButton>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
