import type { LivePointer, Presentation } from '@gp/core';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { orgRemoteControl } from '../../../db/queries.ts';
import { useData } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import { outputWindow } from '../../../live/outputWindow.ts';
import type { LiveControl } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useConfirm } from '../../../ui/Dialog.tsx';
import { ArrowsPointingOutIcon, ChevronDownIcon, ChevronLeftIcon, EllipsisIcon } from '../../../ui/icons.tsx';
import { href } from '../../../ui/router.ts';
import { RemotePanel } from '../RemotePanel.tsx';

type Open = null | 'about' | 'more' | 'remote';

/**
 * A small panel under a button of the bar, as macOS draws a popover. A press outside it closes it and still
 * reaches what was pressed; a press on the bar is the bar's (its buttons open, switch or close the popover), and one
 * in a dialog the popover opened is the popover's.
 * Escape closes it, and only it.
 */
function Popover({ onClose, className, children }: { onClose: () => void; className: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeNow = useEffectEvent(onClose);
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const target = e.target as Element;
      // A dialog opened from the popover is drawn elsewhere in the page, but belongs to it.
      if (!panel.current?.contains(target) && !target.closest('[data-testid="live-bar"], [role="dialog"]')) closeNow();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeNow();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  return (
    <div ref={panel} className={`absolute z-[131] top-12 rounded-xl bg-surface dark:bg-raised shadow-2xl ring-[0.5px] ring-separator text-sm ${className}`}>
      {children}
    </div>
  );
}

const MENU_ROW = 'w-full h-8 px-2.5 flex items-center justify-between gap-3 rounded-md text-left cursor-pointer hover:bg-raised dark:hover:bg-raised-2';
const BAR_BUTTON = 'h-8 px-3 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer';

/**
 * The bar while presenting on a computer or an iPad lying down (docs/layout-2-0.md): "‹ Presentationer" at the
 * left; in the middle the title, LIVE, and the time and place, which open the details; at the right Scenläge, …
 * (Fjärrstyrning, Inställningar) and a red Avsluta, which asks first.
 */
export function LiveBar({
  id,
  presentation,
  pointer,
  live,
  owner,
  onStage,
  onDetails,
}: {
  id: string;
  presentation: Presentation;
  pointer: LivePointer;
  live: LiveControl;
  owner: { sessionId: string } | null;
  onStage: () => void;
  onDetails: () => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const { dialog, ask } = useConfirm();
  const remotePolicy = useData(orgRemoteControl, []);
  const when = [presentation.eventDate, presentation.time, presentation.location].filter(Boolean).join(' · ');
  const close = () => setOpen(null);
  const end = async () => {
    const ok = await ask({ title: t('live.end'), text: t('live.endText'), confirm: t('live.end'), compact: true });
    if (!ok) return;
    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
    // The output window closes with the presentation (Live.razor, Lars 2026-10-29); the page stays, editing.
    outputWindow().turn(false);
  };
  return (
    <div className="relative shrink-0 h-13 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 border-b-[0.5px] border-separator bg-surface" data-testid="live-bar">
      {dialog}
      <a href={href({ page: 'presentations' })} aria-label={t('nav.backToPresentations')} className="justify-self-start flex items-center gap-1 -ml-1 text-sm font-medium text-sky-500 hover:text-sky-600 no-underline whitespace-nowrap">
        <ChevronLeftIcon className="size-5" />
        {t('nav.presentations')}
      </a>
      <AppButton
        variant="plain"
        aria-label={t('live.about')}
        aria-expanded={open === 'about'}
        onClick={() => setOpen(open === 'about' ? null : 'about')}
        className={`min-w-0 px-3 py-1 rounded-lg flex flex-col items-center cursor-pointer ${open === 'about' ? 'bg-raised dark:bg-raised-2' : ''}`}
      >
        <span className="max-w-full flex items-center gap-2 whitespace-nowrap">
          <span className="text-[15px] font-semibold truncate">{presentation.name}</span>
          <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${pointer.black ? 'bg-raised-2 text-neutral-500' : 'bg-red-500/15 text-red-500'}`}>
            <span className={`size-1.5 rounded-full ${pointer.black ? 'bg-neutral-500' : 'bg-red-500'}`} />
            {pointer.black ? t('live.clearedBadge') : t('live.badge')}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 text-neutral-500" />
        </span>
        {when && <span className="max-w-full truncate text-xs text-neutral-500 dark:text-neutral-400">{when}</span>}
      </AppButton>
      <div className="justify-self-end flex items-center gap-2">
        <AppButton variant="plain" onClick={onStage} className={`${BAR_BUTTON} bg-raised dark:bg-raised-2`}>
          <ArrowsPointingOutIcon className="size-4" />
          {t('live.stage')}
        </AppButton>
        <AppButton variant="plain" aria-label={t('live.more')} aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')} className={`${BAR_BUTTON} px-2 bg-raised dark:bg-raised-2`}>
          <EllipsisIcon className="size-4" />
        </AppButton>
        {owner && (
          <AppButton variant="plain" aria-label={t('live.end')} onClick={() => void end()} className={`${BAR_BUTTON} bg-red-500/15 text-red-500`}>
            {t('live.endShort')}
          </AppButton>
        )}
      </div>
      {open === 'about' && (
        <Popover onClose={close} className="left-1/2 -translate-x-1/2 w-96 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold truncate">{presentation.name}</span>
            <AppButton variant="plain" onClick={() => (close(), onDetails())} className="h-7 px-3 rounded-lg bg-raised dark:bg-raised-2 text-[13px] font-semibold cursor-pointer">
              {t('live.editDetails')}
            </AppButton>
          </div>
          {when && <p className="text-[13px]">{when}</p>}
          {presentation.description && <p className="text-[13px]/relaxed whitespace-pre-line">{presentation.description}</p>}
        </Popover>
      )}
      {open === 'more' && (
        <Popover onClose={close} className="right-4 w-60 p-1.5">
          {owner && remotePolicy && remotePolicy !== 'never' && (
            <AppButton variant="plain" onClick={() => setOpen('remote')} className={MENU_ROW}>
              {t('live.remote')}…
            </AppButton>
          )}
          <a href={href({ page: 'songs' })} onClick={close} className={`${MENU_ROW} no-underline text-inherit`}>
            {t('nav.admin')}
          </a>
        </Popover>
      )}
      {open === 'remote' && owner && remotePolicy && remotePolicy !== 'never' && (
        <Popover onClose={close} className="right-4 w-80 p-4">
          <RemotePanel id={id} sessionId={owner.sessionId} name={presentation.name} always={remotePolicy === 'always'} />
        </Popover>
      )}
    </div>
  );
}
