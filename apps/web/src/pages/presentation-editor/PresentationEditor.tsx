import { can, presentingKey, slideOrder, type PresentationItem, type PresentingKey, type Role } from '@gp/core';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useData, useDb, useShownOverlay } from '../../db/react.tsx';
import { arrangementsOf, getPresentation, itemsOf, listOverlays, songsById, themeOf } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { slidesOfItems } from '../../live/live.ts';
import { addAfter } from '../../live/liveList.ts';
import { useSaveFailed, useTrySave } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { deleteAsk, useConfirm } from '../../ui/Dialog.tsx';
import { backToTemplates, href, navigate } from '../../ui/router.ts';
import { songPage } from '../live/songPage.ts';
import { newId } from '../../ids.ts';
import { useAppCommand } from '../../ui/appKeys.ts';
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
import { SlideList, type SlidePick } from '../live/SlideList.tsx';
import { LivePanel } from '../live/LivePanel.tsx';
import { PhoneLive } from '../live/phone/PhoneLive.tsx';
import { RemoteBanner } from '../live/RemoteBanner.tsx';
import { EditTemplateDialog } from '../Templates.tsx';
import { useToast } from '../../ui/Toast.tsx';
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
  const data = useData(
    async (d) => {
      const items = await itemsOf(d, id);
      const songIds = [...new Set(items.filter((i) => i.type === 'song').map((i) => i.sourceId))];
      const slides = await slidesOfItems(d, items);
      const presentation = await getPresentation(d, id);
      return {
        presentation,
        theme: await themeOf(d, presentation),
        items,
        slides,
        songs: await songsById(d, songIds),
        arrangements: await arrangementsOf(d, songIds),
        overlays: await listOverlays(d),
      };
    },
    [id],
  );
  // This window's live slide: its item is marked in the running order and selected on open.
  const pointer = useLivePointer(live);
  const liveItemId = pointer.presentationId === id ? pointer.itemId : null;
  // On open, the item shown live, else the one selected when this presentation was last open (Presentation.razor).
  const [selectedId, setSelectedIdState] = useState<string | null>(() => liveItemId ?? lastSelected.get(id) ?? null);
  const setSelectedId = (itemId: string | null) => {
    setSelectedIdState(itemId);
    if (itemId) lastSelected.set(id, itemId);
  };
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
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const added = (itemId: string) => {
    setSelectedId(itemId);
    setLastAddedId(itemId);
  };
  // Headings and comments (spec 03 2f): a new heading is selected, as an addition is.
  const texts = useItemTexts(id, added);
  // Before presenting, the slide picked: outlined in blue and shown nowhere, moved by the keys that step while
  // presenting (Lars, 2026-11-03: to click and step around and point one out).
  const [picked, setPicked] = useState<SlidePick | null>(null);
  // What was added before presenting does not decide where an addition goes while presenting; Starta presentation
  // lets go of the slide picked too.
  const [wasPresenting, setWasPresenting] = useState(!!presenting);
  if (wasPresenting !== !!presenting) {
    setWasPresenting(!!presenting);
    setLastAddedId(null);
    setPicked(null);
  }
  const [details, setDetails] = useState(false);
  const [savingAsTemplate, setSavingAsTemplate] = useState(false);
  // Spara offline…: its dialog, from the menu or the line at the foot of the left column.
  const [keepingOffline, setKeepingOffline] = useState(false);
  // Noter och länkar…: the songs' sheet music, recordings and links, for the band.
  const [showingMaterials, setShowingMaterials] = useState(false);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  // Presenting: this window's own session, or none while controlling one elsewhere.
  const owner = presenting?.owner ?? null;
  const wide = useWide();
  // An item chosen at the left on a computer scrolls the slides to it, each choice anew.
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const overlay = useShownOverlay(pointer.overlayId);
  // The item shown live is the one selected, as a slide stepped into the next item takes the selection along, and
  // lets go of a slide outlined to show next (useEditorKeys.ts).
  const [followed, setFollowed] = useState(liveItemId);
  if (presenting && liveItemId !== followed) {
    setFollowed(liveItemId);
    if (liveItemId) setSelectedId(liveItemId);
    setPicked(null);
  }
  useAutoOutputs(!!owner);
  // An output closed because the app's window was moved onto its display says so, so a dark projector is no surprise.
  useEffect(() => window.gpDesktop?.onOutputClosedHere((name) => toast(t('live.outputClosedHere', { name }))), [toast]);
  // The screen stays awake while this computer presents (Presentation.razor's wake lock).
  useWakeLock(!!owner);

  /** Every slide of the running order, in order: what → and ← step through while presenting. */
  const order = useMemo(() => (data ? slideOrder(data.items.map((item) => ({ itemId: item.id, parts: data.slides.get(item.id)?.slides.length ?? 0 }))) : []), [data]);
  // A key's effect is the core's (presentingKey): what is shown goes to the outputs, the outline here, which takes the
  // selection along.
  const press = (key: PresentingKey) => {
    const now = { presenting: !!presenting, shown: { itemId: pointer.itemId, partIndex: pointer.partIndex, black: pointer.black }, picked };
    const next = presentingKey(order, now, key);
    if (next.shown !== now.shown) live.set(next.shown);
    if (next.picked !== now.picked) {
      setPicked(next.picked);
      if (next.picked) setSelectedId(next.picked.itemId);
    }
  };

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

  // Page shortcuts (useEditorKeys.ts). Starta presentation stays on the page, which turns to presenting
  // (Presentation.razor's StartPresentation).
  const startable = !template && pointer.presentationId === null;
  // A start always brings the live column out, folded or not before (Lars, 2026-11-03), so it slides in with the picture.
  const start = () => {
    panels.show('right');
    live.set({ presentationId: id, itemId: null, partIndex: 0, black: false });
  };
  useShortcutGroup(KEYS);
  // Starta presentation by the desktop app's menu bar, as by F5 and ⌥⌘P below.
  useAppCommand('start', () => startable && start());
  const { cueText } = useEditorKeys({
    ticking,
    presenting: !!presenting,
    liveItemId,
    items,
    slides: data?.slides,
    selected,
    setSelectedId,
    picked,
    shown: presenting && pointer.itemId ? { itemId: pointer.itemId, partIndex: pointer.partIndex } : null,
    setPicked,
    press,
    start: startable ? start : null,
    onAdd: () => setAdding({ after: null, kind: 'songs' }),
    onRemove: (item) => void removeItem(item),
    onMove: (item, by) => failing(db.mutate('moveItem', { itemId: item.id, by })),
    onReveal: (itemId) => setReveal((r) => ({ id: itemId, n: (r?.n ?? 0) + 1 })),
  });

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
        toast(t('presentation.trashed', { name: presentation.name }));
        if (template) backToTemplates();
        else navigate({ page: 'presentations' });
      }),
    );

  // A row chosen in the running order; on a computer the slides scroll to it, each choice anew.
  const select = (itemId: string) => {
    setSelectedId(itemId);
    setReveal((r) => ({ id: itemId, n: (r?.n ?? 0) + 1 }));
    // While presenting, its first slide is outlined for ↵, as ↓ does; what is shown is not.
    if (presenting) setPicked(itemId !== liveItemId && slides.get(itemId)?.slides.length ? { itemId, partIndex: 0 } : null);
  };
  const current = pointer.itemId ? (slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null) : null;
  // A phone or an iPad held upright: one column with sheets, before and while presenting (docs/layout-2-0.md).
  const phone = !wide;
  const saveAsTemplate = !template && can(role, 'ManageTemplates') ? () => setSavingAsTemplate(true) : undefined;
  // A host's own window keeps nothing (its server has it all), and a template is never presented.
  const keepOffline = !template && !isHostWindow() ? () => setKeepingOffline(true) : undefined;
  // An item's menu, the same from its row at the left and its heading's … (ItemContextMenu).
  // While presenting, after what is shown or the last addition still ahead, unless "Lägg till efter" named the place.
  const afterFor = (chosen: string | null) =>
    presenting ? addAfter({ order: items.map((i) => i.id), shownId: liveItemId, lastAddedId, chosenId: chosen, selectedId }) : (chosen ?? selectedId);
  // A choice of +, or of "Lägg till efter": a heading is named at once; a kind opens the dialog of it.
  const choose = (afterId: string | null, choice: AddChoice) => {
    if (choice === 'header') return texts.addHeader({ afterItemId: afterFor(afterId) });
    setAdding({ after: afterId, kind: choice });
  };
  const menuSource: ItemMenuSource = {
    songs,
    arrangements: data.arrangements,
    overlays,
    shownId: pointer.black ? null : liveItemId,
    editHref: (item) => {
      const page = songPage(item, songs);
      return page && href(page);
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
          onMaterials={template ? undefined : () => setShowingMaterials(true)}
          onTrash={() => void trash()}
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
            if (presenting) live.set({ itemId, partIndex: 0, black: false });
            return true;
          }}
          live={!!presenting}
          ends={!!presenting && !!owner}
          canStart={startable}
          onStart={start}
          onStep={(delta) => press({ type: 'step', delta })}
          onBlack={() => live.set({ black: true })}
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
            canStart={startable}
            onStart={start}
            onDetails={() => setDetails(true)}
            onSaveAsTemplate={saveAsTemplate}
            onKeepOffline={keepOffline}
            onMaterials={template ? undefined : () => setShowingMaterials(true)}
            onTrash={() => void trash()}
          />
        )}
        {!phone && (
          <>
            <SideMenu presentation={presentation} media={!!presenting && !!owner} onOffline={() => setKeepingOffline(true)} open={panels.open.left} onFold={() => panels.toggle('left')}>
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
              />
            </SideMenu>
            <SlideList
              template={template}
              items={items}
              slides={slides}
              theme={theme}
              songs={songs}
              overlays={overlays}
              pointer={pointer}
              toItem={reveal}
              onShow={
                presenting
                  ? (itemId, partIndex) => {
                      setPicked(null);
                      live.set({ itemId, partIndex, black: false });
                    }
                  : undefined
              }
              onAddImages={(itemId) => {
                setSelectedId(itemId);
                setAdding({ after: null, kind: 'images', images: true });
              }}
              menuSource={menuSource}
              editingImages={editingImages}
              onEditingImages={setEditingImages}
              picked={picked}
              onPick={(p) => {
                setPicked(p);
                setSelectedId(p.itemId);
              }}
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
            cue={cueText}
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
            onAdded={added}
            onClose={() => setAdding(null)}
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
