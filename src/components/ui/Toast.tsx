import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  message: string;
  /** e.g. { label: 'Undo', onClick: restore } */
  action?: { label: string; onClick: () => void | Promise<void> };
  /** Milliseconds before the toast hides itself. */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(options: ToastOptions) => void>(() => {});

/** Shows a short message above the tab bar. Call it with an action to offer Undo. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>();
  const nextId = useRef(1);

  const show = useCallback((options: ToastOptions) => setToast({ ...options, id: nextId.current++ }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? undefined : t)), toast.duration ?? (toast.action ? 6000 : 3500));
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* The live region stays mounted so screen readers announce each new message. */}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span className="grow">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={async () => {
                  setToast(undefined);
                  await toast.action?.onClick();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
