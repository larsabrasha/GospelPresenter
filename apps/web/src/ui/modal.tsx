import { useLayoutEffect, useRef, useState, useSyncExternalStore, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The browser's own modal (Lars, 2026-11-25: the best way, not one made by hand): every dialog, sheet and full-screen
// editor is shown in a <dialog> with showModal(). The browser puts it in the top layer, over everything, and makes all
// outside it inert, to the pointer, the keyboard and a screen reader alike, so no focus wanders behind it; Tab stays
// in it. What it draws is unchanged: the <dialog> covers the window, see-through, and holds the dimmed page and the box
// as before. The focus it had before comes back when it closes. Escape is the dialog's own keys', one step at a time
// (docs/assumptions.md): the browser's own close on Escape is turned off.

/** The modals open, the topmost last: what must show over them, and be used, is put in the topmost. */
const stack: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const topmost = () => stack.at(-1) ?? null;

/**
 * Where a layer over the page goes: the topmost modal open, or the page. A context menu, a toast or a sheet drawn in
 * the page's body under an open modal would be inert there, seen but not to be used or read.
 */
export function useLayerRoot(): HTMLElement | null {
  const top = useSyncExternalStore(subscribe, topmost, () => null);
  return top ?? (typeof document === 'undefined' ? null : document.body);
}

/** `node` drawn in the layer root (`useLayerRoot`). */
export function OnTopLayer({ children }: { children: ReactNode }) {
  const root = useLayerRoot();
  return root ? createPortal(children, root) : null;
}

/**
 * A modal over the window: a see-through <dialog> as large as the window, shown with showModal() while it is mounted,
 * and drawn in the page's body. `label` or `labelledBy` names it; the rest are its attributes (`data-page-dialog`).
 */
export function ModalLayer({
  children,
  label,
  labelledBy,
  className,
  ...rest
}: { children: ReactNode; label?: string; labelledBy?: string; className?: string } & Omit<HTMLAttributes<HTMLDialogElement>, 'className' | 'children'> & {
    [data: `data-${string}`]: string | undefined;
  }) {
  const ref = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  // What had the focus gets it back when this closes. Read as this is first drawn, before anything of the commit that
  // shows it goes (the menu whose choice opened it), and before showModal moves the focus in. A choice in a menu goes
  // with its menu, so the button that opened the menu gets it (ui/Dropdown.tsx: the button beside its menu).
  const [before] = useState(() => {
    const had = typeof document === 'undefined' ? null : document.activeElement;
    const menu = had?.closest('[role="menu"]');
    return (menu && menu.parentElement?.querySelector(':scope > [aria-haspopup="menu"]')) ?? had;
  });
  useLayoutEffect(() => {
    const dialog = ref.current!;
    alive.current = true;
    if (!dialog.open) dialog.showModal();
    // The dialog itself in focus, not what showModal() chose (its ✕, as often as not): the frame's effects, after this,
    // put it where it belongs, the first field or the default button, or a search once it is drawn (ui/Picker.tsx).
    dialog.focus({ preventScroll: true });
    stack.push(dialog);
    changed();
    return () => {
      alive.current = false;
      stack.splice(stack.indexOf(dialog), 1);
      changed();
      if (dialog.open) dialog.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shown once for the time it is mounted; `before` is read once, as it was first drawn
  }, []);
  const keys = (e: KeyboardEvent<HTMLDialogElement>) => {
    // The dialog's handlers, under this, took Escape as theirs or not; the browser's close is never asked for.
    if (e.key === 'Escape') e.preventDefault();
    rest.onKeyDown?.(e);
  };
  return createPortal(
    <dialog
      {...rest}
      ref={ref}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={keys}
      onCancel={(e) => e.preventDefault()}
      // Closed by the browser regardless (a second Escape with nothing pressed between): shown again while it is mounted.
      onClose={() => {
        if (alive.current && ref.current && !ref.current.open) ref.current.showModal();
      }}
      className={`fixed inset-0 m-0 p-0 border-0 w-full h-full max-w-none max-h-none bg-transparent text-inherit overflow-visible outline-none backdrop:bg-transparent ${className ?? ''}`}
    >
      {children}
    </dialog>,
    document.body,
  );
}
