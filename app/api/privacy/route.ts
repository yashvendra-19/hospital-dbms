import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff, Db, DbIdentity, DB_ROLE } from '@/lib/db';
import { dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

const TABLES = ['patients', 'admissions', 'billing', 'ambulance_prealerts', 'cost_estimates', 'login_audit', 'audit_chain', 'nhp_hospitals'];

// Same questions asked as six different people. Only counts and yes/no answers come back, never names.
const VIEWERS: { label: string; who: DbIdentity }[] = [
  { label: 'Dr. Arvind (treating ER doctor)', who: { sessionId: 0, staffId: 1, staffCode: 'DOC-1001-TN', role: 'Doctor', mode: 'standard', doctorId: 1 } },
  { label: 'Dr. Radhika (cardiologist)', who: { sessionId: 0, staffId: 2, staffCode: 'DOC-1002-TN', role: 'Doctor', mode: 'standard', doctorId: 2 } },
  { label: 'Sr. Lakshmi (nurse)', who: { sessionId: 0, staffId: 3, staffCode: 'NUR-2001', role: 'Nurse', mode: 'standard', doctorId: null } },
  { label: 'Sr. Lakshmi (break-glass)', who: { sessionId: 0, staffId: 3, staffCode: 'NUR-2001', role: 'Nurse', mode: 'break_glass', doctorId: null } },
  { label: 'Farhan (billing desk)', who: { sessionId: 0, staffId: 4, staffCode: 'BIL-3001', role: 'Billing', mode: 'standard', doctorId: null } },
  { label: 'Meera (administrator)', who: { sessionId: 0, staffId: 5, staffCode: 'ADM-0001', role: 'Admin', mode: 'standard', doctorId: null } },
];

async function probe(db: Db) {
  const patients = await db.tryQuery(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE privacy_level = 'restricted')::int AS restricted FROM patients`
  );
  const admissions = await db.tryQuery(`SELECT count(*)::int AS n FROM admissions WHERE discharge_time IS NULL`);
  const diagnosis = await db.tryQuery(`SELECT count(admission_diagnosis)::int AS n FROM admissions`);
  const bills = await db.tryQuery(`SELECT count(*)::int AS n FROM billing`);
  const chain = await db.tryQuery(`SELECT count(*)::int AS n FROM audit_chain`);
  const mlcBed = await db.tryQuery(
    `SELECT (p.full_name IS NOT NULL) AS sees_name
     FROM wards_beds b
     LEFT JOIN admissions a ON a.bed_id = b.bed_id AND a.discharge_time IS NULL
     LEFT JOIN patients p ON p.patient_id = a.patient_id
     WHERE b.room_number = 'ER-TRAUMA' AND b.bed_label = 'B-1'`
  );
  return {
    patients: patients?.rows[0]?.n ?? null,
    restricted: patients?.rows[0]?.restricted ?? null,
    activeAdmissions: admissions?.rows[0]?.n ?? null,
    diagnosis: diagnosis !== null,
    bills: bills?.rows[0]?.n ?? null,
    auditRows: chain?.rows[0]?.n ?? null,
    seesMlcName: mlcBed ? !!mlcBed.rows[0]?.sees_name : false,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const mine = await asStaff(auth, async (db) => {
      const ctx = (
        await db.query(
          `SELECT current_user AS db_role, session_user AS login_role, app_role() AS staff_role, app_staff_id() AS staff_id,
                  app_doctor_id() AS doctor_id, app_break_glass() AS break_glass,
                  current_setting('app.staff_code', true) AS staff_code`
        )
      ).rows[0];
      const policies = (
        await db.query(
          `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`
        )
      ).rows;
      const matrix = (
        await db.query(
          `SELECT r.rolname AS role, t.tbl AS table_name,
                  has_table_privilege(r.rolname, 'public.' || t.tbl, 'SELECT') AS can_select,
                  has_table_privilege(r.rolname, 'public.' || t.tbl, 'INSERT') AS can_insert,
                  has_table_privilege(r.rolname, 'public.' || t.tbl, 'UPDATE') AS can_update
           FROM pg_roles r CROSS JOIN unnest($1::text[]) AS t(tbl)
           WHERE r.rolname = ANY($2::text[])`,
          [TABLES, Object.values(DB_ROLE)]
        )
      ).rows;
      const columns = (
        await db.query(
          `SELECT r.rolname AS role, c.col AS column_name,
                  has_column_privilege(r.rolname, 'public.admissions', c.col, 'SELECT') AS can_select
           FROM pg_roles r CROSS JOIN unnest(ARRAY['admission_diagnosis', 'triage_priority', 'admission_time']) AS c(col)
           WHERE r.rolname = ANY($1::text[])`,
          [Object.values(DB_ROLE)]
        )
      ).rows;
      const rlsTables = (
        await db.query(
          `SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
           FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity ORDER BY relname`
        )
      ).rows;
      return { ctx, policies, matrix, columns, rlsTables, probe: await probe(db) };
    });

    const comparison = [];
    for (const v of VIEWERS) {
      comparison.push({ label: v.label, role: v.who.role, dbRole: DB_ROLE[v.who.role], mode: v.who.mode, ...(await asStaff(v.who, probe)) });
    }

    return NextResponse.json({ success: true, me: mine, comparison, roles: DB_ROLE });
  } catch (error: any) {
    return dbError(error, 'Failed to build the privacy lens', auth);
  }
}
