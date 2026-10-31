import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { VideoCodec, VideoType } from '@gp/core';
import { t } from '../../i18n.ts';
import { canPlayVideo, codecName } from '../../media/video.ts';
import { useVideo, type VideoControl } from '../../live/video.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { PauseIcon, PlayIcon, WarningIcon } from '../../ui/icons.tsx';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * A video item's player while presenting (TODO.md "Video"), as the audio item's: play and pause, the
 * time, a seek bar and the length. It drives the presenting window's video, whose sound plays here and
 * whose picture the outputs follow. A computer that cannot play the codec says so: the outputs then
 * show the still.
 */
export function VideoPlayer({ control, itemId, name, type, codec }: { control: VideoControl; itemId: string; name: string; type: VideoType; codec: VideoCodec }) {
  const state = useVideo(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  const duration = mine?.duration ?? 0;
  const position = mine?.position ?? 0;
  const bar = useRef<HTMLDivElement>(null);
  const seekTo = (e: { clientX: number }) => {
    const rect = bar.current!.getBoundingClientRect();
    if (!duration || !rect.width) return;
    control.command({ action: 'seek', itemId, position: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration });
  };
  const startSeek = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e);
  };
  const percent = duration ? `${(position / duration) * 100}%` : '0%';
  return (
    <div className="w-full sm:max-w-lg bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm text-neutral-900 dark:text-neutral-100" role="group" aria-label={name} data-testid="video-player" data-playing={playing}>
      <p className="text-sm font-medium truncate mb-3">{name}</p>
      {!canPlayVideo(type, codec) && (
        <p className="flex items-center gap-2 mb-3 text-sm text-amber-700 dark:text-amber-300" data-testid="video-cannot-play">
          <WarningIcon className="size-4 shrink-0" />
          {t('videos.cannotPlayLive', { codec: codecName(codec) })}
        </p>
      )}
      <div className="flex items-center gap-3">
        <AppButton
          variant="plain"
          aria-label={playing ? t('video.pause') : t('video.play')}
          onClick={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
          className="size-10 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-700 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition shrink-0"
        >
          {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
        </AppButton>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums w-10 text-right shrink-0" data-testid="video-time">
            {clock(position)}
          </span>
          <div
            ref={bar}
            role="slider"
            tabIndex={0}
            aria-label={t('video.seek')}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(position)}
            className="flex-1 relative h-5 flex items-center cursor-pointer group touch-none focus:outline-none"
            onPointerDown={startSeek}
            onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && seekTo(e)}
            onKeyDown={(e) => {
              const by = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
              if (!by || !duration) return;
              e.preventDefault();
              e.stopPropagation();
              control.command({ action: 'seek', itemId, position: Math.min(duration, Math.max(0, position + by)) });
            }}
          >
            <div className="w-full h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-600 overflow-hidden">
              <div className="h-full bg-sky-500 rounded-full transition-none" style={{ width: percent }} />
            </div>
            <div className="absolute size-3.5 -ml-[7px] rounded-full bg-sky-500 shadow opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" style={{ left: percent }} />
          </div>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums w-10 shrink-0" data-testid="video-duration">
            {clock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
