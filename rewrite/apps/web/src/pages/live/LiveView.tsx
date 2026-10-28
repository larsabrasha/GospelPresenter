import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { useData, useShownOverlay } from '../../db/react.tsx';
import { getPresentation, itemsOf, listOverlays, themeOf } from '../../db/queries.ts';
import type { AudioControl } from '../../live/audio.ts';
import { slidesOf, type ItemSlides } from '../../live/live.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { useLivePointer } from '../../live/useLive.ts';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { StageView } from '../StageView.tsx';
import { ItemRow } from './ItemRow.tsx';
import { LivePanel } from './LivePanel.tsx';
import { RemoteBanner } from './RemoteBanner.tsx';

/** Whether the window is `lg` or wider, where the live panel is a column rather than a floating box. */
const wideQuery = matchMedia('(min-width: 1024px)');
function useWide(): boolean {
  return useSyncExternalStore(
    (on) => {
      wideQuery.addEventListener('change', on);
      return () => wideQuery.removeEventListener('change', on);
    },
    () => wideQuery.matches,
  );
}

/** The operator's view of a running presentation (spec 04): the owner's own, or a controller's. */
export function LiveView({ id, live, audio, owner, link }: { id: string; live: LiveControl; audio: AudioControl; owner: { sessionId: string } | null; link: LiveLink }) {
  const pointer = useLivePointer(live);
  const [stage, setStage] = useState(false);
  // Below `lg` the panel floats at the bottom right and folds to its caption (LivePanel.razor's Collapsible).
  const [folded, setFolded] = useState(false);
  const wide = useWide();
  const collapsed = folded && !wide;
  const panelId = useId();
  const data = useData(
    async (db) => {
      const items = await itemsOf(db, id);
      const slides = new Map<string, ItemSlides>();
      for (const item of items) slides.set(item.id, await slidesOf(db, item));
      const presentation = await getPresentation(db, id);
      return { presentation, theme: await themeOf(db, presentation), items, slides, overlays: await listOverlays(db) };
    },
    [id],
  );
  const overlay = useShownOverlay(pointer.overlayId);

  useEffect(() => {
    // Opening the page as the owner starts presenting; a controller drives what is already live.
    if (owner && live.pointer.presentationId !== id) live.set({ presentationId: id, itemId: null, partIndex: 0, black: false });
  }, [id, live, owner]);

  /** Every slide of the running order, in order: what next and previous step through. */
  const steps = useMemo(
    () => (data ? data.items.flatMap((item) => (data.slides.get(item.id)?.slides ?? []).map((_, partIndex) => ({ itemId: item.id, partIndex }))) : []),
    [data],
  );

  const step = useCallback(
    (delta: number) => {
      const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
      const next = steps[at === -1 ? (delta > 0 ? 0 : steps.length - 1) : at + delta];
      if (next) live.set({ ...next, black: false });
    },
    [steps, pointer.itemId, pointer.partIndex, live],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (stage) return; // the stage view has its own keys
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) step(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) step(-1);
      else if (e.key === 'b' || e.key === 'B') live.set({ black: true }); // only blanks, as Rensa; a slide shows again
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step, live, stage]);

  if (!data) return null;
  const current = pointer.itemId ? data.slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null : null;

  return (
    <section className="flex-1 min-h-0 flex flex-col">
      {stage && <StageView items={data.items} slides={data.slides} theme={data.theme} overlays={data.overlays} live={live} audio={audio} onLeave={() => setStage(false)} />}
      {!owner && <RemoteBanner />}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 bg-neutral-100 dark:bg-neutral-900 overflow-y-auto">
          <div className="px-5 pt-3 pb-1">
            <h1 className="text-xl/10 font-semibold truncate">{data.presentation?.name}</h1>
            {/* The presenting computer needs everything; a remote control never plays audio, so it fetches none. */}
            <MediaReadiness presentationId={id} audio={!!owner} />
          </div>
          <ol className="px-3 pt-3 pb-24 lg:pb-6 space-y-6">
            {data.items.map((item) => (
              <ItemRow key={item.id} item={item} slides={data.slides.get(item.id)!} overlays={data.overlays} theme={data.theme} pointer={pointer} live={live} audio={audio} />
            ))}
          </ol>
        </div>
        <LivePanel
          id={id}
          owner={owner}
          link={link}
          live={live}
          pointer={pointer}
          current={current}
          overlay={overlay}
          theme={data.theme}
          overlays={data.overlays}
          name={data.presentation?.name}
          collapsed={collapsed}
          panelId={panelId}
          onToggle={() => setFolded((f) => !f)}
          onStage={() => setStage(true)}
        />
      </div>
    </section>
  );
}
