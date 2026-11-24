import type { CustomElement, CustomPage } from '@gp/core';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Group } from '../../ui/Group.tsx';
import { GripIcon, PhotoIcon } from '../../ui/icons.tsx';
import { useSortable } from '../../ui/sortable.ts';

// Keynote's object list (docs/custom-slides.md): the page's elements, the front one first, a tap picking one (also
// one covered by another), a drag or Alt+↑/↓ moving it in the drawing order.

/** What a row calls an element: a text by its first line, the others by their kind. */
function nameOf(e: CustomElement): string {
  if (e.kind === 'text') return e.text.split('\n')[0]!.trim() || t('slideEditor.text');
  if (e.kind === 'image') return t('slideEditor.image');
  if (e.kind === 'ellipse') return t('slideEditor.ellipse');
  if (e.kind === 'line') return t('slideEditor.line');
  return t(e.radius ? 'slideEditor.roundedRect' : 'slideEditor.rect');
}

/** A small sign of the element, in its own colour, as the + menu draws the shapes. */
function Swatch({ e }: { e: CustomElement }) {
  if (e.kind === 'text') return <span className="w-5 text-center font-serif text-base/5 font-semibold">T</span>;
  if (e.kind === 'image') return <PhotoIcon className="size-5 text-stone-500 dark:text-stone-400" />;
  if (e.kind === 'line') return <span className="w-5 h-0.5 bg-stone-500 dark:bg-stone-300" />;
  return <span className={`w-5 h-3.5 ring-1 ring-black/10 ${e.kind === 'ellipse' ? 'rounded-full' : e.radius ? 'rounded' : ''}`} style={{ background: e.fill ?? 'transparent' }} />;
}

export function LayerList({ page, picked, onPick, onMove }: { page: CustomPage; picked: string | null; onPick: (id: string) => void; onMove: (from: number, to: number) => void }) {
  const last = page.elements.length - 1;
  // The rows run front first; the page lists its elements back first.
  const rows = page.elements.toReversed();
  const move = (from: number, to: number) => {
    if (to < 0 || to > last) return;
    onMove(last - from, last - to);
  };
  const { listRef, rowStyle, handle, wholeRow, dragging } = useSortable<HTMLUListElement>(move);

  return (
    <Group title={t('slideEditor.layers')}>
      <ul ref={listRef} data-testid="layer-list">
        {rows.map((e, i) => (
          <li key={e.id} data-sort-row style={rowStyle(i)} {...wholeRow(i)} className={`bg-surface first:rounded-t-xl last:rounded-b-xl ${dragging === i ? 'shadow-lg' : ''}`}>
            <AppButton
              variant="plain"
              aria-current={e.id === picked}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              className={`w-full flex items-center gap-3 px-4 min-h-11 text-sm text-left cursor-pointer select-none [-webkit-touch-callout:none] ${e.id === picked ? 'text-sky-600 dark:text-sky-400 font-medium' : 'hover:bg-stone-200/60 dark:hover:bg-white/[0.06]'}`}
              onClick={() => onPick(e.id)}
              onKeyDown={(ev) => {
                if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
                ev.preventDefault();
                move(i, ev.key === 'ArrowUp' ? i - 1 : i + 1);
              }}
            >
              <span className="w-5 flex items-center justify-center shrink-0" aria-hidden="true">
                <Swatch e={e} />
              </span>
              <span className="flex-1 truncate" data-testid="layer-name">{nameOf(e)}</span>
              {/* A finger drags by the grip, so that a swipe over the rows still scrolls. */}
              <span {...handle(i)} className="-mr-2 p-2 cursor-grab active:cursor-grabbing touch-none" aria-hidden="true">
                <GripIcon className="size-4 text-stone-300 dark:text-stone-500" />
              </span>
            </AppButton>
          </li>
        ))}
      </ul>
    </Group>
  );
}
