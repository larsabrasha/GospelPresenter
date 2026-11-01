import type { VideoCodec, VideoType } from '@gp/core';
import { t } from '../../i18n.ts';
import { canPlayVideo, codecName } from '../../media/video.ts';
import { RemoteVideo, useVideo, type VideoControl } from '../../live/video.ts';
import { WarningIcon } from '../../ui/icons.tsx';
import { PlayerControls } from './PlayerControls.tsx';

/**
 * A video item's player while presenting (TODO.md "Video"), as the audio item's: play and pause, the
 * time, a seek bar and the length. It drives the presenting window's video, whose sound plays here and
 * whose picture the outputs follow; on a controller it sends commands to the presenting computer and
 * mirrors what it reports. A presenting computer that cannot play the codec says so.
 */
export function VideoPlayer({ control, itemId, name, type, codec }: { control: VideoControl; itemId: string; name: string; type: VideoType; codec: VideoCodec }) {
  const state = useVideo(control);
  const mine = state?.itemId === itemId ? state : null;
  const playing = !!mine?.playing;
  return (
    <div className="w-full sm:max-w-lg bg-surface rounded-xl p-4 shadow-sm text-neutral-900 dark:text-neutral-100" role="group" aria-label={name} data-testid="video-player" data-playing={playing}>
      <p className="text-sm font-medium truncate mb-3">{name}</p>
      {/* A controller only drives: whether it could play the video says nothing of the presenting computer. */}
      {!(control instanceof RemoteVideo) && !canPlayVideo(type, codec) && (
        <p className="flex items-center gap-2 mb-3 text-sm text-amber-700 dark:text-amber-300" data-testid="video-cannot-play">
          <WarningIcon className="size-4 shrink-0" />
          {t('videos.cannotPlayLive', { codec: codecName(codec) })}
        </p>
      )}
      <PlayerControls
        kind="video"
        playing={playing}
        position={mine?.position ?? 0}
        duration={mine?.duration ?? 0}
        onToggle={() => control.command({ action: playing ? 'pause' : 'play', itemId })}
        onSeek={(position) => control.command({ action: 'seek', itemId, position })}
      />
    </div>
  );
}
