import { useState } from 'react';
import { can, type LibraryImage, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { IMAGE_ACCEPT, useMediaImport } from '../media/imports.ts';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { CardNote, EmptySmall } from '../ui/Empty.tsx';
import { PhotoOutlineIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { useToast } from '../ui/Toast.tsx';
import { RemoveMenu } from '../ui/RemoveMenu.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

/**
 * A library picture's thumbnail, from this device's own copy, rounded and at
 * most 128 px high (Images.razor); a grey box with "Hämtas..." until it has arrived.
 */
export function ImageThumb({ image, className }: { image: Pick<LibraryImage, 'thumbHash' | 'fileName'>; className?: string }) {
  const url = useBlobUrl(image.thumbHash);
  return url ? (
    <img src={url} alt={image.fileName} draggable={false} className={className ?? 'block max-w-full max-h-32 rounded-lg'} />
  ) : (
    <div className="w-32 max-w-full aspect-video rounded-lg bg-stone-200 dark:bg-raised flex items-center justify-center text-xs text-stone-400">{t('images.fetching')}</div>
  );
}

/**
 * Bilder (spec 05 `/admin/images`): the organisation's pictures. Each file is
 * fitted and re-encoded here (`media/process.ts`), kept on this device and
 * uploaded when the server can be reached (docs/media-and-files.md, "Media"). No preview step,
 * no rename, no detail view (spec 05).
 */
export function Images({ role }: { role: Role }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const images = useData(listImages, []);
  const [query, setQuery] = useState('');
  const { run, progress, failures } = useMediaImport('image');
  const manage = can(role, 'ManageImages');

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await run(files);
    if (added.length && added.length === files.length) toast(t('images.imported', { n: added.length }));
  };

  const remove = async (image: LibraryImage) => {
    if (!(await trySave(db.mutate('trashImage', { id: image.id, at: Date.now() })))) return;
    toast(t('images.trashed', { name: image.fileName }));
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = images?.filter((i) => !q || i.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5" label={t('images.drop')} accept={IMAGE_ACCEPT} enabled={manage} onFiles={(files) => void importFiles(files)}>
        <PageHeader title={t('images.title')}>
          <div className="flex items-center gap-3">
            {manage && <DropHint text={t('images.dropAffordance')} />}
            {manage && (
              <ImportFilesButton round accept={IMAGE_ACCEPT} busy={!!progress} testId="image-file" onFiles={(files) => void importFiles(files)} />
            )}
          </div>
        </PageHeader>
        {progress && (
          <p className="px-5 text-sm text-stone-500 dark:text-stone-400" role="status" data-testid="image-progress">
            {t('images.importing', progress)}
          </p>
        )}
        {!!failures.length && (
          <div className="px-5 text-sm text-red-500 dark:text-red-400" role="alert" data-testid="image-failures">
            <p>{t('images.failed', { n: failures.length })}</p>
            <ul className="list-disc pl-5">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {/* Not clipped, so a ⋯ menu can reach past the card's edge. */}
        <div className={CARD.replace(' overflow-hidden', '')}>
          <div className="px-5 pt-4 pb-2 space-y-3">
            <h2 className="text-base/6 font-semibold">{t('images.all', { n: images?.length ?? 0 })}</h2>
            {!!images?.length && <SearchField value={query} onChange={setQuery} label={t('images.search')} placeholder={t('images.searchPlaceholder')} compact />}
          </div>
          {!images && <div className="px-5 py-4 text-stone-400 text-sm">{t('presentation.loadingImages')}</div>}
          {images && !images.length && (
            <EmptySmall icon={<PhotoOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('images.empty')} />
          )}
          {!!images?.length && !shown.length && <CardNote>{t('images.noMatch')}</CardNote>}
          {/* Columns by its own width, not the window's: Inställningar's page column is narrow on an iPad held upright. */}
          <div className="@container">
          <ul className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5 @4xl:grid-cols-6 gap-1 p-3 empty:hidden" aria-label={t('images.title')} data-testid="image-grid">
            {shown.map((image) => (
              <li key={image.id} className="relative p-2 flex flex-col items-center min-w-0" data-testid="image-card">
                <div className="relative rounded-lg">
                  <ImageThumb image={image} />
                  {manage && (
                    <div className="absolute top-1 right-1">
                      <RemoveMenu name={image.fileName} on="picture" onRemove={() => void remove(image)} />
                    </div>
                  )}
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-1 text-center w-full" title={image.fileName}>
                  {image.fileName}
                </p>
              </li>
            ))}
          </ul>
          </div>
        </div>
      </DropZone>
    </PageContainer>
  );
}
