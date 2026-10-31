import { t } from '../../i18n.ts';
import { useAudio, type AudioControl } from '../../live/audio.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { FadeOutIcon, SpinnerIcon } from '../../ui/icons.tsx';
import { PlayerControls } from './PlayerControls.tsx';

/**
 * An audio item's player (spec 04 §1b, AudioPlayer.razor): Tona ut at the top with a spinner while it
 * fades, then the PlayerControls. It drives the session's audio, which plays on the presenting
 * computer only: on a controller this is a mirror that sends commands. In the editor it drives a
 * preview of its own.
 */
export function AudioPlayer({ control, itemId, name, testId = 'audio-player' }: { control: AudioControl; itemId: string; name: string; testId?: string }) {
  const state = useAudio(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
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
      <PlayerControls
        kind="audio"
        playing={playing}
        position={mine?.position ?? 0}
        duration={mine?.duration ?? 0}
        onToggle={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
        onSeek={(position) => control.command({ action: 'seek', itemId, position })}
      />
    </div>
  );
}
