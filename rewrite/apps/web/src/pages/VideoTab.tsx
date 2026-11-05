import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LibraryVideo } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listVideos } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { useVideoImport, VIDEO_ACCEPT } from '../media/video.ts';
import { useTrySave } from '../ui/AutoSave.tsx';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { DropZone } from '../ui/DropZone.tsx';
import { VideoIcon } from '../ui/icons.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { AddFooter, DeselectAll, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../ui/Picker.tsx';
import { useToast } from '../ui/Toast.tsx';
import { PickableFileRow } from './PickableFileRow.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { useView, VIEW_LIST, ViewPicker } from '../ui/ViewPicker.tsx';

/** When a video goes to the trash: this device's clock. */
const trashedAt = () => Date.now();

/** A length as m:ss, or h:mm:ss for an hour or more. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** A video's still: its thumbnail, kept on every device as a picture's is; small in a row, or a tile's (`tile`) with its length. */
function VideoThumb({ video, tile }: { video: LibraryVideo; tile?: boolean }) {
  const url = useBlobUrl(video.thumbHash);
  return (
    <span className={`relative ${tile ? 'w-full rounded-lg' : 'w-20 rounded'} aspect-video shrink-0 bg-stone-200 dark:bg-raised overflow-hidden flex items-center justify-center`}>
      {url ? <img src={url} alt="" className={`absolute inset-0 size-full ${tile ? 'object-cover' : 'object-contain'}`} draggable={false} /> : <VideoIcon className="size-5 text-stone-400" />}
      {tile && <span className="absolute bottom-1 right-1.5 text-xs font-semibold text-white tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">{formatDuration(video.duration)}</span>}
    </span>
  );
}

/**
 * The add-item modal's video tab (TODO.md "Video"), as the Ljud tab: a click, Enter or Space picks
 * or unpicks a video; "Lägg till" puts each picked one in as an item of its own. Importera and a drop
 * upload new videos to the library first, which needs the server: a video is never kept on a device.
 */
export function VideoTab({ presentationId, afterItemId, onAdded, active }: { presentationId: string; afterItemId: string | null; onAdded: (itemId: string) => void; active: boolean }) {
  const db = useDb();
  const trySave = useTrySave();
  // A list, a grid or large, as in Videor (ui/ViewPicker.tsx), this device's choice.
  const [view, setView] = useView('videoPicker:view', 'list');
  const { dialog, ask } = useConfirm();
  const toast = useToast();
  const videos = useData(listVideos, []);
  const imports = useVideoImport();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useFocusWhenShown(search, active);
  const [picked, setPicked] = useState<string[]>([]);
  const adding = useRef(false);
  const q = query.trim().toLocaleLowerCase('sv');
  const shown = videos?.filter((v) => !q || v.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];
  const chosen = (videos ?? []).filter((v) => picked.includes(v.id)).toSorted((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id));
  const list = useRovingList(shown.length);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const add = async () => {
    if (!chosen.length || adding.current) return;
    adding.current = true;
    try {
      // Each after the one before, so they keep the order they were picked in.
      let after = afterItemId;
      for (const v of chosen) {
        const itemId = newId();
        if (!(await trySave(db.mutate('addVideoToPresentation', { itemId, presentationId, videoId: v.id, afterItemId: after })))) return;
        after = itemId;
        onAdded(itemId);
      }
      toast(t('presentation.videoAdded', { name: chosen.map((v) => v.fileName).join(', ') }));
      setPicked([]);
    } finally {
      adding.current = false;
    }
  };

  // To the trash after a question, as every deletion asks (Lars, 2026-11-03).
  const remove = (v: LibraryVideo) =>
    ask(
      deleteAsk(t('images.trashConfirm', { name: v.fileName }), v.fileName, async () => {
        if (!(await trySave(db.mutate('trashVideo', { id: v.id, at: trashedAt() })))) return;
        setPicked((p) => p.filter((x) => x !== v.id));
        toast(t('videos.trashed', { name: v.fileName }));
      }),
    );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isAddKey(e)) {
      e.preventDefault();
      void add();
    }
  };
  const names = chosen.map((v) => v.fileName).join(', ');
  const status = imports.state;

  return (
    <DropZone className="flex-1 min-h-0 flex flex-col" label={t('videos.drop')} accept={VIDEO_ACCEPT} onFiles={(files) => void imports.run(files)}>
      {dialog}
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="shrink-0 flex flex-wrap items-center gap-3 pb-4">
          {!!imports.failures.length && (
            <span className="text-red-500 dark:text-red-400 text-sm" role="alert" title={imports.failures.join('\n')} data-testid="video-import-failures">
              {imports.failures.length === 1 ? imports.failures[0] : t('videos.failed', { n: imports.failures.length })}
            </span>
          )}
          {status && (
            <span className="text-stone-400 text-sm" data-testid="video-import-progress">
              {status.phase === 'waiting'
                ? t('videos.waiting', { percent: status.percent })
                : t(status.phase === 'reading' ? 'videos.reading' : 'videos.uploading', { name: status.name, percent: status.percent })}
            </span>
          )}
          <SearchField className="max-sm:basis-full" inputRef={search} label={t('presentation.searchImages')} value={query} onChange={setQuery} />
          <ViewPicker value={view} onChange={setView} />
          <ImportFilesButton secondary short accept={VIDEO_ACCEPT} busy={imports.busy} testId="video-tab-file" onFiles={(files) => void imports.run(files)} />
          <DeselectAll count={picked.length} onClear={() => setPicked([])} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!videos && <p className="loading-line flex items-center justify-center py-12 text-stone-400 text-sm">{t('videos.loading')}</p>}
          {videos && !videos.length && (
            <EmptyTab icon={<VideoIcon className="size-12 text-stone-300 dark:text-stone-600" />}>
              <p>{t('presentation.noVideos')}</p>
              <p className="text-xs mt-1">{t('videos.resumeHint')}</p>
            </EmptyTab>
          )}
          <ul className={view === 'list' ? 'flex flex-col gap-1 p-3' : VIEW_LIST[view]} aria-label={t('videos.title')} onKeyDown={list.onKeyDown}>
            {shown.map((v, i) => (
              <PickableFileRow key={v.id} nav={list.item(i)} picked={picked.includes(v.id)} name={v.fileName} icon={<VideoIcon className="size-5 text-stone-400 shrink-0" />} onToggle={() => toggle(v.id)} onRemove={() => void remove(v)} tile={view !== 'list'}>
                <VideoThumb video={v} tile={view !== 'list'} />
                <span className={view === 'list' ? 'text-sm truncate flex-1' : 'text-xs text-center text-stone-500 dark:text-stone-400 truncate'}>{v.fileName}</span>
                {view === 'list' && <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums shrink-0">{formatDuration(v.duration)}</span>}
              </PickableFileRow>
            ))}
          </ul>
        </div>
        <AddFooter
          name={chosen.length ? names : undefined}
          label={chosen.length ? t('presentation.addImage', { name: names }) : undefined}
          onAdd={chosen.length ? () => void add() : undefined}
        />
      </div>
    </DropZone>
  );
}
