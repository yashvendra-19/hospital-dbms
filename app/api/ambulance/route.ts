import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { ALERT_SELECT, diversionOptions } from '@/lib/ambulance';
import { dbError, HttpError } from '@/lib/api';

export const dynamic = 'force-dynamic';


export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const data = await asStaff(auth, async (db) => {
      const alerts = await db.query(
        `${ALERT_SELECT}
         WHERE p.status = 'Incoming' OR p.created_at > LOCALTIMESTAMP - INTERVAL '24 hours'
         ORDER BY (p.status = 'Incoming') DESC, p.esi_level ASC, p.expected_arrival_at ASC
         LIMIT 40`
      );
      const profile = await db.query(`SELECT * FROM hospital_profile`);
      const nearby = await db.query(
        `SELECT * FROM fn_nearest_er_hospitals($1, $2, 24, 45)`,
        [profile.rows[0].latitude, profile.rows[0].longitude]
      );
      return { alerts: alerts.rows, profile: profile.rows[0], nearby: nearby.rows };
    });
    return NextResponse.json({ success: true, ...data });
  } catch (error: any) {
    return dbError(error, 'Failed to load ambulance pre-alerts', auth);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const b = await request.json();
    const reg = String(b.ambulance_reg || '').toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
    const crewPhone = String(b.crew_phone || '').replace(/\D/g, '');
    if (!b.chief_complaint || String(b.chief_complaint).trim().length < 3) throw new HttpError(400, 'Describe the chief complaint.');
    const esi = parseInt(b.esi_level, 10);
    if (!(esi >= 1 && esi <= 5)) throw new HttpError(400, 'ESI level must be 1 to 5.');

    const result = await asStaff(auth, async (db) => {
      // Crew position: from a pincode (India Post centroid) or explicit coordinates
      let lat = b.origin_lat !== undefined ? Number(b.origin_lat) : NaN;
      let lon = b.origin_lon !== undefined ? Number(b.origin_lon) : NaN;
      let label = b.origin_label ? String(b.origin_label).slice(0, 120) : '';
      let pincode: string | null = null;
      if (b.origin_pincode) {
        const pin = await db.query(`SELECT * FROM india_pincodes WHERE pincode = $1`, [String(b.origin_pincode).trim()]);
        if (!pin.rows[0]) throw new HttpError(400, `Pincode ${b.origin_pincode} is not in the India Post directory.`);
        pincode = pin.rows[0].pincode;
        if (isNaN(lat) || isNaN(lon)) {
          lat = Number(pin.rows[0].latitude);
          lon = Number(pin.rows[0].longitude);
        }
        if (!label) label = `${pin.rows[0].locality}, ${pin.rows[0].district}`;
      }
      if (isNaN(lat) || isNaN(lon)) throw new HttpError(400, 'Give the crew position as a pincode or coordinates.');

      const eta = await db.query(`SELECT * FROM fn_suggest_eta_minutes($1, $2)`, [lat, lon]);
      const etaMinutes = b.eta_minutes ? parseInt(b.eta_minutes, 10) : eta.rows[0].eta_minutes;

      const inserted = await db.query(
        `INSERT INTO ambulance_prealerts (ambulance_reg, service_type, crew_phone, origin_label, origin_pincode, origin_lat,
            origin_lon, distance_km, patient_age, patient_gender, chief_complaint, condition_id, esi_level, heart_rate, spo2,
            systolic_bp, gcs, needs_ventilator, required_ward_type, eta_minutes, created_by_staff)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         RETURNING alert_id`,
        [
          reg, b.service_type || '108', crewPhone, label || 'Unknown location', pincode, lat, lon, eta.rows[0].distance_km,
          b.patient_age === '' || b.patient_age === undefined ? null : parseInt(b.patient_age, 10), b.patient_gender || 'U',
          String(b.chief_complaint).trim().slice(0, 200), b.condition_id ? parseInt(b.condition_id, 10) : null, esi,
          b.heart_rate ? parseInt(b.heart_rate, 10) : null, b.spo2 ? parseInt(b.spo2, 10) : null,
          b.systolic_bp ? parseInt(b.systolic_bp, 10) : null, b.gcs ? parseInt(b.gcs, 10) : null, !!b.needs_ventilator,
          b.required_ward_type || null, etaMinutes, auth.staffId,
        ]
      );
      const alertId = inserted.rows[0].alert_id;
      const hold = await db.query(`SELECT * FROM fn_reserve_bed_for_alert($1)`, [alertId]);
      const alert = await db.query(`${ALERT_SELECT} WHERE p.alert_id = $1`, [alertId]);
      const diversion = hold.rows.length === 0 ? await diversionOptions(db, lat, lon) : null;
      return { alert: alert.rows[0], hold: hold.rows[0] || null, diversion };
    });

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error: any) {
    return dbError(error, 'Failed to record the pre-alert', auth);
  }
}
