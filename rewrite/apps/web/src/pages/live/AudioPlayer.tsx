import { t } from '../../i18n.ts';
import { useAudio, type AudioControl } from '../../live/audio.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { FadeOutIcon, PauseIcon, PlayIcon } from '../../ui/icons.tsx';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * An audio item's player (spec 04 §1b): play and pause, the seek bar, the time
 * and Tona ut. It drives the session's audio, which plays on the presenting
 * computer only: on a controller this is a mirror that sends commands.
 */
export function AudioPlayer({ control, itemId, name }: { control: AudioControl; itemId: string; name: string }) {
  const state = useAudio(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  return (
    <div className="w-full sm:max-w-lg bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm" role="group" aria-label={name} data-testid="audio-player" data-playing={playing}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium truncate flex-1">{name}</p>
        <AppButton
          variant="plain"
          disabled={!playing || mine?.fading}
          onClick={() => control.command({ action: 'fade', itemId })}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition shrink-0 disabled:opacity-50 disabled:cursor-default"
        >
          <FadeOutIcon className="size-4" />
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
        <input
          className="flex-1 min-w-0 h-1.5 p-0 border-0 accent-sky-500 cursor-pointer disabled:cursor-default"
          type="range"
          min={0}
          max={mine?.duration ?? 0}
          step={0.1}
          value={mine?.position ?? 0}
          disabled={!mine}
          aria-label={t('audio.seek')}
          onChange={(e) => control.command({ action: 'seek', itemId, position: Number(e.target.value) })}
        />
        <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0" data-testid="audio-time">
          {clock(mine?.position ?? 0)} / {mine?.duration ? clock(mine.duration) : '–:––'}
        </span>
      </div>
    </div>
  );
}
