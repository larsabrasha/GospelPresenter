import { useCallback, useEffect, useMemo } from 'react';
import type { PresentationItem } from '@gp/core';
import { useData } from '../db/react.tsx';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { slidesOf, type ItemSlides, type LiveChannel } from '../live/live.ts';
import { openOutput, useLivePointer } from '../live/useLive.ts';
import { Button } from '../ui/Button.tsx';
import { navigate } from '../ui/router.ts';
import { SlideView } from '../ui/SlideView.tsx';

const problemText = { 'song-missing': t('live.songMissing'), 'song-trashed': t('live.songTrashed'), 'no-parts': t('live.noParts') };

/** The operator's view of a running presentation (spec 04, milestone 1 subset). */
export function Live({ id, live }: { id: string; live: LiveChannel }) {
  const pointer = useLivePointer(live);
  const data = useData(
    async (db) => {
      const items = await itemsOf(db, id);
      const slides = new Map<string, ItemSlides>();
      for (const item of items) slides.set(item.id, await slidesOf(db, item));
      const presentation = await getPresentation(db, id);
      return { presentation, theme: await themeOf(db, presentation), items, slides };
    },
    [id],
  );

  useEffect(() => {
    if (live.pointer.presentationId !== id) live.set({ presentationId: id, itemId: null, partIndex: 0, black: false });
  }, [id, live]);

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
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) step(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) step(-1);
      else if (e.key === 'b' || e.key === 'B') live.set({ black: !live.pointer.black });
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [step, live]);

  if (!data) return null;
  const current = pointer.itemId ? data.slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null : null;

  const itemRow = (item: PresentationItem) => {
    const s = data.slides.get(item.id)!;
    const selected = item.id === pointer.itemId;
    return (
      <li key={item.id} className={selected ? 'live-item selected' : 'live-item'}>
        <h3>{item.title}</h3>
        {s.problem && <p className="warning">{problemText[s.problem]}</p>}
        <div className="thumbs">
          {s.slides.map((slide, i) => (
            <Button
              key={slide.key}
              aria-label={`${item.title} ${i + 1}`}
              aria-pressed={selected && i === pointer.partIndex}
              className={selected && i === pointer.partIndex ? 'thumb current' : 'thumb'}
              onClick={() => live.set({ itemId: item.id, partIndex: i, black: false })}
            >
              <SlideView slide={slide} theme={data.theme} />
            </Button>
          ))}
        </div>
      </li>
    );
  };

  return (
    <section className="live">
      <div className="row">
        <h1 className="grow">{data.presentation?.name}</h1>
        <Button onClick={openOutput}>{t('live.output')}</Button>
        <Button aria-pressed={pointer.black} variant={pointer.black ? 'primary' : 'normal'} onClick={() => live.set({ black: !pointer.black })}>
          {t('live.black')}
        </Button>
        <Button
          onClick={() => {
            live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
            navigate({ page: 'presentation', id });
          }}
        >
          {t('live.end')}
        </Button>
      </div>
      <div className="live-layout">
        <ol className="live-items">{data.items.map(itemRow)}</ol>
        <aside className="live-preview">
          <h2>{t('live.preview')}</h2>
          <SlideView slide={pointer.black ? null : current} theme={data.theme} label={false} />
        </aside>
      </div>
    </section>
  );
}
