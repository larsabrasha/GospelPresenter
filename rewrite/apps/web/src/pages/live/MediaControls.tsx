import type { Slide } from '@gp/core';
import { t } from '../../i18n.ts';
import { useAudio } from '../../live/audio.ts';
import { RemoteVideo, useVideo } from '../../live/video.ts';
import { canPlayVideo, codecName } from '../../media/video.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { FadeOutIcon, SpinnerIcon, WarningIcon } from '../../ui/icons.tsx';
import type { Players } from '../presentation-editor/ItemParts.tsx';
import { PlayerControls } from './PlayerControls.tsx';

/**
 * The shown audio or video slide's controls, over the live picture (Lars, 2026-11-06: audio and video are shown and
 * played alone, so their controls go on the picture): at the top the audio's name and Tona ut, at the foot play and
 * pause, the time, the seek bar and the length, on a shade so they read on any picture. They drive the presenting
 * computer's audio and video; on a controller they send commands and mirror what it reports.
 */
export function MediaControls({ slide, itemId, players }: { slide: Slide; itemId: string; players: Players }) {
  if (slide.audio) return <AudioControls name={slide.audio.name} itemId={itemId} players={players} />;
  if (slide.video && players.video) return <VideoControls slide={slide} itemId={itemId} players={players} />;
  return null;
}

const SHADE = 'absolute inset-0 z-[1] flex flex-col justify-between p-2.5 text-white bg-linear-to-t from-black/70 via-transparent via-45% to-black/45';

function AudioControls({ name, itemId, players }: { name: string; itemId: string; players: Players }) {
  const state = useAudio(players.audio);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  const control = players.audio;
  return (
    <div className={SHADE} role="group" aria-label={name} data-testid="audio-player" data-playing={playing}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate flex-1 drop-shadow">{name}</p>
        <AppButton
          variant="plain"
          onClick={() => control.command({ action: 'fade', itemId })}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm cursor-pointer transition shrink-0 ${mine?.fading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {mine?.fading ? <SpinnerIcon className="size-4" /> : <FadeOutIcon className="size-4" />}
          {t('audio.fade')}
        </AppButton>
      </div>
      <PlayerControls
        kind="audio"
        onPicture
        playing={playing}
        position={mine?.position ?? 0}
        duration={mine?.duration ?? 0}
        onToggle={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
        onSeek={(position) => control.command({ action: 'seek', itemId, position })}
      />
    </div>
  );
}

function VideoControls({ slide, itemId, players }: { slide: Slide; itemId: string; players: Players }) {
  const control = players.video!;
  const state = useVideo(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  const video = slide.video!;
  return (
    <div className={SHADE} role="group" aria-label={t('video.controls')} data-testid="video-player" data-playing={playing}>
      {/* A controller only drives: whether it could play the video says nothing of the presenting computer. */}
      {!(control instanceof RemoteVideo) && !canPlayVideo(video.type, video.codec) ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-300 drop-shadow" data-testid="video-cannot-play">
          <WarningIcon className="size-4 shrink-0" />
          {t('videos.cannotPlayLive', { codec: codecName(video.codec) })}
        </p>
      ) : (
        <span />
      )}
      <PlayerControls
        kind="video"
        onPicture
        playing={playing}
        position={mine?.position ?? 0}
        duration={mine?.duration ?? 0}
        onToggle={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
        onSeek={(position) => control.command({ action: 'seek', itemId, position })}
      />
    </div>
  );
}
