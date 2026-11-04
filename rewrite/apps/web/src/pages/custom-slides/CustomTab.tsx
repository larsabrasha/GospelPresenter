import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { blankPage } from '@gp/core';
import { listCustomSlides } from '../../db/customSlides.ts';
import { orgDefaultThemeId } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { PlusIcon, ShapesIcon } from '../../ui/icons.tsx';
import { matches } from '../../ui/ListSearch.tsx';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../../ui/Picker.tsx';
import { navigate } from '../../ui/router.ts';
import { ctrlLabel } from '../../ui/shortcuts.ts';
import { useToast } from '../../ui/Toast.tsx';
import type { TabProps } from '../presentation-editor/AddItemDialog.tsx';
import { FirstPage } from './CustomSlides.tsx';

/**
 * Lägg till's Egna slides (docs/custom-slides.md): the library's slides by their first pages; a tap picks or unpicks
 * one, Lägg till puts each picked one in, as a reference to the slide. Skapa makes a new one, named as the search,
 * puts it in and opens its editor, as Sånger's Skapa does.
 */
export function CustomTab({ presentationId, afterItemId, onAdded, onClose, active }: TabProps) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const slides = useData(listCustomSlides, []);
  const themeId = useData(orgDefaultThemeId, []);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useFocusWhenShown(search, active);
  const [picked, setPicked] = useState<string[]>([]);
  const busy = useRef(false);
  const shown = slides?.filter((s) => matches(query, s.name)) ?? [];
  const chosen = (slides ?? []).filter((s) => picked.includes(s.id)).toSorted((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id));
  const names = chosen.map((s) => s.name).join(', ');

  /** Each after the one before, in the order they were picked. */
  const addAll = async (ids: string[]) => {
    let after = afterItemId;
    for (const slideId of ids) {
      const itemId = newId();
      if (!(await trySave(db.mutate('addCustomSlideToPresentation', { itemId, presentationId, slideId, afterItemId: after })))) return false;
      after = itemId;
      onAdded(itemId);
    }
    return true;
  };
  const add = async () => {
    if (!chosen.length || busy.current) return;
    busy.current = true;
    try {
      if (await addAll(chosen.map((s) => s.id))) toast(t('presentation.videoAdded', { name: names }));
      setPicked([]);
    } finally {
      busy.current = false;
    }
  };
  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const id = newId();
      if (!(await trySave(db.mutate('createCustomSlide', { id, name: query.trim() || t('customSlides.new'), pages: [blankPage()], at: Date.now() })))) return;
      if (!(await addAll([id]))) return;
      onClose();
      navigate({ page: 'customSlide', id });
    } finally {
      busy.current = false;
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!isAddKey(e)) return;
    e.preventDefault();
    void add();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
      <div className="shrink-0 flex flex-wrap items-center gap-3 pb-4">
        <AppButton variant="secondary" className="inline-flex items-center gap-1.5" onClick={() => void create()}>
          <PlusIcon className="size-4" />
          {t('common.create')}
        </AppButton>
        <SearchField inputRef={search} label={t('images.search')} value={query} onChange={setQuery} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!slides && <p className="loading-line flex items-center justify-center py-12 text-stone-400 text-sm">{t('common.loading')}</p>}
        {slides && !slides.length && (
          <EmptyTab icon={<ShapesIcon className="size-12 text-stone-300 dark:text-stone-600" />}>
            <p>{t('customSlides.empty')}</p>
          </EmptyTab>
        )}
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-1" aria-label={t('nav.customSlides')}>
          {shown.map((s) => (
            <li key={s.id} className="min-w-0">
              <AppButton
                variant="plain"
                role="checkbox"
                aria-checked={picked.includes(s.id)}
                aria-label={s.name}
                className={`w-full rounded-lg cursor-pointer ring-2 ${picked.includes(s.id) ? 'ring-sky-500' : 'ring-transparent'}`}
                onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
              >
                <FirstPage slide={s} themeId={themeId} />
              </AppButton>
              <p className="mt-1 text-xs text-center truncate text-stone-500 dark:text-stone-400">{s.name}</p>
            </li>
          ))}
        </ul>
      </div>
      <AddFooter
        hint={t('presentation.addHint', { key: ctrlLabel('Enter') })}
        name={chosen.length ? names : undefined}
        label={chosen.length ? t('presentation.addImage', { name: names }) : undefined}
        onAdd={chosen.length ? () => void add() : undefined}
      />
    </div>
  );
}
