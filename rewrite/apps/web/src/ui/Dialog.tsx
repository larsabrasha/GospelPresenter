import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { ChevronLeftIcon, CloseIcon } from './icons.tsx';
import { ROUND_CLOSE } from './glass.ts';
import { useSheetDrag } from './sheetDrag.ts';

/** The round close button in a dialog's corner (Components/Dialog.razor). */
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <AppButton
      variant="plain"
      data-close
      className={`absolute top-2.5 touch:top-1.5 right-3 z-10 ${ROUND_CLOSE}`}
      title={t('common.close')}
      aria-label={t('common.close')}
      onClick={onClick}
    >
      <CloseIcon className="size-4" />
    </AppButton>
  );
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The covered page behind a dialog, and the box. Escape, the close button and a
 * press on the dimmed page close it (utils.js showModal), a dialog of pages only the close button; the first field (or
 * button) gets focus, and Tab stays in the box, as with the current app's native
 * `showModal`. Keys in the box stay there, so the page's shortcuts do not see them.
 * It fades in, not out: a delayed close would undo the page opening it again meanwhile.
 */
function DialogFrame({
  titleId,
  onClose,
  className,
  children,
  page,
}: {
  titleId: string;
  onClose: () => void;
  className: string;
  children: (close: () => void) => ReactNode;
  /**
   * A dialog of whole pages: on a phone as iOS's page sheet (Lars, 2026-11-03: not the full screen), sliding up from
   * below to a little under the top, its top corners rounded, the page dimmed behind it, and pulled down it closes, as
   * a sheet does (`useSheetDrag`); focus on the box rather than a field, so a phone shows no keyboard, and otherwise
   * only the close button closes it, so a stray press or Escape loses no work.
   */
  page?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const noBar = useRef<HTMLElement>(null);
  // The page under it brightens as it is pulled away; only a dialog of pages on a phone, where it is a sheet.
  useSheetDrag(
    box,
    noBar,
    onClose,
    (progress, ms) => {
      const el = backdrop.current;
      if (!el) return;
      el.style.transition = ms ? `background-color ${ms}ms` : 'none';
      el.style.backgroundColor = `rgb(0 0 0 / ${0.3 * (1 - progress)})`;
    },
    () => !!page && matchMedia('(width < 40rem)').matches,
  );
  useEffect(() => {
    const el = box.current!;
    if (el.contains(document.activeElement)) return;
    if (page) el.focus();
    else el.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-close])')?.focus();
  }, [page]);
  const close = onClose;
  const trapTab = (e: React.KeyboardEvent) => {
    const all = [...box.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (all.length === 0) return e.preventDefault();
    const first = all[0]!;
    const last = all[all.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current || !box.current!.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div
      ref={backdrop}
      data-overlay="dialog"
      className={`dialog-in fixed inset-0 z-[140] flex items-center justify-center bg-black/30 ${page ? 'sm:p-4 max-sm:items-end max-sm:pt-[calc(env(safe-area-inset-top)+0.75rem)]' : 'p-4'}`}
      onMouseDown={(e) => {
        if (!page && e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={box}
        className={`relative w-full max-h-full rounded-2xl shadow-2xl bg-surface text-stone-900 dark:text-stone-100 ${page ? 'sheet-in h-full flex flex-col overflow-hidden outline-none max-sm:rounded-b-none' : 'overflow-auto'} ${className}`}
        tabIndex={page ? -1 : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          e.stopPropagation(); // keys in a dialog are the dialog's
          if (e.key === 'Escape' && !page) close();
          else if (e.key === 'Tab') trapTab(e);
        }}
      >
        {children(close)}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A dialog: a title and its content, as the current app's dialogs (a white
 * card, rounded, over a dimmed page). `wide` for a large one, such as a picker;
 * `maxWidthClass` for another width, as NameDialog.razor's `max-w-2xl`.
 */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  maxWidthClass,
  showClose,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  maxWidthClass?: string;
  showClose?: boolean;
}) {
  const titleId = useId();
  return (
    <DialogFrame titleId={titleId} onClose={onClose} className={maxWidthClass ?? (wide ? 'max-w-5xl' : 'max-w-md')}>
      {(close) => (
        <>
          {showClose && <CloseButton onClick={close} />}
          <div className="p-6 space-y-4">
            <h2 id={titleId} className={`font-semibold text-lg/7 ${showClose ? 'pr-8' : ''}`}>
              {title}
            </h2>
            {children}
          </div>
        </>
      )}
    </DialogFrame>
  );
}

/**
 * A tall dialog with a centred title, a body that fills it and a footer
 * (Components/Modal.razor), for content that scrolls, such as a list to pick from.
 */
export function Modal({ title, onClose, children, footer, className }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; className?: string }) {
  const titleId = useId();
  return (
    <DialogFrame titleId={titleId} onClose={onClose} className={`rounded-3xl! shadow-lg! ${className ?? 'max-w-2xl'}`}>
      {(close) => (
        <>
          <CloseButton onClick={close} />
          <div className="p-4 text-center">
            <h2 id={titleId} className="text-base/6 font-normal">
              {title}
            </h2>
          </div>
          <div className="px-4 h-[70svh] flex flex-col">{children}</div>
          <div className="px-4 py-3">{footer}</div>
        </>
      )}
    </DialogFrame>
  );
}

/**
 * A dialog that holds pages of its own, as the admin pages over the page the user is on:
 * a bar with the title and the close button, and `children` filling the rest.
 */
export function PageDialog({
  title,
  compactTitle,
  compactTitleShown = true,
  back,
  split,
  narrow,
  onClose,
  children,
}: {
  title: string;
  compactTitle?: string;
  compactTitleShown?: boolean;
  back?: { href: string; label: string };
  /** From `lg` the content draws its own bars, split in two columns up to the top as macOS's System Settings: no bar here. */
  split?: boolean;
  /** One page alone (a song opened from a presentation): as narrow as iPadOS's form sheet (Lars, 2026-11-03). */
  narrow?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <DialogFrame titleId={titleId} onClose={onClose} className={`${narrow ? 'max-w-2xl' : 'max-w-5xl'} sm:h-[min(52rem,100%)]`} page>
      {(close) => (
        <>
          <div className={`elevated relative flex items-center h-14 shrink-0 px-5 border-b-[0.5px] border-separator bg-ground ${split ? 'split:hidden' : ''}`}>
            {/* Below `lg` as iOS 26's bar: a round ‹ alone at the left, and the page's own name in the middle
                (`compactTitle`); the dialog keeps `title` as its name for screen readers. */}
            {back && (
              <a href={back.href} aria-label={back.label} title={back.label} className="split:hidden -ml-2 size-8 flex items-center justify-center rounded-full bg-raised hover:bg-raised-2 text-stone-600 dark:text-stone-300">
                <ChevronLeftIcon className="size-5" />
              </a>
            )}
            <h2 id={titleId} className={`font-semibold text-lg/7 ${compactTitle ? 'max-split:sr-only' : ''}`}>
              {title}
            </h2>
            {compactTitle && (
              <span key={compactTitle} aria-hidden="true" className={`split:hidden absolute inset-x-16 text-center font-semibold text-[17px] truncate transition-opacity ${compactTitleShown ? '' : 'opacity-0'}`}>
                {compactTitle}
              </span>
            )}
            <CloseButton onClick={close} />
          </div>
          {/* A step lighter in dark mode than the page under it (app.css `.elevated`), as iOS draws what floats. */}
          <div className="elevated flex-1 min-h-0 flex flex-col">{children}</div>
        </>
      )}
    </DialogFrame>
  );
}

/** The buttons at the foot of a dialog, to the right (Cancel, then the action). */
export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-3">{children}</div>;
}

export interface AskOptions {
  title: string;
  text: string;
  confirm: string;
  /** A user-authored value in `text` (a name), shown in bold (Components/LocalizedEmphasis.razor). */
  bold?: string;
  /** The work done on confirming; the dialog stays open with `busy` on its button until it ends. */
  run?: () => Promise<unknown>;
  busy?: string;
  /** Narrower, with the text at its normal size, as Presentation.razor's removal of an item. */
  compact?: boolean;
  /** A blue confirm button in place of the red, for what loses nothing (SongHistory.razor's Återställ). */
  primary?: boolean;
}

interface Ask extends AskOptions {
  resolve: (ok: boolean) => void;
}

/** `text` with the first `bold` in it in bold. */
function emphasised(text: string, bold: string | undefined): ReactNode {
  const at = bold ? text.indexOf(bold) : -1;
  if (!bold || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong>{bold}</strong>
      {text.slice(at + bold.length)}
    </>
  );
}

/** The options of a delete confirmation (Components/ConfirmDeleteDialog.razor): titled and confirmed "Radera". */
export function deleteAsk(text: string, bold: string | undefined, run: () => Promise<unknown>): AskOptions {
  return { title: t('common.delete'), text, bold, confirm: t('common.delete'), busy: t('common.deleting'), run };
}

/**
 * A confirmation dialog (Components/ConfirmDeleteDialog.razor): `ask`
 * resolves true when the user confirms, after `run` if one is given. Render
 * `dialog` somewhere in the component.
 */
export function useConfirm(): { dialog: ReactNode; ask: (o: AskOptions) => Promise<boolean> } {
  const [open, setOpen] = useState<Ask | null>(null);
  const [working, setWorking] = useState(false);
  const ask = useCallback((o: AskOptions) => new Promise<boolean>((resolve) => setOpen({ ...o, resolve })), []);
  const done = (ok: boolean) => {
    open?.resolve(ok);
    setOpen(null);
  };
  const confirm = async () => {
    if (!open?.run) return done(true);
    setWorking(true);
    try {
      await open.run();
    } catch (e) {
      // The work says itself what went wrong; the dialog only closes.
      console.error('confirmed work failed', e);
    } finally {
      setWorking(false);
      done(true);
    }
  };
  const dialog = open && (
    <Dialog title={open.title} onClose={() => done(false)} maxWidthClass={open.compact ? 'max-w-sm' : undefined}>
      <p className={open.compact ? '' : 'text-sm text-stone-600 dark:text-stone-300'}>{emphasised(open.text, open.bold)}</p>
      <DialogButtons>
        <AppButton variant="cancel" onClick={() => done(false)}>
          {t('common.cancel')}
        </AppButton>
        <AppButton variant={open.primary ? 'primary' : 'danger'} filled disabled={working} onClick={() => void confirm()}>
          {working && open.busy ? open.busy : open.confirm}
        </AppButton>
      </DialogButtons>
    </Dialog>
  );
  return { dialog, ask };
}
