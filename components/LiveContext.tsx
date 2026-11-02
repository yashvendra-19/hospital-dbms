'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useToast } from './ToastContext';

export interface LiveEvent {
  table: 'ambulance_prealerts' | 'bed_holds' | 'wards_beds' | 'admissions';
  op: 'INSERT' | 'UPDATE';
  alert_code?: string;
  status?: string;
  esi?: number;
  eta?: string;
  origin?: string;
  ambulance?: string;
  bed_id?: number;
}

interface LiveValue {
  /** bumps on every PostgreSQL NOTIFY event: use it as a refetch dependency */
  tick: number;
  last: LiveEvent | null;
  connected: boolean;
}

const LiveContext = createContext<LiveValue>({ tick: 0, last: null, connected: false });
export const useLive = () => useContext(LiveContext);

/** Subscribes once to /api/live (Server-Sent Events fed by PostgreSQL LISTEN/NOTIFY). */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [tick, setTick] = useState(0);
  const [last, setLast] = useState<LiveEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      es = new EventSource('/api/live');
      es.addEventListener('ready', () => setConnected(true));
      es.onmessage = (msg) => {
        try {
          const ev: LiveEvent = JSON.parse(msg.data);
          setLast(ev);
          // Several rows change in one transaction: coalesce into one refetch
          clearTimeout(pending);
          pending = setTimeout(() => setTick((t) => t + 1), 250);
          if (ev.table === 'ambulance_prealerts' && ev.op === 'INSERT') {
            const mins = ev.eta ? Math.max(0, Math.round((new Date(ev.eta).getTime() - Date.now()) / 60000)) : null;
            toastRef.current({
              type: 'warning',
              title: `Ambulance ${ev.alert_code} inbound · ESI ${ev.esi}`,
              message: `${ev.ambulance} from ${ev.origin}${mins !== null ? `, ETA ${mins} min` : ''}. Pushed by PostgreSQL NOTIFY.`,
              duration: 9000,
            });
          }
        } catch {
          /* ignore malformed events */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(open, 4000);
      };
    };
    open();
    return () => {
      clearTimeout(retry);
      clearTimeout(pending);
      es?.close();
    };
  }, []);

  return <LiveContext.Provider value={{ tick, last, connected }}>{children}</LiveContext.Provider>;
}
