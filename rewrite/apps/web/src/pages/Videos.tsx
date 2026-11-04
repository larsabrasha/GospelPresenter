import { useMemo } from 'react';
import { can, MEDIA_LIMITS, type LibraryVideo, type Role } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listVideos } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { playUrl, useVideoImport, VIDEO_ACCEPT } from '../media/video.ts';
import { formatBytes } from '../ui/formatBytes.ts';
import { VideoIcon } from '../ui/icons.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { Library } from '../ui/Library.tsx';
import { useToast } from '../ui/Toast.tsx';
import { ImportNotices, named, trashTexts } from './Images.tsx';
import { formatDuration } from './VideoTab.tsx';

/** A video's still in the grid, as Photos shows one: its length at the bottom right, its size and codec as a tooltip. */
function Still({ video }: { video: LibraryVideo }) {
  const url = useBlobUrl(video.thumbHash);
  return (
    <span
      className="relative block w-full aspect-video rounded-lg bg-stone-200 dark:bg-raised overflow-hidden"
      title={[formatDuration(video.duration), formatBytes(video.size), video.codec === 'hevc' ? 'HEVC' : 'H.264'].join(' · ')}
    >
      {url ? <img src={url} alt={video.fileName} className="absolute inset-0 size-full object-cover" draggable={false} /> : <VideoIcon className="absolute inset-0 m-auto size-6 text-stone-400" />}
      <span className="absolute bottom-1 right-1.5 text-xs font-semibold text-white tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">{formatDuration(video.duration)}</span>
    </span>
  );
}

/**
 * Videor (`/admin/videos`): the organisation's videos, as Photos' grid (ui/Library.tsx), imported here or in Lägg
 * till's Video tab. No playback here; a video plays where a presentation uses it.
 */
export function Videos({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const videos = useData(listVideos, []);
  const items = useMemo(() => named(videos), [videos]);
  const imports = useVideoImport();
  const manage = can(role, 'ManageVideos');
  const status = imports.state;

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await imports.run(files);
    if (added.length && added.length === files.length) toast(t('videos.imported', { n: added.length }));
  };

  const progress =
    status &&
    (status.phase === 'waiting'
      ? t('videos.waiting', { percent: status.percent })
      : t(status.phase === 'reading' ? 'videos.reading' : 'videos.uploading', { name: status.name, percent: status.percent }));

  return (
    <Library
      title={t('videos.page')}
      items={items}
      layout="grid"
      renderTile={(v) => <Still video={v} />}
      preview={(v) => ({ kind: 'video', hash: v.hash, still: v.stillHash, type: v.contentType, codec: v.codec })}
      manage={manage}
      download={{
        zipName: t('videos.page'),
        // Streamed from the server, as a video is not kept here (TODO.md "Video").
        file: async (v) => {
          const url = await playUrl(v.hash);
          const res = url ? await fetch(url) : null;
          return res?.ok ? { name: v.fileName, data: new Uint8Array(await res.arrayBuffer()), type: v.contentType } : null;
        },
      }}
      rename={{ title: t('library.renameTitle'), label: t('library.fileName'), maxLength: MEDIA_LIMITS.fileName, run: (v, fileName) => db.mutate('renameVideo', { id: v.id, fileName }) }}
      remove={{ ...trashTexts('videos.trashed'), run: (v) => db.mutate('trashVideo', { id: v.id, at: Date.now() }) }}
      add={manage && <ImportFilesButton round accept={VIDEO_ACCEPT} busy={imports.busy} testId="video-file" onFiles={(files) => void importFiles(files)} />}
      notices={<ImportNotices progress={progress} failures={imports.failures} failed={t('videos.failed', { n: imports.failures.length })} testId="video" />}
      loading={t('videos.loading')}
      empty={{ icon: <VideoIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('presentation.noVideos') }}
      noMatch={t('videos.noMatch')}
      count={(n) => t(n === 1 ? 'videos.count.one' : 'videos.count.many', { n })}
      drop={{ label: t('videos.drop'), accept: VIDEO_ACCEPT, onFiles: (files) => void importFiles(files) }}
      testId="video"
    />
  );
}
