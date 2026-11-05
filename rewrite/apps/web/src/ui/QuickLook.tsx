import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { VideoCodec, VideoType } from '@gp/core';
import { useBlobUrl, useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { canPlayVideo, codecName, playUrl } from '../media/video.ts';
import { AppButton } from './AppButton.tsx';
import { Dropdown } from './Dropdown.tsx';
import { useLookGestures } from './lookGestures.ts';
import { useSheetDrag } from './sheetDrag.ts';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, EllipsisIcon, SpeakerWaveIcon } from './icons.tsx';

// A library item looked at, as Quick Look on a Mac (Lars, 2026-11-04): the picture as large as the window lets it,
// a video or a sound that plays, the item's name and its ⋯ menu at the top, ← and → (and the arrows under it) to the
// one before and after, and Escape or ✕ to close it, nothing else. It fades in and grows into place, and out again.
// On a touch screen a swipe goes to the one before or after and a picture pinches and double-taps larger, as Photos
// (ui/lookGestures.ts).

export type QuickLookContent =
  | { kind: 'image'; full: string; thumb: string }
  | { kind: 'audio'; hash: string }
  | { kind: 'video'; hash: string; still: string; type: VideoType; codec: VideoCodec };

/** A blob of this device, fetched and kept as cache when it is not here yet; null until it is, or if it cannot be had. */
function useOpenedUrl(hash: string): string | null | undefined {
  const db = useDb();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    void db.openMedia(hash).then((m) => {
      if (!live) return;
      made = m ? URL.createObjectURL(new Blob([m.bytes as BlobPart], { type: m.contentType })) : null;
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [db, hash]);
  return url;
}

function Picture({ full, thumb, name }: { full: string; thumb: string; name: string }) {
  const opened = useOpenedUrl(full);
  const small = useBlobUrl(opened ? null : thumb);
  const url = opened ?? small;
  return url ? <img src={url} alt={name} draggable={false} className="max-w-full max-h-full object-contain rounded-lg" data-testid="quick-look-image" /> : <p className="text-stone-400">{t('images.fetching')}</p>;
}

function Sound({ hash, name }: { hash: string; name: string }) {
  const url = useOpenedUrl(hash);
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      <SpeakerWaveIcon className="size-24 text-stone-400" />
      {url ? (
        <audio src={url} controls autoPlay className="w-full" aria-label={name} data-testid="quick-look-audio" />
      ) : (
        <p className="text-stone-400">{url === null ? t('common.error') : t('presentation.audioFetching')}</p>
      )}
    </div>
  );
}

function Video({ hash, still, type, codec, name }: { hash: string; still: string; type: VideoType; codec: VideoCodec; name: string }) {
  const poster = useBlobUrl(still);
  const playable = canPlayVideo(type, codec);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!playable) return;
    let live = true;
    void playUrl(hash).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [hash, playable]);
  if (!playable)
    return (
      <div className="flex flex-col items-center gap-4 max-w-full max-h-full">
        {poster && <img src={poster} alt="" draggable={false} className="max-w-full max-h-[70svh] object-contain rounded-lg" />}
        <p className="text-sm text-amber-300 text-center">{t('videos.cannotPlay', { codec: codecName(codec) })}</p>
      </div>
    );
  return (
    <video
      className="max-w-full max-h-full rounded-lg bg-black"
      controls
      autoPlay
      playsInline
      poster={poster ?? undefined}
      src={src ?? undefined}
      aria-label={t('videos.preview', { name })}
      data-testid="quick-look-video"
    />
  );
}

const ROUND = 'size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-white bg-white/10 hover:bg-white/20';

/** The item `content` shows, over the whole window; `menu` holds its ⋯ choices. */
export function QuickLook({
  name,
  content,
  menu,
  onPrevious,
  onNext,
  onClose,
}: {
  name: string;
  content: QuickLookContent;
  menu?: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const room = useRef<HTMLDivElement>(null);
  /** A picture zoomed in moves under the finger: the sheet is not pulled down meanwhile. */
  const zoomed = useRef(false);
  useLookGestures(
    room,
    () => room.current?.querySelector<HTMLElement>('[data-testid="quick-look-image"]') ?? null,
    content.kind === 'image' ? content.full : content.hash,
    { previous: onPrevious, next: onNext },
    (z) => (zoomed.current = z),
  );
  /** Closed once it has gone (`.look-out`: faded on a computer, down on a phone, within 260 ms). */
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 260);
  };
  // On a phone a sheet, as Inställningar: pulled down, it goes, and the page under it shows as it does.
  useSheetDrag(
    sheet,
    bar,
    onClose,
    (progress, ms) => {
      const el = backdrop.current;
      if (!el) return;
      el.style.transition = ms ? `opacity ${ms}ms` : 'none';
      el.style.opacity = String(1 - progress);
    },
    () => matchMedia('(width < 40rem)').matches && !zoomed.current,
  );
  const key = useEffectEvent((e: KeyboardEvent) => {
    // Its ⋯ menu, open, takes its own keys, and so does what opens over it (the picture's editor); else these are the
    // look's, before the page under it hears them.
    if (box.current?.querySelector('[role="menu"]')) return;
    const dialogs = document.querySelectorAll('[aria-modal="true"]');
    if (dialogs[dialogs.length - 1] !== box.current) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && onPrevious) onPrevious();
    else if (e.key === 'ArrowRight' && onNext) onNext();
    else return;
    e.stopPropagation();
    e.preventDefault();
  });
  useEffect(() => {
    const listen = (e: KeyboardEvent) => key(e);
    document.addEventListener('keydown', listen, true);
    box.current?.focus();
    return () => document.removeEventListener('keydown', listen, true);
  }, []);

  return createPortal(
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className={`outline-none fixed inset-0 z-[140] ${closing ? 'look-out' : 'look-in'}`}
      data-testid="quick-look"
    >
      <div ref={backdrop} className="absolute inset-0 bg-black/40" />
      <div ref={sheet} className="look-sheet absolute inset-0 flex flex-col bg-black/95 backdrop-blur-md text-white pt-safe-top pb-safe-bottom">
      {/* Over the picture, which a zoom takes past its room. */}
      <div ref={bar} className="relative z-10 flex items-center gap-3 px-3 py-3">
        <AppButton variant="plain" className={ROUND} aria-label={t('common.close')} title={t('common.close')} onClick={close}>
          <CloseIcon className="size-5" />
        </AppButton>
        <h2 className="flex-1 min-w-0 truncate text-center font-semibold">{name}</h2>
        {menu ? (
          <Dropdown menuClassName="min-w-44 right-0" className="relative" button={{ className: ROUND, 'aria-label': t('images.more', { name }) }} trigger={<EllipsisIcon className="size-5" />}>
            {menu}
          </Dropdown>
        ) : (
          <span className="size-11" />
        )}
      </div>
      <div ref={room} className="look-item flex-1 min-h-0 flex items-center justify-center px-4 touch-none" data-testid="quick-look-room">
        {content.kind === 'image' && <Picture key={content.full} full={content.full} thumb={content.thumb} name={name} />}
        {content.kind === 'audio' && <Sound key={content.hash} hash={content.hash} name={name} />}
        {content.kind === 'video' && <Video key={content.hash} hash={content.hash} still={content.still} type={content.type} codec={content.codec} name={name} />}
      </div>
      {/* Under the item, never on it (Lars, 2026-11-04); greyed at either end, so they keep their places. */}
      <div className="relative z-10 flex items-center justify-center gap-6 py-4">
        {(onPrevious || onNext) && (
          <>
            <AppButton variant="plain" className={`${ROUND} disabled:opacity-30 disabled:cursor-default`} disabled={!onPrevious} aria-label={t('quickLook.previous')} onClick={onPrevious}>
              <ChevronLeftIcon className="size-5" />
            </AppButton>
            <AppButton variant="plain" className={`${ROUND} disabled:opacity-30 disabled:cursor-default`} disabled={!onNext} aria-label={t('quickLook.next')} onClick={onNext}>
              <ChevronRightIcon className="size-5" />
            </AppButton>
          </>
        )}
      </div>
      </div>
    </div>,
    document.body,
  );
}
