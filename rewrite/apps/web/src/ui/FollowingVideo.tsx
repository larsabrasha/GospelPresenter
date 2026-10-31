import { useEffect, useState } from 'react';
import type { LiveVideo } from '@gp/core';
import { keepInStep } from '../live/video.ts';

/** How often a following video checks where it should be. */
const CHECK_MS = 250;

/**
 * A video on an output, muted, following the presenting window's (TODO.md
 * "Video on the outputs"): the output window from the live channel, a paired
 * screen from its canvas. `clock` is the clock `video.at` is on, as this page
 * sees it. Without a state yet it holds its first frame. It sits over the
 * slide's still, which shows while it loads.
 */
export function FollowingVideo({ src, video, clock }: { src: string | null; video: LiveVideo | null; clock: () => number }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!el || !video) return;
    const check = () => keepInStep(el, video, clock());
    check();
    const timer = setInterval(check, CHECK_MS);
    el.addEventListener('loadedmetadata', check);
    return () => {
      clearInterval(timer);
      el.removeEventListener('loadedmetadata', check);
    };
  }, [el, video, clock]);
  return src ? <video ref={setEl} src={src} muted playsInline preload="auto" className="slide-image" data-testid="slide-video" /> : null;
}

/** Buffers a video that is coming, out of sight, so its start is there when it goes live. */
export function BufferedVideo({ src }: { src: string | null }) {
  return src ? <video src={src} muted preload="auto" className="hidden" data-testid="buffered-video" /> : null;
}
