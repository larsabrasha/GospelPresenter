import { can, type PresentationItem, type Role } from '@gp/core';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useDataReading, useDb, useShownOverlay } from '../../db/react.tsx';
import { presentationPage, PRESENTATION_PAGE_READS } from '../../db/views.ts';
import { t } from '../../i18n.ts';
import { slideOrderOf } from '../../live/presenting.ts';
import { addAfter } from '../../live/liveList.ts';
import { usePageState, type PageCommand } from '../../live/pageState.ts';
import { useSaveFailed, useTrySave } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { deleteAsk, useConfirm } from '../../ui/Dialog.tsx';
import { backToTemplates, href, navigate } from '../../ui/router.ts';
import { songPage } from '../live/songPage.ts';
import { newId } from '../../ids.ts';
import { runCommand, useAppCommand } from '../../ui/appKeys.ts';
import { useShortcutGroup } from '../../ui/ShortcutHelp.tsx';
import { KEYS, LiveKeys, PaletteTarget } from './EditorKeys.tsx';
import type { AudioControl } from '../../live/audio.ts';
import type { VideoControl } from '../../live/video.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { useLivePointer } from '../../live/useLive.ts';
import { PresentationBar } from '../live/PresentationBar.tsx';
import { useWide } from '../../ui/useWide.ts';
import { useWakeLock } from '../../ui/useWakeLock.ts';
import { useEditorKeys } from './useEditorKeys.ts';
import { FloatingAdd } from './FloatingAdd.tsx';
import { BackToPresentations } from '../../TopBar.tsx';
import { RunningOrder } from '../live/RunningOrder.tsx';
import type { ItemMenuSource } from '../live/ItemContextMenu.tsx';
import { useAutoOutputs } from '../live/useAutoOutputs.ts';
import { SlideList } from '../live/SlideList.tsx';
import { LivePanel } from '../live/LivePanel.tsx';
import { PhoneLive } from '../live/phone/PhoneLive.tsx';
import { RemoteBanner } from '../live/RemoteBanner.tsx';
import { EditTemplateDialog } from '../Templates.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { playful, trashedText } from '../../ui/playful.ts';
import { AddItemDialog, type AddChoice, type AddKind } from './AddItemDialog.tsx';
import { useItemTexts } from './HeaderDialog.tsx';
import { DetailsDialog } from './DetailsDialog.tsx';
import { OfflineDialog } from './OfflineStatus.tsx';
import { PresentationMaterials } from '../song-materials/PresentationMaterials.tsx';
import { isHostWindow } from '../../hostWindow.ts';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog.tsx';
import { SideMenu } from './SideMenu.tsx';
import { useSidePanels } from '../../ui/sidePanels.ts';
import { FloatingPanelToggle } from '../../ui/PanelToggle.tsx';

/** The item last selected in each presentation, for this window's life: opened again, it is selected again. */
const lastSelected = new Map<string, string>();

/**
 * Presenting from the editor, as Presentation.razor does: this window's own session
 * (`owner`), or a controller driving one elsewhere (`?remote=true`). The running order stays, so items
 * are added, removed and moved while live; the live panel is at the right.
 */
export type Presenting = {
  audio: AudioControl;
  /** The session's video: the presenting window's own engine, or on a controller a mirror that sends commands. */
  video?: VideoControl;
  owner: { sessionId: string } | null;
  link: LiveLink;
};

/** How long after this window's own write a change of the presentation is taken as its own (a push's round trip). */
const OWN_WRITE_MS = 10_000;

/**
 * The presentation editor (spec 03 2): the running order on the left, the
 * selected item on the right. With `template`, a template's editor
 * (`/templates/{id}`): a banner says so, and there is no Starta presentation
 * and no Spara som mall.
 */
/** No item lit up. */
const NONE: ReadonlySet<string> = new Set();
/** How long an added item stays lit in the running order: as long as a phone marks one (PhoneLive's MARKED_MS). */
const LIT_MS = 2600;

export function PresentationEditor({
  id,
  role,
  live,
  template = false,
  presenting,
}: {
  id: string;
  role: Role;
  live: LiveControl;
  template?: boolean;
  presenting?: Presenting;
}) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const saveFailed = useSaveFailed();
  // "Kunde inte spara" when a write is refused.
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  // The page's data from the core (presentationPageView), read again when a table it reads changes.
  const data = useDataReading((d) => presentationPage(d, id), [id], PRESENTATION_PAGE_READS);
  // This window's live slide: its item is marked in the running order and selected on open.
  const pointer = useLivePointer(live);
  const liveItemId = pointer.presentationId === id ? pointer.itemId : null;
  /** Every slide of the running order, in order: what → and ← step through while presenting. */
  const order = useMemo(() => (data ? slideOrderOf(data.items.map((item) => ({ itemId: item.id, parts: data.slides.get(item.id)?.slides.length ?? 0 }))) : []), [data]);
  // The page's own state, the core's (live/pageState.ts): the item selected, the slide made ready, the last thing
  // added, a number typed. On open, the item shown live is selected, else the one selected when this presentation was
  // last open (Presentation.razor).
  const page = usePageState({
    presentationId: id,
    isTemplate: template,
    presenting: !!presenting,
    pointer,
    order,
    setLive: (change) => live.set(change),
    initial: () => ({ selectedId: liveItemId ?? lastSelected.get(id) ?? null, followed: liveItemId }),
  });
  const { selectedId, picked, lastAddedId } = page.state;
  useEffect(() => {
    if (selectedId) lastSelected.set(id, selectedId);
  }, [id, selectedId]);
  // Select mode ("Markera"): items are ticked, then removed together (Sidebar.razor).
  const [ticking, setTicking] = useState(false);
  // The row Markera was chosen on from a heading's …, ticked first; and the picture item edited in place.
  const [tickFirst, setTickFirst] = useState<string | null>(null);
  // The side columns on a computer, each folded away or out (ui/sidePanels.ts).
  const panels = useSidePanels();
  const [editingImages, setEditingImages] = useState<string | null>(null);
  // The add dialog: the item "Lägg till efter" named (`after`), the kind + chose, and whether it adds pictures to the
  // selected image item (Lägg till bilder). The last item added is the one the next
  // addition follows while presenting (liveList.ts).
  const [adding, setAdding] = useState<{ after: string | null; kind: AddKind; images?: boolean } | null>(null);
  const added = (itemId: string) => page.send({ type: 'added', itemId });
  // The items the add dialog added, lit up in the running order as it closes, where they landed (Lars, 2026-11-25: one
  // hardly noticed what had happened): behind the dialog they would light up unseen.
  const addedHere = useRef<string[]>([]);
  const [lit, setLit] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    if (!lit.size) return;
    const timer = setTimeout(() => setLit(NONE), LIT_MS);
    return () => clearTimeout(timer);
  }, [lit]);
  const closeAdding = () => {
    setAdding(null);
    if (addedHere.current.length) setLit(new Set(addedHere.current));
    addedHere.current = [];
  };
  // Headings and comments (spec 03 2f): a new heading is selected, as an addition is.
  const texts = useItemTexts(id, added);
  const [details, setDetails] = useState(false);
  const [savingAsTemplate, setSavingAsTemplate] = useState(false);
  // Spara offline…: its dialog, from the menu or the line at the foot of the left column.
  const [keepingOffline, setKeepingOffline] = useState(false);
  // Noter och länkar…: the songs' sheet music, recordings and links, for the band.
  const [showingMaterials, setShowingMaterials] = useState(false);

  const items = data?.items ?? [];

  // Presenting: this window's own session, or none while controlling one elsewhere.
  const owner = presenting?.owner ?? null;
  const wide = useWide();
  // An item chosen at the left on a computer scrolls the slides to it, each choice anew.
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const overlay = useShownOverlay(pointer.overlayId);
  useAutoOutputs(!!owner);
  // An output closed because the app's window was moved onto its display says so, so a dark projector is no surprise.
  useEffect(() => window.gpDesktop?.onOutputClosedHere((name) => toast(t('live.outputClosedHere', { name }))), [toast]);
  // Lekfullt läge (ui/playful.ts): after Släck, the first slide shown again is greeted, here only, never on an output.
  const wasBlack = useRef(pointer.black);
  useEffect(() => {
    if (presenting && wasBlack.current && !pointer.black && playful()) toast(t('fun.light'));
    wasBlack.current = pointer.black;
  }, [presenting, pointer.black, toast]);
  // The screen stays awake while this computer presents (Presentation.razor's wake lock).
  useWakeLock(!!owner);

  // "Presentationen har uppdaterats" when another session changed it: its time of change moved while this window wrote nothing.
  const updatedAt = data?.presentation ? data.presentation.updatedAt : undefined;
  const seenUpdatedAt = useRef<number | null | undefined>(undefined);
  const changed = useEffectEvent((at: number | null) => {
    const was = seenUpdatedAt.current;
    seenUpdatedAt.current = at;
    if (was !== undefined && was !== at && Date.now() - db.lastWriteAt > OWN_WRITE_MS) toast(t('presentation.updatedElsewhere'));
  });
  useEffect(() => {
    if (updatedAt !== undefined) changed(updatedAt);
  }, [updatedAt]);

  const removeItem = async (item: PresentationItem) => {
    const ok = await ask({ title: t('common.delete'), text: t('presentation.removeConfirm', { title: item.title }), bold: item.title, confirm: t('common.delete'), compact: true });
    if (ok) failing(db.mutate('removeItem', { itemId: item.id }));
  };

  // What the core's answer to a key, a tap or a row asks of the page (live/pageState.ts).
  const reveal1 = (itemId: string) => setReveal((r) => ({ id: itemId, n: (r?.n ?? 0) + 1 }));
  const onCommand = (c: PageCommand) => {
    const item = 'itemId' in c ? items.find((i) => i.id === c.itemId) : undefined;
    if (c.type === 'reveal') reveal1(c.itemId);
    else if (c.type === 'item') {
      if (c.reveal) reveal1(c.itemId);
      // The focus with the mark, so ↵ is not a slide's clicked before.
      if (c.focus) document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(c.itemId)}"] [aria-pressed]`)?.focus({ preventScroll: true });
    } else if (c.type === 'move' && item) failing(db.mutate('moveItem', { itemId: item.id, by: c.by }));
    else if (c.type === 'remove' && item) void removeItem(item);
    else if (c.type === 'add') setAdding({ after: null, kind: 'songs' });
    // A start always brings the live column out, folded or not before (Lars, 2026-11-03), so it slides in with the picture.
    else if (c.type === 'start') panels.show('right');
    else if (c.type === 'end') runCommand('end');
  };
  const send = (event: Parameters<typeof page.send>[0]) => {
    const { command } = page.send(event);
    if (command) onCommand(command);
  };
  // Starta presentation stays on the page, which turns to presenting (Presentation.razor's StartPresentation); only
  // while nothing else is presented, and never a template (the core's `canStart`).
  const startable = page.canStart;
  const start = () => send({ type: 'start' });
  useShortcutGroup(KEYS);
  // Starta presentation by the desktop app's menu bar, as by F5 and ⌥⌘P.
  useAppCommand('start', start);
  useEditorKeys({ ticking, page, shown: presenting && pointer.itemId ? { itemId: pointer.itemId, partIndex: pointer.partIndex } : null, onCommand });

  if (!data) return null;
  const { presentation, slides, songs, theme, overlays } = data;
  // A template's id under /presentations, or the other way round, is not found either: said in the side menu (Sidebar.razor).
  if (!presentation || presentation.deletedAt !== null || presentation.isTemplate !== template)
    return (
      <section className="flex-1 min-h-0 flex flex-col bg-ground">
        {/* The app's bar is not on a presentation's page: the way back is this. */}
        <nav data-window-bar className="flex items-center px-4 h-14 sm:h-13 shrink-0 sm:border-b-[0.5px] sm:border-separator bg-ground">
          <BackToPresentations />
        </nav>
        <p className="text-sm text-center text-stone-500 pt-10">{t(template ? 'templates.notFound' : 'presentation.notFound')}</p>
      </section>
    );

  // To the trash after a question, as every deletion asks (Lars, 2026-11-03; PRES-R29 had none), then a toast that
  // says where it went.
  const trash = () =>
    void ask(
      deleteAsk(t(template ? 'templates.trashConfirm' : 'presentation.trashConfirm', { name: presentation.name }), presentation.name, async () => {
        if (!(await trySave(db.mutate(template ? 'trashTemplate' : 'trashPresentation', { id, at: Date.now() })))) return;
        toast(trashedText(t('presentation.trashed', { name: presentation.name }), presentation.name));
        if (template) backToTemplates();
        else navigate({ page: 'presentations' });
      }),
    );

  // A row chosen in the running order; on a computer the slides scroll to it, each choice anew. While presenting, its
  // first slide is outlined for ↵, as ⌘↓ does; what is shown is not (the core's `select`).
  const select = (itemId: string) => send({ type: 'select', itemId });
  const current = pointer.itemId ? (slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null) : null;
  // A phone or an iPad held upright: one column with sheets, before and while presenting (docs/layout-2-0.md).
  const phone = !wide;
  // The presentation's menu: a handler only for what it offers, so the menu shows that and no more. A template has no
  // notes and links and is not saved as a template again; what is being presented is not put in the trash.
  const saveAsTemplate = !template && can(role, 'ManageTemplates') ? () => setSavingAsTemplate(true) : undefined;
  const showMaterials = !template ? () => setShowingMaterials(true) : undefined;
  const trashing = !presenting ? () => void trash() : undefined;
  // A host's own window keeps nothing (its server has it all), and a template is never presented.
  const keepOffline = !template && !isHostWindow() ? () => setKeepingOffline(true) : undefined;
  // An item's menu, the same from its row at the left and its heading's … (ItemContextMenu).
  // Where an addition goes, the core's one rule for every layout (`addAfter`).
  const afterFor = (chosen: string | null) =>
    addAfter({ order: items.map((i) => i.id), shownId: presenting ? liveItemId : null, lastAddedId, chosenId: chosen, selectedId });
  // A choice of +, or of "Lägg till efter": a heading is named at once; a kind opens the dialog of it.
  const choose = (afterId: string | null, choice: AddChoice) => {
    if (choice === 'header') return texts.addHeader({ afterItemId: afterFor(afterId) });
    setAdding({ after: afterId, kind: choice });
  };
  const menuSource: ItemMenuSource = {
    songs,
    arrangements: data.arrangements,
    overlays,
    // The item on the outputs, black or not: removed after Släck, the next → would start the order over (Lars, 2026-11-18).
    shownId: liveItemId,
    editHref: (item) => {
      const route = songPage(item, songs);
      return route && href(route);
    },
    onEditImages: (item) => setEditingImages(item.id),
    onAddAfter: (item, choice) => choose(item.id, choice),
    ...texts.menu,
    onTick: (item) => {
      setTickFirst(item.id);
      setTicking(true);
      // The ticks are in the running order: folded away, it opens to show them (Lars, 2026-11-04).
      panels.show('left');
    },
    onRemove: (item) => void removeItem(item),
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* The bar on a computer, before and while presenting; below `lg` the app's bar and the drawer have it all. */}
      {!phone && (
        <PresentationBar
          presentation={presentation}
          live={live}
          presenting={!!presenting}
          owner={owner}
          canStart={startable}
          onStart={start}
          onDetails={() => setDetails(true)}
          onSaveAsTemplate={saveAsTemplate}
          onMaterials={showMaterials}
          onTrash={trashing}
        />
      )}
      {template && <div className="bg-sky-500 text-white text-center py-1.5 text-sm font-medium shrink-0">{t('templates.banner')}</div>}
      {presenting && !owner && <RemoteBanner />}
      {presenting && <LiveKeys />}
      {/* ⌘K adds a song here, where Lägg till would (ui/CommandPalette.tsx). */}
      {!template && (
        <PaletteTarget
          addSong={async (song) => {
            const itemId = newId();
            const ok = await trySave(db.mutate('addSongToPresentation', { itemId, presentationId: id, songId: song.id, arrangementId: null, afterItemId: afterFor(null) }));
            if (!ok) return false;
            // Picked and scrolled to, and while presenting shown at once (ui/CommandPalette.tsx).
            added(itemId);
            select(itemId);
            if (presenting) send({ type: 'show', itemId, partIndex: 0 });
            return true;
          }}
          live={!!presenting}
          ends={!!presenting && !!owner}
          canStart={startable}
          onStart={start}
          onStep={(delta) => send({ type: 'step', delta })}
          onBlack={() => send({ type: 'black' })}
          shown={presenting && current && pointer.itemId ? { slide: current, itemId: pointer.itemId } : null}
          players={presenting}
          onChoose={(choice) => choose(null, choice)}
        />
      )}
      <section className="flex-1 min-h-0 flex relative">
        {dialog}
        {phone && (
          <PhoneLive
            id={id}
            presentation={presentation}
            items={items}
            slides={slides}
            theme={theme}
            songs={songs}
            arrangements={data.arrangements}
            overlays={overlays}
            overlay={overlay}
            live={live}
            pointer={pointer}
            presenting={presenting}
            page={page}
            canStart={startable}
            onStart={start}
            onDetails={() => setDetails(true)}
            onSaveAsTemplate={saveAsTemplate}
            onKeepOffline={keepOffline}
            onMaterials={showMaterials}
            onTrash={trashing}
          />
        )}
        {!phone && (
          <>
            <SideMenu presentation={presentation} media={!!presenting && !!owner} onOffline={() => setKeepingOffline(true)} open={panels.open.left} onFold={() => panels.toggle('left')} onEditDescription={can(role, 'ManagePresentations') ? () => setDetails(true) : undefined}>
              <RunningOrder
                items={items}
                slides={slides}
                selectedId={selectedId}
                shownId={pointer.black ? null : liveItemId}
                onSelect={select}
                onAdd={(choice) => choose(null, choice)}
                menuSource={menuSource}
                ticking={ticking}
                tickFirst={tickFirst}
                onTicking={(on) => {
                  setTicking(on);
                  if (!on) setTickFirst(null);
                }}
                overlays={overlays}
                lit={lit}
              />
            </SideMenu>
            <SlideList
              markedId={selectedId && lit.has(selectedId) ? selectedId : null}
              template={template}
              items={items}
              slides={slides}
              theme={theme}
              songs={songs}
              overlays={overlays}
              pointer={pointer}
              toItem={reveal}
              onShow={presenting ? (itemId, partIndex) => send({ type: 'show', itemId, partIndex }) : undefined}
              onAddImages={(itemId) => {
                page.send({ type: 'select', itemId });
                setAdding({ after: null, kind: 'images', images: true });
              }}
              menuSource={menuSource}
              editingImages={editingImages}
              onEditingImages={setEditingImages}
              picked={picked}
              onPick={(p) => send({ type: 'show', ...p })}
              only={selectedId ?? liveItemId}
              typing={!!presenting && !!page.state.typed}
            />
          </>
        )}
        {/* A folded column's way back, floating at the middle's foot (ui/PanelToggle.tsx); its way away is in its foot. */}
        {!phone && !panels.open.left && <FloatingPanelToggle side="left" onShow={() => panels.toggle('left')} />}
        {!phone && presenting && !panels.open.right && <FloatingPanelToggle side="right" onShow={() => panels.toggle('right')} />}
        {!phone && !panels.open.left && !ticking && <FloatingAdd onChoose={(choice) => choose(null, choice)} liveColumn={!presenting ? 'none' : panels.open.right ? 'open' : 'folded'} />}
        {!phone && presenting && (
          <LivePanel
            presentation={presentation}
            presenting={presenting}
            live={live}
            pointer={pointer}
            current={current}
            overlay={overlay}
            theme={theme}
            overlays={overlays}
            open={panels.open.right}
            onFold={() => panels.toggle('right')}
          />
        )}
        {!phone && adding && (
          <AddItemDialog
            presentationId={id}
            afterItemId={afterFor(adding.after)}
            kind={adding.kind}
            theme={theme}
            toItemId={adding.images ? (selectedId ?? undefined) : undefined}
            items={items}
            onAdded={(itemId) => {
              addedHere.current.push(itemId);
              added(itemId);
            }}
            onClose={closeAdding}
          />
        )}
        {texts.dialogs}
        {details &&
          (template ? (
            <EditTemplateDialog template={presentation} onClose={() => setDetails(false)} />
          ) : (
            <DetailsDialog presentation={presentation} onClose={() => setDetails(false)} />
          ))}
        {savingAsTemplate && <SaveAsTemplateDialog presentation={presentation} items={items} onClose={() => setSavingAsTemplate(false)} />}
        {keepingOffline && <OfflineDialog presentation={presentation} onClose={() => setKeepingOffline(false)} />}
        {showingMaterials && <PresentationMaterials items={items} onClose={() => setShowingMaterials(false)} />}
      </section>
    </div>
  );
}
