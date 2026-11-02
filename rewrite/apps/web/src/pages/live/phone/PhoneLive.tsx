import { sortedArrangements, type LivePointer, type Overlay, type Presentation, type PresentationItem, type Song, type SongArrangement, type Theme } from '@gp/core';
import { Children, useState, type ReactNode } from 'react';
import { orgRemoteControl, type ShownOverlay } from '../../../db/queries.ts';
import { useData, useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { addAfter } from '../../../live/liveList.ts';
import type { ItemSlides } from '../../../live/live.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { CheckSquareIcon, CogIcon, DesktopIcon, PencilIcon, PlusIcon, RemoteIcon, SquaresOverlapIcon, TrashIcon } from '../../../ui/icons.tsx';
import { href, navigate } from '../../../ui/router.ts';
import { GROUP, Sheet, useSheetDismiss } from '../../../ui/Sheet.tsx';
import { FLOATING_PRIMARY } from '../../../ui/glass.ts';
import { songPage } from '../songPage.ts';
import { LivePicture } from '../LivePicture.tsx';
import { AddItemDialog } from '../../presentation-editor/AddItemDialog.tsx';
import { ImageItemEditor, ItemSettings } from '../../presentation-editor/ItemParts.tsx';
import { OfflineStatus } from '../../presentation-editor/OfflineStatus.tsx';
import { PresentationBar } from '../PresentationBar.tsx';
import { RunningOrder } from '../RunningOrder.tsx';
import { SlideList } from '../SlideList.tsx';
import type { Presenting } from '../../presentation-editor/PresentationEditor.tsx';
import { RemoteBanner } from '../RemoteBanner.tsx';
import { OverlaysPanel } from '../OverlaysPanel.tsx';
import { RemotePanel } from '../RemotePanel.tsx';
import { VideoPlayer } from '../VideoPlayer.tsx';
import { OutputsList } from './OutputsList.tsx';

type Open = null | 'outputs' | 'more' | 'overlays' | 'remote' | { item: PresentationItem } | { images: PresentationItem };

/** How long an item just added stays marked. */
const MARKED_MS = 2600;
/** A row of a sheet's menu. */
const ROW = 'w-full min-h-12 px-4 flex items-center gap-3.5 text-[17px] text-left cursor-pointer';

/**
 * A presentation on a phone or an iPad held upright, the same before and while it is presented (docs/layout-2-0.md):
 * the bar (back, the title that opens the presentation's menu, … with Utgångar first, and ■ to end, or ▶ to start),
 * while presenting the picture with ‹ Rensa › under it, and the running order filling the rest. An item's … picks its
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
  overlay: ShownOverlay | null;
  live: LiveControl;
  pointer: LivePointer;
  /** While presenting; before, the list only edits. */
  presenting?: Presenting;
  /** ▶: not in a template, nor while another presentation is shown. */
  canStart: boolean;
  onStart: () => void;
  onDetails: () => void;
  onSaveAsTemplate?: () => void;
  /** The line under the running order while it is kept offline opens the dialog; not for a template, nor in the host's window. */
  onKeepOffline?: () => void;
  onMaterials?: () => void;
  onTrash: () => void;
}) {
  const db = useDb();
  const { dialog, ask } = useConfirm();
  const remotePolicy = useData(orgRemoteControl, []);
  const [open, setOpen] = useState<Open>(null);
  // The add dialog: after the item named, or with `images` adding pictures to that image item.
  const [adding, setAdding] = useState<{ chosenId: string | null; images?: string } | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  // What was added before presenting does not decide where an addition goes while presenting (liveList.ts).
  const [wasPresenting, setWasPresenting] = useState(!!presenting);
  if (wasPresenting !== !!presenting) {
    setWasPresenting(!!presenting);
    setLastAddedId(null);
  }
  // An item just added: scrolled to (a new object each time) and its heading marked for a moment.
  const [toAdded, setToAdded] = useState<{ id: string } | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  // Select mode (Markera), from an item's …: the item it was chosen on ticked first.
  const [editing, setEditing] = useState<string | null>(null);
  const owner = presenting?.owner ?? null;

  const steps = items.flatMap((item) => (slides.get(item.id)?.slides ?? []).map((_, partIndex) => ({ itemId: item.id, partIndex })));
  const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
  const go = (to: number) => {
    const target = steps[Math.max(0, Math.min(steps.length - 1, to))];
    if (target) live.set({ ...target, black: false });
  };
  const current = pointer.itemId ? (slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null) : null;
  const video = pointer.itemId ? slides.get(pointer.itemId)?.video : undefined;

  const remove = async (item: PresentationItem) => {
    setOpen(null);
    const ok = await ask({ title: t('common.delete'), text: t('presentation.removeConfirm', { title: item.title }), bold: item.title, confirm: t('common.delete'), compact: true });
    if (ok) await db.mutate('removeItem', { itemId: item.id });
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ground text-stone-900 dark:text-stone-100 pt-[env(safe-area-inset-top)]" data-testid="phone-live">
      {dialog}
      {/* The same bar as on a computer (PresentationBar), its … opening the sheet with the rest. */}
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
        onMore={() => setOpen('more')}
      />

      {presentation.isTemplate && <div className="bg-sky-500 text-white text-center py-1.5 text-sm font-medium shrink-0">{t('templates.banner')}</div>}
      {presenting && !owner && <RemoteBanner />}
      {/* Lying down, two columns: the running order at the left, the picture and its buttons at the right (Lars,
          2026-11-02). */}
      <div className="flex-1 min-h-0 flex flex-col landscape:flex-row-reverse">
      {/* Above the running order, so the buttons' shadows fall over it rather than being cut by its sticky headings. */}
      {presenting && (
      <div className="relative z-[2] px-4 pt-2 shrink-0 landscape:w-[45%] landscape:pt-3">
        {/* At most a fifth of the screen high, so a small phone keeps room for the running order (Lars, 2026-11-02);
            lying down, as wide as its column. */}
        <LivePicture
          maxWidthClass="max-w-[calc(20svh*16/9)] landscape:max-w-none"
          slide={current}
          theme={theme}
          overlay={overlay}
          black={pointer.black}
          canStep={{ back: at > 0, forward: at === -1 ? steps.length > 0 : at < steps.length - 1 }}
          onStep={(delta) => go(at + delta)}
          onClear={() => live.set({ black: true })}
          testId="phone-live-picture"
        >
          {video && pointer.itemId && presenting.video && <VideoPlayer control={presenting.video} itemId={pointer.itemId} name={video.fileName} type={video.contentType} codec={video.codec} />}
        </LivePicture>
      </div>
      )}

      {/* No heading over the running order; Lägg till floats at the bottom right as a round glass +, as iOS 27's
          Notes and Reminders put "new", far enough from the edges that its shadow is not cut. Moving is reached from an
          item's … (Ändra ordning); Klar takes the +'s place. */}
      <div className="h-3 shrink-0 landscape:hidden" />
      {/* Whether it is kept offline, at the foot of the view in the middle, level with the +, as Mail's "Uppdaterad
          nyss" (Lars, 2026-11-02); lying down, under the running order. */}
      {onKeepOffline && !editing && (
        <div className="absolute z-10 left-0 right-0 landscape:right-[45%] bottom-[max(1.75rem,env(safe-area-inset-bottom))] h-14 flex items-center justify-center pointer-events-none">
          <OfflineStatus presentation={presentation} onOpen={onKeepOffline} className="w-auto pointer-events-auto" />
        </div>
      )}
      {/* In select mode its own Klar and removal take the foot (RunningOrder). */}
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
          onAddAfter={(itemId) => setAdding({ chosenId: itemId })}
          onRemove={(item) => void remove(item)}
          editHref={(item) => {
            const page = songPage(item, songs);
            return page && href(page);
          }}
          ticking
          tickFirst={editing}
          onTicking={(on) => !on && setEditing(null)}
        />
      ) : (
        <SlideList
          items={items}
          slides={slides}
          theme={theme}
          songs={songs}
          arrangements={arrangements}
          overlays={overlays}
          pointer={pointer}
          players={presenting ? { audio: presenting.audio } : undefined}
          toItem={toAdded}
          markedId={addedId}
          onShow={presenting ? (itemId, partIndex) => live.set({ itemId, partIndex, black: false }) : undefined}
          onItemMenu={(item) => setOpen({ item })}
        />
      )}
      </div>

      {open === 'outputs' && presenting && owner && (
        <Sheet title={t('live.outputs')} onClose={() => setOpen(null)}>
          <OutputsList link={presenting.link} sessionId={owner.sessionId} />
        </Sheet>
      )}
      {open === 'overlays' && presenting && (
        <Sheet title={t('overlays.title')} onClose={() => setOpen(null)}>
          <OverlaysPanel overlays={overlays} pointer={pointer} live={live} bare />
        </Sheet>
      )}
      {open === 'remote' && owner && remotePolicy && remotePolicy !== 'never' && (
        <Sheet title={t('live.remote')} onClose={() => setOpen(null)}>
          <RemotePanel id={id} sessionId={owner.sessionId} name={presentation.name} always={remotePolicy === 'always'} />
        </Sheet>
      )}
      {open === 'more' && (
        <Sheet title={presentation.name} onClose={() => setOpen(null)}>
          {/* What is shown, then the app. The presentation's own (details, Noter och länkar, Spara som mall, to the
              trash) is the title's menu, as on a computer. */}
          <div className="flex flex-col gap-5">
            <MenuGroup>
              {owner && (
                <MenuRow icon={<DesktopIcon className="size-5" />} onClick={() => setOpen('outputs')}>
                  {t('live.outputs')}
                </MenuRow>
              )}
              {presenting && !!overlays.length && (
                <MenuRow icon={<SquaresOverlapIcon className="size-5" />} onClick={() => setOpen('overlays')}>
                  {t('overlays.title')}
                </MenuRow>
              )}
              {owner && remotePolicy && remotePolicy !== 'never' && (
                <MenuRow icon={<RemoteIcon className="size-5" />} onClick={() => setOpen('remote')}>
                  {t('live.remote')}
                </MenuRow>
              )}
            </MenuGroup>
            <MenuGroup>
              <MenuRow icon={<CogIcon className="size-5" />} onClick={() => (setOpen(null), navigate({ page: 'admin' }))}>
                {t('nav.admin')}
              </MenuRow>
            </MenuGroup>
          </div>
        </Sheet>
      )}
      {open && typeof open === 'object' && 'images' in open && (
        <Sheet title={open.images.title} onClose={() => setOpen(null)}>
          <ImageItemEditor item={open.images} slides={slides.get(open.images.id)?.slides ?? []} theme={theme} onAddImages={() => setAdding({ chosenId: null, images: open.images.id })} />
        </Sheet>
      )}
      {open && typeof open === 'object' && 'item' in open && (
        <Sheet title={open.item.title} onClose={() => setOpen(null)}>
          {/* Grouped as the presentation's …: where it stands, the item itself, its settings, and to the trash last. */}
          <div className="flex flex-col gap-5">
            <MenuGroup>
              <MenuRow icon={<PlusIcon className="size-5" />} onClick={() => (setOpen(null), setAdding({ chosenId: open.item.id }))}>
                {t('live.addAfter')}
              </MenuRow>
              <MenuRow icon={<CheckSquareIcon className="size-5" />} onClick={() => (setOpen(null), setEditing(open.item.id))}>
                {t('presentation.tick')}
              </MenuRow>
            </MenuGroup>
            <MenuGroup>
              {songPage(open.item, songs) && (
                <MenuRow icon={<PencilIcon className="size-5" />} onClick={() => (setOpen(null), navigate(songPage(open.item, songs)!))}>
                  {t('presentation.editSong')}
                </MenuRow>
              )}
              {open.item.type === 'image' && (
                <MenuRow icon={<PencilIcon className="size-5" />} onClick={() => setOpen({ images: open.item })}>
                  {t('presentation.editImages')}
                </MenuRow>
              )}
            </MenuGroup>
            <div className="px-2 empty:hidden">
              <ItemSettings
                item={open.item}
                song={songs.get(open.item.sourceId)}
                arrangements={open.item.type === 'song' ? sortedArrangements(arrangements, open.item.sourceId) : []}
                overlays={overlays}
              />
            </div>
            <MenuGroup>
              <MenuRow icon={<TrashIcon className="size-5" />} onClick={() => void remove(open.item)} danger disabled={!!presenting && open.item.id === pointer.itemId}>
                {presenting && open.item.id === pointer.itemId ? t('live.shownCannotRemove') : t('common.delete')}
              </MenuRow>
            </MenuGroup>
          </div>
        </Sheet>
      )}
      {adding && (
        <AddItemDialog
          presentationId={id}
          afterItemId={addAfter({ order: items.map((i) => i.id), shownId: presenting ? pointer.itemId : null, lastAddedId, chosenId: adding.chosenId })}
          theme={theme}
          toItemId={adding.images}
          onAdded={(itemId) => {
            setLastAddedId(itemId);
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

/** A choice in a sheet's menu, its icon first, as iOS 27 draws them; choosing it closes the sheet. */
/** One rounded group of rows; with no row in it (each is conditional) it takes no room. */
function MenuGroup({ children }: { children: ReactNode }) {
  if (!Children.toArray(children).length) return null;
  return <div className={GROUP}>{children}</div>;
}

function MenuRow({ icon, onClick, danger, disabled, children }: { icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  // The sheet slides away first, as on iOS, then the choice is carried out.
  const dismiss = useSheetDismiss();
  return (
    <AppButton variant="plain" onClick={() => dismiss(onClick)} disabled={disabled} className={`${ROW} ${danger ? 'text-red-500' : ''} disabled:text-stone-400 disabled:cursor-default disabled:text-[15px]`}>
      {icon && <span className={`shrink-0 flex ${danger || disabled ? '' : 'text-stone-500 dark:text-stone-400'}`}>{icon}</span>}
      <span>{children}</span>
    </AppButton>
  );
}
