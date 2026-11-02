import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError, HttpError } from '@/lib/api';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const bedId = parseInt(params.id, 10);
    if (isNaN(bedId)) throw new HttpError(400, 'Invalid bed ID');

    const { operational_status } = await request.json();
    const allowedStatuses = ['Available', 'Occupied', 'Sanitizing', 'Out-Of-Service'];
    if (!allowedStatuses.includes(operational_status)) {
      throw new HttpError(400, `Status must be one of: ${allowedStatuses.join(', ')}`);
    }

    const bed = await asStaff(auth, async (db) => {
      if (operational_status === 'Available') {
        const active = await db.query(
          `SELECT admission_id FROM admissions WHERE bed_id = $1 AND discharge_time IS NULL AND admission_status = 'Admitted'`,
          [bedId]
        );
        if (active.rows.length > 0) {
          throw new HttpError(400, 'Cannot mark bed as Available while an inpatient is currently admitted to it. Discharge patient first.');
        }
      }
      const { rows } = await db.query(
        `UPDATE wards_beds SET operational_status = $1 WHERE bed_id = $2
         RETURNING bed_id, room_number, bed_label, ward_type, operational_status`,
        [operational_status, bedId]
      );
      if (rows.length === 0) throw new HttpError(404, 'Bed not found');
      return rows[0];
    });

    return NextResponse.json({ success: true, bed, message: `Bed operational status updated to ${operational_status}` });
  } catch (error: any) {
    return dbError(error, 'Failed to update bed', auth);
  }
}
