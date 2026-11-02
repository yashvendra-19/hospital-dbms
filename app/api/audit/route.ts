import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Verification summary for everyone; the sealed rows themselves only for administrators (GRANT on audit_chain). */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = new URL(request.url).searchParams;
    const table = sp.get('table');
    const limit = Math.min(200, Math.max(10, parseInt(sp.get('limit') || '60', 10) || 60));
    const data = await asStaff(auth, async (db) => {
      const summary = (await db.query(`SELECT * FROM fn_verify_audit_chain()`)).rows[0];
      const rows = await db.tryQuery(
        `SELECT seq, occurred_at, staff_code, staff_role, access_mode, db_role, table_name, operation, record_pk,
                old_data, new_data, prev_hash, row_hash, seal_ok, link_ok
         FROM v_audit_chain_verified
         WHERE ($1::text IS NULL OR table_name = $1)
         ORDER BY seq DESC LIMIT $2`,
        [table, limit]
      );
      const byTable = await db.tryQuery(
        `SELECT table_name, count(*)::int AS n FROM audit_chain GROUP BY table_name ORDER BY n DESC`
      );
      const drills = await db.tryQuery(
        `SELECT drill_id, seq, field_name, performed_by, performed_at, restored_at FROM audit_tamper_drill ORDER BY drill_id DESC LIMIT 5`
      );
      return { summary, rows: rows?.rows ?? null, byTable: byTable?.rows ?? null, drills: drills?.rows ?? null };
    });
    return NextResponse.json({ success: true, ...data, canReadRows: data.rows !== null });
  } catch (error: any) {
    return dbError(error, 'Failed to verify the audit chain', auth);
  }
}
