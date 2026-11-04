import { useMemo, type ReactNode } from 'react';
import { can, MEDIA_LIMITS, type LibraryImage, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t, type TextKey } from '../i18n.ts';
import { IMAGE_ACCEPT, useMediaImport } from '../media/imports.ts';
import { PhotoOutlineIcon } from '../ui/icons.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { Library } from '../ui/Library.tsx';
import { useToast } from '../ui/Toast.tsx';

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

/** The messages of an import: how far it is, and the files it could not take. */
export function ImportNotices({ progress, failures, failed, testId }: { progress: ReactNode; failures: string[]; failed: string; testId: string }) {
  return (
    <>
      {progress && (
        <p className="px-5 text-sm text-stone-500 dark:text-stone-400" role="status" data-testid={`${testId}-progress`}>
          {progress}
        </p>
      )}
      {!!failures.length && (
        <div className="px-5 text-sm text-red-500 dark:text-red-400" role="alert" data-testid={`${testId}-failures`}>
          <p>{failed}</p>
          <ul className="list-disc pl-5">
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** A file's name as a library item's. */
export const named = <T extends { fileName: string }>(items: T[] | undefined) => items?.map((i) => ({ ...i, name: i.fileName }));

/** The question and the toast of trashing files: one named, or how many. */
export const trashTexts = (doneOne: TextKey) => ({
  ask: (items: { name: string }[]) =>
    items.length === 1 ? { text: t('images.trashConfirm', { name: items[0]!.name }), bold: items[0]!.name } : { text: t('library.trashMany', { n: items.length }) },
  done: (items: { name: string }[]) => (items.length === 1 ? t(doneOne, { name: items[0]!.name }) : t('library.trashedMany', { n: items.length })),
});

/**
 * Bilder (spec 05 `/admin/images`): the organisation's pictures, as Photos' grid (ui/Library.tsx). Each file is
 * fitted and re-encoded here (`media/process.ts`), kept on this device and uploaded when the server can be reached
 * (docs/media-and-files.md, "Media").
 */
export function Images({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const images = useData(listImages, []);
  const items = useMemo(() => named(images), [images]);
  const { run, progress, failures } = useMediaImport('image');
  const manage = can(role, 'ManageImages');

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await run(files);
    if (added.length && added.length === files.length) toast(t('images.imported', { n: added.length }));
  };

  return (
    <Library
      title={t('images.title')}
      items={items}
      layout="grid"
      renderTile={(image) => <ImageThumb image={image} />}
      preview={(image) => ({ kind: 'image', full: image.fullHash, thumb: image.thumbHash })}
      manage={manage}
      rename={{ title: t('library.renameTitle'), label: t('library.fileName'), maxLength: MEDIA_LIMITS.fileName, run: (image, fileName) => db.mutate('renameImage', { id: image.id, fileName }) }}
      remove={{ ...trashTexts('images.trashed'), run: (image) => db.mutate('trashImage', { id: image.id, at: Date.now() }) }}
      add={manage && <ImportFilesButton round accept={IMAGE_ACCEPT} busy={!!progress} testId="image-file" onFiles={(files) => void importFiles(files)} />}
      notices={<ImportNotices progress={progress && t('images.importing', progress)} failures={failures} failed={t('images.failed', { n: failures.length })} testId="image" />}
      loading={t('presentation.loadingImages')}
      empty={{ icon: <PhotoOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('images.empty') }}
      noMatch={t('images.noMatch')}
      count={(n) => t(n === 1 ? 'images.count.one' : 'images.count.many', { n })}
      drop={{ label: t('images.drop'), accept: IMAGE_ACCEPT, onFiles: (files) => void importFiles(files) }}
      testId="image"
    />
  );
}
