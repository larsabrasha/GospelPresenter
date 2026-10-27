import { useEffect, useRef, useState } from 'react';
import type { PresentationItem, Theme } from '@gp/core';
import { t } from '../i18n.ts';
import type { ItemSlides, LiveChannel } from '../live/live.ts';
import { useLivePointer } from '../live/useLive.ts';
import { Button } from '../ui/Button.tsx';
import { SlideView } from '../ui/SlideView.tsx';

/**
 * Scenläge (spec 04 §3): a full-screen dark view for a worship leader or a
 * foot pedal. Next and previous stay within the selected item and stop at its
 * ends (LIVE-R41); picking an item puts its first part live. Overlays and
 * audio are not built, so the bar has neither.
 */
export function StageView({
  items,
  slides,
  theme,
  live,
  onLeave,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  live: LiveChannel;
  onLeave: () => void;
}) {
  const pointer = useLivePointer(live);
  const item = items.find((i) => i.id === pointer.itemId) ?? null;
  const parts = item ? (slides.get(item.id)?.slides ?? []) : [];
  const [picking, setPicking] = useState(!item && items.length > 0); // opens by itself with nothing selected
  const liveRef = useRef<HTMLLIElement>(null);

  // The screen stays awake while the view is open.
  useEffect(() => {
    let lock: { release(): Promise<void> } | undefined;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    void nav.wakeLock?.request('screen').then((l) => (lock = l), () => undefined);
    return () => void lock?.release();
  }, []);

  // Keeps the live tile centred; cheap, so it runs after every render rather than naming what it reads.
  useEffect(() => {
    liveRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  });

  const show = (itemId: string, partIndex: number) => live.set({ itemId, partIndex, black: false });
  const go = (delta: number) => {
    if (!item) return;
    const at = pointer.itemId === item.id ? pointer.partIndex : -1; // nothing of the item live: next is part 0
    const to = at === -1 ? (delta > 0 ? 0 : -1) : at + delta;
    if (to >= 0 && to < parts.length) show(item.id, to);
  };
  const pick = (i: PresentationItem) => {
    setPicking(false);
    if (slides.get(i.id)?.slides.length) show(i.id, 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picking) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) go(1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) go(-1);
      else if (e.key === 'Escape') onLeave();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true); // before the page's own shortcuts, which stage mode suppresses
    return () => removeEventListener('keydown', onKey, true);
  });

  const current = item && !pointer.black ? (parts[pointer.partIndex] ?? null) : null;
  const next = item && !pointer.black ? parts[pointer.partIndex + 1] : undefined;

  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label={t('live.stage')} data-testid="stage-view">
      <div className="stage-bar row">
        <Button onClick={onLeave}>{t('stage.leave')}</Button>
        <Button className="grow" aria-haspopup="dialog" onClick={() => setPicking(true)}>
          {item?.title ?? t('stage.choose')}
        </Button>
      </div>
      {picking && (
        <div className="stage-sheet" role="dialog" aria-label={t('stage.itemPicker')}>
          {!items.length && <p className="muted">{t('stage.empty')}</p>}
          <ul className="list">
            {items.map((i) => (
              <li key={i.id}>
                <Button className="list-button" onClick={() => pick(i)}>
                  {i.title}
                </Button>
              </li>
            ))}
          </ul>
          <Button onClick={() => setPicking(false)}>{t('common.close')}</Button>
        </div>
      )}
      <div className="stage-main">
        <section>
          <h2>{t('stage.nowShowing')}</h2>
          <div className="stage-now">
            <SlideView slide={current} theme={theme} label={false} credits={false} />
            {current?.label && (
              <span className="stage-label" style={{ background: current.label.color }}>
                {current.label.text}
              </span>
            )}
          </div>
          <Button className={pointer.black ? 'invisible' : ''} tabIndex={pointer.black ? -1 : 0} onClick={() => live.set({ black: true })}>
            {t('stage.clear')}
          </Button>
        </section>
        <section>
          <h2>{t('stage.next')}</h2>
          {next ? (
            <Button className="stage-next" aria-label={t('stage.next')} onClick={() => go(1)}>
              <SlideView slide={next} theme={theme} label={false} credits={false} />
            </Button>
          ) : (
            <p className="muted">{item ? t('stage.nextNone') : ''}</p>
          )}
        </section>
      </div>
      <ol className="stage-strip" aria-label={t('stage.strip')}>
        {parts.map((slide, i) => {
          const isLive = !pointer.black && i === pointer.partIndex;
          return (
            <li key={slide.key} ref={isLive ? liveRef : undefined} className={isLive ? 'stage-tile live' : 'stage-tile'}>
              <Button aria-label={`${item!.title} ${i + 1}`} aria-pressed={isLive} onClick={() => show(item!.id, i)}>
                <SlideView slide={slide} theme={theme} label={false} credits={false} />
              </Button>
              {isLive && <span className="stage-badge">{t('stage.live')}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
