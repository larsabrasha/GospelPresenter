import type { RefObject } from 'react';
import type { CustomElement } from '@gp/core';
import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ACTION_ROW, GROUP_ROW, Group } from '../../ui/Group.tsx';

// What the picked element is, to change (docs/custom-slides.md): its words, size and colour, its fill and outline,
// its picture, its place in the drawing order; and, with nothing picked, the page's background and the page itself.

const SWATCHES = ['#ffffff', '#000000', '#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];

/** A colour: one of the swatches, another of the system's picker, or none (`empty`: the theme's, or no colour). */
export function ColorChoice({ label, value, empty, onChange }: { label: string; value: string | null; empty: 'theme' | 'none'; onChange: (c: string | null) => void }) {
  const dot = 'size-8 shrink-0 rounded-full cursor-pointer ring-offset-2 ring-offset-surface dark:ring-offset-raised';
  return (
    <div className={`${GROUP_ROW} flex-wrap`} role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          variant="plain"
          role="radio"
          aria-checked={value === null}
          aria-label={t(empty === 'theme' ? 'slideEditor.theme' : 'slideEditor.none')}
          title={t(empty === 'theme' ? 'slideEditor.theme' : 'slideEditor.none')}
          className={`${dot} border border-separator bg-[linear-gradient(135deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)] ${value === null ? 'ring-2 ring-sky-500' : ''}`}
          onClick={() => onChange(null)}
        />
        {SWATCHES.map((c) => (
          <AppButton key={c} variant="plain" role="radio" aria-checked={value === c} aria-label={c} className={`${dot} border border-separator ${value === c ? 'ring-2 ring-sky-500' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        {/* Another colour, by the system's own picker. */}
        <label className={`${dot} relative overflow-hidden border border-separator bg-[conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#8b5cf6,#ef4444)] ${value && !SWATCHES.includes(value) ? 'ring-2 ring-sky-500' : ''}`} title={t('slideEditor.otherColor')}>
          <input type="color" aria-label={t('slideEditor.otherColor')} className="absolute inset-0 opacity-0 cursor-pointer" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        </label>
      </span>
    </div>
  );
}

/** A number on a slider, with its value beside it. */
function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className={GROUP_ROW}>
      <span className="shrink-0">{label}</span>
      <input type="range" min={min} max={max} value={value} className="flex-1 min-w-0 accent-sky-500" onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-10 text-right tabular-nums text-stone-500 dark:text-stone-400">{value}</span>
    </label>
  );
}

/** Choices side by side, one of them chosen (Vänster, Mitten, Höger). */
function Segments<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: [V, TextKey][]; onChange: (v: V) => void }) {
  return (
    <div className={GROUP_ROW} role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <span className="flex rounded-full bg-raised p-0.5">
        {options.map(([v, key]) => (
          <AppButton key={v} variant="plain" role="radio" aria-checked={value === v} className={`h-8 px-3 rounded-full text-[13px] cursor-pointer ${value === v ? 'bg-surface dark:bg-raised-2 shadow font-medium' : 'text-stone-500 dark:text-stone-400'}`} onClick={() => onChange(v)}>
            {t(key)}
          </AppButton>
        ))}
      </span>
    </div>
  );
}

/** A switch as a word that is on or off (Fet, Kursiv). */
function OnOff({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <AppButton variant="plain" role="switch" aria-checked={on} className={`h-8 px-3 rounded-full text-[13px] cursor-pointer ${on ? 'bg-sky-500 text-white' : 'bg-raised text-stone-600 dark:text-stone-300'}`} onClick={() => onChange(!on)}>
      {label}
    </AppButton>
  );
}

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
  onDuplicate,
  onRemove,
  onReplaceImage,
}: {
  element: CustomElement;
  tab: InspectorTab;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (patch: Partial<CustomElement>) => void;
  onReorder: (to: 'up' | 'down' | 'top' | 'bottom') => void;
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
              maxLength={2000}
              className="w-full resize-y bg-transparent text-[17px] outline-none"
              value={e.text}
              onChange={(ev) => onChange({ text: ev.target.value })}
            />
          </div>
          <Slider label={t('slideEditor.size')} value={e.size} min={10} max={400} onChange={(size) => onChange({ size })} />
          <div className={GROUP_ROW}>
            <span>{t('slideEditor.style')}</span>
            <span className="flex gap-2">
              <OnOff label={t('slideEditor.bold')} on={e.bold} onChange={(bold) => onChange({ bold })} />
              <OnOff label={t('slideEditor.italic')} on={e.italic} onChange={(italic) => onChange({ italic })} />
            </span>
          </div>
          <Segments label={t('slideEditor.align')} value={e.align} options={[['left', 'slideEditor.left'], ['center', 'slideEditor.center'], ['right', 'slideEditor.right']]} onChange={(align) => onChange({ align })} />
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
          <Group title={t('slideEditor.order')}>
            {(
              [
                ['top', 'slideEditor.toFront'],
                ['up', 'slideEditor.forward'],
                ['down', 'slideEditor.backward'],
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

/** The inspector's tabs, as iOS's segmented control. */
export function InspectorTabs({ tabs, value, onChange }: { tabs: InspectorTab[]; value: InspectorTab; onChange: (tab: InspectorTab) => void }) {
  return (
    <div className="flex rounded-full bg-raised p-0.5" role="tablist">
      {tabs.map((tab) => (
        <AppButton
          key={tab}
          variant="plain"
          role="tab"
          aria-selected={value === tab}
          className={`flex-1 h-8 px-3 rounded-full text-[13px] cursor-pointer ${value === tab ? 'bg-surface dark:bg-raised-2 shadow font-medium' : 'text-stone-500 dark:text-stone-400'}`}
          onClick={() => onChange(tab)}
        >
          {t(TAB_TEXT[tab])}
        </AppButton>
      ))}
    </div>
  );
}
