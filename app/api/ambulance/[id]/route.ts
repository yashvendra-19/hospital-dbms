import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { dbError, HttpError } from '@/lib/api';
import { diversionOptions } from '@/lib/ambulance';

export const dynamic = 'force-dynamic';

/** Diversion options for one pre-alert (nearest real hospitals from the national directory). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const alertId = parseInt(params.id, 10);
    const data = await asStaff(auth, async (db) => {
      const a = await db.query(`SELECT origin_lat, origin_lon FROM ambulance_prealerts WHERE alert_id = $1`, [alertId]);
      if (!a.rows[0]) throw new HttpError(404, 'Pre-alert not found');
      return diversionOptions(db, Number(a.rows[0].origin_lat), Number(a.rows[0].origin_lon));
    });
    return NextResponse.json({ success: true, diversion: data });
  } catch (error: any) {
    return dbError(error, 'Failed to load diversion options', auth);
  }
}

/** action: reserve (retry) | arrive | divert | cancel */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const alertId = parseInt(params.id, 10);
    if (isNaN(alertId)) throw new HttpError(400, 'Invalid pre-alert id');
    const b = await request.json();

    const result = await asStaff(auth, async (db) => {
      switch (b.action) {
        case 'reserve': {
          const hold = await db.query(`SELECT * FROM fn_reserve_bed_for_alert($1)`, [alertId]);
          if (hold.rows.length === 0) {
            const a = await db.query(`SELECT origin_lat, origin_lon FROM ambulance_prealerts WHERE alert_id = $1`, [alertId]);
            return { hold: null, diversion: await diversionOptions(db, Number(a.rows[0].origin_lat), Number(a.rows[0].origin_lon)) };
          }
          return { hold: hold.rows[0] };
        }
        case 'arrive': {
          if (!b.patient_id || !b.doctor_id) throw new HttpError(400, 'Choose the patient record and the receiving doctor.');
          const adm = await db.query(`SELECT fn_admit_from_alert($1, $2, $3, $4) AS admission_id`, [
            alertId, b.patient_id, b.doctor_id, b.diagnosis || null,
          ]);
          return { admission_id: adm.rows[0].admission_id };
        }
        case 'divert': {
          const note = String(b.note || '').trim();
          if (note.length < 5) throw new HttpError(400, 'Say why the ambulance is being diverted (at least 5 characters).');
          await db.query(
            `UPDATE bed_holds SET status = 'Released', released_reason = 'Ambulance diverted' WHERE alert_id = $1 AND status = 'Active'`,
            [alertId]
          );
          const r = await db.query(
            `UPDATE ambulance_prealerts SET status = 'Diverted', resolved_at = LOCALTIMESTAMP, diverted_to_nhp_id = $2,
                    resolution_note = $3
             WHERE alert_id = $1 AND status = 'Incoming' RETURNING alert_code`,
            [alertId, b.nhp_id ? parseInt(b.nhp_id, 10) : null, note.slice(0, 255)]
          );
          if (!r.rows[0]) throw new HttpError(409, 'This pre-alert is no longer incoming.');
          return { diverted: r.rows[0].alert_code };
        }
        case 'cancel': {
          await db.query(
            `UPDATE bed_holds SET status = 'Released', released_reason = 'Pre-alert cancelled by the crew' WHERE alert_id = $1 AND status = 'Active'`,
            [alertId]
          );
          const r = await db.query(
            `UPDATE ambulance_prealerts SET status = 'Cancelled', resolved_at = LOCALTIMESTAMP, resolution_note = $2
             WHERE alert_id = $1 AND status = 'Incoming' RETURNING alert_code`,
            [alertId, String(b.note || 'Cancelled by the crew').slice(0, 255)]
          );
          if (!r.rows[0]) throw new HttpError(409, 'This pre-alert is no longer incoming.');
          return { cancelled: r.rows[0].alert_code };
        }
        default:
          throw new HttpError(400, 'Unknown action');
      }
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return dbError(error, 'Failed to update the pre-alert', auth);
  }
}
