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
    const sql = `
      SELECT
        a.admission_id, a.patient_id, a.bed_id, a.admitting_doctor_id,
        ${clinical ? 'a.triage_priority, a.admission_diagnosis' : 'NULL::int AS triage_priority, NULL::text AS admission_diagnosis'},
        a.admission_time, a.admission_status,
        p.national_health_id, p.full_name AS patient_name, p.gender, p.dob, p.blood_group, p.primary_phone,
        p.emergency_contact_name, p.emergency_contact_phone, p.privacy_level AS patient_privacy,
        b.room_number, b.bed_label, b.ward_type, b.has_ventilator, b.has_oxygen_port,
        b.daily_tariff::numeric AS daily_tariff,
        d.dept_id, d.dept_name, d.dept_code,
        doc.full_name AS doctor_name, doc.specialization AS doctor_specialization,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - a.admission_time)) / 86400.0))::int AS billable_days,
        ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - a.admission_time)) / 86400.0)::numeric, 1) AS actual_days_elapsed,
        (GREATEST(1, CEIL(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - a.admission_time)) / 86400.0)) * b.daily_tariff)::numeric AS estimated_bed_charges,
        e.estimate_code, e.est_low_inr::numeric AS est_low_inr, e.est_typical_inr::numeric AS est_typical_inr,
        e.est_high_inr::numeric AS est_high_inr, e.oop_typical_inr::numeric AS oop_typical_inr, e.scheme_code AS estimate_scheme,
        e.los_low AS estimate_los_low, e.los_high AS estimate_los_high, e.explained_to AS estimate_explained_to,
        cc.display_name AS estimate_condition
      FROM admissions a
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN wards_beds b ON a.bed_id = b.bed_id
      INNER JOIN departments d ON b.dept_id = d.dept_id
      INNER JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id
      LEFT JOIN cost_estimates e ON e.admission_id = a.admission_id
      LEFT JOIN condition_catalog cc ON cc.condition_id = e.condition_id
      WHERE a.discharge_time IS NULL AND a.admission_status = 'Admitted'
      ORDER BY a.admission_time ASC
    `;
    const rows = await asStaff(auth, async (db) => (await db.query(sql)).rows);
    return NextResponse.json({ success: true, activeInpatients: rows, count: rows.length });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch active inpatients', auth);
  }
}
