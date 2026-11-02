import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const SESSION_COOKIE = 'mr_session';
export const SHIFT_SECONDS = 8 * 60 * 60; // a standard session lasts one 8-hour shift
export const BREAK_GLASS_SECONDS = 15 * 60; // emergency access is capped at 15 minutes

export type AccessMode = 'standard' | 'break_glass';

export interface StaffSession {
  sessionId: number;
  staffId: number;
  staffCode: string;
  fullName: string;
  role: 'Doctor' | 'Nurse' | 'Admin' | 'Billing';
  mode: AccessMode;
  expiresAt: string;
  reason: string | null;
  doctorId: number | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function clientMeta(request: NextRequest) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.ip || null;
  const userAgent = request.headers.get('user-agent')?.slice(0, 300) || null;
  return { ip, userAgent };
}

/** Creates a session row (token stored only as a hash) and returns the raw token for the cookie. */
export async function createSession(staffId: number, mode: AccessMode, reason: string | null = null) {
  const token = randomBytes(32).toString('base64url');
  const seconds = mode === 'break_glass' ? BREAK_GLASS_SECONDS : SHIFT_SECONDS;
  await query(
    `INSERT INTO staff_sessions (staff_id, token_hash, access_mode, break_glass_reason, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + make_interval(secs => $5))`,
    [staffId, hashToken(token), mode, reason, seconds]
  );
  return { token, maxAge: seconds };
}

export function setSessionCookie(res: NextResponse, token: string, maxAge: number) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Looks up a live (unexpired, unrevoked) session for the request's cookie. */
export async function getSession(request: NextRequest): Promise<StaffSession | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20) return null;
  const { rows } = await query(
    `SELECT s.session_id, s.access_mode, s.expires_at, s.break_glass_reason,
            a.staff_id, a.staff_code, a.full_name, a.staff_role, a.doctor_id
     FROM staff_sessions s
     JOIN staff_accounts a ON a.staff_id = s.staff_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > CURRENT_TIMESTAMP
       AND a.is_active`,
    [hashToken(token)]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    staffId: r.staff_id,
    staffCode: r.staff_code,
    fullName: r.full_name,
    role: r.staff_role,
    mode: r.access_mode,
    expiresAt: new Date(r.expires_at).toISOString(),
    reason: r.break_glass_reason,
    doctorId: r.doctor_id ?? null,
  };
}

/** Route guard: returns the session, or a 401 response to send back. */
export async function requireSession(request: NextRequest): Promise<StaffSession | NextResponse> {
  const session = await getSession(request);
  if (session) return session;
  return NextResponse.json(
    { success: false, error: 'Your session has ended. Sign in with your staff badge to continue.', code: 'UNAUTHENTICATED' },
    { status: 401 }
  );
}

export async function revokeSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await query(`UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL`, [
    hashToken(token),
  ]);
}
