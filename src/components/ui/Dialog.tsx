import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Native <dialog> opened with showModal(): the browser handles the focus trap, Escape to close,
 * inert background and the backdrop, so this stays small and accessible.
 */
function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal is missing in some test DOMs; fall back to the open attribute.
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);
  return ref;
}

/** A bottom sheet on phones, a centred panel on wider screens. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useModal(open, onClose);
  return (
    <dialog ref={ref} className="sheet" aria-label={title}>
      {open && (
        <div className="sheet-body">
          <div className="sheet-handle" aria-hidden="true" />
          <h2 className="section-title">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

/** `if (await confirm({ title: 'Erase all data?', danger: true })) …` */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>();
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })), []);
  const finish = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(undefined);
    },
    [pending],
  );
  const cancel = useCallback(() => finish(false), [finish]);
  const ref = useModal(!!pending, cancel);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog ref={ref} className="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        {pending && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="stack" style={{ gap: 6 }}>
              <h2 id="confirm-title" className="section-title">
                {pending.title}
              </h2>
              {pending.message && (
                <p id="confirm-message" className="label">
                  {pending.message}
                </p>
              )}
            </div>
            <div className="grid-2">
              <button type="button" className="btn" onClick={cancel} autoFocus>
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button type="button" className={'btn ' + (pending.danger ? 'btn--danger-solid' : 'btn--solid')} onClick={() => finish(true)}>
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
