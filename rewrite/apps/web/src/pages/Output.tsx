import { useEffect } from 'react';
import { useData, useShownOverlay } from '../db/react.tsx';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import { slidesOf, type LiveChannel } from '../live/live.ts';
import { useLivePointer } from '../live/useLive.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { askFullScreen } from '../ui/fullScreen.ts';

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
      <SlideView slide={shown?.slide ?? null} theme={shown?.theme} label={false} overlay={overlay} black={pointer.black} />
    </div>
  );
}
