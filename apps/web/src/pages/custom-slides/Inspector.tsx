import { useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { type CustomElement, type CustomPage, FIELD_RULES } from '@gp/core';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { AutoSaveField } from '../../ui/AutoSave.tsx';
import { ACTION_ROW, Group } from '../../ui/Group.tsx';
import { ColorChoice } from '../../ui/FormatControls.tsx';
import { LayerList } from './LayerList.tsx';
import type { Place } from './slideModel.ts';
import { ElementPanel, elementTabs, InspectorTabs, type InspectorTab } from './ElementPanel.tsx';

// Keynote's Format (docs/custom-slides.md): with an element picked, its tabs (Text or Stil or Bild, and Ordna); with
// none, the page's background, or for an overlay, whose page has none, a line saying to pick something; and the name
// only just after it was made.

export function Inspector({
  name,
  nameNew,
  page,
  pageAt,
  element,
  textRef,
  onRename,
  hasBackground,
  onSaved,
  onPage,
  onElement,
  onReorder,
  onPlace,
  onMoveLayer,
  onPick,
  onDuplicate,
  onRemove,
  onChoose,
  tabsInto,
}: {
  name: string;
  /** Just made: the name is focused and picked, to type over. */
  nameNew?: boolean;
  page: CustomPage;
  pageAt: number;
  element: CustomElement | undefined;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onRename: (name: string) => Promise<unknown>;
  hasBackground: boolean;
  onSaved: () => void;
  onPage: (key: string, fn: (page: CustomPage) => CustomPage) => void;
  onElement: (key: string, patch: Partial<CustomElement>) => void;
  onReorder: (to: 'up' | 'down' | 'top' | 'bottom') => void;
  onPlace: (place: Place) => void;
  onMoveLayer: (from: number, to: number) => void;
  onPick: (id: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onChoose: (what: 'replace' | 'background') => void;
  /** Where the tabs go instead of above the panel: the head of a phone's sheet, as Keynote's on an iPhone. */
  tabsInto?: HTMLElement | null;
}) {
  const [chosen, setChosen] = useState<InspectorTab>('text');
  if (element) {
    const tabs = elementTabs(element.kind);
    const tab = tabs.includes(chosen) ? chosen : tabs[0]!;
    return (
      <div className="space-y-4" data-testid="inspector">
        {/* On a phone the tabs are the sheet's head, where Format is said already; elsewhere titled Format. */}
        {tabsInto ? createPortal(<InspectorTabs tabs={tabs} value={tab} onChange={setChosen} />, tabsInto) : <InspectorTabs label={t('slideEditor.format')} tabs={tabs} value={tab} onChange={setChosen} />}
        <ElementPanel
          element={element}
          tab={tab}
          textRef={textRef}
          // What changed is the step's kind: a slider pulled is one step, a colour then another.
          onChange={(patch) => onElement(Object.keys(patch).join(','), patch)}
          onReorder={onReorder}
          onPlace={onPlace}
          layers={<LayerList page={page} picked={element.id} onPick={onPick} onMove={onMoveLayer} />}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          onReplaceImage={() => onChoose('replace')}
        />
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="inspector">
      {/* The name only just made, to type at once; after that it is renamed from the title's menu (Lars, 2026-11-26). */}
      {nameNew && (
        <Group>
          <AutoSaveField bare autoSelect label={t('song.name')} maxChars={FIELD_RULES.name.max} value={name} onSave={(v) => (v.trim() ? onRename(v) : undefined)} onSaved={onSaved} />
        </Group>
      )}
      {!hasBackground && <p className="px-4 text-[13px] text-stone-500 dark:text-stone-400">{t('slideEditor.pickSomething')}</p>}
      {hasBackground && (
        <Group title={t('slideEditor.page', { n: pageAt + 1 })}>
          <ColorChoice label={t('slideEditor.background')} value={page.background} empty="theme" onChange={(background) => onPage('background', (p) => ({ ...p, background }))} />
          <AppButton variant="plain" className={ACTION_ROW} onClick={() => onChoose('background')}>
            {t(page.backgroundPicture ? 'slideEditor.replaceBackground' : 'slideEditor.backgroundImage')}
          </AppButton>
          {page.backgroundPicture && (
            <AppButton variant="plain" className={ACTION_ROW} onClick={() => onPage('background', (p) => ({ ...p, backgroundPicture: null }))}>
              {t('slideEditor.removeBackground')}
            </AppButton>
          )}
          {/* A PDF's page under the elements: taken away, the page is its background and elements only. */}
          {page.backgroundPage && (
            <AppButton variant="plain" className={ACTION_ROW} onClick={() => onPage('background', (p) => ({ ...p, backgroundPage: null }))}>
              {t('slideEditor.removePdfPage')}
            </AppButton>
          )}
        </Group>
      )}
    </div>
  );
}
