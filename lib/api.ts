import { NextResponse } from 'next/server';
import { formatPgError } from '@/lib/db-errors';
import { DB_ROLE } from '@/lib/db';
import type { StaffSession } from '@/lib/auth';

/**
 * What each staff role may read. PostgreSQL enforces this with column grants and RLS
 * (setup_hospital_db.sql, section 8); these flags only keep queries from naming columns
 * the database would refuse anyway.
 */
export function access(s: StaffSession) {
  return {
    clinical: s.role !== 'Billing', // diagnosis, triage, ambulance details
    finance: s.role === 'Billing' || s.role === 'Admin', // bills and revenue
    admin: s.role === 'Admin',
  };
}

/** Turns a PostgreSQL error into a JSON response (403 when the database denied access). */
export function dbError(error: any, fallback: string, session?: StaffSession) {
  const f = formatPgError(error);
  const forbidden = f.code === '42501';
  const status = forbidden ? 403 : f.isConstraintError ? 409 : error?.status || 500;
  return NextResponse.json(
    {
      success: false,
      error: f.message || fallback,
      details: f,
      code: forbidden ? 'DB_FORBIDDEN' : f.code,
      ...(session ? { role: session.role, dbRole: DB_ROLE[session.role] } : {}),
    },
    { status }
  );
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
