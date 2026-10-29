import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../i18n.ts';
import { useAudio, type AudioControl } from '../../live/audio.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { FadeOutIcon, PauseIcon, PlayIcon, SpinnerIcon } from '../../ui/icons.tsx';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * An audio item's player (spec 04 §1b, AudioPlayer.razor): Tona ut at the top with a spinner while it
 * fades, then play and pause, the time played, a thin sky seek bar with a knob on hover that a mouse
 * or a finger drags, and the length. It drives the session's audio, which plays on the presenting
 * computer only: on a controller this is a mirror that sends commands. In the editor it drives a
 * preview of its own.
 */
export function AudioPlayer({ control, itemId, name, testId = 'audio-player' }: { control: AudioControl; itemId: string; name: string; testId?: string }) {
  const state = useAudio(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  const duration = mine?.duration ?? 0;
  const position = mine?.position ?? 0;
  const bar = useRef<HTMLDivElement>(null);
  const seekTo = (e: { clientX: number }) => {
    const rect = bar.current!.getBoundingClientRect();
    if (!duration || !rect.width) return;
    const at = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    control.command({ action: 'seek', itemId, position: at * duration });
  };
  const startSeek = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e);
  };
  const percent = duration ? `${(position / duration) * 100}%` : '0%';
  return (
    <div className="w-full sm:max-w-lg bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm text-neutral-900 dark:text-neutral-100" role="group" aria-label={name} data-testid={testId} data-playing={playing}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium truncate flex-1">{name}</p>
        <AppButton
          variant="plain"
          onClick={() => control.command({ action: 'fade', itemId })}
          className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition shrink-0 ${mine?.fading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {mine?.fading ? <SpinnerIcon className="size-4" /> : <FadeOutIcon className="size-4" />}
          {t('audio.fade')}
        </AppButton>
      </div>
      <div className="flex items-center gap-3">
        <AppButton
          variant="plain"
          aria-label={playing ? t('audio.pause') : t('audio.play')}
          onClick={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
          className="size-10 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-700 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition shrink-0"
        >
          {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
        </AppButton>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums w-10 text-right shrink-0" data-testid="audio-time">
            {clock(position)}
          </span>
          <div
            ref={bar}
            role="slider"
            tabIndex={0}
            aria-label={t('audio.seek')}
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
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums w-10 shrink-0" data-testid="audio-duration">
            {clock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
