import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Background, TextStyle, Theme, ThemeDefinition } from '@gp/core';
import { getOwnTheme } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSavedIndicator, useTrySave } from '../../ui/AutoSave.tsx';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, PaintBrushIcon } from '../../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { href } from '../../ui/router.ts';
import { SlideView } from '../../ui/SlideView.tsx';
import { FormatSheet } from '../custom-slides/FormatSheet.tsx';
import * as history from '../custom-slides/history.ts';
import { ImagePicker } from '../custom-slides/ImagePicker.tsx';
import { ThemeCanvas } from './ThemeCanvas.tsx';
import { ThemeInspector } from './ThemeInspector.tsx';
import { useJustCreated } from '../../ui/justCreated.ts';
import { SAMPLES, withBackground, withText, type EditedKind, type TextRole } from './themeModel.ts';

// An own theme's editor (docs/themes.md), as the slideshows' (Lars, 2026-11-04): Ångra and Gör om above the slide; the
// three kinds of slide (Sång, Bibeltext, Bild och video) where the slideshows' editor has its pages; Format at the right,
// or a sheet on a phone. A tap on a text picks it, to change its look and to drag or size its box. It saves as it
// goes, the whole definition, half a second after the last change.

const SAVE_AFTER_MS = 500;
const TOOL = 'size-10 rounded-full flex items-center justify-center cursor-pointer text-sky-600 dark:text-sky-400 hover:bg-raised-2 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-default';
const KINDS: [EditedKind, TextKey][] = [
  ['song', 'themeEditor.song'],
  ['bible', 'themeEditor.bible'],
  ['media', 'themeEditor.media'],
];

const typing = (e: ReactKeyboardEvent) => e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select, [contenteditable]');

function KindNavigator({ theme, at, onOpen }: { theme: Theme; at: EditedKind; onOpen: (kind: EditedKind) => void }) {
  return (
    <div className="flex @4xl:flex-col gap-3 overflow-x-auto @4xl:overflow-x-visible [scrollbar-width:none] p-1" role="listbox" aria-label={t('themeEditor.kinds')}>
      {KINDS.map(([kind, label]) => (
        <div key={kind} className="shrink-0">
          <AppButton
            variant="plain"
            role="option"
            aria-selected={kind === at}
            aria-label={t(label)}
            className={`block w-28 @4xl:w-36 aspect-video rounded-lg overflow-hidden cursor-pointer ring-[3px] ${kind === at ? 'ring-sky-500' : 'ring-transparent'}`}
            onClick={() => onOpen(kind)}
          >
            <SlideView slide={SAMPLES[kind]} theme={theme} label={false} />
          </AppButton>
          <p className="mt-1 text-xs text-center text-stone-500 dark:text-stone-400">{t(label)}</p>
        </div>
      ))}
    </div>
  );
}

export function ThemeEditor({ id }: { id: string }) {
  const db = useDb();
  const trySave = useTrySave();
  const saved = useSavedIndicator();
  const row = useData((d) => getOwnTheme(d, id), [id]);
  const [h, setH] = useState<history.History<ThemeDefinition> | null>(null);
  const [kind, setKind] = useState<EditedKind>('song');
  const [picked, setPicked] = useState<TextRole | null>(null);
  // Just made: Format open with the name picked, where it is a popover or a sheet (ui/justCreated.ts).
  const isNew = useJustCreated(id);
  const [formatOpen, setFormatOpen] = useState(isNew);
  const [choosing, setChoosing] = useState(false);
  /** Changes not saved yet: while there are some, the theme as stored is not taken over. */
  const dirty = useRef(false);
  /** The newest version taken over or saved here. */
  const known = useRef(0);
  const definition = h?.present ?? null;

  // The stored theme, at first and whenever another device saved a newer one and nothing here waits to be saved.
  if (row && !dirty.current && row.updatedAt > known.current) {
    known.current = row.updatedAt;
    if (JSON.stringify(row.theme.definition) !== JSON.stringify(definition)) setH(history.startHistory(row.theme.definition));
  }
  const save = async (next: ThemeDefinition) => {
    dirty.current = false;
    const at = Math.max(Date.now(), known.current + 1);
    known.current = at;
    if (await trySave(db.mutate('updateTheme', { id, definition: next, at }))) saved.show();
  };
  useEffect(() => {
    if (!definition || !dirty.current) return;
    const timer = setTimeout(() => void save(definition), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saved once the changes stop
  }, [definition]);
  // Leaving the page saves what waits at once.
  const pending = useRef(definition);
  useEffect(() => {
    pending.current = definition;
  });
  useEffect(
    () => () => {
      if (dirty.current && pending.current) void save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on leaving only
    [],
  );

  if (!row || !definition || !h)
    return <PageContainer>{row === null ? <p className="px-5 text-stone-500">{t('themeEditor.missing')}</p> : <div className="loading-line px-5 text-stone-400">{t('common.loading')}</div>}</PageContainer>;

  const theme: Theme = { ...row.theme, definition };
  /** A change, kept for Ångra: `key` names its kind, so a slider pulled is one step; '' is always a step of its own. */
  const change = (key: string, fn: (d: ThemeDefinition) => ThemeDefinition) => {
    dirty.current = true;
    setH((now) => (now ? history.record(now, fn(now.present), key, Date.now()) : now));
  };
  const step = (fn: (h: history.History<ThemeDefinition>) => history.History<ThemeDefinition>) => {
    dirty.current = true;
    setH((now) => now && fn(now));
  };
  const onText = (key: string, patch: Partial<TextStyle>) => {
    if (kind === 'media' || !picked) return;
    change(key && `${kind}:${picked}:${key}`, (d) => withText(d, kind, picked, patch));
  };
  const onBackground = (key: string, patch: Partial<Background>) => change(key && `${kind}:background:${key}`, (d) => withBackground(d, kind, patch));
  const open = (k: EditedKind) => {
    setKind(k);
    setPicked(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (typing(e) || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    step(e.shiftKey ? history.redo : history.undo);
  };

  const inspector = (
    <ThemeInspector
      name={row.theme.name}
      nameNew={isNew}
      definition={definition}
      kind={kind}
      picked={picked}
      onRename={(name) => db.mutate('updateTheme', { id, name, at: Date.now() })}
      onSaved={saved.show}
      onText={onText}
      onBackground={onBackground}
      onChoosePicture={() => setChoosing(true)}
    />
  );

  return (
    <PageContainer maxWidthClass="max-w-[1400px]" className="pb-8">
      <DetailHeader backHref={href({ page: 'themes' })} title={row.theme.name} saved={saved.node} className="px-5" />
      <div className="@container">
        <div className="flex flex-col @4xl:flex-row gap-4 @4xl:gap-6" onKeyDown={onKeyDown}>
          <div className="order-3 @4xl:order-1 @4xl:w-44 shrink-0">
            <KindNavigator theme={theme} at={kind} onOpen={open} />
          </div>
          <div className="relative order-1 @4xl:order-2 flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-1" role="toolbar" aria-label={t('slideEditor.format')}>
              <AppButton variant="plain" className={TOOL} disabled={!h.past.length} aria-label={t('slideEditor.undo')} title={t('slideEditor.undo')} onClick={() => step(history.undo)}>
                <ArrowUturnLeftIcon className="size-5" />
              </AppButton>
              <AppButton variant="plain" className={TOOL} disabled={!h.future.length} aria-label={t('slideEditor.redo')} title={t('slideEditor.redo')} onClick={() => step(history.redo)}>
                <ArrowUturnRightIcon className="size-5" />
              </AppButton>
              <span className="flex-1" />
              <AppButton variant="plain" className={`${TOOL} @4xl:hidden ${formatOpen ? 'bg-sky-500/15' : ''}`} aria-label={t('slideEditor.format')} title={t('slideEditor.format')} aria-pressed={formatOpen} onClick={() => setFormatOpen((o) => !o)}>
                <PaintBrushIcon className="size-5" />
              </AppButton>
            </div>
            {/* Format under the brush where the editor is narrow; beside the slide where it is wide. */}
            {formatOpen && (
              <FormatSheet title={t('slideEditor.format')} onClose={() => setFormatOpen(false)}>
                {inspector}
              </FormatSheet>
            )}
            <ThemeCanvas theme={theme} kind={kind} picked={picked} onPick={setPicked} onArea={(role, area) => kind !== 'media' && change('', (d) => withText(d, kind, role, { area }))} />
          </div>
          <aside className="hidden @4xl:block order-2 @4xl:order-3 @4xl:w-80 shrink-0">{inspector}</aside>
        </div>
      </div>
      {choosing && (
        <ImagePicker
          onClose={() => setChoosing(false)}
          onPick={(chosen) => {
            onBackground('', { image: { kind: 'picture', full: chosen.picture.full, thumb: chosen.picture.thumb } });
            setChoosing(false);
          }}
        />
      )}
    </PageContainer>
  );
}
