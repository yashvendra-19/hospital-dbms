import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Search the India Post pincode table by pincode prefix or locality/district name. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    if (q.length < 2) return NextResponse.json({ success: true, pincodes: [] });
    const rows = await asStaff(auth, async (db) => {
      const hp = (await db.query(`SELECT latitude, longitude FROM hospital_profile`)).rows[0];
      return (
        await db.query(
          `SELECT pincode, locality, district, state, latitude, longitude,
                  fn_haversine_km($2, $3, latitude, longitude) AS distance_km
           FROM india_pincodes
           WHERE pincode LIKE $1 || '%' OR locality ILIKE '%' || $1 || '%' OR district ILIKE $1 || '%'
           ORDER BY distance_km ASC LIMIT 8`,
          [q, hp.latitude, hp.longitude]
        )
      ).rows;
    });
    return NextResponse.json({ success: true, pincodes: rows });
  } catch (error: any) {
    return dbError(error, 'Failed to search pincodes', auth);
  }
}
