'use client';

import { createContext, useContext } from 'react';

export interface ClientSession {
  staffCode: string;
  fullName: string;
  role: 'Doctor' | 'Nurse' | 'Admin' | 'Billing';
  mode: 'standard' | 'break_glass';
  expiresAt: string;
  reason: string | null;
}

interface SessionValue {
  session: ClientSession | null;
  logout: (reason?: 'signed_out' | 'expired') => Promise<void>;
}

export const SessionContext = createContext<SessionValue>({ session: null, logout: async () => {} });
export const useSession = () => useContext(SessionContext);

/** Badge roles: colour, label and badge-ID prefix. */
export const ROLE_STYLE = {
  Doctor: { rgb: '46,230,245', hex: '#2ee6f5', prefix: 'DOC' },
  Nurse: { rgb: '52,211,153', hex: '#34d399', prefix: 'NUR' },
  Admin: { rgb: '148,116,255', hex: '#9474ff', prefix: 'ADM' },
  Billing: { rgb: '251,191,36', hex: '#fbbf24', prefix: 'BIL' },
} as const;

export type Role = keyof typeof ROLE_STYLE;

/** PostgreSQL role each staff role runs as (SET LOCAL ROLE in lib/db.ts). */
export const DB_ROLE_OF: Record<Role, string> = { Doctor: 'mr_doctor', Nurse: 'mr_nurse', Billing: 'mr_billing', Admin: 'mr_admin' };

export function roleFromCode(code: string): Role | null {
  const p = code.trim().toUpperCase().slice(0, 3);
  return (Object.keys(ROLE_STYLE) as Role[]).find((r) => ROLE_STYLE[r].prefix === p) ?? null;
}

export const initials = (name: string) =>
  name
    .replace(/^(Dr\.?|Sr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
