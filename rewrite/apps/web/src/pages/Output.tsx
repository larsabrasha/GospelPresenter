import { useData } from '../db/react.tsx';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import { slidesOf, type LiveChannel } from '../live/live.ts';
import { useLivePointer } from '../live/useLive.ts';
import { SlideView } from '../ui/SlideView.tsx';

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
  return (
    <div className="output" data-testid="output">
      <SlideView slide={pointer.black ? null : (shown?.slide ?? null)} theme={shown?.theme} label={false} />
    </div>
  );
}
