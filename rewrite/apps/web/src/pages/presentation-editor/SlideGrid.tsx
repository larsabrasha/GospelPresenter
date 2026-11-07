import type { LivePointer, SongArrangement, Theme } from '@gp/core';
import { useShownOverlay } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import type { SlideMarkKind } from '../../live/liveList.ts';
import { AudioMark, SlideMark, tileClass } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';

/** Arrangement pills, shown when a song has two or more (spec 02); unnamed ones read "Arrangemang 2", by their place. */
export function ArrangementPills({ arrangements, chosen, onChoose, className }: { arrangements: SongArrangement[]; chosen: string | null; onChoose: (id: string) => void; className?: string }) {
  if (arrangements.length < 2) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`} role="group" aria-label={t('song.arrangements')}>
      {arrangements.map((a, i) => (
        <AppButton
          key={a.id}
          variant="plain"
          aria-pressed={a.id === chosen}
          onClick={() => onChoose(a.id)}
          className={`${a.id === chosen ? 'bg-sky-500 text-white' : 'bg-stone-200 dark:bg-raised text-stone-700 dark:text-stone-200 hover:bg-stone-300 dark:hover:bg-raised-2'} rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors`}
        >
          {a.name ?? `${t('song.arrangement')} ${i + 1}`}
        </AppButton>
      ))}
    </div>
  );
}

/**
 * Where n tiles of 340 px fit to a row but n of 384 do not (each with its 8 px margin, 12 px between), they share the
 * row: three to it on an iPad lying down with both columns folded (Lars, 2026-11-03), two or four in a window of that
 * width. Elsewhere they stay 384 px.
 */
const FIT = 'lg:@min-[708px]:@max-[796px]:w-[calc((100%-1.75rem)/2)] lg:@min-[1068px]:@max-[1200px]:w-[calc((100%-3rem)/3)] lg:@min-[1428px]:@max-[1604px]:w-[calc((100%-4.25rem)/4)]';

/**
 * The slides of an item, or a song in the add dialog; with the overlay the item
 * carries drawn above each, and no credits (SlideGrid.razor gives its tiles none).
 * A wrapping grid of tiles: one to a row on a phone, three to `lg`, then 384 px
 * each (SlideGrid.razor's scale), shrinking to no less than 340 px where that fits one more to a row (`FIT`); or with
 * `column` one under the other at full
 * width, as the add dialog's preview, which marks its search's words with `highlight`.
 * With `shown`, while presenting, each tile is a button that shows its slide live, and the
 * one shown is marked (SlideGrid.razor's SelectSlide). With `picked`, before presenting, a tile clicked gets the
 * current app's blue outline and nothing more (spec 04: Starta presentation still starts black; Lars, 2026-11-03);
 * while presenting the slide ↵ shows, which wins over the red of the one shown (VISAS still says it). Each tile names
 * its slide (`data-slide`, `itemId`/part) for the arrows to move through them as they stand (useEditorKeys.ts).
 */
export function SlideGrid({
  slides,
  label,
  theme,
  overlayId = null,
  column,
  highlight,
  shown,
  picked,
  itemId,
}: {
  /** The item the slides are of, for `data-slide`. */
  itemId?: string;
  slides: ItemSlides['slides'];
  label: string;
  theme: Theme;
  overlayId?: string | null;
  column?: boolean;
  highlight?: string;
  shown?: { pointer: LivePointer; itemId: string; mark: (partIndex: number) => SlideMarkKind | null; onShow: (partIndex: number) => void };
  picked?: { partIndex: number | null; onPick: (partIndex: number) => void };
}) {
  const overlay = useShownOverlay(overlayId);
  const size = column ? '' : `w-full md:w-[calc(33.333%-0.75rem)] lg:w-96 m-1 ${FIT}`;
  if (shown || picked) {
    return (
      <ol className="@container flex flex-wrap gap-3" aria-label={label}>
        {slides.map((s, i) => {
          // After Släck nothing is shown: the slide last shown is only outlined in grey, where → goes on from.
          const here = !!shown && shown.pointer.itemId === shown.itemId && shown.pointer.partIndex === i;
          const live = here && !shown.pointer.black;
          // Outlined in blue: before presenting the slide picked, while presenting the one ↵ shows (useEditorKeys.ts).
          const chosen = picked?.partIndex === i;
          const mark = shown?.mark(i);
          return (
            <li key={s.key} className={`${size} flex`}>
              <AppButton
                variant="plain"
                aria-label={`${label} ${i + 1}`}
                aria-pressed={shown ? live : chosen}
                data-current={live}
                data-picked={chosen}
                data-slide={itemId && `${itemId}/${i}`}
                className={`${tileClass(shown && !chosen ? { selected: live, live: true, rested: here && shown.pointer.black } : { selected: chosen })} w-full p-0`}
                onClick={() => (shown ? shown.onShow(i) : picked?.onPick(i))}
              >
                <SlideView slide={s} theme={theme} overlay={overlay} credits={false} />
                <AudioMark slide={s} />
                {mark && <SlideMark kind={mark} className="absolute top-2 left-2 z-[3]" />}
                {/* Its number, for a number and ↵ to show it while presenting (Lars, 2026-11-07). */}
                <span className="absolute bottom-1.5 right-1.5 z-[3] min-w-5 rounded-md bg-black/55 px-1.5 text-center text-xs/5 font-semibold tabular-nums text-white" aria-hidden>
                  {i + 1}
                </span>
              </AppButton>
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <ol className={column ? 'flex flex-col gap-2' : '@container flex flex-wrap gap-3'} aria-label={label}>
      {slides.map((s, i) => (
        <li key={s.key} className={`${tileClass({ interactive: false })} ${size}`} aria-label={`${label} ${i + 1}`}>
          <SlideView slide={s} theme={theme} overlay={overlay} credits={false} highlight={highlight} />
          <AudioMark slide={s} />
        </li>
      ))}
    </ol>
  );
}
