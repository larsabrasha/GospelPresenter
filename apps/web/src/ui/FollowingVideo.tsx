import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LiveVideo, SlideVideo } from '@gp/core';
import { keepInStep } from '../live/video.ts';
import { canPlayVideo, playUrl } from '../media/video.ts';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';

/** How often a following video checks where it should be. */
const CHECK_MS = 250;

/** A URL that streams the video, once the server has given a token for it; null where this device cannot play it. */
export function useVideoSrc(video: Pick<SlideVideo, 'hash' | 'type' | 'codec'> | null | undefined): string | null {
  const [src, setSrc] = useState<{ hash: string; url: string | null } | null>(null);
  const hash = video && canPlayVideo(video.type, video.codec) ? video.hash : null;
  useEffect(() => {
    if (!hash) return;
    let live = true;
    void playUrl(hash).then((url) => live && setSrc({ hash, url }));
    return () => {
      live = false;
    };
  }, [hash]);
  return hash && src?.hash === hash ? src.url : null;
}

/**
 * A video muted, following the one that plays (TODO.md "Video on the outputs",
 * playback.ts): an output window that is not the primary, and the presenting
 * window's live picture, from the live channel; a paired screen from its canvas.
 * `clock` is the clock `video.at` is on, as this page sees it. Without a state
 * yet it holds its first frame. It sits over the slide's still, which shows
 * while it loads.
 *
 * A browser that will not let the page start it untouched (Safari on an iPad
 * refuses even a muted video in a window nobody has tapped, Lars 2026-11-07)
 * gets a button over it: a tap plays it, and it follows from then on. Without
 * `tap` (the live picture, whose controls lie there) it shows the still instead.
 */
export function FollowingVideo({ src, video, clock, tap = true }: { src: string | null; video: LiveVideo | null; clock: () => number; tap?: boolean }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (!el || !video) return;
    const check = () => keepInStep(el, video, clock(), setRefused);
    check();
    const timer = setInterval(check, CHECK_MS);
    el.addEventListener('loadedmetadata', check);
    return () => {
      clearInterval(timer);
      el.removeEventListener('loadedmetadata', check);
    };
  }, [el, video, clock]);
  if (!src) return null;
  return (
    <>
      <video ref={setEl} src={src} muted playsInline preload="auto" className="slide-image" data-testid="slide-video" />
      {/* play() inside the tap itself: that is what the browser lets through. */}
      {refused && tap && <TapToPlay onTap={() => void el?.play().then(() => setRefused(false), () => undefined)} />}
    </>
  );
}

/**
 * The button over an output that a browser holding the playback back until a tap gets (Safari on an iPad). It goes on
 * the page itself, not the slide's scaled stage, and is sized by the window, in its middle: 16 px on a phone, about 24 on an iPad's
 * half screen, 44 on a projector (Lars, 2026-11-07: 48 px filled a phone's screen), on one line where it fits.
 */
export function TapToPlay({ onTap }: { onTap: () => void }) {
  return createPortal(
    <AppButton
      variant="plain"
      className="fixed inset-x-0 top-1/2 -translate-y-1/2 z-[70] mx-auto w-fit max-w-[calc(100vw-32px)] rounded-full bg-black/75 px-[1.4em] py-[0.8em] font-sans text-[clamp(16px,4vmin,44px)] leading-tight font-semibold text-center text-white cursor-pointer"
      data-testid="video-tap"
      onClick={onTap}
    >
      {t('video.tapToPlay')}
    </AppButton>,
    document.body,
  );
}

/** Buffers a video that is coming, out of sight, so its start is there when it goes live. */
export function BufferedVideo({ src }: { src: string | null }) {
  return src ? <video src={src} muted preload="auto" className="hidden" data-testid="buffered-video" /> : null;
}
