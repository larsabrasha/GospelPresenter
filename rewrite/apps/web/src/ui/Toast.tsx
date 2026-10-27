import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircleIcon } from './icons.tsx';

const ToastContext = createContext<(text: string) => void>(() => {});

/**
 * Short confirmations ("… flyttad till papperskorgen") that go away by
 * themselves, at the bottom in the middle (Components/ToastContainer.razor).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const show = useCallback((text: string) => {
    const id = Math.random();
    setToasts((ts) => [...ts, { id, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[150] flex flex-col items-center gap-2 pointer-events-none" role="status">
        {toasts.map((x) => (
          <div
            key={x.id}
            className="toast-item flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white ring-1 ring-neutral-200 dark:ring-neutral-700 text-sm"
          >
            <CheckCircleIcon className="size-5 shrink-0 text-green-500 dark:text-green-400" />
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): (text: string) => void {
  return useContext(ToastContext);
}
