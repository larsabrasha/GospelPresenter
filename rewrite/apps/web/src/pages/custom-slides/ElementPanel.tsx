import type { RefObject } from 'react';
import type { CustomElement } from '@gp/core';
import { t, type TextKey } from '../../i18n.ts';
import { ColorChoice, OnOff, Segments, Slider } from '../../ui/FormatControls.tsx';
import { AppButton } from '../../ui/AppButton.tsx';
import { ACTION_ROW, GROUP_ROW, Group } from '../../ui/Group.tsx';

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
