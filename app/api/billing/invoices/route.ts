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
    // Doctors and nurses have no grant on billing: PostgreSQL answers 403 for them.
    const sql = `
      SELECT
        b.bill_id, b.admission_id,
        b.bed_charges::numeric AS bed_charges, b.clinical_procedure_charges::numeric AS clinical_procedure_charges,
        b.pharmacy_charges::numeric AS pharmacy_charges, b.gross_amount::numeric AS gross_amount,
        b.insurance_claim_approved::numeric AS insurance_claim_approved, b.discount_percentage::numeric AS discount_percentage,
        b.net_patient_payable::numeric AS net_patient_payable, b.payment_status, b.settled_at,
        p.patient_id, p.national_health_id, p.full_name AS patient_name, p.primary_phone,
        wb.room_number, wb.bed_label, wb.ward_type, d.dept_name, doc.full_name AS doctor_name,
        a.admission_time, a.discharge_time,
        ${clinical ? 'a.admission_diagnosis' : 'NULL::text AS admission_diagnosis'},
        ea.estimate_code, ea.est_low_inr::numeric AS est_low_inr, ea.est_high_inr::numeric AS est_high_inr,
        ea.outcome AS estimate_outcome, ea.deviation_pct::numeric AS estimate_deviation_pct,
        seal.seq AS seal_seq, seal.row_hash AS seal_hash
      FROM billing b
      INNER JOIN admissions a ON b.admission_id = a.admission_id
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN wards_beds wb ON a.bed_id = wb.bed_id
      INNER JOIN departments d ON wb.dept_id = d.dept_id
      INNER JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id
      LEFT JOIN v_estimate_accuracy ea ON ea.bill_id = b.bill_id
      LEFT JOIN LATERAL fn_audit_seal('billing', b.bill_id::text) seal ON true
      ORDER BY b.bill_id DESC
    `;
    const rows = await asStaff(auth, async (db) => (await db.query(sql)).rows);
    return NextResponse.json({ success: true, invoices: rows, count: rows.length });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch invoices', auth);
  }
}
