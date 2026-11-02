import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { asStaff } from '@/lib/db';
import { access, dbError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (auth instanceof NextResponse) return auth;
  const { clinical } = access(auth);
  try {
    const stats = await asStaff(auth, async (db) => {
      const bed = (
        await db.query(`
          SELECT
            COUNT(*)::int AS total_beds,
            COUNT(*) FILTER (WHERE board_status = 'Occupied')::int AS occupied_beds,
            COUNT(*) FILTER (WHERE board_status = 'Available')::int AS available_beds,
            COUNT(*) FILTER (WHERE board_status = 'Reserved')::int AS reserved_beds,
            COUNT(*) FILTER (WHERE board_status = 'Sanitizing')::int AS sanitizing_beds,
            COUNT(*) FILTER (WHERE board_status = 'Out-Of-Service')::int AS oos_beds,
            COUNT(*) FILTER (WHERE ward_type IN ('ICU', 'CCU'))::int AS total_icu_beds,
            COUNT(*) FILTER (WHERE ward_type IN ('ICU', 'CCU') AND board_status = 'Available')::int AS available_icu_beds,
            COUNT(*) FILTER (WHERE ward_type IN ('ICU', 'CCU') AND board_status = 'Occupied')::int AS occupied_icu_beds,
            COUNT(*) FILTER (WHERE has_ventilator)::int AS total_ventilators,
            COUNT(*) FILTER (WHERE has_ventilator AND board_status = 'Occupied')::int AS in_use_ventilators,
            COUNT(*) FILTER (WHERE has_ventilator AND board_status = 'Available')::int AS available_ventilators
          FROM v_bed_board
        `)
      ).rows[0];

      // Counts of admissions respect row-level security: restricted records a viewer cannot see are not counted.
      const triage = clinical
        ? (
            await db.query(`
              SELECT
                COUNT(*)::int AS active,
                COUNT(*) FILTER (WHERE triage_priority = 1)::int AS esi_1,
                COUNT(*) FILTER (WHERE triage_priority = 2)::int AS esi_2,
                COUNT(*) FILTER (WHERE triage_priority = 3)::int AS esi_3,
                COUNT(*) FILTER (WHERE triage_priority >= 4)::int AS esi_45
              FROM admissions WHERE discharge_time IS NULL AND admission_status = 'Admitted'
            `)
          ).rows[0]
        : (
            await db.query(
              `SELECT COUNT(*)::int AS active, NULL::int AS esi_1, NULL::int AS esi_2, NULL::int AS esi_3, NULL::int AS esi_45
               FROM admissions WHERE discharge_time IS NULL AND admission_status = 'Admitted'`
            )
          ).rows[0];

      const incoming = await db.tryQuery(
        `SELECT COUNT(*)::int AS n, MIN(expected_arrival_at) AS next_eta FROM ambulance_prealerts WHERE status = 'Incoming'`
      );
      const hidden = (await db.query(`SELECT fn_hidden_active_admissions() AS n`)).rows[0].n;
      return { bed, triage, incoming: incoming?.rows[0] ?? null, hidden };
    });

    const { bed, triage, incoming, hidden } = stats;
    const occupancyRate = bed.total_beds > 0 ? Math.round((bed.occupied_beds / bed.total_beds) * 100) : 0;

    return NextResponse.json({
      success: true,
      stats: {
        totalBeds: bed.total_beds,
        occupiedBeds: bed.occupied_beds,
        availableBeds: bed.available_beds,
        reservedBeds: bed.reserved_beds,
        sanitizingBeds: bed.sanitizing_beds,
        oosBeds: bed.oos_beds,
        occupancyRate,
        availableIcuBeds: bed.available_icu_beds,
        totalIcuBeds: bed.total_icu_beds,
        occupiedIcuBeds: bed.occupied_icu_beds,
        criticalTriageCount: triage.active,
        esi1Resus: triage.esi_1,
        esi2Emergent: triage.esi_2,
        esi3Urgent: triage.esi_3,
        esiStable: triage.esi_45,
        activeInpatients: triage.active,
        totalVentilators: bed.total_ventilators,
        inUseVentilators: bed.in_use_ventilators,
        availableVentilators: bed.available_ventilators,
        incomingAmbulances: incoming ? incoming.n : null,
        nextAmbulanceEta: incoming ? incoming.next_eta : null,
        protectedInpatients: hidden,
        clinicalView: clinical,
      },
    });
  } catch (error: any) {
    return dbError(error, 'Failed to fetch clinical metrics', auth);
  }
}
