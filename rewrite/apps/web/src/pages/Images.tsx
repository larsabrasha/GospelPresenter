import { useState, type DragEvent } from 'react';
import { can, type LibraryImage, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listImages } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { processImage, ImageRefused, type ImageProblem } from '../media/process.ts';
import { Button } from '../ui/Button.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';

const failedText: Record<ImageProblem | 'other', Parameters<typeof t>[0]> = {
  type: 'images.failedType',
  size: 'images.failedSize',
  name: 'images.failedName',
  invalid: 'images.failedInvalid',
  other: 'images.failedOther',
};

/** A library picture's thumbnail, from this device's own copy; "Hämtas..." until it has arrived. */
export function ImageThumb({ image }: { image: Pick<LibraryImage, 'thumbHash' | 'fileName'> }) {
  const url = useBlobUrl(image.thumbHash);
  return (
    <div className="frame">
      {url ? <img src={url} alt={image.fileName} draggable={false} /> : <span className="muted small">{t('images.fetching')}</span>}
    </div>
  );
}

/**
 * Bilder (spec 05 `/admin/images`): the organisation's pictures. Each file is
 * fitted and re-encoded here (`media/process.ts`), kept on this device and
 * uploaded when the server can be reached (README, "Media"). No preview step,
 * no rename, no detail view (spec 05).
 */
export function Images({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const images = useData(listImages, []);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
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
    await db.mutate('trashImage', { id: image.id, at: Date.now() });
    toast(t('images.trashed', { name: image.fileName }));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFiles([...e.dataTransfer.files]);
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = images?.filter((i) => !q || i.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  return (
    <section
      className={dragging ? 'drop-zone dragging' : 'drop-zone'}
      onDragOver={(e) => {
        e.preventDefault();
        if (manage) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="row">
        <h1 className="grow">{t('images.title')}</h1>
        <a className="btn" href={href({ page: 'trash', kind: 'Image' })}>
          {t('images.trash')}
        </a>
        {manage && (
          <label className={progress ? 'btn btn-primary disabled' : 'btn btn-primary'}>
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
          </label>
        )}
      </div>
      {dragging && <p className="drop-hint">{t('images.drop')}</p>}
      {progress && (
        <p className="muted" role="status" data-testid="image-progress">
          {t('images.importing', progress)}
        </p>
      )}
      {!!failures.length && (
        <div className="danger" role="alert" data-testid="image-failures">
          <p>{t('images.failed', { n: failures.length })}</p>
          <ul>
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <h2>{t('images.all', { n: images?.length ?? 0 })}</h2>
        {!!images?.length && (
          <div className="row">
            <input
              className="search grow"
              type="search"
              maxLength={100}
              aria-label={t('images.search')}
              placeholder={t('images.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <Button aria-label={t('common.clear')} onClick={() => setQuery('')}>
                ×
              </Button>
            )}
          </div>
        )}
        {images && !images.length && (
          <div className="empty">
            <p>
              <strong>{t('images.empty')}</strong>
            </p>
            <p className="muted">{t('images.emptyText')}</p>
          </div>
        )}
        {!!images?.length && !shown.length && <p className="muted">{t('images.noMatch')}</p>}
        <ul className="image-grid" aria-label={t('images.title')} data-testid="image-grid">
          {shown.map((image) => (
            <li key={image.id} className="image-card" data-testid="image-card">
              <ImageThumb image={image} />
              <div className="name" title={image.fileName}>
                {image.fileName}
              </div>
              {manage && (
                <Button className="remove" aria-label={`${t('images.remove')} ${image.fileName}`} onClick={() => void remove(image)}>
                  ⋯
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
