import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const ToastContext = createContext<(text: string) => void>(() => {});

/** Short confirmations ("… flyttad till papperskorgen") that go away by themselves. */
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
      <div className="toasts" role="status">
        {toasts.map((x) => (
          <div key={x.id} className="toast">
            {x.text}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): (text: string) => void {
  return useContext(ToastContext);
}
