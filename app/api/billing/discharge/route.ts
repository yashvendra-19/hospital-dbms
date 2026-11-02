import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { access, dbError, HttpError } from '@/lib/api';

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  const { clinical } = access(auth);
  try {
    const body = await request.json();
    const {
      admission_id,
      bed_charges = 0,
      clinical_procedure_charges = 0,
      pharmacy_charges = 0,
      insurance_claim_approved = 0,
      discount_percentage = 0,
      payment_status = 'Settled',
      next_bed_status = 'Available',
    } = body;

    if (!admission_id) throw new HttpError(400, 'Admission ID is required');

    const bedChargesNum = Math.max(0, parseFloat(bed_charges) || 0);
    const procChargesNum = Math.max(0, parseFloat(clinical_procedure_charges) || 0);
    const pharmChargesNum = Math.max(0, parseFloat(pharmacy_charges) || 0);
    const gross = bedChargesNum + procChargesNum + pharmChargesNum;
    const insuranceNum = Math.max(0, parseFloat(insurance_claim_approved) || 0);
    if (insuranceNum > gross) {
      throw new HttpError(400, `Insurance claim approved (₹${insuranceNum}) cannot exceed the gross hospital bill (₹${gross}).`);
    }
    const discountNum = Math.max(0, Math.min(50, parseFloat(discount_percentage) || 0));
    const finalBedStatus = next_bed_status === 'Sanitizing' ? 'Sanitizing' : 'Available';

    // One transaction as the signed-in role. Doctors and nurses have no INSERT grant on billing,
    // so PostgreSQL rolls the whole discharge back for them.
    const result = await asStaff(auth, async (db) => {
      const adm = await db.query(
        `SELECT admission_id, patient_id, bed_id, admission_status FROM admissions WHERE admission_id = $1`,
        [admission_id]
      );
      if (adm.rows.length === 0) throw new HttpError(404, 'Admission record not found');
      const admission = adm.rows[0];
      if (admission.admission_status === 'Discharged') throw new HttpError(400, 'Patient is already discharged from this admission.');

      await db.query(
        `UPDATE admissions SET admission_status = 'Discharged', discharge_time = CURRENT_TIMESTAMP
         WHERE admission_id = $1 RETURNING admission_id`,
        [admission_id]
      );
      await db.query(`UPDATE wards_beds SET operational_status = $1 WHERE bed_id = $2`, [finalBedStatus, admission.bed_id]);

      const bill = await db.query(
        `INSERT INTO billing (admission_id, bed_charges, clinical_procedure_charges, pharmacy_charges,
                              insurance_claim_approved, discount_percentage, payment_status, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${payment_status === 'Settled' ? 'CURRENT_TIMESTAMP' : 'NULL'})
         RETURNING bill_id`,
        [admission_id, bedChargesNum.toFixed(2), procChargesNum.toFixed(2), pharmChargesNum.toFixed(2), insuranceNum.toFixed(2),
          discountNum.toFixed(2), payment_status]
      );
      const billId = bill.rows[0].bill_id;

      const invoice = await db.query(
        `SELECT
          b.bill_id, b.admission_id, b.bed_charges::numeric, b.clinical_procedure_charges::numeric,
          b.pharmacy_charges::numeric, b.gross_amount::numeric, b.insurance_claim_approved::numeric,
          b.discount_percentage::numeric, b.net_patient_payable::numeric, b.payment_status, b.settled_at,
          p.full_name AS patient_name, p.national_health_id, wb.room_number, wb.bed_label, wb.ward_type,
          d.dept_name, doc.full_name AS doctor_name, a.admission_time, a.discharge_time,
          ${clinical ? 'a.admission_diagnosis' : 'NULL::text AS admission_diagnosis'},
          seal.seq AS seal_seq, seal.row_hash AS seal_hash
        FROM billing b
        JOIN admissions a ON b.admission_id = a.admission_id
        JOIN patients p ON a.patient_id = p.patient_id
        JOIN wards_beds wb ON a.bed_id = wb.bed_id
        JOIN departments d ON wb.dept_id = d.dept_id
        JOIN doctors doc ON a.admitting_doctor_id = doc.doctor_id
        LEFT JOIN LATERAL fn_audit_seal('billing', b.bill_id::text) seal ON true
        WHERE b.bill_id = $1`,
        [billId]
      );
      const estimate = await db.tryQuery(
        `SELECT estimate_code, est_low_inr::numeric, est_typical_inr::numeric, est_high_inr::numeric, outcome, deviation_pct::numeric
         FROM v_estimate_accuracy WHERE bill_id = $1`,
        [billId]
      );
      return { invoice: invoice.rows[0], estimate: estimate?.rows[0] ?? null };
    });

    return NextResponse.json({
      success: true,
      message: 'Patient discharged and billing finalized successfully',
      invoice: { ...result.invoice, estimate: result.estimate },
    });
  } catch (error: any) {
    return dbError(error, 'Failed to discharge patient', auth);
  }
}
