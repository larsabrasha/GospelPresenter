import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Overlay, PresentationItem, Theme } from '@gp/core';
import { useShownOverlay } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { useAudio, type AudioControl } from '../live/audio.ts';
import type { VideoControl } from '../live/video.ts';
import { VideoPlayer } from './live/VideoPlayer.tsx';
import type { ItemSlides } from '../live/live.ts';
import type { LiveControl } from '../live/remote.ts';
import { useLivePointer } from '../live/useLive.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ChevronDownIcon, ChevronLeftIcon, CloseIcon, ItemIcon, SpeakerOutlineIcon, SquaresOverlapIcon } from '../ui/icons.tsx';
import { LiveBadge } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { AudioPlayer } from './live/AudioPlayer.tsx';
import { OverlayToggles } from './OverlayToggles.tsx';
import { stageKey } from './stageKeys.ts';
import { helpOpen, useShortcutGroup, type ShortcutGroup } from '../ui/ShortcutHelp.tsx';

/*
 * The sizes of StageView.razor's ComputeScales, from the window: 240 px of its height and 48 px of its width are the
 * bars, strip and gaps. Side by side (from 640 px) the current slide takes 58 % of the width, the next 36 %; stacked on a
 * phone, 62 % and 30 % of the height. At most 0.9 and 0.5 of the 1920 px canvas. The strip's tiles are 110 px high.
 */
const CURRENT_WIDTH = 'w-[min(100vw_-_48px,(100dvh_-_240px)_*_0.62_*_16_/_9,1728px)] sm:w-[min((100vw_-_48px)_*_0.58,(100dvh_-_240px)_*_16_/_9,1728px)]';
const NEXT_WIDTH = 'w-[min((100vw_-_48px)_*_0.85,(100dvh_-_240px)_*_0.3_*_16_/_9,960px)] sm:w-[min((100vw_-_48px)_*_0.36,(100dvh_-_240px)_*_0.85_*_16_/_9,960px)]';

/**
 * Scenläge (spec 04 §3): a full-screen dark view for a worship leader or a
 * foot pedal. Next and previous stay within the selected item and stop at its
 * ends (LIVE-R41); picking an item puts its first part live. The bar's
 * Overlays button has a dot while one is on, and opens their toggles.
 */
/** The stage view's keys in the help dialog (stageKeys.ts); the live page's are off while it is open. */
const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.stage'),
  blocks: true,
  lines: [
    { keys: ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'], text: t('shortcuts.nextSlide') },
    { keys: ['ArrowLeft', 'ArrowUp', 'PageUp'], text: t('shortcuts.previousSlide') },
    { keys: ['.', 'B'], text: t('shortcuts.black') },
    { keys: ['Escape'], text: t('shortcuts.leaveStage') },
  ],
};

export function StageView({
  items,
  slides,
  theme,
  overlays,
  live,
  audio,
  video,
  onLeave,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  overlays: Overlay[];
  live: LiveControl;
  audio: AudioControl;
  video?: VideoControl;
  onLeave: () => void;
}) {
  useShortcutGroup(KEYS);
  const pointer = useLivePointer(live);
  const sound = useAudio(audio);
  const item = items.find((i) => i.id === pointer.itemId) ?? null;
  const parts = item ? (slides.get(item.id)?.slides ?? []) : [];
  const [picking, setPicking] = useState(!item && items.length > 0); // opens by itself with nothing selected
  const [overlaySheet, setOverlaySheet] = useState(false);
  const overlay = useShownOverlay(pointer.overlayId);
  const liveRef = useRef<HTMLLIElement>(null);

  // The screen stays awake while the view is open, and takes the lock again when it shows (utils.js).
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (document.visibilityState === 'visible') void navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, []);

  // Keeps the live tile centred, scrolling smoothly; cheap, so it runs after every render rather than naming what it reads.
  useEffect(() => {
    liveRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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
      // An audio item in stage mode: it becomes the item, the screen goes black and the sound plays (LIVE-R6, LIVE-A29).
      live.set({ itemId: i.id, partIndex: 0, black: true });
      audio.command({ action: 'play', itemId: i.id });
    } else show(i.id, 0); // an item without slides goes live too, at its first place (Presentation.razor)
  };

  // Whether Tab, rather than a click or tap, last moved focus: only then do Enter and Space press the focused button.
  const tabbed = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (helpOpen()) return; // the keyboard help is open above the stage: its keys are its own
      if (e.key === 'Tab') tabbed.current = true;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const target = el && { tagName: el.tagName, isContentEditable: el.isContentEditable, role: el.getAttribute('role'), tabbedTo: tabbed.current };
      const action = stageKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target });
      if (action === 'escape') {
        if (overlaySheet) setOverlaySheet(false);
        else if (picking) setPicking(false);
        else onLeave();
      } else if (!action) return;
      else if (action === 'next') go(1);
      else if (action === 'previous') go(-1);
      else live.set({ black: true }); // as Rensa: only blanks
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointer = () => (tabbed.current = false);
    addEventListener('keydown', onKey, true); // before the page's own shortcuts, which stage mode suppresses
    addEventListener('pointerdown', onPointer, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      removeEventListener('pointerdown', onPointer, true);
    };
  });

  const current = item && !pointer.black ? (parts[pointer.partIndex] ?? null) : null;
  // Nästa shows the slide after the live part, also while the screen is black (StageView.razor).
  const next = item ? parts[pointer.partIndex + 1] : undefined;
  const audioItem = item && slides.get(item.id)?.audio;
  const videoItem = item && slides.get(item.id)?.video;

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
          title={t('stage.switch')}
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
            aria-label={t('stage.toggleOverlays')}
            title={t('stage.toggleOverlays')}
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
        <section className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <h2 className={`${caption} self-start`}>{t('stage.nowShowing')}</h2>
            <div className={`relative aspect-video rounded-lg shadow-2xl overflow-hidden ${CURRENT_WIDTH}`} data-testid="stage-current">
              <SlideView slide={current} theme={theme} label={false} credits={false} overlay={pointer.black ? null : overlay} />
              {/* An audio item: its icon and its player, so it is played, paused and faded from here. */}
              {audioItem && item ? (
                <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-3 p-4 text-neutral-400">
                  <SpeakerOutlineIcon className="size-12 opacity-70" />
                  {sound?.playing && sound.itemId === item.id && <p className="text-xs">{t('stage.audioPlaying')}</p>}
                  <AudioPlayer control={audio} itemId={item.id} name={audioItem.fileName} />
                </div>
              ) : (
                pointer.black &&
                sound?.playing && (
                  <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 text-neutral-400 pointer-events-none">
                    <SpeakerOutlineIcon className="size-12 opacity-70" />
                    <p className="text-xs">{t('stage.audioPlaying')}</p>
                  </div>
                )
              )}
              {current?.label && (
                <span
                  className="absolute top-2 right-2 z-[3] text-xs font-semibold uppercase tracking-wide rounded-full px-3 py-1 pointer-events-none shadow-md text-white"
                  style={{ background: current.label.color }}
                  data-testid="stage-current-label"
                >
                  {current.label.text}
                </span>
              )}
            </div>
            {/* A video item: its player, so it is paused and moved in from here; its sound plays on this computer. */}
            {videoItem && item && video && <VideoPlayer control={video} itemId={item.id} name={videoItem.fileName} type={videoItem.contentType} codec={videoItem.codec} />}
            <AppButton
              variant="plain"
              className={`cursor-pointer flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium shrink-0 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 mt-1 ${pointer.black ? 'invisible' : ''}`}
              tabIndex={pointer.black ? -1 : 0}
              title={t('stage.clear')}
              onClick={() => live.set({ black: true })}
            >
              <CloseIcon className="size-4" />
              <span>{t('stage.clear')}</span>
            </AppButton>
          </div>
        </section>
        <section className="shrink-0 flex flex-col items-center sm:justify-center sm:w-2/5 lg:w-1/3">
          <h2 className={`${caption} mb-2 self-start`}>{t('stage.next')}</h2>
          {next ? (
            <AppButton
              variant="plain"
              className={`block aspect-video shrink-0 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-400 transition-all p-0 ${NEXT_WIDTH}`}
              aria-label={t('stage.next')}
              onClick={() => go(1)}
            >
              <SlideView slide={next} theme={theme} credits={false} />
            </AppButton>
          ) : (
            // Nothing after it: an empty box (StageView.razor).
            <div className={`aspect-video shrink-0 ${NEXT_WIDTH}`} />
          )}
        </section>
      </div>
      {!!parts.length && (
        <div className="shrink-0 bg-neutral-950 border-t border-neutral-800 px-3 py-3 overflow-x-auto">
          <ol className="flex gap-2 items-center" aria-label={t('stage.strip')}>
            {parts.map((slide, i) => {
              const isLive = !pointer.black && i === pointer.partIndex;
              // While the screen is black, the part it will show again stays marked, in sky (StageView.razor).
              const held = pointer.black && i === pointer.partIndex;
              return (
                <li key={slide.key} ref={isLive ? liveRef : undefined} className="relative shrink-0">
                  <AppButton
                    variant="plain"
                    aria-label={`${item!.title} ${i + 1}`}
                    aria-pressed={isLive}
                    onClick={() => show(item!.id, i)}
                    className={`block cursor-pointer rounded-md transition-opacity p-0.5 outline-3 ${isLive ? 'outline-red-500' : held ? 'outline-transparent ring-2 ring-sky-400' : 'outline-transparent opacity-70 hover:opacity-100'}`}
                  >
                    <span className="block h-[110px] aspect-video rounded overflow-hidden">
                      <SlideView slide={slide} theme={theme} credits={false} />
                    </span>
                  </AppButton>
                  {isLive && <LiveBadge small>{t('stage.live')}</LiveBadge>}
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
      {/* A press on the dark backdrop closes the sheet (StageView.razor). */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
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
