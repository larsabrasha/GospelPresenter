import { useState } from 'react';
import { can, type LibraryImage, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { processImage, ImageRefused, type ImageProblem } from '../media/process.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { Dropdown, MENU_ITEM_DANGER } from '../ui/Dropdown.tsx';
import { CardNote, EmptySmall } from '../ui/Empty.tsx';
import { ArrowDownTrayIcon, EllipsisIcon, PhotoOutlineIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';

const failedText: Record<ImageProblem | 'other', Parameters<typeof t>[0]> = {
  type: 'images.failedType',
  size: 'images.failedSize',
  name: 'images.failedName',
  invalid: 'images.failedInvalid',
  other: 'images.failedOther',
};

/**
 * A library picture's thumbnail, from this device's own copy, rounded and at
 * most 128 px high (Images.razor); a grey box with "Hämtas..." until it has arrived.
 */
export function ImageThumb({ image, className }: { image: Pick<LibraryImage, 'thumbHash' | 'fileName'>; className?: string }) {
  const url = useBlobUrl(image.thumbHash);
  return url ? (
    <img src={url} alt={image.fileName} draggable={false} className={className ?? 'block max-w-full max-h-32 rounded-lg'} />
  ) : (
    <div className="w-32 max-w-full aspect-video rounded-lg bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs text-neutral-400">{t('images.fetching')}</div>
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
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const manage = can(role, 'ManageImages');

  const importFiles = async (files: File[]) => {
    if (!files.length || progress || !manage) return;
    setFailures([]);
    const failed: string[] = [];
    let added = 0;
    for (const [i, file] of files.entries()) {
      setProgress({ i: i + 1, n: files.length });
      try {
        await db.addImage(await processImage(file, newId()));
        added++;
      } catch (e) {
        failed.push(t(failedText[e instanceof ImageRefused ? e.problem : 'other'], { name: file.name }));
      }
    }
    setProgress(null);
    setFailures(failed);
    if (added && !failed.length) toast(t('images.imported', { n: added }));
  };

  const remove = async (image: LibraryImage) => {
    if (!(await trySave(db.mutate('trashImage', { id: image.id, at: Date.now() })))) return;
    toast(t('images.trashed', { name: image.fileName }));
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = images?.filter((i) => !q || i.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5 min-h-[60vh]" label={t('images.drop')} enabled={manage} onFiles={(files) => void importFiles(files)}>
        <PageHeader title={t('images.title')}>
          <div className="flex items-center gap-3">
            {manage && <DropHint text={t('images.dropAffordance')} />}
            {/* Always here: someone who has just deleted the wrong picture needs the way back in view. */}
            <AppButton variant="neutral" href={href({ page: 'trash', kind: 'Image' })} className="inline-flex items-center gap-1.5">
              <TrashIcon className="size-4" />
              {t('images.trash')}
            </AppButton>
            {manage && (
              <AppButton asLabel disabled={!!progress} className="inline-flex items-center gap-1.5">
                <ArrowDownTrayIcon className="size-4 shrink-0" />
                {t('images.import')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  hidden
                  disabled={!!progress}
                  data-testid="image-file"
                  onChange={(e) => {
                    void importFiles([...(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                />
              </AppButton>
            )}
          </div>
        </PageHeader>
        {progress && (
          <p className="px-5 text-sm text-neutral-500 dark:text-neutral-400" role="status" data-testid="image-progress">
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
            {!!images?.length && <SearchField value={query} onChange={setQuery} label={t('images.search')} compact />}
          </div>
          {images && !images.length && (
            <EmptySmall icon={<PhotoOutlineIcon className="size-12 mb-3 text-neutral-300 dark:text-neutral-600" />} title={t('images.empty')} text={t('images.emptyText')} />
          )}
          {!!images?.length && !shown.length && <CardNote>{t('images.noMatch')}</CardNote>}
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 p-3 empty:hidden" aria-label={t('images.title')} data-testid="image-grid">
            {shown.map((image) => (
              <li key={image.id} className="relative p-2 flex flex-col items-center min-w-0" data-testid="image-card">
                <div className="relative rounded-lg">
                  <ImageThumb image={image} />
                  {manage && (
                    <div className="absolute top-1 right-1">
                      <Dropdown
                        menuClassName="min-w-36"
                        button={{
                          className: 'size-7 flex items-center justify-center rounded-full bg-black/60 text-white cursor-pointer hover:bg-black/80',
                          'aria-label': t('images.more', { name: image.fileName }),
                        }}
                        trigger={<EllipsisIcon className="size-4" />}
                      >
                        <AppButton variant="plain" role="menuitem" className={MENU_ITEM_DANGER} onClick={() => void remove(image)}>
                          <TrashIcon className="size-4" />
                          {t('images.remove')}
                        </AppButton>
                      </Dropdown>
                    </div>
                  )}
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-1 text-center w-full" title={image.fileName}>
                  {image.fileName}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </DropZone>
    </PageContainer>
  );
}
