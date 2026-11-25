import type { ItemSlides, LibraryVideo } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useFetchedUrl, usePictureUrl } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { AudioEngine } from '../../live/audio.ts';
import { canPlayVideo, codecName, playUrl } from '../../media/video.ts';
import { WarningIcon } from '../../ui/icons.tsx';
import { AudioOverlay, SHADE } from './MediaControls.tsx';
import { PlayerControls } from './PlayerControls.tsx';
import { errorText } from '../../ui/playful.ts';

/**
 * Before presenting, an audio or video item's preview on its own tile, as the live picture has it while presenting
 * (Lars, 2026-11-25: one tile, the same look before and during): the controls over the picture, a player of its own
 * that plays nothing on the outputs and stops when the item is left. Only the controls take a click; the rest of the
 * tile is the tile under it, which picks the item as any tile does.
 */
export function MediaPreview({ itemId, set }: { itemId: string; set: ItemSlides }) {
  if (set.audio) return <AudioPreview key={itemId} itemId={itemId} hash={set.audio.hash} name={set.audio.fileName} />;
  if (set.video) return <VideoPreview key={itemId} video={set.video} />;
  return null;
}

/** Over the tile, clipped to its corners; clicks pass through but on the controls. */
const LAYER = 'absolute inset-0 z-[4] rounded-2xl overflow-hidden pointer-events-none [&_button]:pointer-events-auto [&_[role=slider]]:pointer-events-auto';

/**
 * Once this device has the file, fetched now when it lacks it, as Quick Look does: a device keeps by itself only the
 * files of a presentation presented or kept offline.
 */
function AudioPreview({ itemId, hash, name }: { itemId: string; hash: string; name: string }) {
  const url = useFetchedUrl(hash);
  return (
    <div className={LAYER}>
      {url ? (
        <AudioPlayerOn key={url} url={url} itemId={itemId} name={name} />
      ) : (
        <div className={SHADE} data-testid="audio-preview">
          <p className="text-sm font-medium truncate drop-shadow">{name}</p>
          <p className="text-sm drop-shadow">{url === null ? errorText() : t('presentation.audioFetching')}</p>
        </div>
      )}
    </div>
  );
}

function AudioPlayerOn({ url, itemId, name }: { url: string; itemId: string; name: string }) {
  const [engine] = useState(() => new AudioEngine(async () => url));
  useEffect(() => () => engine.dispose(), [engine]);
  return <AudioOverlay control={engine} itemId={itemId} name={name} testId="audio-preview" />;
}

/**
 * The video on its tile, streamed from the server when it is played and kept nowhere (TODO.md "Video"), over its
 * still; the live picture's controls drive it. A device that cannot play the codec says so on the tile.
 */
function VideoPreview({ video }: { video: LibraryVideo }) {
  // Its still fetched as a picture at full size is, its thumbnail meanwhile.
  const poster = usePictureUrl(video.stillHash, video.thumbHash);
  const playable = canPlayVideo(video.contentType, video.codec);
  const element = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState({ playing: false, position: 0, duration: 0 });
  useEffect(() => {
    if (!playable) return;
    let live = true;
    void playUrl(video.hash).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [video.hash, playable]);
  const read = () => {
    const v = element.current;
    if (v) setState({ playing: !v.paused && !v.ended, position: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0 });
  };
  return (
    <div className={LAYER}>
      {playable && (
        <video
          ref={element}
          className="absolute inset-0 size-full object-contain bg-black"
          playsInline
          preload="none"
          poster={poster ?? undefined}
          src={src ?? undefined}
          aria-label={t('videos.preview', { name: video.fileName })}
          data-testid="video-preview"
          onPlay={read}
          onPause={read}
          onEnded={read}
          onTimeUpdate={read}
          onLoadedMetadata={read}
          onSeeked={read}
        />
      )}
      <div className={SHADE} role="group" aria-label={t('video.controls')} data-playing={state.playing}>
        {playable ? (
          <span />
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-amber-300 drop-shadow" data-testid="video-cannot-play">
            <WarningIcon className="size-4 shrink-0" />
            {t('videos.cannotPlay', { codec: codecName(video.codec) })}
          </p>
        )}
        {playable && (
          <PlayerControls
            kind="video"
            onPicture
            playing={state.playing}
            position={state.position}
            duration={state.duration}
            onToggle={() => {
              const v = element.current;
              if (v) void (v.paused || v.ended ? v.play() : Promise.resolve(v.pause()));
            }}
            onSeek={(position) => {
              if (element.current) element.current.currentTime = position;
            }}
          />
        )}
      </div>
    </div>
  );
}
