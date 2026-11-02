import type { Db } from '@/lib/db';

export const ALERT_SELECT = `
  SELECT p.*, cc.display_name AS condition_name, cc.default_ward_type,
         h.hold_id, h.bed_id AS hold_bed_id, h.status AS hold_status, upper(h.hold_window) AS hold_until,
         wb.room_number AS hold_room, wb.bed_label AS hold_bed_label, wb.ward_type AS hold_ward_type, d.dept_name AS hold_dept,
         dv.hospital_name AS diverted_to_name, dv.district AS diverted_to_district,
         EXTRACT(EPOCH FROM (p.expected_arrival_at - LOCALTIMESTAMP))::int AS seconds_to_arrival
  FROM ambulance_prealerts p
  LEFT JOIN condition_catalog cc ON cc.condition_id = p.condition_id
  LEFT JOIN LATERAL (
    SELECT * FROM bed_holds bh WHERE bh.alert_id = p.alert_id ORDER BY bh.hold_id DESC LIMIT 1
  ) h ON true
  LEFT JOIN wards_beds wb ON wb.bed_id = h.bed_id
  LEFT JOIN departments d ON d.dept_id = wb.dept_id
  LEFT JOIN nhp_hospitals dv ON dv.nhp_id = p.diverted_to_nhp_id
`;

/** When no bed fits: nearest emergency-capable hospitals + our beds most likely to free up soon. */
export async function diversionOptions(db: Db, lat: number, lon: number) {
  const hospitals = await db.query(`SELECT * FROM fn_nearest_er_hospitals($1, $2, 8, 60)`, [lat, lon]);
  const freeing = await db.tryQuery(
    `SELECT b.bed_id, b.room_number, b.bed_label, b.ward_type,
            a.admission_time + (m.los_p50 * INTERVAL '1 day') AS expected_free_at, m.cases
     FROM admissions a
     JOIN wards_beds b ON b.bed_id = a.bed_id
     JOIN LATERAL (
       SELECT los_p50, cases FROM mv_condition_benchmarks mb
       WHERE mb.condition_id = a.condition_id AND mb.severity_code IN (COALESCE(a.apr_severity, 0), 0) AND mb.cases >= 30
       ORDER BY mb.severity_code DESC LIMIT 1
     ) m ON true
     WHERE a.discharge_time IS NULL AND a.admission_status = 'Admitted'
     ORDER BY expected_free_at ASC LIMIT 4`
  );
  return { hospitals: hospitals.rows, likelyFreeSoon: freeing?.rows ?? [] };
}

