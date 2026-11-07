import type { CustomPage, Slide, Theme } from '@gp/core';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { LIFTED } from '../../ui/glass.ts';
import { BlackScreenIcon, ChevronLeftIcon } from '../../ui/icons.tsx';
import { SlideView } from '../../ui/SlideView.tsx';
import type { Players } from '../presentation-editor/ItemParts.tsx';
import type { VideoControl } from '../../live/video.ts';
import { FollowingVideo, useVideoSrc } from '../../ui/FollowingVideo.tsx';
import { MediaControls } from './MediaControls.tsx';

/** This machine's clock: the video's state is on it too. */
const now = () => Date.now();

/**
 * The video shown, muted, following the one that plays in the primary output or this window (playback.ts), as an
 * output window that is not the primary does (Lars, 2026-11-07). A controller, which plays nothing, keeps the still.
 */
function PictureVideo({ control }: { control: VideoControl }) {
  const [video, setVideo] = useState(() => control.live?.() ?? null);
  // A new state on every change of the video (play, pause, seek, another item), not on every tick.
  useEffect(() => control.subscribe(() => setVideo(control.live?.() ?? null)), [control]);
  const src = useVideoSrc(video);
  return <FollowingVideo key={video?.hash} src={src} video={video} clock={now} tap={false} />;
}

/**
 * The picture shown and ‹ Släck › under it, the same on a phone and a computer (docs/layout-2-0.md): a red ring while
 * the outputs show it, grey while Släck has blacked them; round lifted arrows, and Släck a capsule of plain text between
 * them, as iOS 27's player. Släck only blacks the outputs; a part chosen or an arrow shows one again, as ProPresenter's
 * Clear. An audio or video slide shown has its controls over the picture (MediaControls), with `players` and the
 * shown item's `itemId`. `trailing` (a phone's Visning)
 * stands at the right end of a row as wide as the column, the buttons kept in its middle, Släck as wide as there is
 * room for, up to 144 px. Without `onStep` there are no arrows: a phone shows a part by a tap on it, and the arrows
 * were seldom used there and drew the eye (Lars, 2026-11-03). The picture is `data-live-picture`, which fades in
 * after Starta presentation once its area has taken its room (liveMotion.ts, called by the area's owner).
 */
export function LivePicture({
  slide,
  theme,
  overlay,
  black,
  canStep,
  onStep,
  onClear,
  testId,
  maxWidthClass = 'max-w-[640px]',
  trailing,
  leading,
  players,
  itemId = null,
  cue,
}: {
  slide: Slide | null;
  theme: Theme;
  overlay: CustomPage | null;
  black: boolean;
  canStep?: { back: boolean; forward: boolean };
  onStep?: (delta: number) => void;
  onClear: () => void;
  testId?: string;
  /** How wide the picture may grow; a phone caps it by the screen's height. */
  maxWidthClass?: string;
  trailing?: ReactNode;
  /** With `trailing`: what stands at the row's left end (a phone's Beskrivning); an empty place as wide, without. */
  leading?: ReactNode;
  /** While presenting: the session's audio and video, which the controls drive. */
  players?: Players;
  itemId?: string | null;
  /** The slide ↵ shows, outlined in blue (useEditorKeys.ts): said in the picture's middle, clear of its controls, so a slip is seen before it shows. */
  cue?: string | null;
}) {
  // 36 px on a computer, as every button there; 44 by touch and on a phone (Lars, 2026-11-02).
  const arrow = `size-11 lg:size-9 lg:touch:size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-default ${LIFTED}`;
  return (
    <div className="flex flex-col gap-3 items-center">
      <div data-live-picture className={`relative w-full ${maxWidthClass} aspect-video rounded-2xl overflow-hidden ring-2 ${black ? 'ring-stone-500' : 'ring-red-500'}`} data-testid={testId}>
        <SlideView slide={slide} theme={theme} label={false} overlay={overlay} black={black} video={players?.video?.live && <PictureVideo control={players.video} />} />
        {players && itemId && slide && <MediaControls slide={slide} itemId={itemId} players={players} />}
        {cue && (
          <span className="absolute inset-0 z-[2] m-auto h-fit w-fit rounded-full bg-black/75 px-3 py-1.5 text-sm font-semibold tabular-nums text-white" data-testid="live-cue">
            {cue}
          </span>
        )}
      </div>
      {/* ‹ Släck › in the middle (a phone: Släck alone); on a phone Visning at the row's right end, round and lifted as the arrows; the picture
          stays free of buttons (Lars, 2026-11-02). */}
      <div role="toolbar" aria-label={t('live.outputs')} className={`flex items-center h-11 lg:h-9 lg:touch:h-11 ${trailing ? 'w-full max-w-[640px] justify-between gap-2' : 'justify-center'}`}>
        {/* An empty place as wide as Visning keeps the middle in the middle. */}
        {trailing && (leading ?? <span className="size-11 shrink-0" />)}
        <div className={`flex items-center ${trailing ? 'flex-1 min-w-0 justify-center gap-2' : 'gap-4'}`}>
          {onStep && (
            <AppButton variant="plain" aria-label={t('live.previous')} disabled={!canStep?.back} onClick={() => onStep(-1)} className={arrow}>
              <ChevronLeftIcon className="size-5" />
            </AppButton>
          )}
          <AppButton
            variant="plain"
            aria-pressed={black}
            disabled={black}
            onClick={onClear}
            className={`h-11 lg:h-9 lg:touch:h-11 ${trailing ? 'flex-1 min-w-0 max-w-36 px-3' : 'min-w-36 px-6'} rounded-full flex items-center justify-center gap-2 text-[15px] lg:text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${LIFTED}`}
          >
            {/* A symbol and a word, as Apple marks what matters most on a screen (Lars, 2026-11-04: was Släck, then Släck). */}
            <BlackScreenIcon className="size-5 shrink-0" />
            {t('live.clear')}
          </AppButton>
          {onStep && (
            <AppButton variant="plain" aria-label={t('live.nextSlide')} disabled={!canStep?.forward} onClick={() => onStep(1)} className={arrow}>
              <ChevronLeftIcon className="size-5 rotate-180" />
            </AppButton>
          )}
        </div>
        {trailing}
      </div>
    </div>
  );
}
