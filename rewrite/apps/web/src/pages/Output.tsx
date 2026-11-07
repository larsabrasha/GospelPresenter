import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useData, useShownOverlay } from '../db/react.tsx';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import { slidesOf, type LiveChannel } from '../live/live.ts';
import { useLivePointer } from '../live/useLive.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { askFullScreen } from '../ui/fullScreen.ts';
import { BufferedVideo, FollowingVideo, TapToPlay, useVideoSrc } from '../ui/FollowingVideo.tsx';
import type { OutputVideo } from '../live/video.ts';
import type { OutputPlayback } from '../live/playback.ts';
import type { Player } from '../live/player.ts';
import { useWakeLock } from '../ui/useWakeLock.ts';

/** This machine's clock: the presenting window's video state is on it too. */
const now = () => Date.now();

/** The video the operator plays, as the live channel brings it. */
function useOutputVideo(live: LiveChannel): OutputVideo {
  const [video, setVideo] = useState<OutputVideo>({ video: null, next: null });
  useEffect(() => live.subscribeVideo(setVideo), [live]);
  return video;
}

/**
 * The primary output's own video element, picture and sound, playing in the page: it stays where it is while it
 * plays, so nothing interrupts its sound (Lars, 2026-11-07). It leaves the page only when the slide changes, stopped.
 */
function PlayingVideo({ player }: { player: Player }) {
  const host = useRef<HTMLDivElement>(null);
  const el = useSyncExternalStore(
    (fn) => player.subscribe(fn),
    () => player.video.picture(),
  );
  useLayoutEffect(() => {
    const box = host.current;
    if (!el || !box) return;
    box.append(el);
    return () => el.remove();
  }, [el]);
  return <div ref={host} className="slide-image [&>video]:size-full [&>video]:object-contain" data-testid="playing-video" />;
}

/** The tap a browser wants before the primary output may play, or play sound (Safari, a browser's popup). */
function PlayerTap({ player }: { player: Player }) {
  const refused = useSyncExternalStore(
    (fn) => player.subscribe(fn),
    () => player.played().refused,
  );
  return refused ? <TapToPlay onTap={() => player.unlock()} /> : null;
}

/**
 * An output window: renders its own copy of the content plus the live pointer
 * (ADR 0007, decision 4). An edit to the shown song reaches the screen on the
 * next database change, without the operator doing anything (D7). So does a
 * new theme for the presentation (spec 05).
 */
export function Output({ live, playback, player }: { live: LiveChannel; playback: OutputPlayback; player: Player }) {
  const pointer = useLivePointer(live);
  // The first output window opened plays the audio and video, picture and sound together (playback.ts).
  const primary = useSyncExternalStore(playback.subscribe, playback.isPrimary);
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
  // Any other output window plays a video slide muted, following the primary's.
  const followed = useOutputVideo(live);
  const shownVideo = shown?.slide.video;
  const src = useVideoSrc(primary ? null : shownVideo);
  const following = followed.video && followed.video.hash === shownVideo?.hash ? followed.video : null;
  const nextSrc = useVideoSrc(!primary && followed.next && followed.next.hash !== shownVideo?.hash ? followed.next : null);
  // The window is named after the presentation, as the current app's `?title` (Live.razor).
  const name = useData(async (db) => (pointer.presentationId ? ((await getPresentation(db, pointer.presentationId))?.name ?? null) : null), [pointer.presentationId]);
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  // The screen stays awake (Live.razor).
  useWakeLock();
  return (
    // A click asks for full screen (Live.razor).
    <div className="fixed inset-0 bg-black cursor-none" data-testid="output" onClick={askFullScreen}>
      <SlideView
        slide={shown?.slide ?? null}
        theme={shown?.theme}
        label={false}
        overlay={overlay}
        black={pointer.black}
        video={primary ? <PlayingVideo player={player} /> : <FollowingVideo key={shownVideo?.hash} src={src} video={following} clock={now} />}
      />
      {primary ? <PlayerTap player={player} /> : <BufferedVideo src={nextSrc} />}
    </div>
  );
}
