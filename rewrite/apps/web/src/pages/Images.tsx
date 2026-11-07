import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, MEDIA_LIMITS, type LibraryImage, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb, usePictureUrl } from '../db/react.tsx';
import { listImages } from '../db/images.ts';
import { t, type TextKey } from '../i18n.ts';
import { nameFor } from '../media/download.ts';
import { IMAGE_ACCEPT, useMediaImport } from '../media/imports.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { ArrowUturnLeftIcon, PencilIcon, PhotoOutlineIcon } from '../ui/icons.tsx';
import { ImageEditor } from './image-editor/ImageEditor.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { Library } from '../ui/Library.tsx';
import { useToast } from '../ui/Toast.tsx';

/**
 * A library picture's thumbnail, from this device's own copy, rounded and at
 * most 128 px high (Images.razor); a grey box with "Hämtas..." until it has arrived.
 */
export function ImageThumb({ image, className }: { image: Pick<LibraryImage, 'thumbHash' | 'fileName'>; className?: string }) {
  return <Thumb url={useBlobUrl(image.thumbHash)} name={image.fileName} className={className} />;
}

/**
 * A library picture at full size, for the large view, where its thumbnail (400 × 225) would be soft: the picture
 * itself, fetched when this device lacks it, which a browser does unless a presentation needs it (Lars, 2026-11-06:
 * "Hämtas..." stayed on an iPad); its thumbnail meanwhile. Fetched only once it comes within a screen of view, so a
 * long list does not download every original (Lars, 2026-11-06).
 */
export function ImageFull({ image, className }: { image: Pick<LibraryImage, 'fullHash' | 'thumbHash' | 'fileName'>; className?: string }) {
  const [el, setEl] = useState<Element | null>(null);
  const near = useNearView(el);
  return <Thumb url={usePictureUrl(near ? image.fullHash : null, image.thumbHash)} name={image.fileName} className={className} ref={setEl} />;
}

/** Whether `el` has come within a screen of view in its scrolling box; once true, it stays so. */
function useNearView(el: Element | null): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!el || near) return;
    // The scrolling box as the root: the margin reaches past its edges, which it would not past the window's alone.
    const seen = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), { root: scrollingBox(el), rootMargin: '100% 0px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [el, near]);
  return near;
}

function scrollingBox(el: Element): Element | null {
  for (let box = el.parentElement; box; box = box.parentElement) if (/auto|scroll/.test(getComputedStyle(box).overflowY)) return box;
  return null;
}

function Thumb({ url, name, className, ref }: { url: string | null; name: string; className?: string; ref?: (el: Element | null) => void }) {
  return url ? (
    <img ref={ref} src={url} alt={name} draggable={false} className={className ?? 'block max-w-full max-h-32 rounded-lg'} />
  ) : (
    <div ref={ref} className="w-32 max-w-full aspect-video rounded-lg bg-stone-200 dark:bg-raised flex items-center justify-center text-xs text-stone-400">{t('images.fetching')}</div>
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

/** The orders of a library of files: newest first (as it was), oldest first, by name; `more` after them. */
export function fileSorts<T extends { name: string; createdAt: number }>(more: { key: string; label: string; compare: (a: T, b: T) => number }[] = []) {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'sv', { numeric: true });
  return [
    { key: 'newest', label: t('library.sort.newest'), compare: (a: T, b: T) => b.createdAt - a.createdAt || byName(a, b) },
    { key: 'oldest', label: t('library.sort.oldest'), compare: (a: T, b: T) => a.createdAt - b.createdAt || byName(a, b) },
    { key: 'name', label: t('library.sort.name'), compare: byName },
    ...more,
  ];
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
  // A picture edited (MEDIA-R19): Redigera in its menu, here and in Quick Look; the row as it is now, after a sync.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? images?.find((i) => i.id === editingId) : undefined;
  const { dialog, ask } = useConfirm();
  const revert = async (image: LibraryImage) => {
    const ok = await ask({ title: t('images.revert'), text: t('images.revertConfirm'), confirm: t('images.revert'), compact: true, run: () => db.mutate('revertImage', { id: image.id }) });
    if (ok) toast(t('images.reverted'));
  };

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await run(files);
    if (added.length && added.length === files.length) toast(t('images.imported', { n: added.length }));
  };

  return (
    <>
    {dialog}
    {editing && <ImageEditor key={editing.id} image={editing} onClose={() => setEditingId(null)} />}
    <Library
      title={t('images.title')}
      items={items}
      layout="grid"
      switchable
      sorts={fileSorts()}
      renderRow={(image) => ({
        leading: <ImageThumb image={image} className="block w-16 aspect-video object-cover rounded shrink-0" />,
        subtitle: `${image.width} × ${image.height}`,
      })}
      // Large, the picture itself rather than its thumbnail (400 × 225), which would be soft at that size.
      renderTile={(image, large) => (large ? <ImageFull image={image} className="block w-full rounded-lg" /> : <ImageThumb image={image} />)}
      preview={(image) => ({ kind: 'image', full: image.fullHash, thumb: image.thumbHash })}
      manage={manage}
      renderActions={(image, row) => (
        <>
          <AppButton variant="plain" role="menuitem" className={row} onClick={() => setEditingId(image.id)}>
            <PencilIcon className="size-4" />
            {t('images.edit')}
          </AppButton>
          {image.originalFullHash && (
            <AppButton variant="plain" role="menuitem" className={row} onClick={() => void revert(image)}>
              <ArrowUturnLeftIcon className="size-4" />
              {t('images.revert')}
            </AppButton>
          )}
        </>
      )}
      download={{
        zipName: t('images.title'),
        file: async (image) => {
          const m = await db.openMedia(image.fullHash);
          return m && { name: nameFor(image.fileName, m.contentType), data: m.bytes, type: m.contentType };
        },
      }}
      rename={{ title: t('library.renameTitle'), label: t('library.fileName'), maxLength: MEDIA_LIMITS.fileName, run: (image, fileName) => db.mutate('renameImage', { id: image.id, fileName }) }}
      remove={{ ...trashTexts('images.trashed'), run: (image) => db.mutate('trashImage', { id: image.id, at: Date.now() }) }}
      add={manage && <ImportFilesButton round accept={IMAGE_ACCEPT} busy={!!progress} testId="image-file" onFiles={(files) => void importFiles(files)} />}
      notices={<ImportNotices progress={progress && t('images.importing', progress)} failures={failures} failed={t('images.failed', { n: failures.length })} testId="image" />}
      loading={t('presentation.loadingImages')}
      empty={{ icon: <PhotoOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('images.empty'),
        text: t('images.emptyText'),
        action: <ImportFilesButton accept={IMAGE_ACCEPT} busy={!!progress} testId="image-file" label={t('images.emptyImport')} onFiles={(files) => void importFiles(files)} />,
      }}
      noMatch={t('images.noMatch')}
      count={(n) => t(n === 1 ? 'images.count.one' : 'images.count.many', { n })}
      drop={{ label: t('images.drop'), accept: IMAGE_ACCEPT, onFiles: (files) => void importFiles(files) }}
      testId="image"
    />
    </>
  );
}
