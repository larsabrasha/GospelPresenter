import type { LivePointer, Overlay, Presentation, PresentationItem, Theme } from '@gp/core';
import { useState, type ReactNode } from 'react';
import { orgRemoteControl, type ShownOverlay } from '../../../db/queries.ts';
import { useData, useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { addAfter } from '../../../live/liveList.ts';
import type { ItemSlides } from '../../../live/live.ts';
import { outputWindow } from '../../../live/outputWindow.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { ArrowsPointingOutIcon, ChevronDownIcon, ChevronLeftIcon, CloseIcon, DesktopIcon, EllipsisIcon, GripIcon, InformationCircleIcon, PencilIcon, PlusIcon, RemoteIcon, SquaresOverlapIcon, StopIcon, TrashIcon } from '../../../ui/icons.tsx';
import { href, navigate } from '../../../ui/router.ts';
import { GROUP, Sheet } from '../../../ui/Sheet.tsx';
import { SlideView } from '../../../ui/SlideView.tsx';
import { AddItemDialog } from '../../presentation-editor/AddItemDialog.tsx';
import type { Presenting } from '../../presentation-editor/PresentationEditor.tsx';
import { OverlaysPanel } from '../OverlaysPanel.tsx';
import { RemotePanel } from '../RemotePanel.tsx';
import { VideoPlayer } from '../VideoPlayer.tsx';
import { LiveEditList } from './LiveEditList.tsx';
import { LiveOrder } from './LiveOrder.tsx';
import { OutputsList } from './OutputsList.tsx';

type Open = null | 'outputs' | 'more' | 'overlays' | 'remote' | { item: PresentationItem };

/** A round glass button of the bar, as iOS 26 draws them. */
const GLASS = 'bg-white/70 dark:bg-surface/60 backdrop-blur-md shadow-[inset_0_0.5px_0_rgba(255,255,255,0.22),0_8px_28px_rgba(0,0,0,0.25)]';
/** How long an item just added stays marked. */
const MARKED_MS = 2600;
/** A row of a sheet's menu. */
const ROW = 'w-full min-h-12 px-4 flex items-center gap-3.5 text-[17px] text-left cursor-pointer';

/**
 * Presenting on a phone or an iPad held upright (docs/layout-2-0.md): the bar (back, the title that opens the
 * details, Utgångar and …), the picture with ‹ Rensa › under it, and the running order filling the rest.
 */
export function PhoneLive({
  id,
  presentation,
  items,
  slides,
  theme,
  overlays,
  overlay,
  live,
  pointer,
  presenting,
  onStage,
  onDetails,
}: {
  id: string;
  presentation: Presentation;
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  overlays: Overlay[];
  overlay: ShownOverlay | null;
  live: LiveControl;
  pointer: LivePointer;
  presenting: Presenting;
  onStage: () => void;
  onDetails: () => void;
}) {
  const db = useDb();
  const { dialog, ask } = useConfirm();
  const remotePolicy = useData(orgRemoteControl, []);
  const [open, setOpen] = useState<Open>(null);
  const [adding, setAdding] = useState<{ chosenId: string | null } | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const owner = presenting.owner;

  const steps = items.flatMap((item) => (slides.get(item.id)?.slides ?? []).map((_, partIndex) => ({ itemId: item.id, partIndex })));
  const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
  const go = (to: number) => {
    const target = steps[Math.max(0, Math.min(steps.length - 1, to))];
    if (target) live.set({ ...target, black: false });
  };
  const current = pointer.itemId ? (slides.get(pointer.itemId)?.slides[pointer.partIndex] ?? null) : null;
  const video = pointer.itemId ? slides.get(pointer.itemId)?.video : undefined;
  const place = [presentation.time, presentation.location].filter(Boolean).join(' · ');

  const end = async () => {
    setOpen(null);
    const ok = await ask({ title: t('live.end'), text: t('live.endText'), confirm: t('live.end'), compact: true });
    if (!ok) return;
    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
    outputWindow().turn(false);
  };
  const remove = async (item: PresentationItem) => {
    setOpen(null);
    const ok = await ask({ title: t('common.delete'), text: t('presentation.removeConfirm', { title: item.title }), bold: item.title, confirm: t('common.delete'), compact: true });
    if (ok) await db.mutate('removeItem', { itemId: item.id });
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ground text-neutral-900 dark:text-neutral-100 pt-[env(safe-area-inset-top)]" data-testid="phone-live">
      {dialog}
      <div className="grid grid-cols-[6rem_minmax(0,1fr)_6rem] items-center gap-2 h-15 px-4 shrink-0">
        <a href={href({ page: 'presentations' })} aria-label={t('nav.backToPresentations')} className={`justify-self-start size-11 rounded-full flex items-center justify-center ${GLASS}`}>
          <ChevronLeftIcon className="size-5" />
        </a>
        <AppButton variant="plain" onClick={onDetails} aria-label={t('live.about')} className="min-w-0 h-11 flex flex-col items-center justify-center cursor-pointer overflow-hidden">
          <span className="max-w-full flex items-center gap-1 text-[17px]/[22px] font-semibold whitespace-nowrap">
            <span className="truncate">{presentation.name}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-neutral-500" />
          </span>
          <span className="max-w-full flex items-center gap-1.5 text-xs/4 whitespace-nowrap">
            <span className={`size-1.5 rounded-full shrink-0 ${pointer.black ? 'bg-neutral-500' : 'bg-red-500'}`} />
            <span className={`shrink-0 font-semibold tracking-wide ${pointer.black ? 'text-neutral-500' : 'text-red-500'}`}>{pointer.black ? t('live.clearedBadge') : t('live.badge')}</span>
            {place && <span className="min-w-0 truncate text-neutral-500 dark:text-neutral-400">· {place}</span>}
          </span>
        </AppButton>
        <div className={`justify-self-end flex h-11 rounded-full ${GLASS}`}>
          {owner && (
            <AppButton variant="plain" aria-label={t('live.outputs')} onClick={() => setOpen('outputs')} className="w-12 flex items-center justify-center cursor-pointer">
              <DesktopIcon className="size-5" />
            </AppButton>
          )}
          <AppButton variant="plain" aria-label={t('live.more')} onClick={() => setOpen('more')} className="w-12 flex items-center justify-center cursor-pointer">
            <EllipsisIcon className="size-5" />
          </AppButton>
        </div>
      </div>

      <div className="px-4 pt-3 flex flex-col gap-3 shrink-0 items-center">
        <div className={`w-full max-w-[640px] aspect-video rounded-2xl overflow-hidden ring-2 ${pointer.black ? 'ring-neutral-500' : 'ring-red-500'}`} data-testid="phone-live-picture">
          <SlideView slide={current} theme={theme} label={false} overlay={overlay} black={pointer.black} />
        </div>
        {video && pointer.itemId && presenting.video && <VideoPlayer control={presenting.video} itemId={pointer.itemId} name={video.fileName} type={video.contentType} codec={video.codec} />}
        {/* As iOS 27's player: round glass arrows, and Rensa a capsule of its own width between them. */}
        <div role="toolbar" aria-label={t('live.outputs')} className="flex items-center justify-center gap-4 h-11">
          <AppButton variant="plain" aria-label={t('live.previous')} disabled={at <= 0} onClick={() => go(at - 1)} className={`size-11 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-35 ${GLASS}`}>
            <ChevronLeftIcon className="size-5" />
          </AppButton>
          <AppButton
            variant="plain"
            aria-pressed={pointer.black}
            onClick={() => live.set({ black: !pointer.black })}
            className={`h-11 min-w-36 px-6 rounded-full flex items-center justify-center gap-1.5 text-[15px] font-semibold cursor-pointer ${pointer.black ? 'bg-neutral-900 text-white dark:bg-white dark:text-black' : GLASS}`}
          >
            {!pointer.black && <CloseIcon className="size-4" />}
            {pointer.black ? t('live.showAgain') : t('live.clear')}
          </AppButton>
          <AppButton variant="plain" aria-label={t('live.nextSlide')} disabled={at === -1 ? !steps.length : at >= steps.length - 1} onClick={() => go(at + 1)} className={`size-11 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-35 ${GLASS}`}>
            <ChevronLeftIcon className="size-5 rotate-180" />
          </AppButton>
        </div>
      </div>

      {/* A quiet heading, as iOS 27's lists: Redigera as text, Lägg till as a round +, no line under it. */}
      <div className="flex items-center justify-between pl-5 pr-4 pt-6 pb-1 shrink-0">
        <h2 className="text-xl/7 font-semibold">{t('live.order')}</h2>
        <span className="flex items-center gap-1">
          <AppButton
            variant="plain"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
            className={`h-11 px-3 text-[17px] text-sky-500 cursor-pointer ${editing ? 'font-semibold' : ''}`}
          >
            {editing ? t('live.editDone') : t('live.edit')}
          </AppButton>
          {!editing && (
            <AppButton variant="plain" aria-label={t('live.add')} title={t('live.add')} onClick={() => setAdding({ chosenId: null })} className="size-9 rounded-full flex items-center justify-center cursor-pointer bg-sky-500 text-white">
              <PlusIcon className="size-5" />
            </AppButton>
          )}
        </span>
      </div>
      {editing ? (
        <LiveEditList items={items} shownId={pointer.itemId} onRemove={(item) => void remove(item)} />
      ) : (
        <LiveOrder
          items={items}
          slides={slides}
          theme={theme}
          pointer={pointer}
          audio={presenting.audio}
          addedId={addedId}
          onPick={(itemId, partIndex) => live.set({ itemId, partIndex, black: false })}
          onItemMenu={(item) => setOpen({ item })}
        />
      )}

      {open === 'outputs' && owner && (
        <Sheet title={t('live.outputs')} onClose={() => setOpen(null)}>
          <OutputsList link={presenting.link} sessionId={owner.sessionId} />
        </Sheet>
      )}
      {open === 'overlays' && (
        <Sheet title={t('overlays.title')} onClose={() => setOpen(null)}>
          <OverlaysPanel overlays={overlays} pointer={pointer} live={live} />
        </Sheet>
      )}
      {open === 'remote' && owner && remotePolicy && remotePolicy !== 'never' && (
        <Sheet title={t('live.remote')} onClose={() => setOpen(null)}>
          <RemotePanel id={id} sessionId={owner.sessionId} name={presentation.name} always={remotePolicy === 'always'} />
        </Sheet>
      )}
      {open === 'more' && (
        <Sheet title={presentation.name} onClose={() => setOpen(null)}>
          <div className={GROUP}>
            <MenuRow icon={<InformationCircleIcon className="size-5" />} onClick={() => (setOpen(null), onDetails())}>
              {t('live.about')}
            </MenuRow>
            <MenuRow icon={<ArrowsPointingOutIcon className="size-5" />} onClick={() => (setOpen(null), onStage())}>
              {t('live.stage')}
            </MenuRow>
            {!!overlays.length && (
              <MenuRow icon={<SquaresOverlapIcon className="size-5" />} onClick={() => setOpen('overlays')}>
                {t('overlays.title')}
              </MenuRow>
            )}
            {owner && remotePolicy && remotePolicy !== 'never' && (
              <MenuRow icon={<RemoteIcon className="size-5" />} onClick={() => setOpen('remote')}>
                {t('live.remote')}
              </MenuRow>
            )}
          </div>
          {owner && (
            <div className={GROUP}>
              <MenuRow icon={<StopIcon className="size-5" />} onClick={() => void end()} danger>
                {t('live.end')}
              </MenuRow>
            </div>
          )}
        </Sheet>
      )}
      {open && typeof open === 'object' && (
        <Sheet title={open.item.title} onClose={() => setOpen(null)}>
          <div className={GROUP}>
            <MenuRow icon={<PlusIcon className="size-5" />} onClick={() => (setOpen(null), setAdding({ chosenId: open.item.id }))}>
              {t('live.addAfter')}
            </MenuRow>
            <MenuRow icon={<GripIcon className="size-5" />} onClick={() => (setOpen(null), setEditing(true))}>
              {t('live.move')}
            </MenuRow>
            {open.item.type === 'song' && (
              <MenuRow icon={<PencilIcon className="size-5" />} onClick={() => (setOpen(null), navigate({ page: 'song', id: open.item.sourceId }))}>
                {t('live.editSong')}
              </MenuRow>
            )}
            <MenuRow icon={<TrashIcon className="size-5" />} onClick={() => void remove(open.item)} danger disabled={open.item.id === pointer.itemId}>
              {open.item.id === pointer.itemId ? t('live.shownCannotRemove') : t('common.delete')}
            </MenuRow>
          </div>
        </Sheet>
      )}
      {adding && (
        <AddItemDialog
          presentationId={id}
          afterItemId={addAfter({ order: items.map((i) => i.id), shownId: pointer.itemId, lastAddedId, chosenId: adding.chosenId })}
          theme={theme}
          onAdded={(itemId) => {
            setLastAddedId(itemId);
            setAddedId(itemId);
            setTimeout(() => setAddedId((now) => (now === itemId ? null : now)), MARKED_MS);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

/** A choice in a sheet's menu, its icon first, as iOS 27 draws them. */
function MenuRow({ icon, onClick, danger, disabled, children }: { icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <AppButton variant="plain" onClick={onClick} disabled={disabled} className={`${ROW} ${danger ? 'text-red-500' : ''} disabled:text-neutral-400 disabled:cursor-default disabled:text-[15px]`}>
      {icon && <span className={`shrink-0 flex ${danger || disabled ? '' : 'text-neutral-500 dark:text-neutral-400'}`}>{icon}</span>}
      <span>{children}</span>
    </AppButton>
  );
}
