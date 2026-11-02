import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { access, dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  const { finance } = access(auth);
  try {
    // 1. Departmental capacity & revenue aggregate query
    const deptSummaryQuery = `
      SELECT 
        d.dept_id,
        d.dept_code,
        d.dept_name,
        d.floor_number,
        d.emergency_contact,
        d.annual_budget::numeric AS annual_budget,
        COALESCE(bed_stats.total_beds, 0)::int AS total_beds,
        COALESCE(bed_stats.occupied_beds, 0)::int AS occupied_beds,
        COALESCE(bed_stats.available_beds, 0)::int AS available_beds,
        COALESCE(bed_stats.sanitizing_beds, 0)::int AS sanitizing_beds,
        COALESCE(
          ROUND(
            (bed_stats.occupied_beds::numeric / NULLIF(bed_stats.total_beds, 0)) * 100.0, 
            1
          ), 
          0.0
        )::numeric AS occupancy_rate_pct,
        COALESCE(adm_stats.active_admissions, 0)::int AS active_admissions,
        COALESCE(adm_stats.total_all_time_admissions, 0)::int AS total_admissions,
        ${finance ? `COALESCE(rev_stats.gross_billed, 0.00)::numeric AS total_revenue_billed,
        COALESCE(rev_stats.net_payable, 0.00)::numeric AS total_net_patient_payable,
        COALESCE(rev_stats.insurance_approved, 0.00)::numeric AS total_insurance_claimed,` : `NULL::numeric AS total_revenue_billed,
        NULL::numeric AS total_net_patient_payable,
        NULL::numeric AS total_insurance_claimed,`}
        COALESCE(doc_stats.total_doctors, 0)::int AS total_doctors,
        COALESCE(doc_stats.on_duty_doctors, 0)::int AS on_duty_doctors
      FROM departments d
      -- Bed aggregations per department
      LEFT JOIN (
        SELECT 
          dept_id,
          COUNT(*)::int AS total_beds,
          COUNT(*) FILTER (WHERE operational_status = 'Occupied')::int AS occupied_beds,
          COUNT(*) FILTER (WHERE operational_status = 'Available')::int AS available_beds,
          COUNT(*) FILTER (WHERE operational_status = 'Sanitizing')::int AS sanitizing_beds
        FROM wards_beds
        GROUP BY dept_id
      ) bed_stats ON d.dept_id = bed_stats.dept_id
      -- Active & historical admissions per department (via bed)
      LEFT JOIN (
        SELECT 
          b.dept_id,
          COUNT(*) FILTER (WHERE a.discharge_time IS NULL AND a.admission_status = 'Admitted')::int AS active_admissions,
          COUNT(*)::int AS total_all_time_admissions
        FROM admissions a
        JOIN wards_beds b ON a.bed_id = b.bed_id
        GROUP BY b.dept_id
      ) adm_stats ON d.dept_id = adm_stats.dept_id
      ${finance ? `      -- Billing revenue per department
      LEFT JOIN (
        SELECT 
          wb.dept_id,
          SUM(bill.gross_amount)::numeric AS gross_billed,
          SUM(bill.net_patient_payable)::numeric AS net_payable,
          SUM(bill.insurance_claim_approved)::numeric AS insurance_approved
        FROM billing bill
        JOIN admissions a ON bill.admission_id = a.admission_id
        JOIN wards_beds wb ON a.bed_id = wb.bed_id
        GROUP BY wb.dept_id
      ) rev_stats ON d.dept_id = rev_stats.dept_id` : ''}
      -- Doctors per department
      LEFT JOIN (
        SELECT 
          dept_id,
          COUNT(*)::int AS total_doctors,
          COUNT(*) FILTER (WHERE is_on_duty = true)::int AS on_duty_doctors
        FROM doctors
        GROUP BY dept_id
      ) doc_stats ON d.dept_id = doc_stats.dept_id
      ORDER BY occupancy_rate_pct DESC, d.dept_id ASC
    `;

    // 2. Ward type distribution aggregate
    const wardTypeQuery = `
      SELECT 
        ward_type,
        COUNT(*)::int AS total_beds,
        COUNT(*) FILTER (WHERE operational_status = 'Occupied')::int AS occupied_beds,
        COUNT(*) FILTER (WHERE operational_status = 'Available')::int AS available_beds,
        COUNT(*) FILTER (WHERE has_ventilator = true)::int AS ventilator_equipped,
        ROUND(AVG(daily_tariff), 2)::numeric AS avg_daily_tariff
      FROM wards_beds
      GROUP BY ward_type
      ORDER BY total_beds DESC
    `;

    // 3. Overall KPI totals
    const kpiQuery = `
      SELECT 
        (SELECT COUNT(*)::int FROM wards_beds) AS total_beds,
        (SELECT COUNT(*)::int FROM v_bed_board WHERE board_status = 'Occupied') AS total_occupied,
        (SELECT COUNT(*)::int FROM admissions WHERE discharge_time IS NULL AND admission_status = 'Admitted') AS total_active_admissions,
        ${finance ? `(SELECT COALESCE(SUM(gross_amount), 0)::numeric FROM billing) AS total_gross_billed,
        (SELECT COALESCE(SUM(net_patient_payable), 0)::numeric FROM billing) AS total_net_payable,
        (SELECT COALESCE(SUM(insurance_claim_approved), 0)::numeric FROM billing) AS total_insurance_claimed,
        (SELECT COUNT(*)::int FROM billing WHERE payment_status = 'Settled') AS settled_bills_count,
        (SELECT COUNT(*)::int FROM billing WHERE payment_status <> 'Settled') AS pending_bills_count` : `NULL::numeric AS total_gross_billed,
        NULL::numeric AS total_net_payable,
        NULL::numeric AS total_insurance_claimed,
        NULL::int AS settled_bills_count,
        NULL::int AS pending_bills_count`}
    `;

    // Real-world context: where our numbers come from, and how honest our estimates have been
    const realWorldQuery = `
      SELECT
        (SELECT json_agg(json_build_object('key', source_key, 'title', title, 'publisher', publisher, 'url', source_url,
                 'mirror', mirror_url, 'licence', licence, 'rows', rows_loaded, 'rowsInSource', rows_in_source,
                 'sha256', raw_sha256, 'notes', notes) ORDER BY source_key) FROM dataset_sources) AS sources,
        (SELECT json_build_object(
            'hospitals', COUNT(*), 'states', COUNT(DISTINCT state), 'erCapable', COUNT(*) FILTER (WHERE er_capable),
            'withCoordinates', COUNT(*) FILTER (WHERE latitude IS NOT NULL),
            'sameDistrict', COUNT(*) FILTER (WHERE district = (SELECT district FROM hospital_profile)),
            'sameDistrictEr', COUNT(*) FILTER (WHERE er_capable AND district = (SELECT district FROM hospital_profile))
         ) FROM nhp_hospitals) AS directory,
        (SELECT json_agg(x ORDER BY x.cases DESC) FROM (
            SELECT cc.display_name AS condition, d.dept_code, m.cases, m.los_p50::numeric AS los_median,
                   m.los_p90::numeric AS los_p90, m.mortality_pct::numeric AS mortality_pct, m.intensity_index::numeric AS intensity
            FROM mv_condition_benchmarks m
            JOIN condition_catalog cc ON cc.condition_id = m.condition_id
            JOIN departments d ON d.dept_id = cc.dept_id
            WHERE m.severity_code = 0
            ORDER BY m.cases DESC, cc.display_name LIMIT 8
         ) x) AS top_conditions
    `;

    const { deptRes, wardRes, kpiRes, realRes, accuracyRes } = await asStaff(auth, async (db) => ({
      deptRes: await db.query(deptSummaryQuery),
      wardRes: await db.query(wardTypeQuery),
      kpiRes: await db.query(kpiQuery),
      realRes: await db.query(realWorldQuery),
      accuracyRes: await db.tryQuery(
        `SELECT outcome, COUNT(*)::int AS n FROM v_estimate_accuracy GROUP BY outcome ORDER BY outcome`
      ),
    }));

    const kpi = kpiRes.rows[0];
    const overallOccupancyPct = kpi.total_beds > 0
      ? Math.round((kpi.total_occupied / kpi.total_beds) * 1000) / 10
      : 0;

    return NextResponse.json({
      success: true,
      departmentCapacity: deptRes.rows,
      wardTypeDistribution: wardRes.rows,
      kpis: {
        ...kpi,
        overallOccupancyPct,
      },
      financeVisible: finance,
      realWorld: realRes.rows[0],
      estimateAccuracy: accuracyRes ? accuracyRes.rows : null,
    });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch analytics', auth);
  }
}
