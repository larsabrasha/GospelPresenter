import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircleIcon, WarningSolidIcon } from './icons.tsx';

/** A confirmation (green tick) or a warning (amber triangle), as ToastKind in the current app. */
export type ToastKind = 'success' | 'warning';

function toastItem(x: { id: number; text: string; kind: ToastKind }) {
  return (
    <div
      key={x.id}
      className="toast-item flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white ring-1 ring-neutral-200 dark:ring-neutral-700 text-sm"
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

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

/**
 * Short confirmations ("… flyttad till papperskorgen") and warnings that go
 * away by themselves, at the bottom in the middle (Components/ToastContainer.razor).
 * A warning already shown is replaced rather than stacked, so a save refused
 * again and again shows one "Kunde inte spara".
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: ToastKind }[]>([]);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = Math.random();
    setToasts((ts) => [...ts.filter((x) => !(kind === 'warning' && x.kind === kind && x.text === text)), { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      {/* Warnings in a region of their own, so a screen reader says them at once rather than after what it is reading. */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[150] flex flex-col items-center gap-2 pointer-events-none">
        <div className="flex flex-col items-center gap-2" role="alert">
          {toasts.filter((x) => x.kind === 'warning').map(toastItem)}
        </div>
        <div className="flex flex-col items-center gap-2" role="status">
          {toasts.filter((x) => x.kind === 'success').map(toastItem)}
        </div>
      </div>
    </ToastContext>
  );
}

export function useToast(): (text: string, kind?: ToastKind) => void {
  return useContext(ToastContext);
}
