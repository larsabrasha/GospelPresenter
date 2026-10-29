import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircleIcon, WarningSolidIcon } from './icons.tsx';

/** A confirmation (green tick) or a warning (amber triangle), as ToastKind in the current app. */
export type ToastKind = 'success' | 'warning';

interface ToastData {
  id: number;
  text: string;
  kind: ToastKind;
}

function toastItem(x: ToastData, leaving: boolean) {
  return (
    <div
      key={x.id}
      className={`${leaving ? 'toast-item-out' : 'toast-item'} flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white ring-1 ring-neutral-200 dark:ring-neutral-700 text-sm`}
    >
      {x.kind === 'warning' ? (
        <WarningSolidIcon className="size-5 shrink-0 text-amber-500 dark:text-amber-400" />
      ) : (
        <CheckCircleIcon className="size-5 shrink-0 text-green-500 dark:text-green-400" />
      )}
      <span>{x.text}</span>
    </div>
  );
}

/** How long a toast shows, and how long it takes to go (ToastContainer.razor). */
const SHOW_MS = 3000;
const OUT_MS = 200;

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

/**
 * Short confirmations ("… flyttad till papperskorgen") and warnings that go
 * away by themselves, at the bottom in the middle (Components/ToastContainer.razor):
 * one at a time, a new one replacing the one shown, each for 3 s and fading out
 * in 200 ms.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<ToastData | null>(null);
  const [leaving, setLeaving] = useState<ToastData | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const current = useRef<ToastData | null>(null);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    for (const x of timers.current) clearTimeout(x);
    const next = { id: Math.random(), text, kind };
    setLeaving(current.current);
    setShown((current.current = next));
    timers.current = [
      setTimeout(() => setLeaving(null), OUT_MS),
      setTimeout(() => {
        current.current = null;
        setShown(null);
        setLeaving(next);
      }, SHOW_MS),
      setTimeout(() => setLeaving(null), SHOW_MS + OUT_MS),
    ];
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      {/* Warnings in a region of their own, so a screen reader says them at once rather than after what it is reading. */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[150] grid pointer-events-none *:col-start-1 *:row-start-1 *:justify-self-center">
        <div role="alert">{shown?.kind === 'warning' && toastItem(shown, false)}</div>
        <div role="status">{shown?.kind === 'success' && toastItem(shown, false)}</div>
        {leaving && <div aria-hidden="true">{toastItem(leaving, true)}</div>}
      </div>
    </ToastContext>
  );
}

export function useToast(): (text: string, kind?: ToastKind) => void {
  return useContext(ToastContext);
}
