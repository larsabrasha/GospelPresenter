import { useEffect, useState } from 'react';
import type { SlideVideo } from '@gp/core';
import { useData, useShownOverlay } from '../db/react.tsx';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import { slidesOf, type LiveChannel } from '../live/live.ts';
import { useLivePointer } from '../live/useLive.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { askFullScreen } from '../ui/fullScreen.ts';
import { BufferedVideo, FollowingVideo } from '../ui/FollowingVideo.tsx';
import { canPlayVideo, playUrl } from '../media/video.ts';
import type { OutputVideo } from '../live/video.ts';

/** This machine's clock: the presenting window's video state is on it too. */
const now = () => Date.now();

/** A URL that streams the video, once the server has given a token for it; null where this device cannot play it. */
function useVideoSrc(video: Pick<SlideVideo, 'hash' | 'type' | 'codec'> | null | undefined): string | null {
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

/** The video the operator plays, as the live channel brings it. */
function useOutputVideo(live: LiveChannel): OutputVideo {
  const [video, setVideo] = useState<OutputVideo>({ video: null, next: null });
  useEffect(() => live.subscribeVideo(setVideo), [live]);
  return video;
}

/**
 * An output window: renders its own copy of the content plus the live pointer
 * (ADR 0007, decision 4). An edit to the shown song reaches the screen on the
 * next database change, without the operator doing anything (D7). So does a
 * new theme for the presentation (spec 05).
 */
export function Output({ live }: { live: LiveChannel }) {
  const pointer = useLivePointer(live);
  const shown = useData(
    async (db) => {
      if (!pointer.presentationId || !pointer.itemId) return null;
      const item = (await itemsOf(db, pointer.presentationId)).find((i) => i.id === pointer.itemId);
      if (!item) return null;
      const slide = (await slidesOf(db, item)).slides[pointer.partIndex] ?? null;
      // The theme is read with the slide, so a changed theme or default shows at once (THEME-R6).
      return slide && { slide, theme: await themeOf(db, await getPresentation(db, pointer.presentationId)) };
    },
    [pointer.presentationId, pointer.itemId, pointer.partIndex],
  );
  const overlay = useShownOverlay(pointer.overlayId);
  // A video slide plays here, muted, following the operator window's video; its sound is the operator window's (LIVE-R6).
  const playback = useOutputVideo(live);
  const shownVideo = shown?.slide.video;
  const src = useVideoSrc(shownVideo);
  const following = playback.video && playback.video.hash === shownVideo?.hash ? playback.video : null;
  const nextSrc = useVideoSrc(playback.next && playback.next.hash !== shownVideo?.hash ? playback.next : null);
  // The window is named after the presentation, as the current app's `?title` (Live.razor).
  const name = useData(async (db) => (pointer.presentationId ? ((await getPresentation(db, pointer.presentationId))?.name ?? null) : null), [pointer.presentationId]);
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  // The screen stays awake, and takes the lock again when the window shows (Live.razor).
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (document.visibilityState === 'visible') void navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, []);
  return (
    // A click asks for full screen (Live.razor).
    <div className="fixed inset-0 bg-black cursor-none" data-testid="output" onClick={askFullScreen}>
      <SlideView
        slide={shown?.slide ?? null}
        theme={shown?.theme}
        label={false}
        overlay={overlay}
        black={pointer.black}
        video={<FollowingVideo key={shownVideo?.hash} src={src} video={following} clock={now} />}
      />
      <BufferedVideo src={nextSrc} />
    </div>
  );
}
