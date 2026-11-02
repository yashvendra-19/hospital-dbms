import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { access, dbError, HttpError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  const { clinical, finance } = access(auth);
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('q');

    const conditions: string[] = [];
    const params: any[] = [];
    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`a.admission_status = $${params.length}`);
    }
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      const i = params.length;
      conditions.push(`(p.full_name ILIKE $${i} OR p.national_health_id ILIKE $${i} OR b.room_number ILIKE $${i}
                        OR b.bed_label ILIKE $${i} OR doc.full_name ILIKE $${i})`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        a.admission_id, a.patient_id, a.bed_id, a.admitting_doctor_id,
        ${clinical ? 'a.triage_priority, a.admission_diagnosis, a.condition_id, a.apr_severity' : 'NULL::int AS triage_priority, NULL::text AS admission_diagnosis, NULL::int AS condition_id, NULL::int AS apr_severity'},
        a.admission_time, a.discharge_time, a.admission_status,
        p.national_health_id, p.full_name AS patient_name, p.gender, p.dob, p.blood_group, p.primary_phone,
        p.emergency_contact_name, p.emergency_contact_phone, p.privacy_level AS patient_privacy,
        b.room_number, b.bed_label, b.ward_type, b.has_ventilator, b.has_oxygen_port,
        b.daily_tariff::numeric AS daily_tariff, b.operational_status AS bed_operational_status,
        d.dept_id, d.dept_name, d.dept_code,
        doc.license_no AS doctor_license, doc.full_name AS doctor_name, doc.specialization AS doctor_specialization,
        ${finance ? 'bill.bill_id, bill.gross_amount::numeric AS gross_amount, bill.net_patient_payable::numeric AS net_patient_payable, bill.payment_status' : 'NULL::int AS bill_id, NULL::numeric AS gross_amount, NULL::numeric AS net_patient_payable, NULL::text AS payment_status'},
        EXTRACT(EPOCH FROM (COALESCE(a.discharge_time, CURRENT_TIMESTAMP) - a.admission_time))::numeric AS stay_seconds
      FROM admissions a
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN wards_beds b ON a.bed_id = b.bed_id
      INNER JOIN departments d ON b.dept_id = d.dept_id
      INNER JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id
      ${finance ? 'LEFT JOIN billing bill ON a.admission_id = bill.admission_id' : ''}
      ${whereClause}
      ORDER BY
        CASE WHEN a.admission_status = 'Admitted' THEN 0 ELSE 1 END,
        ${clinical ? 'a.triage_priority ASC,' : ''}
        a.admission_time DESC
    `;
    const rows = await asStaff(auth, async (db) => (await db.query(sql, params)).rows);
    return NextResponse.json({ success: true, admissions: rows });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch admissions', auth);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { patient_id, bed_id, admitting_doctor_id, triage_priority, admission_diagnosis, condition_id, apr_severity, estimate } = body;

    if (!patient_id || !bed_id || !admitting_doctor_id || !admission_diagnosis) {
      throw new HttpError(400, 'Missing required admission fields: patient_id, bed_id, admitting_doctor_id, admission_diagnosis');
    }
    const triageNum = parseInt(triage_priority, 10) || 3;
    if (triageNum < 1 || triageNum > 5) throw new HttpError(400, 'Triage priority must be an integer between 1 and 5');
    const conditionId = condition_id ? parseInt(condition_id, 10) : null;
    const severity = apr_severity ? parseInt(apr_severity, 10) : null;

    const result = await asStaff(auth, async (db) => {
      const active = await db.query(
        `SELECT a.admission_id, b.room_number, b.bed_label
         FROM admissions a JOIN wards_beds b ON a.bed_id = b.bed_id
         WHERE a.patient_id = $1 AND a.discharge_time IS NULL AND a.admission_status = 'Admitted'`,
        [patient_id]
      );
      if (active.rows.length > 0) {
        const r = active.rows[0];
        throw new HttpError(409, `Patient is already admitted to Bed ${r.room_number} (${r.bed_label}). Discharge current stay before admitting to a new bed.`);
      }

      // Guards that fire here: ex_no_double_bed_booking (GiST) and trg_admission_hold_guard (ambulance holds)
      const inserted = await db.query(
        `INSERT INTO admissions (patient_id, bed_id, admitting_doctor_id, triage_priority, admission_time,
                                 admission_status, admission_diagnosis, condition_id, apr_severity)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'Admitted', $5, $6, $7)
         RETURNING admission_id`,
        [patient_id, bed_id, admitting_doctor_id, triageNum, String(admission_diagnosis).trim(), conditionId, severity]
      );
      const admissionId = inserted.rows[0].admission_id;
      await db.query(`UPDATE wards_beds SET operational_status = 'Occupied' WHERE bed_id = $1`, [bed_id]);

      // Upfront cost estimate, computed by PostgreSQL from real outcomes and saved with the admission
      let savedEstimate = null;
      if (conditionId && severity && estimate) {
        const bedWard = await db.query(`SELECT ward_type FROM wards_beds WHERE bed_id = $1`, [bed_id]);
        const est = await db.query(
          `INSERT INTO cost_estimates (patient_id, admission_id, condition_id, severity_code, ward_type, scheme_code,
               cover_available_inr, cases_used, los_low, los_typical, los_high, daily_tariff, intensity_index,
               est_low_inr, est_typical_inr, est_high_inr, oop_typical_inr, explained_to, relation_to_patient, created_by_staff)
           SELECT $1, $2, e.condition_id, $3, e.ward_type, e.scheme_code, e.cover_available, e.cases, e.los_low, e.los_typical,
                  e.los_high, e.daily_tariff, e.intensity_index, e.est_low, e.est_typical, e.est_high, e.oop_typical, $7, $8, $9
           FROM fn_estimate_admission_cost($4, $3, $5, $6, $10) e
           RETURNING estimate_id, estimate_code, est_low_inr, est_typical_inr, est_high_inr, oop_typical_inr`,
          [
            patient_id,
            admissionId,
            severity,
            conditionId,
            bedWard.rows[0]?.ward_type || null,
            estimate.scheme_code || 'SELF',
            estimate.explained_to ? String(estimate.explained_to).slice(0, 100) : null,
            estimate.relation ? String(estimate.relation).slice(0, 40) : null,
            auth.staffId,
            estimate.cover_remaining !== undefined && estimate.cover_remaining !== '' && estimate.cover_remaining !== null
              ? Number(estimate.cover_remaining)
              : null,
          ]
        );
        savedEstimate = est.rows[0];
      }

      const detail = await db.query(
        `SELECT a.admission_id, a.triage_priority, a.admission_time, a.admission_status, a.admission_diagnosis,
                p.full_name AS patient_name, p.national_health_id, b.room_number, b.bed_label, b.ward_type,
                doc.full_name AS doctor_name, d.dept_name
         FROM admissions a
         JOIN patients p ON a.patient_id = p.patient_id
         JOIN wards_beds b ON a.bed_id = b.bed_id
         JOIN departments d ON b.dept_id = d.dept_id
         JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id
         WHERE a.admission_id = $1`,
        [admissionId]
      );
      return { admission: detail.rows[0] || { admission_id: admissionId }, estimate: savedEstimate };
    });

    return NextResponse.json(
      { success: true, ...result, message: 'Patient admitted successfully into bed' },
      { status: 201 }
    );
  } catch (error: any) {
    return dbError(error, 'Failed to admit patient', auth);
  }
}
