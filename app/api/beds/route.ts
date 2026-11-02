import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { access, dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  const { clinical } = access(auth);
  try {
    const { searchParams } = new URL(request.url);
    const deptId = searchParams.get('dept_id');
    const status = searchParams.get('status');
    const wardType = searchParams.get('ward_type');
    const search = searchParams.get('search');

    const conditions: string[] = [];
    const params: any[] = [];

    if (deptId && deptId !== 'all') {
      params.push(parseInt(deptId, 10));
      conditions.push(`b.dept_id = $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`b.board_status = $${params.length}`);
    }
    if (wardType && wardType !== 'all') {
      params.push(wardType);
      conditions.push(`b.ward_type = $${params.length}`);
    }
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      const i = params.length;
      conditions.push(`(b.room_number ILIKE $${i} OR b.bed_label ILIKE $${i} OR p.full_name ILIKE $${i} OR p.national_health_id ILIKE $${i})`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Billing staff have no column grant on diagnosis / triage / condition, so those are not named for them.
    const clinicalCols = clinical
      ? `a.triage_priority, a.admission_diagnosis, a.condition_id, a.apr_severity, cc.display_name AS condition_name,
         bm.los_p50 AS expected_los_days, bm.cases AS benchmark_cases,
         a.admission_time + (bm.los_p50 * INTERVAL '1 day') AS expected_discharge_at,
         a.admission_time + (bm.los_p75 * INTERVAL '1 day') AS late_discharge_at`
      : `NULL::int AS triage_priority, NULL::text AS admission_diagnosis, NULL::int AS condition_id, NULL::int AS apr_severity,
         NULL::text AS condition_name, NULL::numeric AS expected_los_days, NULL::int AS benchmark_cases,
         NULL::timestamp AS expected_discharge_at, NULL::timestamp AS late_discharge_at`;
    const clinicalJoins = clinical
      ? `LEFT JOIN condition_catalog cc ON cc.condition_id = a.condition_id
         LEFT JOIN LATERAL (
           SELECT m.los_p50, m.los_p75, m.cases FROM mv_condition_benchmarks m
           WHERE m.condition_id = a.condition_id AND m.severity_code IN (COALESCE(a.apr_severity, 0), 0) AND m.cases >= 30
           ORDER BY m.severity_code DESC LIMIT 1
         ) bm ON true`
      : '';

    const sql = `
      SELECT
        b.bed_id, b.dept_id, b.room_number, b.bed_label, b.ward_type, b.has_ventilator, b.has_oxygen_port,
        b.daily_tariff::numeric AS daily_tariff,
        b.board_status AS operational_status,
        b.operational_status AS physical_status,
        b.dept_code, b.dept_name, b.floor_number,
        b.hold_id, b.hold_alert_code, b.hold_ambulance, b.hold_until, b.hold_eta, b.hold_esi, b.hold_complaint, b.hold_origin,
        a.admission_id, a.admission_time, a.admission_status,
        ${clinicalCols},
        p.patient_id, p.national_health_id, p.full_name AS patient_name, p.gender AS patient_gender,
        p.blood_group AS patient_blood_group, p.privacy_level AS patient_privacy, p.restriction_reason,
        doc.doctor_id, doc.full_name AS doctor_name, doc.specialization AS doctor_specialization,
        (b.board_status = 'Occupied' AND a.admission_id IS NULL) AS is_protected
      FROM v_bed_board b
      LEFT JOIN admissions a ON b.bed_id = a.bed_id AND a.discharge_time IS NULL AND a.admission_status = 'Admitted'
      LEFT JOIN patients p ON a.patient_id = p.patient_id
      LEFT JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id
      ${clinicalJoins}
      ${whereClause}
      ORDER BY
        CASE b.board_status WHEN 'Occupied' THEN 1 WHEN 'Reserved' THEN 2 WHEN 'Available' THEN 3 WHEN 'Sanitizing' THEN 4 ELSE 5 END,
        b.dept_name, b.room_number, b.bed_label
    `;

    const rows = await asStaff(auth, async (db) => (await db.query(sql, params)).rows);
    return NextResponse.json({ success: true, beds: rows, count: rows.length });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch beds', auth);
  }
}
