'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Gauge,
  Lock,
  Receipt,
  Siren,
  Sparkles,
  Stethoscope,
  Wind,
  Wrench,
} from 'lucide-react';
import TriageBadge, { triage } from './TriageBadge';
import TiltCard from './fx/TiltCard';
import EcgLine from './fx/EcgLine';

export interface BedData {
  bed_id: number;
  dept_id: number;
  room_number: string;
  bed_label: string;
  ward_type: string;
  has_ventilator: boolean;
  has_oxygen_port: boolean;
  daily_tariff: number | string;
  operational_status: 'Available' | 'Occupied' | 'Sanitizing' | 'Out-Of-Service' | 'Reserved';
  dept_code: string;
  dept_name: string;
  floor_number: number;
  admission_id?: number | null;
  triage_priority?: number | null;
  admission_time?: string | null;
  admission_diagnosis?: string | null;
  patient_id?: number | null;
  national_health_id?: string | null;
  patient_name?: string | null;
  patient_gender?: string | null;
  patient_blood_group?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  doctor_specialization?: string | null;
  // ambulance hold (status 'Reserved')
  hold_id?: number | null;
  hold_alert_code?: string | null;
  hold_ambulance?: string | null;
  hold_until?: string | null;
  hold_eta?: string | null;
  hold_esi?: number | null;
  hold_complaint?: string | null;
  hold_origin?: string | null;
  // privacy (row-level security)
  patient_privacy?: 'standard' | 'restricted' | null;
  restriction_reason?: string | null;
  is_protected?: boolean;
  // predicted discharge from real length-of-stay data
  condition_name?: string | null;
  expected_los_days?: number | string | null;
  expected_discharge_at?: string | null;
  late_discharge_at?: string | null;
  benchmark_cases?: number | null;
}

interface BedCardProps {
  bed: BedData;
  onStatusChange?: (bedId: number, newStatus: string) => void;
  highlight?: boolean;
}

export const STATUS_RGB: Record<string, string> = {
  Available: '52,211,153',
  Occupied: '251,113,133',
  Sanitizing: '251,191,36',
  Reserved: '56,189,248',
  'Out-Of-Service': '148,163,184',
};

/** "in 2h 10m" / "3 min ago" relative to now. */
export function relTime(iso?: string | null, now = Date.now()) {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - now;
  const m = Math.round(Math.abs(diff) / 60000);
  const txt = m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
  return diff >= 0 ? `in ${txt}` : `${txt} ago`;
}

/** Live countdown text for an ambulance ETA. */
function useCountdown(iso?: string | null) {
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => {
    if (!iso) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [iso]);
  if (!iso) return null;
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const a = Math.abs(s);
  return { overdue: s < 0, text: `${s < 0 ? '+' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}` };
}

const stayTime = (timeStr?: string | null) => {
  if (!timeStr) return '';
  const hours = Math.floor((Date.now() - new Date(timeStr).getTime()) / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
};

const initials = (name?: string | null) =>
  (name || '?')
    .replace(/^(Master|Baby|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export default function BedCard({ bed, onStatusChange, highlight }: BedCardProps) {
  const [updating, setUpdating] = useState(false);
  const rgb = STATUS_RGB[bed.operational_status] ?? '148,163,184';
  const occupied = bed.operational_status === 'Occupied';
  const critical = occupied && bed.triage_priority === 1;
  const t = triage(bed.triage_priority);
  const reserved = bed.operational_status === 'Reserved';
  const eta = useCountdown(reserved ? bed.hold_eta : null);
  const restricted = bed.patient_privacy === 'restricted';

  const restore = async () => {
    if (!onStatusChange) return;
    setUpdating(true);
    try {
      await onStatusChange(bed.bed_id, 'Available');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <TiltCard className="h-full">
      <div
        id={`bed-${bed.bed_id}`}
        className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-ink-900/95 transition-shadow duration-300 ${
          highlight ? 'ring-2 ring-pulse-300 ring-offset-2 ring-offset-ink-950' : ''
        }`}
        style={{
          borderColor: critical ? `rgba(${rgb},0.55)` : 'rgba(231,236,245,0.09)',
          boxShadow: critical
            ? `0 0 0 1px rgba(${rgb},0.25), 0 20px 60px -20px rgba(255,59,92,0.7)`
            : '0 1px 0 rgba(255,255,255,0.04) inset, 0 18px 40px -28px rgba(0,0,0,0.9)',
        }}
      >
        {/* status beam on top edge */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, rgb(${rgb}), transparent)` }}
        />
        <div
          aria-hidden
          className="absolute -right-12 -top-12 h-36 w-36 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: `rgba(${rgb},0.12)` }}
        />
        {bed.operational_status === 'Sanitizing' && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-scan">
            <div className="h-full w-full bg-gradient-to-b from-transparent via-amber-300/10 to-transparent" />
            <div className="h-px w-full bg-amber-300/70" />
          </div>
        )}
        {bed.operational_status === 'Out-Of-Service' && <div aria-hidden className="hazard absolute inset-0" />}
        {reserved && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-sky-400/50"
            animate={{ opacity: [0.15, 0.8, 0.15] }}
            transition={{ duration: 1.1, repeat: Infinity }}
          />
        )}

        <div className="relative flex-1 p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-lg font-bold tracking-tight text-fg [font-stretch:100%]">{bed.room_number}</span>
                <span className="flex-shrink-0 whitespace-nowrap rounded-md border border-tint/[0.14] bg-tint/5 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-fg2">
                  {bed.bed_label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-fg3">
                {bed.dept_name} · F{bed.floor_number}
              </p>
            </div>
            <span
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold"
              style={{ color: `rgb(${rgb})`, borderColor: `rgba(${rgb},0.35)`, background: `rgba(${rgb},0.1)` }}
            >
              <span className="relative flex h-1.5 w-1.5">
                {bed.operational_status !== 'Out-Of-Service' && (
                  <span className="absolute inline-flex h-full w-full animate-ping2 rounded-full" style={{ background: `rgb(${rgb})` }} />
                )}
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: `rgb(${rgb})` }} />
              </span>
              {bed.operational_status}
            </span>
          </div>

          {/* Equipment */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="chip border-tint/[0.14] bg-tint/[0.04] text-fg2">{bed.ward_type}</span>
            {bed.has_ventilator && (
              <span className="chip border-plasma-400/30 bg-plasma-500/10 text-plasma-400">
                <Wind className="h-3 w-3" /> Vent
              </span>
            )}
            {bed.has_oxygen_port && (
              <span className="chip border-sky-400/30 bg-sky-400/10 text-sky-300">
                <Gauge className="h-3 w-3" /> O₂
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-fg2">
              ₹{Number(bed.daily_tariff).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              <span className="text-fg3">/d</span>
            </span>
          </div>

          {/* Body */}
          <div className="mt-4 border-t border-tint/[0.11] pt-3.5">
            {occupied && bed.is_protected && (
              <div className="flex items-center gap-3 py-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-plasma-400/40 bg-plasma-500/10">
                  <Lock className="h-4 w-4 text-plasma-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">Protected record</p>
                  <p className="text-[11px] leading-snug text-fg3">
                    PostgreSQL row-level security hides this patient from your role. Use break-glass if a life is at risk.
                  </p>
                </div>
              </div>
            )}

            {occupied && !bed.is_protected && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold text-[#060812]"
                    style={{
                      background: `linear-gradient(135deg, rgb(${t.rgb}), rgb(148,116,255))`,
                      boxShadow: `0 0 20px -4px rgba(${t.rgb},0.8)`,
                    }}
                  >
                    {initials(bed.patient_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-fg">{bed.patient_name || 'Inpatient'}</span>
                      {restricted && (
                        <span
                          title={bed.restriction_reason || 'Restricted record'}
                          className="inline-flex items-center gap-0.5 rounded border border-plasma-400/40 bg-plasma-500/10 px-1 font-mono text-[9.5px] font-bold text-plasma-400"
                        >
                          <Lock className="h-2.5 w-2.5" /> RLS
                        </span>
                      )}
                      {bed.patient_blood_group && (
                        <span className="rounded border border-rose-400/30 bg-rose-500/10 px-1 font-mono text-[9.5px] font-bold text-rose-300">
                          {bed.patient_blood_group}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-[10.5px] text-fg3">{bed.national_health_id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {bed.triage_priority ? <TriageBadge priority={bed.triage_priority} size="sm" /> : null}
                  <div className="ecg-paper relative h-7 flex-1 overflow-hidden rounded-md border border-rose-400/25">
                    <EcgLine bpm={t.bpm} color={t.hex} className="absolute inset-0 h-full w-full" strokeWidth={1.6} />
                  </div>
                  <span className="font-mono text-[10px] tabular-nums" style={{ color: t.hex }}>
                    {t.bpm}
                    <span className="text-fg3">bpm</span>
                  </span>
                </div>

                {bed.doctor_name && (
                  <div className="flex items-center gap-1.5 text-xs text-fg2">
                    <Stethoscope className="h-3.5 w-3.5 flex-shrink-0 text-fg3" />
                    <span className="truncate">{bed.doctor_name}</span>
                  </div>
                )}
                {bed.admission_diagnosis && (
                  <p className="line-clamp-2 rounded-lg border border-tint/[0.1] bg-tint/[0.02] p-2 text-[11.5px] italic text-fg2">
                    “{bed.admission_diagnosis}”
                  </p>
                )}
                {bed.admission_time && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-fg3">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> LOS {stayTime(bed.admission_time)}
                    </span>
                    {bed.expected_discharge_at && (
                      <span
                        className="text-pulse-300/90"
                        title={`Median stay for ${bed.condition_name} across ${bed.benchmark_cases} real hospital stays (NY SPARCS 2021)`}
                      >
                        {new Date(bed.expected_discharge_at).getTime() > Date.now()
                          ? `likely free ${relTime(bed.expected_discharge_at)}`
                          : `past typical stay (${Number(bed.expected_los_days)}d median)`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {reserved && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-11 w-11 items-center justify-center">
                    <span className="absolute inset-0 animate-ping2 rounded-full bg-sky-400/20" />
                    <span className="absolute inset-0 rounded-full border border-sky-400/50" />
                    <Siren className="h-5 w-5 text-sky-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-sky-100">Held for ambulance {bed.hold_alert_code}</p>
                    <p className="truncate font-mono text-[10.5px] text-fg3">
                      {bed.hold_ambulance} · from {bed.hold_origin}
                    </p>
                  </div>
                  {eta && (
                    <div className="text-right">
                      <div className={`font-mono text-base font-bold tabular-nums ${eta.overdue ? 'text-rose-300' : 'text-sky-200'}`}>
                        {eta.text}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-wider text-fg3">{eta.overdue ? 'overdue' : 'ETA'}</div>
                    </div>
                  )}
                </div>
                {(bed.hold_esi || bed.hold_complaint) && (
                  <div className="flex items-center gap-2">
                    {bed.hold_esi ? <TriageBadge priority={bed.hold_esi} size="sm" /> : null}
                    {bed.hold_complaint && <span className="truncate text-[11.5px] italic text-fg2">“{bed.hold_complaint}”</span>}
                  </div>
                )}
                <p className="font-mono text-[10px] text-fg3">
                  hold ends {relTime(bed.hold_until)} · tsrange expires by itself
                </p>
              </div>
            )}

            {bed.operational_status === 'Available' && (
              <div className="flex items-center gap-3 py-2">
                <div className="relative flex h-11 w-11 items-center justify-center">
                  <span className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-emerald-400/50" />
                  <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-200">Sanitized & ready</p>
                  <p className="text-[11px] text-fg3">Cleared for emergency intake</p>
                </div>
              </div>
            )}

            {bed.operational_status === 'Sanitizing' && (
              <div className="flex items-center gap-3 py-2">
                <div className="relative flex h-11 w-11 items-center justify-center">
                  <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(251,191,36,0.15)" strokeWidth="3" />
                    <motion.circle
                      cx="22"
                      cy="22"
                      r="19"
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="3"
                      strokeLinecap="round"
                      animate={{ pathLength: [0.05, 0.95, 0.05] }}
                      transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </svg>
                  <Sparkles className="h-4 w-4 text-amber-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-200">UV sterilization cycle</p>
                  <p className="text-[11px] text-fg3">Infection-control hold</p>
                </div>
              </div>
            )}

            {bed.operational_status === 'Out-Of-Service' && (
              <div className="flex items-center gap-3 py-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-500/40">
                  <Wrench className="h-4 w-4 text-fg2" />
                </div>
                <p className="text-sm font-semibold text-fg2">Engineering maintenance</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="relative border-t border-tint/[0.11] bg-sunk/60 p-3">
          {bed.operational_status === 'Available' && (
            <Link
              href={`/admissions?bed_id=${bed.bed_id}`}
              className="group/btn flex w-full items-center justify-center gap-2 rounded-xl border border-pulse-400/40 bg-pulse-400/10 px-3.5 py-2 text-xs font-semibold text-pulse-200 hover:bg-pulse-400/20 transition"
            >
              Admit patient here
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover/btn:-translate-y-0.5 group-hover/btn:translate-x-0.5" />
            </Link>
          )}
          {reserved && (
            <Link
              href="/ambulance"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/20"
            >
              <Siren className="h-3.5 w-3.5" />
              Open Golden Hour desk
            </Link>
          )}
          {occupied && bed.is_protected && (
            <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-plasma-400/25 bg-plasma-500/[0.07] px-3 py-2 text-xs font-semibold text-plasma-400">
              <Lock className="h-3.5 w-3.5" /> Restricted to the care team
            </div>
          )}
          {occupied && !bed.is_protected && (
            <Link
              href={`/billing?admission_id=${bed.admission_id}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20"
            >
              <Receipt className="h-3.5 w-3.5" />
              Discharge & bill
            </Link>
          )}
          {bed.operational_status === 'Sanitizing' && (
            <button
              onClick={restore}
              disabled={updating}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {updating ? 'Updating…' : 'Mark cleaned & available'}
            </button>
          )}
          {bed.operational_status === 'Out-Of-Service' && (
            <button
              onClick={restore}
              disabled={updating}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-tint/20 bg-tint/5 px-3.5 py-2 text-xs font-semibold text-fg transition hover:bg-tint/10 disabled:opacity-50"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {updating ? 'Updating…' : 'Restore to available'}
            </button>
          )}
        </div>
      </div>
    </TiltCard>
  );
}
