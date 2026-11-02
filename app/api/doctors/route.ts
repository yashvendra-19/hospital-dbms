import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const onDutyOnly = searchParams.get('on_duty') === 'true';
    const deptId = searchParams.get('dept_id');

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (onDutyOnly) {
      conditions.push(`doc.is_on_duty = true`);
    }

    if (deptId && deptId !== 'all') {
      conditions.push(`doc.dept_id = $${paramIndex}`);
      params.push(parseInt(deptId, 10));
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT 
        doc.doctor_id,
        doc.license_no,
        doc.full_name,
        doc.specialization,
        doc.dept_id,
        doc.email,
        doc.phone,
        doc.consultation_fee::numeric AS consultation_fee,
        doc.is_on_duty,
        d.dept_name,
        d.dept_code
      FROM doctors doc
      INNER JOIN departments d ON doc.dept_id = d.dept_id
      ${whereClause}
      ORDER BY doc.is_on_duty DESC, doc.full_name ASC
    `;

    const rows = await asStaff(auth, async (db) => (await db.query(sql, params)).rows);

    return NextResponse.json({ success: true, doctors: rows });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch doctors', auth);
  }
}
