import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Overlay, PresentationItem, Theme } from '@gp/core';
import { useShownOverlay } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { useAudio, type AudioControl } from '../live/audio.ts';
import type { ItemSlides } from '../live/live.ts';
import type { LiveControl } from '../live/remote.ts';
import { useLivePointer } from '../live/useLive.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ChevronDownIcon, ChevronLeftIcon, CloseIcon, ItemIcon, SpeakerOutlineIcon, SquaresOverlapIcon } from '../ui/icons.tsx';
import { LiveBadge } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { OverlayToggles } from './OverlayToggles.tsx';

/**
 * Scenläge (spec 04 §3): a full-screen dark view for a worship leader or a
 * foot pedal. Next and previous stay within the selected item and stop at its
 * ends (LIVE-R41); picking an item puts its first part live. The bar's
 * Overlays button has a dot while one is on, and opens their toggles.
 */
export function StageView({
  items,
  slides,
  theme,
  overlays,
  live,
  audio,
  onLeave,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  overlays: Overlay[];
  live: LiveControl;
  audio: AudioControl;
  onLeave: () => void;
}) {
  const pointer = useLivePointer(live);
  const sound = useAudio(audio);
  const item = items.find((i) => i.id === pointer.itemId) ?? null;
  const parts = item ? (slides.get(item.id)?.slides ?? []) : [];
  const [picking, setPicking] = useState(!item && items.length > 0); // opens by itself with nothing selected
  const [overlaySheet, setOverlaySheet] = useState(false);
  const overlay = useShownOverlay(pointer.overlayId);
  const liveRef = useRef<HTMLLIElement>(null);

  // The screen stays awake while the view is open.
  useEffect(() => {
    let lock: { release(): Promise<void> } | undefined;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    void nav.wakeLock?.request('screen').then((l) => (lock = l), () => undefined);
    return () => void lock?.release();
  }, []);

  // Keeps the live tile centred; cheap, so it runs after every render rather than naming what it reads.
  useEffect(() => {
    liveRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  });

  const show = (itemId: string, partIndex: number) => live.set({ itemId, partIndex, black: false });
  const go = (delta: number) => {
    if (!item) return;
    const at = pointer.itemId === item.id ? pointer.partIndex : -1; // nothing of the item live: next is part 0
    const to = at === -1 ? (delta > 0 ? 0 : -1) : at + delta;
    if (to >= 0 && to < parts.length) show(item.id, to);
  };
  const pick = (i: PresentationItem) => {
    setPicking(false);
    if (slides.get(i.id)?.audio) {
      // An audio item in stage mode: the screen goes black and the sound plays (LIVE-R6, LIVE-A29).
      live.set({ black: true });
      audio.command({ action: 'play', itemId: i.id });
    } else if (slides.get(i.id)?.slides.length) show(i.id, 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picking || overlaySheet) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) go(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) go(-1);
      else if (e.key === 'Escape') onLeave();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true); // before the page's own shortcuts, which stage mode suppresses
    return () => removeEventListener('keydown', onKey, true);
  });

  const current = item && !pointer.black ? (parts[pointer.partIndex] ?? null) : null;
  const next = item && !pointer.black ? parts[pointer.partIndex + 1] : undefined;

  const caption = 'text-[10px] uppercase tracking-widest text-neutral-500 font-semibold';

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900 text-white flex flex-col select-none" role="dialog" aria-modal="true" aria-label={t('live.stage')} data-testid="stage-view">
      <div className="shrink-0 relative flex items-center gap-2 px-3 py-2 bg-neutral-950 border-b border-neutral-800">
        <AppButton
          variant="plain"
          onClick={onLeave}
          aria-label={t('stage.leave')}
          title={t('stage.leave')}
          className="cursor-pointer flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-neutral-800 text-sm shrink-0"
        >
          <ChevronLeftIcon className="size-5" />
          <span className="hidden sm:inline">{t('stage.leave')}</span>
        </AppButton>
        <AppButton
          variant="plain"
          aria-haspopup="dialog"
          onClick={() => setPicking(true)}
          className="cursor-pointer absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[60%] flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-neutral-800"
        >
          <span className="truncate text-base font-semibold">{item?.title ?? t('stage.choose')}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />
        </AppButton>
        {!!overlays.length && (
          <AppButton
            variant="plain"
            aria-haspopup="dialog"
            aria-label={t('overlays.title')}
            title={t('overlays.title')}
            onClick={() => setOverlaySheet(true)}
            className="cursor-pointer ml-auto relative flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg shrink-0 hover:bg-neutral-800 text-neutral-200 text-sm"
          >
            <SquaresOverlapIcon className="size-5" />
            <span className="hidden sm:inline">{t('overlays.title')}</span>
            {pointer.overlayId && <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-sky-500" data-testid="overlay-on" />}
          </AppButton>
        )}
      </div>
      {overlaySheet && (
        <Sheet title={t('overlays.title')} onClose={() => setOverlaySheet(false)}>
          <div className="p-3">
            <OverlayToggles overlays={overlays} pointer={pointer} live={live} stage />
          </div>
        </Sheet>
      )}
      {picking && (
        <Sheet title={t('stage.itemPicker')} onClose={() => setPicking(false)}>
          <div className="py-2">
            {!items.length && <p className="px-4 py-8 text-center text-neutral-500 text-sm">{t('stage.empty')}</p>}
            <ul>
              {items.map((i) => (
                <li key={i.id}>
                  <AppButton
                    variant="plain"
                    onClick={() => pick(i)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer ${i.id === item?.id ? 'bg-sky-600 text-white' : 'text-neutral-200 hover:bg-neutral-800'}`}
                  >
                    <ItemIcon type={i.type} className="size-4 shrink-0" />
                    <span className="truncate">{i.title}</span>
                  </AppButton>
                </li>
              ))}
            </ul>
          </div>
        </Sheet>
      )}
      <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-3 p-3 overflow-hidden">
        <section className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center gap-2">
          <div className="flex-1 min-h-0 w-full flex items-center justify-center [container-type:size]">
            <div className="flex flex-col gap-2 w-[min(100cqw,calc((100cqh-1.5rem)*16/9))]">
              <h2 className={caption}>{t('stage.nowShowing')}</h2>
              <div className="relative aspect-video rounded-lg shadow-2xl overflow-hidden">
                <SlideView slide={current} theme={theme} label={false} credits={false} overlay={pointer.black ? null : overlay} />
                {pointer.black && sound?.playing && (
                  <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 text-neutral-400 pointer-events-none">
                    <SpeakerOutlineIcon className="size-12 opacity-70" />
                    <p className="text-xs">{t('stage.audioPlaying')}</p>
                  </div>
                )}
                {current?.label && (
                  <span
                    className="absolute top-2 right-2 z-[3] text-xs font-semibold uppercase tracking-wide rounded-full px-3 py-1 pointer-events-none shadow-md text-white"
                    style={{ background: current.label.color }}
                  >
                    {current.label.text}
                  </span>
                )}
              </div>
            </div>
          </div>
          <AppButton
            variant="plain"
            className={`cursor-pointer flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium shrink-0 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 mt-1 ${pointer.black ? 'invisible' : ''}`}
            tabIndex={pointer.black ? -1 : 0}
            onClick={() => live.set({ black: true })}
          >
            <CloseIcon className="size-4" />
            <span>{t('stage.clear')}</span>
          </AppButton>
        </section>
        <section className="shrink-0 flex flex-col items-center sm:justify-center sm:w-2/5 lg:w-1/3">
          <h2 className={`${caption} mb-2 self-start`}>{t('stage.next')}</h2>
          {next ? (
            <AppButton
              variant="plain"
              className="block w-full aspect-video shrink-0 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-400 transition-all p-0"
              aria-label={t('stage.next')}
              onClick={() => go(1)}
            >
              <SlideView slide={next} theme={theme} label={false} credits={false} />
            </AppButton>
          ) : (
            <div className="w-full aspect-video flex items-center justify-center text-center px-4">
              <p className="text-sm text-neutral-500">{item ? t('stage.nextNone') : ''}</p>
            </div>
          )}
        </section>
      </div>
      {!!parts.length && (
        <div className="shrink-0 bg-neutral-950 border-t border-neutral-800 px-3 py-3 overflow-x-auto">
          <ol className="flex gap-2 items-center" aria-label={t('stage.strip')}>
            {parts.map((slide, i) => {
              const isLive = !pointer.black && i === pointer.partIndex;
              return (
                <li key={slide.key} ref={isLive ? liveRef : undefined} className="relative shrink-0">
                  <AppButton
                    variant="plain"
                    aria-label={`${item!.title} ${i + 1}`}
                    aria-pressed={isLive}
                    onClick={() => show(item!.id, i)}
                    className={`block w-48 cursor-pointer rounded-md transition-opacity p-0.5 outline-3 ${isLive ? 'outline-red-500' : 'outline-transparent opacity-70 hover:opacity-100'}`}
                  >
                    <span className="block aspect-video rounded overflow-hidden">
                      <SlideView slide={slide} theme={theme} label={false} credits={false} />
                    </span>
                  </AppButton>
                  {isLive && (
                    <LiveBadge small>
                      {t('stage.live')}
                    </LiveBadge>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** A sheet over the stage view, from the bottom on a phone and centred above it (StageView.razor's drawers). */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full sm:max-w-lg bg-neutral-900 text-white rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col shadow-2xl" role="dialog" aria-label={title}>
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h2 className="text-base/6 font-semibold">{title}</h2>
          <AppButton variant="plain" onClick={onClose} aria-label={t('common.close')} className="cursor-pointer p-2 rounded-full hover:bg-neutral-800">
            <CloseIcon className="size-5" />
          </AppButton>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
