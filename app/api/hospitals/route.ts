import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Fuzzy search of the National Hospital Directory (pg_trgm similarity + GIN index). */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = new URL(request.url).searchParams;
    const q = (sp.get('q') || '').trim();
    const state = sp.get('state') || 'Tamil Nadu';
    if (q.length < 3) return NextResponse.json({ success: true, hospitals: [] });
    const rows = await asStaff(auth, async (db) => {
      const hp = (await db.query(`SELECT latitude, longitude FROM hospital_profile`)).rows[0];
      return (
        await db.query(
          `SELECT nhp_id, hospital_name, district, state, pincode, care_type, hospital_category, er_capable, total_beds,
                  COALESCE(emergency_phone, ambulance_phone, telephone, mobile) AS phone, geo_source,
                  round(similarity(hospital_name, $1)::numeric, 2) AS match,
                  CASE WHEN latitude IS NULL THEN NULL ELSE fn_haversine_km($3, $4, latitude, longitude) END AS distance_km
           FROM nhp_hospitals
           WHERE (hospital_name % $1 OR hospital_name ILIKE '%' || $1 || '%') AND ($2 = 'all' OR state = $2)
           ORDER BY similarity(hospital_name, $1) DESC, distance_km NULLS LAST
           LIMIT 12`,
          [q, state, hp.latitude, hp.longitude]
        )
      ).rows;
    });
    return NextResponse.json({ success: true, hospitals: rows });
  } catch (error: any) {
    return dbError(error, 'Failed to search the hospital directory', auth);
  }
}
