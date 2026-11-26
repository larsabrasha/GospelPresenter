import type { ReactNode, RefObject } from 'react';
import { CUSTOM_LIMITS, type CustomElement } from '@gp/core';
import { t, type TextKey } from '../../i18n.ts';
import { ALIGN_CHOICES, ColorChoice, OnOff, Segments, Slider } from '../../ui/FormatControls.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { ACTION_ROW, GROUP_ROW, Group, PopUp } from '../../ui/Group.tsx';
import { withMaxChars } from '../../ui/maxChars.ts';
import { FormatTabs } from './EditorChrome.tsx';
import { placeOf, type Across, type Down, type Place } from './slideModel.ts';

/**
 * A text's sizes, on the 1920×1080 slide: from a line under the song's words to a heading, as Keynote's menu of sizes
 * (Lars, 2026-11-26: a slider to 400 made sizes no slide wants easy to land on).
 */
const SIZES = [32, 40, 48, 56, 64, 72, 80, 96, 120, 144, 180, 240];

/** The sizes, with a size of its own the text has (set before this menu) in its place among them. */
const sizesWith = (size: number) => (SIZES.includes(size) ? SIZES : [...SIZES, size].toSorted((a, b) => a - b));

/** The nine places on the slide, across and down, each with its name. */
const PLACES: [Across, Down, TextKey][] = [
  ['left', 'top', 'slideEditor.topLeft'],
  ['center', 'top', 'slideEditor.topCenter'],
  ['right', 'top', 'slideEditor.topRight'],
  ['left', 'middle', 'slideEditor.middleLeft'],
  ['center', 'middle', 'slideEditor.middle'],
  ['right', 'middle', 'slideEditor.middleRight'],
  ['left', 'bottom', 'slideEditor.bottomLeft'],
  ['center', 'bottom', 'slideEditor.bottomCenter'],
  ['right', 'bottom', 'slideEditor.bottomRight'],
];
const ACROSS: Record<Across, string> = { left: '14%', center: '50%', right: '86%' };
const DOWN: Record<Down, string> = { top: '20%', middle: '50%', bottom: '80%' };

/**
 * Placering på sliden: a small slide with a point at each of the nine places, the element's own filled, its name under
 * it; a press puts the element there (Lars, 2026-11-26: as Keynote's and Figma's, plainer than arrows).
 */
function PlacePad({ element, onPlace }: { element: CustomElement; onPlace: (place: Place) => void }) {
  const at = placeOf(element);
  const name = at && PLACES.find(([a, d]) => a === at.across && d === at.down)?.[2];
  return (
    <Group title={t('slideEditor.place')}>
      <div className="flex flex-col items-center gap-2 p-3">
        <div className="relative w-48 aspect-video rounded-lg bg-stone-800 dark:bg-black" role="radiogroup" aria-label={t('slideEditor.place')}>
          {PLACES.map(([across, down, key]) => {
            const on = at?.across === across && at.down === down;
            return (
              <AppButton
                key={key}
                variant="plain"
                role="radio"
                aria-checked={on}
                aria-label={t(key)}
                title={t(key)}
                className={`absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full cursor-pointer ${on ? 'bg-sky-500 ring-[3px] ring-sky-500/35' : 'bg-white/20 hover:bg-white/40'}`}
                style={{ left: ACROSS[across], top: DOWN[down] }}
                onClick={() => onPlace({ across, down })}
              />
            );
          })}
        </div>
        <p className="h-4 text-xs text-stone-500 dark:text-stone-400">{name ? t(name) : ''}</p>
      </div>
    </Group>
  );
}

// What the picked element is, to change (docs/custom-slides.md): its words, size and colour, its fill and outline,
// its picture, its place in the drawing order; and, with nothing picked, the page's background and the page itself.

/** The inspector's tabs for an element, as Keynote's Format: its own first, then Ordna. */
export type InspectorTab = 'text' | 'style' | 'image' | 'arrange';

export function elementTabs(kind: CustomElement['kind']): InspectorTab[] {
  return kind === 'text' ? ['text', 'arrange'] : kind === 'image' ? ['image', 'arrange'] : ['style', 'arrange'];
}

const TAB_TEXT: Record<InspectorTab, TextKey> = { text: 'slideEditor.text', style: 'slideEditor.styleTab', image: 'slideEditor.image', arrange: 'slideEditor.arrange' };

export function ElementPanel({
  element: e,
  tab,
  textRef,
  onChange,
  onReorder,
  onPlace,
  layers,
  onDuplicate,
  onRemove,
  onReplaceImage,
}: {
  element: CustomElement;
  tab: InspectorTab;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (patch: Partial<CustomElement>) => void;
  onReorder: (to: 'top' | 'bottom') => void;
  onPlace: (place: Place) => void;
  /** The page's elements in their drawing order, in Ordna. */
  layers: ReactNode;
  onDuplicate: () => void;
  onRemove: () => void;
  onReplaceImage: () => void;
}) {
  return (
    <div className="space-y-5" data-testid="element-panel">
      {tab === 'text' && e.kind === 'text' && (
        <Group>
          <div className="px-4 py-2">
            <textarea
              ref={textRef}
              aria-label={t('slideEditor.text')}
              rows={3}
              className="w-full resize-y bg-transparent text-[17px] outline-none"
              value={e.text}
              onChange={withMaxChars(CUSTOM_LIMITS.text, (ev) => onChange({ text: ev.target.value }))}
            />
          </div>
          <div className={GROUP_ROW}>
            <span>{t('slideEditor.size')}</span>
            <PopUp aria-label={t('slideEditor.size')} value={e.size} onChange={(ev) => onChange({ size: Number(ev.target.value) })}>
              {sizesWith(e.size).map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </PopUp>
          </div>
          <div className={GROUP_ROW}>
            <span>{t('slideEditor.style')}</span>
            <span className="flex gap-2">
              <OnOff label={t('slideEditor.bold')} on={e.bold} onChange={(bold) => onChange({ bold })} />
              <OnOff label={t('slideEditor.italic')} on={e.italic} onChange={(italic) => onChange({ italic })} />
            </span>
          </div>
          <Segments label={t('slideEditor.align')} value={e.align} options={ALIGN_CHOICES} onChange={(align) => onChange({ align })} />
          <ColorChoice label={t('slideEditor.color')} value={e.color} empty="theme" onChange={(color) => onChange({ color })} />
        </Group>
      )}
      {tab === 'style' && (e.kind === 'rect' || e.kind === 'ellipse') && (
        <Group>
          <ColorChoice label={t('slideEditor.fill')} value={e.fill} empty="none" onChange={(fill) => onChange({ fill })} />
          <ColorChoice label={t('slideEditor.stroke')} value={e.stroke} empty="none" onChange={(stroke) => onChange({ stroke })} />
          <Slider label={t('slideEditor.strokeWidth')} value={e.strokeWidth} min={0} max={40} onChange={(strokeWidth) => onChange({ strokeWidth })} />
          {e.kind === 'rect' && <Slider label={t('slideEditor.radius')} value={e.radius} min={0} max={200} onChange={(radius) => onChange({ radius })} />}
        </Group>
      )}
      {tab === 'style' && e.kind === 'line' && (
        <Group>
          <ColorChoice label={t('slideEditor.color')} value={e.stroke} empty="theme" onChange={(stroke) => onChange({ stroke })} />
          <Slider label={t('slideEditor.strokeWidth')} value={e.strokeWidth} min={1} max={40} onChange={(strokeWidth) => onChange({ strokeWidth })} />
        </Group>
      )}
      {tab === 'image' && e.kind === 'image' && (
        <Group>
          <Segments label={t('slideEditor.fit')} value={e.fit} options={[['contain', 'slideEditor.contain'], ['cover', 'slideEditor.cover']]} onChange={(fit) => onChange({ fit })} />
          <AppButton variant="plain" className={ACTION_ROW} onClick={onReplaceImage}>
            {t('slideEditor.replaceImage')}
          </AppButton>
        </Group>
      )}
      {tab === 'arrange' && (
        <>
          <PlacePad element={e} onPlace={onPlace} />
          {layers}
          {/* One step forward or back is a drag in the list, or Alt+↑/↓ (Lars, 2026-11-05). */}
          <Group>
            {(
              [
                ['top', 'slideEditor.toFront'],
                ['bottom', 'slideEditor.toBack'],
              ] as const
            ).map(([to, key]) => (
              <AppButton key={to} variant="plain" className={ACTION_ROW} onClick={() => onReorder(to)}>
                {t(key)}
              </AppButton>
            ))}
          </Group>
          <Group>
            <AppButton variant="plain" className={ACTION_ROW} onClick={onDuplicate}>
              {t('slideEditor.duplicate')}
            </AppButton>
            <AppButton variant="plain" className={`${ACTION_ROW} text-red-600! dark:text-red-400!`} onClick={onRemove}>
              {t('slideEditor.removeElement')}
            </AppButton>
          </Group>
        </>
      )}
    </div>
  );
}

/** The inspector's tabs for an element (FormatTabs). */
export function InspectorTabs({ tabs, value, onChange, label }: { tabs: InspectorTab[]; value: InspectorTab; onChange: (tab: InspectorTab) => void; label?: string }) {
  return <FormatTabs label={label} tabs={tabs.map((tab) => [tab, TAB_TEXT[tab]])} value={value} onChange={onChange} />;
}
