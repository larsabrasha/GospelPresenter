import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CLASSIC, type CustomElement, type CustomPage } from '@gp/core';
import { defaultTheme } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSavedIndicator, useTrySave } from '../../ui/AutoSave.tsx';
import { CONTEXT_ROW } from '../../ui/ContextMenu.tsx';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, PaintBrushIcon } from '../../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { href } from '../../ui/router.ts';
import { readEdited, renameEdited, savePages, type EditedKind } from './edited.ts';
import { EditorCanvas } from './EditorCanvas.tsx';
import { FormatSheet } from './FormatSheet.tsx';
import * as history from './history.ts';
import { ImagePicker } from './ImagePicker.tsx';
import { Inspector } from './Inspector.tsx';
import { InsertMenu } from './InsertMenu.tsx';
import { PageNavigator } from './PageNavigator.tsx';
import * as model from './slideModel.ts';

// A custom slide's editor (docs/custom-slides.md), as Keynote's: Ångra, Gör om, + and Format above the page; the
// pages in a column at the left on a computer and an iPad, under the page on a phone; Format's panel at the right, or
// a sheet on a phone. It saves as it goes, all the pages at once, half a second after the last change. An overlay is
// edited by the same editor, with its one page and no pages to add or background to set.

const SAVE_AFTER_MS = 500;

/** A round button of the editor's row, as Keynote's toolbar's. */
const TOOL = 'size-10 rounded-full flex items-center justify-center cursor-pointer text-sky-600 dark:text-sky-400 hover:bg-raised-2 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-default';

type Choosing = 'add' | 'replace' | 'background' | null;

/** Whether a key is the user's typing, not a command (a field has it). */
const typing = (e: ReactKeyboardEvent) => e.target instanceof HTMLElement && !!e.target.closest('input, textarea, [contenteditable]');

export function SlideEditor({ id, edits = 'slide' }: { id: string; edits?: EditedKind }) {
  const db = useDb();
  const trySave = useTrySave();
  const saved = useSavedIndicator();
  const slide = useData((d) => readEdited(d, edits, id), [edits, id]);
  const theme = useData(defaultTheme, []) ?? CLASSIC;
  const [h, setH] = useState<history.History<CustomPage[]> | null>(null);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [choosing, setChoosing] = useState<Choosing>(null);
  const [clip, setClip] = useState<CustomElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Changes not saved yet: while there are some, the slide as stored is not taken over. */
  const dirty = useRef(false);
  /** The newest version taken over or saved here: a read of it, or of an older one, changes nothing. */
  const known = useRef(0);
  const pages = h?.present ?? null;

  // The stored slide, at first and whenever another device saved a newer one and nothing here waits to be saved.
  if (slide && !dirty.current && slide.updatedAt > known.current) {
    known.current = slide.updatedAt;
    if (JSON.stringify(slide.pages) !== JSON.stringify(pages)) setH(history.startHistory(slide.pages));
  }
  const save = async (next: CustomPage[]) => {
    dirty.current = false;
    const when = Math.max(Date.now(), known.current + 1);
    known.current = when;
    if (await trySave(savePages(db, edits, id, next, when))) saved.show();
  };
  useEffect(() => {
    if (!pages || !dirty.current) return;
    const timer = setTimeout(() => void save(pages), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saved once the changes stop
  }, [pages]);
  // Leaving the page saves what waits at once.
  const pending = useRef(pages);
  useEffect(() => {
    pending.current = pages;
  });
  useEffect(
    () => () => {
      if (dirty.current && pending.current) void save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on leaving only
    [],
  );

  if (!slide || !pages || !h)
    return <PageContainer>{slide === null ? <p className="px-5 text-stone-500">{t('slideEditor.missing')}</p> : <div className="loading-line px-5 text-stone-400">{t('common.loading')}</div>}</PageContainer>;

  const pageAt = Math.min(at, pages.length - 1);
  const page = pages[pageAt]!;
  const element = picked ? page.elements.find((e) => e.id === picked) : undefined;
  /** A change, kept for Ångra: `key` names its kind, so a run of the same is one step; '' is always a step of its own. */
  const change = (key: string, fn: (pages: CustomPage[]) => CustomPage[]) => {
    dirty.current = true;
    setH((now) => (now ? history.record(now, fn(now.present), key, Date.now()) : now));
  };
  const onPage = (key: string, fn: (page: CustomPage) => CustomPage) => change(key, (p) => model.withPage(p, pageAt, fn));
  const step = (fn: (h: history.History<CustomPage[]>) => history.History<CustomPage[]>) => {
    dirty.current = true;
    setH((now) => now && fn(now));
  };
  const pick = (eid: string | null) => {
    setPicked(eid);
    if (!eid) setWriting(false);
  };
  const insert = (e: CustomElement) => {
    onPage('', (p) => model.addElement(p, e));
    pick(e.id);
  };
  const add = (kind: model.NewKind) => (kind === 'image' ? setChoosing('add') : insert(model.newElement(kind, newId())));
  const remove = () => {
    if (!element) return;
    onPage('', (p) => model.removeElement(p, element.id));
    pick(null);
  };
  const duplicate = () => {
    if (!element) return;
    const copy = newId();
    onPage('', (p) => model.duplicateElement(p, element.id, copy));
    pick(copy);
  };
  const paste = () => clip && insert({ ...clip, id: newId(), x: clip.x + 40, y: clip.y + 40 });
  const openPage = (i: number) => {
    setAt(i);
    pick(null);
  };

  // Keynote's keys on a computer: ⌘Z, ⇧⌘Z, ⌘C, ⌘X, ⌘V, ⌘D and Delete, when no field has them.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (typing(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (mod && k === 'z') run(() => step(e.shiftKey ? history.redo : history.undo));
    else if (mod && k === 'c' && element) run(() => setClip(element));
    else if (mod && k === 'x' && element) run(() => (setClip(element), remove()));
    else if (mod && k === 'v' && clip) run(paste);
    else if (mod && k === 'd' && element) run(duplicate);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && element) run(remove);
  };

  const menu = (
    <>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!element} onClick={() => element && (setClip(element), remove())}>
        {t('slideEditor.cut')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!element} onClick={() => element && setClip(element)}>
        {t('slideEditor.copy')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!clip} onClick={paste}>
        {t('slideEditor.paste')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!element} onClick={duplicate}>
        {t('slideEditor.duplicate')}
      </AppButton>
      <div role="separator" className="h-px my-1 bg-separator" />
      <AppButton variant="plain" role="menuitem" className={`${CONTEXT_ROW} text-red-600 dark:text-red-400`} disabled={!element} onClick={remove}>
        {t('slideEditor.removeElement')}
      </AppButton>
    </>
  );

  const inspector = (
    <Inspector
      name={slide.name}
      page={page}
      pageAt={pageAt}
      element={element}
      textRef={textRef}
      onRename={(name) => renameEdited(db, edits, id, name)}
      hasBackground={edits === 'slide'}
      onSaved={saved.show}
      onPage={onPage}
      onElement={(key, patch) => element && onPage(`${element.id}:${key}`, (p) => model.changeElement(p, element.id, patch))}
      onReorder={(to) => element && onPage('', (p) => model.reorderElement(p, element.id, to))}
      onDuplicate={duplicate}
      onRemove={remove}
      onChoose={setChoosing}
    />
  );

  return (
    <PageContainer maxWidthClass="max-w-[1400px]" className="pb-8">
      <DetailHeader backHref={href({ page: edits === 'slide' ? 'customSlides' : 'overlays' })} title={slide.name} saved={saved.node} className="px-5" />
      {/* Three columns where the editor is wide enough (its own width: Inställningar's column is narrower than the
          window), else the page with its pages under it and Format as a sheet. */}
      <div className="@container">
      <div className="flex flex-col @4xl:flex-row gap-4 @4xl:gap-6" onKeyDown={onKeyDown}>
        {edits === 'slide' && (
          <div className="order-3 @4xl:order-1 @4xl:w-44 shrink-0 @4xl:max-h-[75svh] @4xl:overflow-y-auto">
            <PageNavigator
              pages={pages}
              theme={theme}
              at={pageAt}
              onOpen={openPage}
              onAdd={() => (change('', (p) => model.addPage(p, pageAt, false, newId)), openPage(pageAt + 1))}
              onDuplicate={(i) => (change('', (p) => model.addPage(p, i, true, newId)), openPage(i + 1))}
              onMove={(i, to) => (change('', (p) => model.movePage(p, i, to)), openPage(to))}
              onRemove={(i) => (change('', (p) => model.removePage(p, i)), openPage(Math.max(0, i - 1)))}
            />
          </div>
        )}
        <div className="relative order-1 @4xl:order-2 flex-1 min-w-0 space-y-3">
          {/* Keynote's toolbar: Ångra and Gör om at the left, + and Format at the right. */}
          <div className="flex items-center gap-1" role="toolbar" aria-label={t('slideEditor.add')}>
            <AppButton variant="plain" className={TOOL} disabled={!h.past.length} aria-label={t('slideEditor.undo')} title={t('slideEditor.undo')} onClick={() => step(history.undo)}>
              <ArrowUturnLeftIcon className="size-5" />
            </AppButton>
            <AppButton variant="plain" className={TOOL} disabled={!h.future.length} aria-label={t('slideEditor.redo')} title={t('slideEditor.redo')} onClick={() => step(history.redo)}>
              <ArrowUturnRightIcon className="size-5" />
            </AppButton>
            <span className="flex-1" />
            <InsertMenu className={TOOL} onInsert={add} />
            <AppButton variant="plain" className={`${TOOL} @4xl:hidden ${formatOpen ? 'bg-sky-500/15' : ''}`} aria-label={t('slideEditor.format')} title={t('slideEditor.format')} aria-pressed={formatOpen} onClick={() => setFormatOpen((o) => !o)}>
              <PaintBrushIcon className="size-5" />
            </AppButton>
          </div>
          {/* Format under the brush where the editor is narrow; beside the page where it is wide. */}
          {formatOpen && (
            <FormatSheet title={t('slideEditor.format')} onClose={() => setFormatOpen(false)}>
              {inspector}
            </FormatSheet>
          )}
          <EditorCanvas
            page={page}
            theme={theme}
            picked={element ? picked : null}
            editingText={writing}
            menu={menu}
            onPick={pick}
            onChange={(eid, patch) => onPage(`${eid}:${Object.keys(patch).join(',')}`, (p) => model.changeElement(p, eid, patch))}
            onEditText={setWriting}
          />
        </div>
        <aside className="hidden @4xl:block order-2 @4xl:order-3 @4xl:w-80 shrink-0">{inspector}</aside>
      </div>
      </div>
      {choosing && (
        <ImagePicker
          onClose={() => setChoosing(null)}
          onPick={(chosen) => {
            if (choosing === 'background') onPage('background', (p) => ({ ...p, backgroundPicture: chosen.picture }));
            else if (choosing === 'replace' && element) onPage('image', (p) => model.changeElement(p, element.id, { picture: chosen.picture }));
            else insert(model.newElement('image', newId(), chosen));
            setChoosing(null);
          }}
        />
      )}
    </PageContainer>
  );
}
