import { useState } from 'react';
import { can, type LibraryVideo, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listVideos } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { useVideoImport, VIDEO_ACCEPT } from '../media/video.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { CardNote, EmptySmall } from '../ui/Empty.tsx';
import { TrashIcon, VideoIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { formatBytes } from './Storage.tsx';
import { formatDuration } from './VideoTab.tsx';
import { RemoveMenu } from '../ui/RemoveMenu.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

/** When a video goes to the trash: this device's clock, as for songs and presentations. */
const trashedAt = () => Date.now();

function Thumb({ video }: { video: LibraryVideo }) {
  const url = useBlobUrl(video.thumbHash);
  return (
    <span className="relative w-16 aspect-video shrink-0 rounded bg-neutral-200 dark:bg-raised overflow-hidden flex items-center justify-center">
      {url ? <img src={url} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : <VideoIcon className="size-4 text-neutral-400" />}
    </span>
  );
}

/**
 * Videor (`/admin/videos`, as Ljud): the organisation's videos, as a list with their stills, lengths and
 * sizes, imported here or in Lägg till's Video tab, and trashed from the ⋯ menu. No playback here; a video
 * plays where a presentation uses it.
 */
export function Videos({ role }: { role: Role }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const videos = useData(listVideos, []);
  const [query, setQuery] = useState('');
  const imports = useVideoImport();
  const manage = can(role, 'ManageVideos');

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await imports.run(files);
    if (added.length && added.length === files.length) toast(t('videos.imported', { n: added.length }));
  };

  const remove = async (v: LibraryVideo) => {
    if (!(await trySave(db.mutate('trashVideo', { id: v.id, at: trashedAt() })))) return;
    toast(t('videos.trashed', { name: v.fileName }));
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = videos?.filter((v) => !q || v.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const status = imports.state;

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5" label={t('videos.drop')} accept={VIDEO_ACCEPT} enabled={manage} onFiles={(files) => void importFiles(files)}>
        <PageHeader title={t('videos.page')}>
          <div className="flex items-center gap-3">
            {manage && <DropHint text={t('images.dropAffordance')} />}
            <AppButton variant="neutral" href={href({ page: 'trash', kind: 'Video' })} className="inline-flex items-center gap-1.5">
              <TrashIcon className="size-4" />
              {t('images.trash')}
            </AppButton>
            {manage && (
              <ImportFilesButton round accept={VIDEO_ACCEPT} busy={imports.busy} testId="video-file" onFiles={(files) => void importFiles(files)} />
            )}
          </div>
        </PageHeader>
        {status && (
          <p className="px-5 text-sm text-neutral-500 dark:text-neutral-400" role="status">
            {status.phase === 'waiting'
              ? t('videos.waiting', { percent: status.percent })
              : t(status.phase === 'reading' ? 'videos.reading' : 'videos.uploading', { name: status.name, percent: status.percent })}
          </p>
        )}
        {!!imports.failures.length && (
          <div className="px-5 text-sm text-red-500 dark:text-red-400" role="alert" data-testid="video-failures">
            <p>{t('videos.failed', { n: imports.failures.length })}</p>
            <ul className="list-disc pl-5">
              {imports.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {/* Not clipped, so a ⋯ menu can reach past the card's edge. */}
        <div className={CARD.replace(' overflow-hidden', '')}>
          <div className="px-5 pt-4 pb-2 space-y-3">
            <h2 className="text-base/6 font-semibold">{t('videos.all', { n: videos?.length ?? 0 })}</h2>
            {!!videos?.length && <SearchField value={query} onChange={setQuery} label={t('images.search')} placeholder={t('images.searchPlaceholder')} compact />}
          </div>
          {!videos && <div className="px-5 py-4 text-neutral-400 text-sm">{t('videos.loading')}</div>}
          {videos && !videos.length && <EmptySmall icon={<VideoIcon className="size-12 mb-3 text-neutral-300 dark:text-neutral-600" />} title={t('presentation.noVideos')} text={t('videos.emptyText')} />}
          {!!videos?.length && !shown.length && <CardNote>{t('videos.noMatch')}</CardNote>}
          <ul aria-label={t('videos.page')}>
            {shown.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-3 px-5 py-3 border-b border-separator last:border-b-0 last:rounded-b-xl hover:bg-neutral-100 dark:hover:bg-raised/50"
                aria-label={v.fileName}
              >
                <Thumb video={v} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{v.fileName}</span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                    {[formatDuration(v.duration), formatBytes(v.size), v.codec === 'hevc' ? 'HEVC' : 'H.264'].join(' · ')}
                  </span>
                </span>
                {manage && (
                  <RemoveMenu name={v.fileName} on="row" onRemove={() => void remove(v)} />
                )}
              </li>
            ))}
          </ul>
        </div>
      </DropZone>
    </PageContainer>
  );
}
