import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { Button } from './Button.tsx';

/**
 * A modal dialog. Escape closes it; the first field (or button) gets focus.
 * The page behind is covered, so its shortcuts do not see the keys.
 */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    if (!el.contains(document.activeElement)) el.querySelector<HTMLElement>('[autofocus], input, textarea, select, button')?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={box}
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          e.stopPropagation(); // keys in a dialog are the dialog's
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

interface Ask {
  title: string;
  text: string;
  confirm: string;
  resolve: (ok: boolean) => void;
}

/**
 * A confirmation dialog: `ask` resolves true when the user confirms. Render
 * `dialog` somewhere in the component.
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
      <p>{open.text}</p>
      <div className="row end">
        <Button onClick={() => done(false)}>{t('common.cancel')}</Button>
        <Button variant="danger" onClick={() => done(true)}>
          {open.confirm}
        </Button>
      </div>
    </Dialog>
  );
  return { dialog, ask };
}
