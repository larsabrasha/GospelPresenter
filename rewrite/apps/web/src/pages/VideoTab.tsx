import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LibraryVideo } from '@gp/core';
import { useBlobUrl, useData, useDb } from '../db/react.tsx';
import { listVideos } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { useVideoImport, VIDEO_ACCEPT } from '../media/video.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { Dropdown, MENU_ITEM_DANGER } from '../ui/Dropdown.tsx';
import { ArrowDownTrayIcon, CheckIcon, EllipsisIcon, TrashIcon, VideoIcon } from '../ui/icons.tsx';
import { useRovingList } from '../ui/listNav.ts';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../ui/Picker.tsx';
import { ctrlLabel } from '../ui/shortcuts.ts';
import { useToast } from '../ui/Toast.tsx';

/** When a video goes to the trash: this device's clock. */
const trashedAt = () => Date.now();

/** A length as m:ss, or h:mm:ss for an hour or more. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** A video's still, small: its thumbnail, kept on every device as a picture's is. */
function VideoThumb({ video }: { video: LibraryVideo }) {
  const url = useBlobUrl(video.thumbHash);
  return (
    <span className="relative w-20 aspect-video shrink-0 rounded bg-neutral-200 dark:bg-neutral-700 overflow-hidden flex items-center justify-center">
      {url ? <img src={url} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : <VideoIcon className="size-5 text-neutral-400" />}
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

  const remove = async (v: LibraryVideo) => {
    if (!(await trySave(db.mutate('trashVideo', { id: v.id, at: trashedAt() })))) return;
    setPicked((p) => p.filter((x) => x !== v.id));
    toast(t('videos.trashed', { name: v.fileName }));
  };

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
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="shrink-0 flex flex-wrap items-center gap-3 pb-4">
          <AppButton variant="secondary" asLabel disabled={imports.busy} className="inline-flex items-center gap-1.5">
            <ArrowDownTrayIcon className="size-4 shrink-0" />
            {t('images.import')}
            <input
              type="file"
              accept={VIDEO_ACCEPT}
              multiple
              hidden
              disabled={imports.busy}
              data-testid="video-tab-file"
              onChange={(e) => {
                void imports.run([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </AppButton>
          <DropHint text={t('images.dropAffordance')} />
          {!!imports.failures.length && (
            <span className="text-red-500 dark:text-red-400 text-sm" role="alert" title={imports.failures.join('\n')} data-testid="video-import-failures">
              {imports.failures.length === 1 ? imports.failures[0] : t('videos.failed', { n: imports.failures.length })}
            </span>
          )}
          {status && (
            <span className="text-neutral-400 text-sm" data-testid="video-import-progress">
              {status.phase === 'waiting'
                ? t('videos.waiting', { percent: status.percent })
                : t(status.phase === 'reading' ? 'videos.reading' : 'videos.uploading', { name: status.name, percent: status.percent })}
            </span>
          )}
          <SearchField inputRef={search} label={t('presentation.searchImages')} value={query} onChange={setQuery} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!videos && <p className="flex items-center justify-center py-12 text-neutral-400 text-sm">{t('videos.loading')}</p>}
          {videos && !videos.length && (
            <EmptyTab icon={<VideoIcon className="size-12 text-neutral-300 dark:text-neutral-600" />}>
              <p>{t('presentation.noVideos')}</p>
              <p className="text-xs mt-1">{t('videos.resumeHint')}</p>
            </EmptyTab>
          )}
          <ul className="flex flex-col gap-1 p-3" aria-label={t('videos.title')} onKeyDown={list.onKeyDown}>
            {shown.map((v, i) => {
              const isPicked = picked.includes(v.id);
              return (
                <li
                  key={v.id}
                  {...list.item(i)}
                  role="button"
                  aria-pressed={isPicked}
                  aria-label={v.fileName}
                  onClick={() => toggle(v.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey) return;
                    e.preventDefault();
                    toggle(v.id);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ring-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    isPicked ? 'ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'ring-transparent hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }`}
                >
                  {isPicked ? (
                    <span className="size-5 flex items-center justify-center rounded-full bg-sky-500 text-white shrink-0">
                      <CheckIcon className="size-4" />
                    </span>
                  ) : (
                    <VideoIcon className="size-5 text-neutral-400 shrink-0" />
                  )}
                  <VideoThumb video={v} />
                  <span className="text-sm truncate flex-1">{v.fileName}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0">{formatDuration(v.duration)}</span>
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Dropdown
                      menuClassName="min-w-36"
                      button={{
                        className: 'size-7 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer',
                        'aria-label': t('images.more', { name: v.fileName }),
                      }}
                      trigger={<EllipsisIcon className="size-4" />}
                    >
                      <AppButton variant="plain" role="menuitem" className={MENU_ITEM_DANGER} onClick={() => void remove(v)}>
                        <TrashIcon className="size-4" />
                        {t('images.remove')}
                      </AppButton>
                    </Dropdown>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <AddFooter
          hint={t('presentation.addHint', { key: ctrlLabel('Enter') })}
          name={chosen.length ? names : undefined}
          label={chosen.length ? t('presentation.addImage', { name: names }) : undefined}
          onAdd={chosen.length ? () => void add() : undefined}
        />
      </div>
    </DropZone>
  );
}
