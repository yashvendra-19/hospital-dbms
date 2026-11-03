'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (options: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const CFG = {
  success: { rgb: '52,211,153', text: 'text-emerald-300', Icon: CheckCircle2 },
  error: { rgb: '251,113,133', text: 'text-rose-300', Icon: AlertOctagon },
  warning: { rgb: '251,191,36', text: 'text-amber-300', Icon: AlertTriangle },
  info: { rgb: '231,236,245', text: 'text-pulse-300', Icon: Info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ type, title, message, duration = 5000 }: Omit<ToastMessage, 'id'>) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, type, title, message, duration }]);
      if (duration > 0) setTimeout(() => removeToast(id), duration);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-20 z-[90] flex w-full max-w-sm flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const c = CFG[t.type];
            const Icon = c.Icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 80, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.92, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                role="status"
                className="pointer-events-auto relative overflow-hidden rounded-xl border bg-ink-900/90 p-3.5 pr-9 shadow-2xl backdrop-blur-2xl"
                style={{ borderColor: `rgba(${c.rgb},0.35)`, boxShadow: '0 18px 40px -16px rgba(0,0,0,0.85)' }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${c.text}`}
                    style={{ background: `rgba(${c.rgb},0.12)` }}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-fg">{t.title}</h4>
                    {t.message && <p className="mt-0.5 text-xs leading-relaxed text-fg2">{t.message}</p>}
                  </div>
                </div>
                <button
                  onClick={() => removeToast(t.id)}
                  className="absolute right-2 top-2 rounded p-1 text-fg3 transition hover:text-fg"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {t.duration && t.duration > 0 ? (
                  <motion.div
                    className="absolute bottom-0 left-0 h-[2px]"
                    style={{ background: `rgb(${c.rgb})`, boxShadow: `0 0 10px rgb(${c.rgb})` }}
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: t.duration / 1000, ease: 'linear' }}
                  />
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
