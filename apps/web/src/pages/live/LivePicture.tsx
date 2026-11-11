import type { CustomPage, Slide, Theme } from '@gp/core';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { LIFTED } from '../../ui/glass.ts';
import { BlackScreenIcon } from '../../ui/icons.tsx';
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
 * The picture shown and Släck under it, the same on a phone and a computer (docs/layout-2-0.md): a red ring while
 * the outputs show it, grey while Släck has blacked them; Släck a lifted capsule of plain text, as iOS 27's player.
 * Släck only blacks the outputs; a part chosen or a key shows one again, as ProPresenter's Clear. No arrows beside it,
 * on a phone or a computer: a part is shown by a tap or a click on it, or by the keys (Lars, 2026-11-03 on a phone,
 * 2026-11-08 on a computer). An audio or video slide shown has its controls over the picture (MediaControls), with
 * `players` and the shown item's `itemId`. `trailing` (a phone's Visning) stands at the right end of a row as wide as
 * the column, Släck kept in its middle, as wide as there is room for, up to 144 px. The picture is
 * `data-live-picture`, which fades in after Starta presentation once its area has taken its room (liveMotion.ts,
 * called by the area's owner).
 */
export function LivePicture({
  slide,
  theme,
  overlay,
  black,
  onClear,
  testId,
  maxWidthClass = 'max-w-[640px]',
  trailing,
  leading,
  players,
  itemId = null,
  cue,
  beside = false,
}: {
  slide: Slide | null;
  theme: Theme;
  overlay: CustomPage | null;
  black: boolean;
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
  /**
   * A phone held upright: the picture small at the left, Släck at its right and `leading` and `trailing` under Släck,
   * so the running order keeps the room to scroll (Lars, 2026-11-08); lying down, the picture over Släck's row.
   */
  beside?: boolean;
}) {
  const picture = (
      <div data-live-picture className={`relative ${beside ? 'w-1/2 shrink-0 landscape:w-full' : 'w-full'} ${maxWidthClass} aspect-video ${beside ? 'rounded-xl landscape:rounded-2xl' : 'rounded-2xl'} overflow-hidden ring-2 ${black ? 'ring-stone-500' : 'ring-red-500'}`} data-testid={testId}>
        <SlideView slide={slide} theme={theme} label={false} overlay={overlay} black={black} video={players?.video?.live && <PictureVideo control={players.video} />} />
        {players && itemId && slide && <MediaControls slide={slide} itemId={itemId} players={players} />}
        {cue && (
          <span className="absolute inset-0 z-[2] m-auto h-fit w-fit rounded-full bg-black/75 px-3 py-1.5 text-sm font-semibold tabular-nums text-white" data-testid="live-cue">
            {cue}
          </span>
        )}
      </div>
  );
  const clear = (wide: string) => (
    <AppButton
      variant="plain"
      aria-pressed={black}
      disabled={black}
      onClick={onClear}
      className={`h-11 lg:h-9 lg:touch:h-11 ${wide} rounded-full flex items-center justify-center gap-2 text-[15px] lg:text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${LIFTED}`}
    >
      {/* A symbol and a word, as Apple marks what matters most on a screen (Lars, 2026-11-04: was Släck, then Släck). */}
      <BlackScreenIcon className="size-5 shrink-0" />
      {t('live.clear')}
    </AppButton>
  );
  if (beside)
    return (
      <div className="flex items-center gap-3 landscape:flex-col">
        {picture}
        {/* Upright: Släck over a row of the round buttons at the right end; lying down, one row with Släck in its middle
            (`contents` lets leading and trailing stand at its ends). */}
        <div role="toolbar" aria-label={t('live.outputs')} className="flex-1 min-w-0 flex flex-col gap-2 landscape:w-full landscape:flex-row landscape:items-center landscape:justify-between">
          {clear('w-full px-3 landscape:w-auto landscape:flex-1 landscape:max-w-36')}
          <div className="flex justify-end gap-2 empty:hidden landscape:contents">
            {leading && <span className="landscape:order-first">{leading}</span>}
            {!leading && trailing && <span className="size-11 shrink-0 hidden landscape:block landscape:order-first" />}
            {trailing}
          </div>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 items-center">
      {picture}
      {/* Släck in the middle; on a phone Visning at the row's right end, round and lifted; the picture stays free of
          buttons (Lars, 2026-11-02). */}
      <div role="toolbar" aria-label={t('live.outputs')} className={`flex items-center h-11 lg:h-9 lg:touch:h-11 ${trailing ? 'w-full max-w-[640px] justify-between gap-2' : 'justify-center'}`}>
        {/* An empty place as wide as Visning keeps the middle in the middle. */}
        {trailing && (leading ?? <span className="size-11 shrink-0" />)}
        <div className={`flex items-center ${trailing ? 'flex-1 min-w-0 justify-center' : ''}`}>{clear(trailing ? 'flex-1 min-w-0 max-w-36 px-3' : 'min-w-36 px-6')}</div>
        {trailing}
      </div>
    </div>
  );
}
