import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { CloseIcon } from './icons.tsx';

/** The round close button in a dialog's corner (Components/Dialog.razor). */
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <AppButton
      variant="plain"
      data-close
      className="absolute top-3 right-3 z-10 size-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer text-neutral-500"
      title={t('common.close')}
      aria-label={t('common.close')}
      onClick={onClick}
    >
      <CloseIcon className="size-4" />
    </AppButton>
  );
}

/**
 * The covered page behind a dialog, and the box. Escape closes it; the first
 * field (or button) gets focus. Keys in the box stay there, so the page's
 * shortcuts do not see them.
 */
function DialogFrame({ titleId, onClose, className, children }: { titleId: string; onClose: () => void; className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    if (!el.contains(document.activeElement)) el.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-close])')?.focus();
  }, []);
  return createPortal(
    <div className="dialog-in fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={box}
        className={`relative w-full max-h-full overflow-auto rounded-2xl shadow-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          e.stopPropagation(); // keys in a dialog are the dialog's
          if (e.key === 'Escape') onClose();
        }}
      >
        {children}
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
      {showClose && <CloseButton onClick={onClose} />}
      <div className="p-6 space-y-4">
        <h2 id={titleId} className={`font-semibold text-lg/7 ${showClose ? 'pr-8' : ''}`}>
          {title}
        </h2>
        {children}
      </div>
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
      <CloseButton onClick={onClose} />
      <div className="p-4 text-center">
        <h2 id={titleId} className="text-base/6 font-normal">
          {title}
        </h2>
      </div>
      <div className="px-4 h-[70svh] flex flex-col">{children}</div>
      <div className="px-4 py-3">{footer}</div>
    </DialogFrame>
  );
}

/** The buttons at the foot of a dialog, to the right (Cancel, then the action). */
export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-3">{children}</div>;
}

interface Ask {
  title: string;
  text: string;
  confirm: string;
  resolve: (ok: boolean) => void;
}

/**
 * A confirmation dialog (Components/ConfirmDeleteDialog.razor): `ask`
 * resolves true when the user confirms. Render `dialog` somewhere in the component.
 */
export function useConfirm(): { dialog: ReactNode; ask: (o: { title: string; text: string; confirm: string }) => Promise<boolean> } {
  const [open, setOpen] = useState<Ask | null>(null);
  const ask = useCallback((o: { title: string; text: string; confirm: string }) => new Promise<boolean>((resolve) => setOpen({ ...o, resolve })), []);
  const done = (ok: boolean) => {
    open?.resolve(ok);
    setOpen(null);
  };
  const dialog = open && (
    <Dialog title={open.title} onClose={() => done(false)}>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{open.text}</p>
      <DialogButtons>
        <AppButton variant="cancel" onClick={() => done(false)}>
          {t('common.cancel')}
        </AppButton>
        <AppButton variant="danger" filled onClick={() => done(true)}>
          {open.confirm}
        </AppButton>
      </DialogButtons>
    </Dialog>
  );
  return { dialog, ask };
}
