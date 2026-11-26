import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CLASSIC, FIELD_RULES, type CustomElement, type CustomPage } from '@gp/core';
import { defaultTheme } from '../../db/queries.ts';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { loadingText } from '../../ui/playful.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSavedIndicator, useTrySave } from '../../ui/AutoSave.tsx';
import { CONTEXT_ROW } from '../../ui/ContextMenu.tsx';
import { MENU_ITEM } from '../../ui/Dropdown.tsx';
import { PhotoIcon, PlusIcon } from '../../ui/icons.tsx';
import { NameDialog } from '../../ui/NameDialog.tsx';
import { usePhone } from '../../ui/usePhone.ts';
import { DetailHeader, PageContainer } from '../../ui/PageContainer.tsx';
import { href } from '../../ui/router.ts';
import { readEdited, renameEdited, savePages, type EditedKind } from './edited.ts';
import { EditorCanvas } from './EditorCanvas.tsx';
import { FormatButton, GROUP, TOOL, UndoRedo, useWide } from './EditorChrome.tsx';
import { FormatSheet } from './FormatSheet.tsx';
import { useJustCreated } from '../../ui/justCreated.ts';
import * as history from './history.ts';
import { ImagePicker } from './ImagePicker.tsx';
import { Inspector } from './Inspector.tsx';
import { InsertChoices, ShapeMenu, TextMark } from './InsertMenu.tsx';
import { BehindPicker, behindSlide, useBehind } from './OverlayBehind.tsx';
import { PageNavigator } from './PageNavigator.tsx';
import * as model from './slideModel.ts';

// A custom slide's editor (docs/custom-slides.md), as Keynote's (Lars, 2026-11-26): on a computer a toolbar of
// grouped round buttons, Ångra and Gör om, then Text, Form and Bild, then Format at the right, which shows and hides
// Format's panel beside the page, the page narrower and never covered; on a phone one group at the right, Ångra, Gör
// om, + and Format, + and Format sheets from below with the page above them, Format's tabs at the sheet's head. The
// pages in a column at the left on a wide screen, under the page otherwise. It saves as it goes, all the pages at once,
// half a second after the last change. An overlay is edited by the same editor, with its one page and no pages to add
// or background to set, over a song's slide, a Bible text's or the black screen (Exempelslide, under the page).

const SAVE_AFTER_MS = 500;

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
  // Just made: Format open with the name picked, where it is a popover or a sheet (ui/justCreated.ts).
  const isNew = useJustCreated(id);
  // Just made, the name is in Format to type at once, until something on the slide is picked.
  const [naming, setNaming] = useState(isNew);
  const phone = usePhone();
  const column = useRef<HTMLDivElement>(null);
  const wide = useWide(column) && !phone;
  const [renaming, setRenaming] = useState(false);
  // Open beside the page on a computer until closed; on a phone and in a popover only when asked for, or just made.
  const [formatChoice, setFormatOpen] = useState<boolean | null>(isNew ? true : null);
  const formatOpen = formatChoice ?? wide;
  const [adding, setAdding] = useState(false);
  const [behind, setBehind] = useBehind();
  const [tabsSlot, setTabsSlot] = useState<HTMLDivElement | null>(null);
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
    return <PageContainer>{slide === null ? <p className="px-5 text-stone-500">{t('slideEditor.missing')}</p> : <div className="loading-line px-5 text-stone-400">{loadingText()}</div>}</PageContainer>;

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
    if (eid) setNaming(false);
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
      nameNew={naming}
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
      onCorner={(corner) => element && onPage('', (p) => model.changeElement(p, element.id, model.inCorner(element, corner)))}
      onMoveLayer={(from, to) => onPage('', (p) => model.moveElement(p, from, to))}
      onPick={pick}
      onDuplicate={duplicate}
      onRemove={remove}
      onChoose={setChoosing}
      tabsInto={phone ? tabsSlot : null}
    />
  );
  const overlay = edits === 'overlay';
  const undoRedo = <UndoRedo canUndo={!!h.past.length} canRedo={!!h.future.length} onUndo={() => step(history.undo)} onRedo={() => step(history.redo)} />;
  const formatButton = <FormatButton open={formatOpen} onToggle={() => (setAdding(false), setFormatOpen(!formatOpen))} />;

  return (
    <PageContainer maxWidthClass="max-w-[1400px]" className="pb-8">
      <DetailHeader
        backHref={href({ page: edits === 'slide' ? 'customSlides' : 'overlays' })}
        title={slide.name}
        menu={
          <AppButton variant="plain" role="menuitem" className={MENU_ITEM} onClick={() => setRenaming(true)}>
            {t('slideEditor.rename')}
          </AppButton>
        }
        saved={saved.node}
        className="px-5"
      />
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
        <div ref={column} className="relative order-1 @4xl:order-2 flex-1 min-w-0 space-y-3">
          {phone ? (
            <div className="flex justify-end" role="toolbar" aria-label={t('slideEditor.add')}>
              <div className={GROUP}>
                {undoRedo}
                <AppButton variant="plain" className={TOOL} aria-label={t('slideEditor.add')} title={t('slideEditor.add')} onClick={() => (setFormatOpen(false), setAdding(true))}>
                  <PlusIcon className="size-5" />
                </AppButton>
                {formatButton}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2" role="toolbar" aria-label={t('slideEditor.add')}>
              <div className={GROUP}>{undoRedo}</div>
              <div className={GROUP}>
                <AppButton variant="plain" className={TOOL} aria-label={t('slideEditor.addText')} title={t('slideEditor.text')} onClick={() => add('text')}>
                  <TextMark />
                </AppButton>
                <ShapeMenu className={TOOL} onInsert={add} />
                <AppButton variant="plain" className={TOOL} aria-label={t('slideEditor.addImage')} title={t('slideEditor.image')} onClick={() => add('image')}>
                  <PhotoIcon className="size-5" />
                </AppButton>
              </div>
              <span className="flex-1" />
              <div className={GROUP}>{formatButton}</div>
            </div>
          )}
          {/* Format as a popover under the brush where the column is narrow, as a sheet on a phone (its tabs at the
              head); beside the page where it is wide. */}
          {formatOpen && !wide && (
            <FormatSheet title={t('slideEditor.format')} hideFrom="" head={phone && element ? <div ref={setTabsSlot} className="w-full" /> : undefined} onClose={() => setFormatOpen(false)}>
              {inspector}
            </FormatSheet>
          )}
          {adding && (
            <FormatSheet title={t('slideEditor.add')} hideFrom="" onClose={() => setAdding(false)}>
              <InsertChoices onInsert={(kind) => (setAdding(false), add(kind))} />
            </FormatSheet>
          )}
          <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0 space-y-3">
              <EditorCanvas
                page={page}
                theme={theme}
                picked={element ? picked : null}
                editingText={writing}
                menu={menu}
                onPick={pick}
                onChange={(eid, patch) => onPage(`${eid}:${Object.keys(patch).join(',')}`, (p) => model.changeElement(p, eid, patch))}
                onEditText={setWriting}
                behind={overlay ? behindSlide(behind) : undefined}
              />
              {overlay && <BehindPicker value={behind} onChange={setBehind} className="max-w-md" />}
            </div>
            {formatOpen && wide && (
              <aside className="w-80 shrink-0" aria-label={t('slideEditor.format')} data-testid="format-panel">
                {inspector}
              </aside>
            )}
          </div>
        </div>
      </div>
      </div>
      {renaming && (
        <NameDialog
          title={t('library.rename')}
          label={t('song.name')}
          maxChars={FIELD_RULES.name.max}
          initial={slide.name}
          onClose={() => setRenaming(false)}
          submit={async (name) => {
            if (await trySave(renameEdited(db, edits, id, name))) setRenaming(false);
          }}
        />
      )}
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
