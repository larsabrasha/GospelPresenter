import type { LivePointer, Overlay, Presentation, PresentationItem, CustomPage, Song, SongArrangement, Theme, ItemSlides } from '@gp/core';
import { useRef, useState } from 'react';
import { orgRemoteControl } from '../../../db/queries.ts';
import { useData, useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { addAfter } from '../../../live/liveList.ts';
import type { PageControl } from '../../../live/pageState.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { FloatingSearchButton } from '../../../ui/CommandPalette.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { ItemBadge, PencilIcon, PlusIcon } from '../../../ui/icons.tsx';
import { href } from '../../../ui/router.ts';
import { Sheet } from '../../../ui/Sheet.tsx';
import { FLOATING_PRIMARY } from '../../../ui/glass.ts';
import { songPage } from '../songPage.ts';
import { LivePicture } from '../LivePicture.tsx';
import { AddItemDialog, addKinds, type AddChoice, type AddKind } from '../../presentation-editor/AddItemDialog.tsx';
import { useItemTexts } from '../../presentation-editor/HeaderDialog.tsx';
import { ImageItemEditor } from '../../presentation-editor/ItemParts.tsx';
import { ItemSheet } from './ItemSheet.tsx';
import { MenuGroup, MenuRow } from './MenuRows.tsx';
import { OfflineStatus } from '../../presentation-editor/OfflineStatus.tsx';
import { PresentationBar } from '../PresentationBar.tsx';
import { useLiveMotion } from '../liveMotion.ts';
import { SyncLine } from '../../../TopBar.tsx';
import { RunningOrder } from '../RunningOrder.tsx';
import { SlideList } from '../SlideList.tsx';
import type { Presenting } from '../../presentation-editor/PresentationEditor.tsx';
import { RemoteBanner } from '../RemoteBanner.tsx';
import { OverlaysPanel } from '../OverlaysPanel.tsx';
import { RemoteStatus } from '../RemotePanel.tsx';
import { OutputsPanel } from '../OutputsPanel.tsx';
import { DescriptionGlyph, DisplayGlyph } from './LiveGlyphs.tsx';
import { Description } from '../../presentation-editor/Description.tsx';

type Open = null | 'display' | 'description' | { item: PresentationItem } | { images: PresentationItem };

/** How long an item just added stays marked. */
const MARKED_MS = 2600;

/**
 * A presentation on a phone or an iPad held upright, the same before and while it is presented (docs/layout-2-0.md):
 * the bar (back, the title that opens the presentation's menu, … with Utgångar first, and ■ to end, or ▶ to start),
 * while presenting the picture with Släck under it, and the running order filling the rest. An item's … picks its
 * arrangement and overlay and edits its song or pictures; it has no Byt namn, which confused (Lars, 2026-11-02).
 */
export function PhoneLive({
  id,
  presentation,
  items,
  slides,
  theme,
  songs,
  arrangements,
  overlays,
  overlay,
  live,
  pointer,
  presenting,
  page,
  canStart,
  onStart,
  onDetails,
  onSaveAsTemplate,
  onKeepOffline,
  onMaterials,
  onTrash,
}: {
  id: string;
  presentation: Presentation;
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  songs: Map<string, Song>;
  arrangements: SongArrangement[];
  overlays: Overlay[];
  overlay: CustomPage | null;
  live: LiveControl;
  pointer: LivePointer;
  /** While presenting; before, the list only edits. */
  presenting?: Presenting;
  /** The page's own state, the same as a computer's (live/pageState.ts). */
  page: PageControl;
  /** ▶: not in a template, nor while another presentation is shown. */
  canStart: boolean;
  onStart: () => void;
  onDetails: () => void;
  onSaveAsTemplate?: () => void;
  /** The line under the running order while it is kept offline opens the dialog; not for a template, nor in the host's window. */
  onKeepOffline?: () => void;
  onMaterials?: () => void;
  onTrash?: () => void;
}) {
  const db = useDb();
  const { dialog, ask } = useConfirm();
  const remotePolicy = useData(orgRemoteControl, []);
  const [open, setOpen] = useState<Open>(null);
  // The add dialog: after the item named, or with `images` adding pictures to that image item. + first asks which kind
  // (`kind`), as on a computer (Lars, 2026-11-05), and the dialog shows that one only.
  const [adding, setAdding] = useState<{ chosenId: string | null; images?: string; kind?: AddKind } | null>(null);
  const choosingKind = !!adding && !adding.images && !adding.kind;
  // An item just added: scrolled to (a new object each time) and its heading marked for a moment.
  const [toAdded, setToAdded] = useState<{ id: string } | null>(null);
  // Headings and comments (spec 03 2f): a new heading is scrolled to, as an addition is; the page's state keeps it as
  // the last thing added (the core's, live/pageState.ts).
  const texts = useItemTexts(id, (itemId) => {
    page.send({ type: 'added', itemId });
    setToAdded({ id: itemId });
  });
  const [addedId, setAddedId] = useState<string | null>(null);
  // Select mode (Markera), from an item's …: the item it was chosen on ticked first.
  const [editing, setEditing] = useState<string | null>(null);
  const owner = presenting?.owner ?? null;
  // The picture's block, which takes its room before the picture fades in after a start (liveMotion.ts).
  const pictureArea = useRef<HTMLDivElement>(null);
  useLiveMotion(pictureArea, { shown: !!presenting });

  const current = pointer.itemId ? (slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null) : null;

  // Where an addition goes, the core's one rule: as on a computer, the item selected here is the one a tap made ready.
  const afterFor = (chosenId: string | null) =>
    addAfter({ order: items.map((i) => i.id), shownId: presenting ? pointer.itemId : null, lastAddedId: page.state.lastAddedId, chosenId, selectedId: page.state.selectedId });
  // A choice of + or of "Lägg till efter": a heading is named at once, a kind opens the dialog on it.
  const choose = (chosenId: string | null, choice: AddChoice) => {
    if (choice !== 'header') return setAdding({ chosenId, kind: choice });
    setAdding(null);
    texts.addHeader({ afterItemId: afterFor(chosenId) });
  };

  const remove = async (item: PresentationItem) => {
    setOpen(null);
    const ok = await ask({ title: t('common.delete'), text: t('presentation.removeConfirm', { title: item.title }), bold: item.title, confirm: t('common.delete'), compact: true });
    if (ok) await db.mutate('removeItem', { itemId: item.id });
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ground text-stone-900 dark:text-stone-100 p-safe" data-testid="phone-live">
      {dialog}
      {/* The same bar as on a computer (PresentationBar), its cog to Inställningar. */}
      <PresentationBar
        presentation={presentation}
        live={live}
        presenting={!!presenting}
        owner={owner}
        canStart={canStart}
        onStart={onStart}
        onDetails={onDetails}
        onSaveAsTemplate={onSaveAsTemplate}
        onMaterials={onMaterials}
        onTrash={onTrash}
      />

      {presentation.isTemplate && <div className="bg-sky-500 text-white text-center py-1.5 text-sm font-medium shrink-0">{t('templates.banner')}</div>}
      {presenting && !owner && <RemoteBanner />}
      {/* Lying down, two columns: the running order at the left, the picture and its buttons at the right (Lars,
          2026-11-02). */}
      <div className="flex-1 min-h-0 flex flex-col landscape:flex-row-reverse">
      {/* Above the running order, so the buttons' shadows fall over it rather than being cut by its sticky headings. */}
      {presenting && (
      <div ref={pictureArea} className="relative z-[2] px-4 pt-3 shrink-0 landscape:w-[45%] landscape:pt-3">
        {/* Upright, small at the left with its buttons at the right, so the running order keeps room to scroll (Lars,
            2026-11-08); lying down, as wide as its column. */}
        <LivePicture
          beside
          slide={current}
          theme={theme}
          overlay={overlay}
          black={pointer.black}
          onClear={() => live.set({ black: true })}
          testId="phone-live-picture"
          // Under Släck upright, at the ends of its row lying down (LivePicture).
          leading={presentation.description ? <DescriptionGlyph onClick={() => setOpen('description')} /> : undefined}
          trailing={
            (owner || !!overlays.length) && <DisplayGlyph link={owner ? presenting.link : null} sessionId={owner?.sessionId ?? ''} pointer={pointer} onClick={() => setOpen('display')} />
          }
          players={presenting}
          itemId={pointer.itemId}
        />
      </div>
      )}

      {/* No heading over the running order; Lägg till floats at the bottom right as a round glass +, as iOS 27's
          Notes and Reminders put "new", far enough from the edges that its shadow is not cut. Moving is reached from an
          item's … (Ändra ordning); Klar takes the +'s place. */}
      <div className="h-3 shrink-0 landscape:hidden" />
      {/* In select mode its own Klar and removal take the foot (RunningOrder). */}
      {!editing && <FloatingSearchButton />}
      {!editing && (
        <AppButton variant="plain" aria-label={t('live.add')} title={t('live.add')} onClick={() => setAdding({ chosenId: null })} className={`absolute z-10 right-7 landscape:right-[calc(45%+0.75rem)] bottom-[max(1.75rem,env(safe-area-inset-bottom))] size-14 rounded-full flex items-center justify-center cursor-pointer ${FLOATING_PRIMARY}`}>
          <PlusIcon className="size-6" strokeWidth={2.25} />
        </AppButton>
      )}
      {editing ? (
        // The computer's running order in its select mode, as iOS's lists edit (Lars, 2026-11-02).
        <RunningOrder
          items={items}
          slides={slides}
          selectedId={null}
          shownId={pointer.black ? null : pointer.itemId}
          onSelect={() => {}}
          onAdd={(choice) => choose(null, choice)}
          // A row's menu here is the computer's (ItemContextMenu); its pictures open in their sheet, as the item's own sheet has them.
          menuSource={{
            songs,
            arrangements,
            overlays,
            shownId: presenting ? pointer.itemId : null,
            editHref: (item) => {
              const route = songPage(item, songs);
              return route && href(route);
            },
            onEditImages: (item) => setOpen({ images: item }),
            onAddAfter: (item, choice) => choose(item.id, choice),
            ...texts.menu,
            onTick: (item) => setEditing(item.id),
            onRemove: (item) => void remove(item),
          }}
          ticking
          tickFirst={editing}
          onTicking={(on) => !on && setEditing(null)}
        />
      ) : (
        <SlideList
          template={presentation.isTemplate}
          items={items}
          slides={slides}
          theme={theme}
          songs={songs}
          overlays={overlays}
          pointer={pointer}
          toItem={toAdded}
          markedId={addedId}
          // A part tapped: shown while presenting; before, made ready and its item selected, as on a computer (the
          // page's state, Lars 2026-11-18), so + adds after it.
          onShow={presenting ? (itemId, partIndex) => page.send({ type: 'show', itemId, partIndex }) : undefined}
          picked={page.state.picked}
          onPick={(p) => page.send({ type: 'show', ...p })}
          onItemMenu={(item) => setOpen({ item })}
          // Before presenting, the description at the top of the list, as a computer has it atop its left column; while
          // presenting, behind the button left of Släck (Lars, 2026-11-03).
          header={!presenting && !!presentation.description && <Description key={presentation.description} text={presentation.description} className="mt-4" />}
          // Whether it is kept offline and Fjärrstyrning at the foot of the list (Lars, 2026-11-02), as a computer has
          // them at the foot of its columns.
          footer={
            <>
              <SyncLine className="w-auto" fallback={onKeepOffline && <OfflineStatus presentation={presentation} onOpen={onKeepOffline} className="w-auto" />} />
              {owner && remotePolicy && remotePolicy !== 'never' && (
                <RemoteStatus id={id} sessionId={owner.sessionId} always={remotePolicy === 'always'} className="w-auto" />
              )}
            </>
          }
        />
      )}
      </div>

      {/* Beskrivning: the text to read, and the way to change it (Lars, 2026-11-03). */}
      {open === 'description' && presentation.description && (
        <Sheet title={t('presentation.description')} onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-5">
            <p className="rounded-[1.375rem] bg-sheet-cell px-4 py-3.5 text-[17px] whitespace-pre-line select-text" data-testid="description-sheet">
              {presentation.description}
            </p>
            <MenuGroup>
              <MenuRow icon={<PencilIcon className="size-5" />} onClick={onDetails}>
                {t('presentation.editDetailsMenu')}
              </MenuRow>
            </MenuGroup>
          </div>
        </Sheet>
      )}
      {/* Visning: the outputs and the overlays in one sheet, each its group (Lars, 2026-11-02). */}
      {open === 'display' && presenting && (
        <Sheet title={t('live.display')} onClose={() => setOpen(null)}>
          {owner && <OutputsPanel link={presenting.link} sessionId={owner.sessionId} sheet />}
          <OverlaysPanel overlays={overlays} pointer={pointer} live={live} sheet />
        </Sheet>
      )}
      {open && typeof open === 'object' && 'images' in open && (
        <Sheet title={open.images.title} onClose={() => setOpen(null)}>
          <ImageItemEditor item={open.images} slides={slides.get(open.images.id)?.slides ?? []} theme={theme} onAddImages={() => setAdding({ chosenId: null, images: open.images.id })} />
        </Sheet>
      )}
      {open && typeof open === 'object' && 'item' in open && (
        <ItemSheet
          item={items.find((i) => i.id === open.item.id) ?? open.item}
          songs={songs}
          arrangements={arrangements}
          overlays={overlays}
          shownId={presenting ? pointer.itemId : null}
          on={{
            ...texts.menu,
            onEditImages: (item) => setOpen({ images: item }),
            onAddAfter: (item) => setAdding({ chosenId: item.id }),
            onTick: (item) => setEditing(item.id),
            onRemove: (item) => void remove(item),
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {choosingKind && <AddKindSheet onChoose={(choice) => choose(adding.chosenId, choice)} onClose={() => setAdding(null)} />}
      {texts.dialogs}
      {adding && !choosingKind && (
        <AddItemDialog
          kind={adding.images ? 'images' : adding.kind!}
          presentationId={id}
          afterItemId={afterFor(adding.chosenId)}
          theme={theme}
          toItemId={adding.images}
          onAdded={(itemId) => {
            page.send({ type: 'added', itemId });
            setToAdded({ id: itemId });
            setAddedId(itemId);
            setTimeout(() => setAddedId((now) => (now === itemId ? null : now)), MARKED_MS);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

/** What + adds, asked first (Lars, 2026-11-04): the kinds as a menu, Sånger first, the most used; Rubrik under them. */
function AddKindSheet({ onChoose, onClose }: { onChoose: (choice: AddChoice) => void; onClose: () => void }) {
  return (
    <Sheet title={t('presentation.addTitle')} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <MenuGroup>
          {addKinds().map(([kind, label, , type]) => (
            <MenuRow key={kind} icon={<ItemBadge type={type} />} onClick={() => onChoose(kind)}>
              {label}
            </MenuRow>
          ))}
        </MenuGroup>
        {/* Made, not chosen from a library: a group of its own, under the kinds (Lars, 2026-11-05). */}
        <MenuGroup>
          <MenuRow icon={<ItemBadge type="header" />} onClick={() => onChoose('header')}>
            {t('header.kind')}
          </MenuRow>
        </MenuGroup>
      </div>
    </Sheet>
  );
}
