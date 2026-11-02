import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError, HttpError } from '@/lib/api';

/** Check a seal printed on a receipt (sequence number + first characters of the hash). */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { seq, hash } = await request.json();
    const seqNum = parseInt(String(seq).replace(/\D/g, ''), 10);
    if (!seqNum || !hash || String(hash).trim().length < 8) throw new HttpError(400, 'Enter the seal number and at least 8 characters of its hash.');
    const row = await asStaff(auth, async (db) => (await db.query(`SELECT * FROM fn_check_seal($1, $2)`, [seqNum, String(hash)])).rows[0]);
    return NextResponse.json({ success: true, check: row });
  } catch (error: any) {
    return dbError(error, 'Failed to check the seal', auth);
  }
}
