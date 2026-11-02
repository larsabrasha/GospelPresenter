import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { PauseIcon, PlayIcon } from '../../ui/icons.tsx';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The texts and test ids of the audio item's player or the video item's. */
export type PlayerKind = 'audio' | 'video';

const LABELS: Record<PlayerKind, { play: TextKey; pause: TextKey; seek: TextKey }> = {
  audio: { play: 'audio.play', pause: 'audio.pause', seek: 'audio.seek' },
  video: { play: 'video.play', pause: 'video.pause', seek: 'video.seek' },
};

/**
 * Play and pause, the time played, a thin sky seek bar with a knob on hover that a mouse or a finger drags (or the
 * arrow keys move by 5 s), and the length (AudioPlayer.razor). The player it belongs to sends the commands.
 */
export function PlayerControls({ kind, playing, position, duration, onToggle, onSeek }: { kind: PlayerKind; playing: boolean; position: number; duration: number; onToggle: () => void; onSeek: (position: number) => void }) {
  const labels = LABELS[kind];
  const bar = useRef<HTMLDivElement>(null);
  const seekTo = (e: { clientX: number }) => {
    const rect = bar.current!.getBoundingClientRect();
    if (!duration || !rect.width) return;
    onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration);
  };
  const startSeek = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e);
  };
  const percent = duration ? `${(position / duration) * 100}%` : '0%';
  return (
    <div className="flex items-center gap-3">
      <AppButton
        variant="plain"
        aria-label={playing ? t(labels.pause) : t(labels.play)}
        onClick={onToggle}
        className="size-10 flex items-center justify-center rounded-full bg-raised cursor-pointer hover:bg-raised-2 transition shrink-0"
      >
        {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
      </AppButton>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums w-10 text-right shrink-0" data-testid={`${kind}-time`}>
          {clock(position)}
        </span>
        <div
          ref={bar}
          role="slider"
          tabIndex={0}
          aria-label={t(labels.seek)}
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
            onSeek(Math.min(duration, Math.max(0, position + by)));
          }}
        >
          <div className="w-full h-1.5 rounded-full bg-stone-200 dark:bg-raised-2 overflow-hidden">
            <div className="h-full bg-sky-500 rounded-full transition-none" style={{ width: percent }} />
          </div>
          <div className="absolute size-3.5 -ml-[7px] rounded-full bg-sky-500 shadow opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" style={{ left: percent }} />
        </div>
        <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums w-10 shrink-0" data-testid={`${kind}-duration`}>
          {clock(duration)}
        </span>
      </div>
    </div>
  );
}
