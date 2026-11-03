import { useState } from 'react';
import { can, type LibraryVideo, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listVideos } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { useVideoImport, VIDEO_ACCEPT } from '../media/video.ts';
import { useTrySave } from '../ui/AutoSave.tsx';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { DropMore, DropZone } from '../ui/DropZone.tsx';
import { CardNote, EmptySmall } from '../ui/Empty.tsx';
import { VideoIcon } from '../ui/icons.tsx';
import { ROW_HOVER, CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { useToast } from '../ui/Toast.tsx';
import { formatBytes } from '../ui/formatBytes.ts';
import { formatDuration } from './VideoTab.tsx';
import { RemoveMenu } from '../ui/RemoveMenu.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

/** When a video goes to the trash: this device's clock, as for songs and presentations. */
const trashedAt = () => Date.now();

function Thumb({ video }: { video: LibraryVideo }) {
  const url = useBlobUrl(video.thumbHash);
  return (
    <span className="relative w-16 aspect-video shrink-0 rounded bg-stone-200 dark:bg-raised overflow-hidden flex items-center justify-center">
      {url ? <img src={url} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : <VideoIcon className="size-4 text-stone-400" />}
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
  const { dialog, ask } = useConfirm();
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

  // To the trash after a question, as every deletion asks (Lars, 2026-11-03).
  const remove = (v: LibraryVideo) =>
    ask(
      deleteAsk(t('images.trashConfirm', { name: v.fileName }), v.fileName, async () => {
        if (!(await trySave(db.mutate('trashVideo', { id: v.id, at: trashedAt() })))) return;
        toast(t('videos.trashed', { name: v.fileName }));
      }),
    );

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = videos?.filter((v) => !q || v.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const status = imports.state;

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5" label={t('videos.drop')} accept={VIDEO_ACCEPT} enabled={manage} onFiles={(files) => void importFiles(files)}>
        {dialog}
        <PageHeader title={t('videos.page')}>
          <div className="flex items-center gap-3">
            {manage && (
              <ImportFilesButton round accept={VIDEO_ACCEPT} busy={imports.busy} testId="video-file" onFiles={(files) => void importFiles(files)} />
            )}
          </div>
        </PageHeader>
        {status && (
          <p className="px-5 text-sm text-stone-500 dark:text-stone-400" role="status">
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
        {/* Under the title, as Sånger's (Lars, 2026-11-03: the pages alike, no box in a box). */}
        {!!videos?.length && <SearchField compact filled value={query} onChange={setQuery} label={t('images.search')} placeholder={t('images.searchPlaceholder')} />}
        {/* Not clipped, so a ⋯ menu can reach past the card's edge. */}
        <div className={CARD.replace(' overflow-hidden', '')}>
          {!videos && <div className="loading-line px-5 py-4 text-stone-400 text-sm">{t('videos.loading')}</div>}
          {videos && !videos.length && <EmptySmall icon={<VideoIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('presentation.noVideos')} dropHint={manage ? t('drop.here') : undefined} />}
          {!!videos?.length && !shown.length && <CardNote>{t('videos.noMatch')}</CardNote>}
          <ul aria-label={t('videos.page')}>
            {shown.map((v) => (
              <li
                key={v.id}
                className={`flex items-center gap-3 px-5 py-3 border-b border-separator last:border-b-0 last:rounded-b-xl ${ROW_HOVER}`}
                aria-label={v.fileName}
              >
                <Thumb video={v} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{v.fileName}</span>
                  <span className="block text-xs text-stone-500 dark:text-stone-400 tabular-nums">
                    {[formatDuration(v.duration), formatBytes(v.size), v.codec === 'hevc' ? 'HEVC' : 'H.264'].join(' · ')}
                  </span>
                </span>
                {manage && (
                  <RemoveMenu name={v.fileName} onRemove={() => void remove(v)} />
                )}
              </li>
            ))}
          </ul>
        </div>
        {!!shown.length && <p className="text-center text-sm text-stone-500 dark:text-stone-400">{t(shown.length === 1 ? 'videos.count.one' : 'videos.count.many', { n: shown.length })}</p>}
        {manage && !!videos?.length && <DropMore />}
      </DropZone>
    </PageContainer>
  );
}
