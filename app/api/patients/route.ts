import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError, HttpError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q');

    let sql = `
      SELECT 
        p.patient_id,
        p.national_health_id,
        p.full_name,
        p.gender,
        p.dob,
        p.blood_group,
        p.primary_phone,
        p.emergency_contact_name,
        p.emergency_contact_phone,
        p.privacy_level,
        p.restriction_reason,
        (
          SELECT a.admission_id 
          FROM admissions a 
          WHERE a.patient_id = p.patient_id AND a.discharge_time IS NULL AND a.admission_status = 'Admitted'
          LIMIT 1
        ) AS active_admission_id
      FROM patients p
    `;

    const params: any[] = [];
    if (search && search.trim() !== '') {
      sql += ` WHERE p.full_name ILIKE $1 OR p.national_health_id ILIKE $1 OR p.primary_phone ILIKE $1`;
      params.push(`%${search.trim()}%`);
    }

    sql += ` ORDER BY p.patient_id DESC`;

    // Row-level security decides which patients come back (restricted records only for the care team)
    const rows = await asStaff(auth, async (db) => (await db.query(sql, params)).rows);
    return NextResponse.json({ success: true, patients: rows });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch patients', auth);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const {
      national_health_id,
      full_name,
      gender,
      dob,
      blood_group,
      primary_phone,
      emergency_contact_name,
      emergency_contact_phone,
      privacy_level,
      restriction_reason,
    } = body;
    const restricted = privacy_level === 'restricted';
    if (restricted && (!restriction_reason || String(restriction_reason).trim().length < 3)) {
      throw new HttpError(400, 'Give a reason for restricting this record (for example: medico-legal case).');
    }

    // Basic front validation
    if (!national_health_id || !full_name || !gender || !dob || !blood_group || !primary_phone) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required patient fields: national_health_id, full_name, gender, dob, blood_group, primary_phone',
        },
        { status: 400 }
      );
    }

    // Phone format sanitization (must be 10 digits to satisfy chk_pat_phone)
    const sanitizedPhone = String(primary_phone).replace(/\D/g, '');
    if (sanitizedPhone.length !== 10) {
      return NextResponse.json(
        {
          success: false,
          error: 'Primary phone number must be exactly 10 digits.',
        },
        { status: 400 }
      );
    }

    const sanitizedEmergencyPhone = emergency_contact_phone
      ? String(emergency_contact_phone).replace(/\D/g, '')
      : null;

    const sql = `
      INSERT INTO patients (
        national_health_id,
        full_name,
        gender,
        dob,
        blood_group,
        primary_phone,
        emergency_contact_name,
        emergency_contact_phone,
        privacy_level,
        restriction_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const params = [
      national_health_id.trim().toUpperCase(),
      full_name.trim(),
      gender.toUpperCase(),
      dob,
      blood_group,
      sanitizedPhone,
      emergency_contact_name ? emergency_contact_name.trim() : null,
      sanitizedEmergencyPhone,
      restricted ? 'restricted' : 'standard',
      restricted ? String(restriction_reason).trim().slice(0, 80) : null,
    ];

    // RLS policy pol_patients_register: only doctors and admins may create restricted records
    const rows = await asStaff(auth, async (db) => (await db.query(sql, params)).rows);

    return NextResponse.json(
      {
        success: true,
        patient: rows[0],
        message: 'Patient registered successfully',
      },
      { status: 201 }
    );
  } catch (error: any) {
    return dbError(error, 'Failed to register patient', auth);
  }
}
