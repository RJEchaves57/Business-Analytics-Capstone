/* eslint-disable react-refresh/only-export-components -- this module intentionally exports shared helpers alongside components */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import type { ConfirmOptions, Toast } from '../types';

interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (answer: boolean) => void;
}

interface UIContextValue {
  toast: (message: string, type?: string) => void;
  confirm: (options?: ConfirmOptions & { danger?: boolean }) => Promise<boolean>;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type = 'success') => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, type }]);
      window.setTimeout(() => dismiss(id), type === 'error' ? 5200 : 3600);
    },
    [dismiss]
  );

  const confirm = useCallback(
    (options: ConfirmOptions & { danger?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        setConfirmation({
          title: options.title || 'Please confirm',
          message: options.message || '',
          confirmLabel: options.confirmLabel || 'Confirm',
          cancelLabel: options.cancelLabel || 'Cancel',
          danger: Boolean(options.danger),
          resolve,
        });
      }),
    []
  );

  const settle = useCallback((answer: boolean) => {
    setConfirmation((current) => {
      if (current) current.resolve(answer);
      return null;
    });
  }, []);

  const value = useMemo<UIContextValue>(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <UIContext.Provider value={value}>
      {children}
      <div className="toast-root" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.type}`}>
            <Icon name={item.type === 'success' ? 'check' : 'alert'} size={16} />
            <div>{item.message}</div>
          </div>
        ))}
      </div>
      {confirmation ? (
        <Modal
          title={confirmation.title}
          size="narrow"
          onClose={() => settle(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => settle(false)}>
                {confirmation.cancelLabel}
              </button>
              <button
                type="button"
                className={`btn ${confirmation.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
              >
                {confirmation.confirmLabel}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-soft)' }}>{confirmation.message}</p>
        </Modal>
      ) : null}
    </UIContext.Provider>
  );
}

export function useUI(): UIContextValue {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUI must be used inside UIProvider.');
  return context;
}
