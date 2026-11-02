import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { dbError, HttpError } from '@/lib/api';

/**
 * Tamper drill (administrators only): simulates a rogue database owner who silently edits an old
 * audit row, so the team can watch fn_verify_audit_chain() catch it, then restores the original.
 * Runs as the table owner because only the owner can switch off the append-only trigger.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== 'Admin') {
    return NextResponse.json({ success: false, error: 'Only administrators can run a tamper drill.' }, { status: 403 });
  }
  const client = await pool.connect();
  try {
    const { action } = await request.json();
    await client.query('BEGIN');
    let result: any;
    if (action === 'tamper') {
      const open = await client.query(`SELECT drill_id FROM audit_tamper_drill WHERE restored_at IS NULL`);
      if (open.rows.length) throw new HttpError(409, 'A drill is already active. Restore it first.');
      const target = (
        await client.query(
          `SELECT seq, table_name, new_data FROM audit_chain
           WHERE new_data IS NOT NULL AND table_name IN ('billing', 'admissions', 'patients')
           ORDER BY (table_name = 'billing') DESC, (table_name = 'admissions') DESC, seq DESC LIMIT 1`
        )
      ).rows[0];
      if (!target) throw new HttpError(404, 'No sealed record to tamper with yet.');
      const d = target.new_data;
      let field = 'full_name';
      let value: any = 'Edited by rogue DBA';
      if (target.table_name === 'billing') {
        field = 'net_patient_payable';
        value = Math.round(Number(d.net_patient_payable || 0) * 0.4 * 100) / 100;
      } else if (target.table_name === 'admissions') {
        field = 'admission_diagnosis';
        value = 'Minor sprain (edited)';
      }
      // Everything stays inside SQL so the original JSONB is kept byte-for-byte for the restore.
      await client.query(
        `INSERT INTO audit_tamper_drill (seq, field_name, original_new_data, tampered_new_data, performed_by)
         SELECT seq, $2::text, new_data,
                jsonb_set(new_data, ARRAY[$2::text], CASE WHEN $4::boolean THEN to_jsonb($3::numeric) ELSE to_jsonb($3::text) END),
                $5
         FROM audit_chain WHERE seq = $1`,
        [target.seq, field, String(value), typeof value === 'number', auth.staffCode]
      );
      await client.query('ALTER TABLE audit_chain DISABLE TRIGGER trg_audit_chain_immutable');
      await client.query(
        `UPDATE audit_chain c SET new_data = d.tampered_new_data
         FROM audit_tamper_drill d WHERE d.seq = c.seq AND d.restored_at IS NULL AND c.seq = $1`,
        [target.seq]
      );
      await client.query('ALTER TABLE audit_chain ENABLE TRIGGER trg_audit_chain_immutable');
      result = { seq: target.seq, table: target.table_name, field, before: d[field], after: value };
    } else if (action === 'restore') {
      const open = (await client.query(`SELECT * FROM audit_tamper_drill WHERE restored_at IS NULL ORDER BY drill_id DESC`)).rows;
      if (!open.length) throw new HttpError(404, 'No active drill to restore.');
      await client.query('ALTER TABLE audit_chain DISABLE TRIGGER trg_audit_chain_immutable');
      await client.query(
        `UPDATE audit_chain c SET new_data = d.original_new_data
         FROM audit_tamper_drill d WHERE d.seq = c.seq AND d.restored_at IS NULL`
      );
      await client.query(`UPDATE audit_tamper_drill SET restored_at = CURRENT_TIMESTAMP WHERE restored_at IS NULL`);
      await client.query('ALTER TABLE audit_chain ENABLE TRIGGER trg_audit_chain_immutable');
      result = { restored: open.map((d) => d.seq) };
    } else {
      throw new HttpError(400, 'action must be tamper or restore');
    }
    await client.query('COMMIT');
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    return dbError(error, 'Tamper drill failed', auth);
  } finally {
    client.release();
  }
}
