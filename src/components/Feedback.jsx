import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const FeedbackCtx = createContext(null);

export function useFeedback() {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error('useFeedback phải nằm trong FeedbackProvider');
  return ctx;
}

const TOAST_STYLE = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-600 text-white',
  info: 'bg-slate-800 text-white',
};

const TOAST_ICON = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export default function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const idRef = useRef(0);
  const confirmResolveRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (msg, type) => {
      if (!msg) return;
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-2), { id, msg, type }]);
      setTimeout(() => dismissToast(id), type === 'error' ? 6000 : 3500);
    },
    [dismissToast]
  );

  const toast = useMemo(
    () => ({
      success: (msg) => pushToast(msg, 'success'),
      error: (msg) => pushToast(msg, 'error'),
      info: (msg) => pushToast(msg, 'info'),
    }),
    [pushToast]
  );

  const askConfirm = useCallback(
    ({ title = 'Xác nhận', message = '', confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', danger = false } = {}) =>
      new Promise((resolve) => {
        confirmResolveRef.current?.(false);
        confirmResolveRef.current = (answer) => {
          confirmResolveRef.current = null;
          setConfirmState(null);
          resolve(answer);
        };
        setConfirmState({ title, message, confirmLabel, cancelLabel, danger });
      }),
    []
  );

  const answerConfirm = useCallback((answer) => {
    confirmResolveRef.current?.(answer);
  }, []);

  const value = useMemo(() => ({ toast, askConfirm }), [toast, askConfirm]);

  return (
    <FeedbackCtx.Provider value={value}>
      {children}

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.type];
          return (
            <div
              key={t.id}
              className={`animate-toast-in pointer-events-auto w-full flex items-start gap-2 px-4 py-3 rounded-2xl shadow-lg text-xs font-semibold ${TOAST_STYLE[t.type]}`}
              role="status"
            >
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">{t.msg}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="shrink-0 p-1 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
                aria-label="Đóng thông báo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {confirmState && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
          onClick={() => answerConfirm(false)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmState.danger ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'
                }`}
              >
                <AlertCircle className="w-4.5 h-4.5" />
              </div>
              <h4 className="font-bold text-sm text-slate-900">{confirmState.title}</h4>
            </div>
            <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">
              {confirmState.message}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                autoFocus
                onClick={() => answerConfirm(false)}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl min-w-9"
              >
                {confirmState.cancelLabel}
              </button>
              <button
                onClick={() => answerConfirm(true)}
                className={`px-4 py-2.5 text-xs font-bold text-white rounded-xl shadow-sm min-w-9 ${
                  confirmState.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackCtx.Provider>
  );
}
