import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { useData, useShownOverlay } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { getPresentation, itemsOf, listOverlays, themeOf } from '../../db/queries.ts';
import type { AudioControl } from '../../live/audio.ts';
import { slidesOfItems } from '../../live/live.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { useLivePointer } from '../../live/useLive.ts';
import { MediaReadiness } from '../../ui/MediaReadiness.tsx';
import { usePageKeys } from '../../ui/shortcuts.ts';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';
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

/** The live page's keys in the help dialog: ProPresenter's (Lars, 2026-10-29). */
const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.live'),
  lines: [
    { keys: ['ArrowRight', ' ', 'PageDown'], text: t('shortcuts.nextSlide') },
    { keys: ['ArrowLeft', 'PageUp'], text: t('shortcuts.previousSlide') },
    { keys: ['ArrowDown'], text: t('shortcuts.nextItem') },
    { keys: ['ArrowUp'], text: t('shortcuts.previousItem') },
    { keys: ['B'], text: t('shortcuts.black') },
  ],
};

/** The operator's view of a running presentation (spec 04): the owner's own, or a controller's. */
export function LiveView({
  id,
  live,
  audio,
  owner,
  link,
  stage: openInStage = false,
}: {
  id: string;
  live: LiveControl;
  audio: AudioControl;
  owner: { sessionId: string } | null;
  link: LiveLink;
  stage?: boolean;
}) {
  const pointer = useLivePointer(live);
  const [stage, setStage] = useState(openInStage);
  // The address says whether the stage view is open (`?stage=true`, as Presentation.razor), so a reload or a copied link opens it again.
  useEffect(() => {
    const url = new URL(location.href);
    if (stage) url.searchParams.set('stage', 'true');
    else url.searchParams.delete('stage');
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }, [stage]);
  // Below `lg` the panel floats at the bottom right and folds to its caption (LivePanel.razor's Collapsible).
  const [folded, setFolded] = useState(false);
  const wide = useWide();
  const collapsed = folded && !wide;
  const panelId = useId();
  const data = useData(
    async (db) => {
      const items = await itemsOf(db, id);
      const slides = await slidesOfItems(db, items);
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
  const steps = useMemo(() => (data ? data.items.flatMap((item) => (data.slides.get(item.id)?.slides ?? []).map((_, partIndex) => ({ itemId: item.id, partIndex }))) : []), [data]);

  const step = useCallback(
    (delta: number) => {
      const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
      const next = steps[at === -1 ? (delta > 0 ? 0 : steps.length - 1) : at + delta];
      if (next) live.set({ ...next, black: false });
    },
    [steps, pointer.itemId, pointer.partIndex, live],
  );

  /** ↓ and ↑: the first slide of the next or previous item that has slides. */
  const stepItem = (delta: number) => {
    const withSlides = data?.items.filter((item) => data.slides.get(item.id)?.slides.length) ?? [];
    const at = withSlides.findIndex((item) => item.id === pointer.itemId);
    const next = withSlides[at === -1 ? (delta > 0 ? 0 : withSlides.length - 1) : at + delta];
    if (next) live.set({ itemId: next.id, partIndex: 0, black: false });
  };

  // The keys follow ProPresenter (Lars, 2026-10-29): → Space PageDown the next slide, ← PageUp the
  // previous, ↓ ↑ the next or previous item; `b` blanks, as Rensa. Not in a field or behind a
  // dialog (ui/shortcuts.ts); the stage view has its own.
  useShortcutGroup(KEYS);
  usePageKeys((e) => {
    if (stage || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) step(1);
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) step(-1);
    else if (e.key === 'ArrowDown') stepItem(1);
    else if (e.key === 'ArrowUp') stepItem(-1);
    else if (e.key === 'b' || e.key === 'B')
      live.set({ black: true }); // only blanks, as Rensa; a slide shows again
    else return;
    e.preventDefault();
  });

  // The screen stays awake while this computer presents (Presentation.razor's wake lock), and takes it again when the page shows.
  useEffect(() => {
    if (!owner || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (document.visibilityState === 'visible')
        void navigator.wakeLock.request('screen').then(
          (l) => (lock = l),
          () => {},
        );
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, [owner]);

  if (!data) return null;
  const current = pointer.itemId ? (data.slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null) : null;

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
