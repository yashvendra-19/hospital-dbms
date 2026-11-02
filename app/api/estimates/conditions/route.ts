import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Condition catalogue + insurance schemes for the cost-estimate desk. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const data = await asStaff(auth, async (db) => ({
      conditions: (
        await db.query(
          `SELECT cc.condition_id, cc.ccsr_code, cc.age_scope, cc.display_name, cc.ccsr_description, cc.dept_id,
                  d.dept_name, d.dept_code, cc.default_ward_type, cc.source_population,
                  m.cases AS sample_cases, m.los_p50::numeric AS los_median
           FROM condition_catalog cc
           JOIN departments d ON d.dept_id = cc.dept_id
           LEFT JOIN mv_condition_benchmarks m ON m.condition_id = cc.condition_id AND m.severity_code = 0
           ORDER BY cc.dept_id, cc.display_name`
        )
      ).rows,
      schemes: (await db.query(`SELECT * FROM insurance_schemes ORDER BY annual_cover_inr DESC NULLS LAST, scheme_code`)).rows,
    }));
    return NextResponse.json({ success: true, ...data });
  } catch (error: any) {
    return dbError(error, 'Failed to load the condition catalogue', auth);
  }
}
