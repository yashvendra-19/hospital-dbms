import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError, HttpError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Live cost estimate computed by fn_estimate_admission_cost() plus the real length-of-stay
 * distribution it is based on (rows from historical_discharges, NY SPARCS 2021).
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = new URL(request.url).searchParams;
    const conditionId = parseInt(sp.get('condition_id') || '', 10);
    const severity = parseInt(sp.get('severity') || '', 10);
    if (!conditionId || !severity) throw new HttpError(400, 'condition_id and severity are required');
    const ward = sp.get('ward_type') || null;
    const scheme = sp.get('scheme') || 'SELF';
    const coverRaw = sp.get('cover');
    const cover = coverRaw !== null && coverRaw !== '' ? Number(coverRaw) : null;

    const data = await asStaff(auth, async (db) => {
      const est = (await db.query(`SELECT * FROM fn_estimate_admission_cost($1, $2, $3, $4, $5)`, [conditionId, severity, ward, scheme, cover])).rows[0];
      const sevFilter = est.severity_used === 0 ? '' : 'AND severity_code = $2';
      const params = est.severity_used === 0 ? [conditionId] : [conditionId, est.severity_used];
      const histogram = (
        await db.query(
          `SELECT LEAST(length_of_stay, 30)::int AS days, count(*)::int AS stays
           FROM historical_discharges WHERE condition_id = $1 ${sevFilter}
           GROUP BY 1 ORDER BY 1`,
          params
        )
      ).rows;
      const outcomes = (
        await db.query(
          `SELECT disposition_group AS outcome, count(*)::int AS stays
           FROM historical_discharges WHERE condition_id = $1 ${sevFilter}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
          params
        )
      ).rows;
      const facts = (
        await db.query(
          `SELECT count(DISTINCT facility_name)::int AS hospitals, round(100.0 * avg(ed_admission::int), 0)::int AS via_er_pct
           FROM historical_discharges WHERE condition_id = $1 ${sevFilter}`,
          params
        )
      ).rows[0];
      const source = (await db.query(`SELECT title, publisher, source_url, rows_in_source FROM dataset_sources WHERE source_key = 'sparcs_2021'`)).rows[0];
      return { estimate: est, histogram, outcomes, facts, source };
    });
    return NextResponse.json({ success: true, ...data });
  } catch (error: any) {
    return dbError(error, 'Failed to compute the estimate', auth);
  }
}
