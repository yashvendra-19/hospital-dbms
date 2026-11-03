'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Ambulance,
  BedDouble,
  CheckCircle2,
  Clock,
  HeartPulse,
  Hospital,
  MapPin,
  Navigation,
  Phone,
  Radio,
  RefreshCw,
  Search,
  Siren,
  UserPlus,
  Wind,
  XCircle,
} from 'lucide-react';
import PageHeader, { GhostButton } from '@/components/PageHeader';
import TriageBadge from '@/components/TriageBadge';
import DbLock from '@/components/DbLock';
import RadarMap, { RadarHospital } from '@/components/RadarMap';
import Modal from '@/components/fx/Modal';
import QuickPatientModal from '@/components/QuickPatientModal';
import { useToast } from '@/components/ToastContext';
import { useLive } from '@/components/LiveContext';
import { relTime } from '@/components/BedCard';

interface Alert {
  alert_id: number;
  alert_code: string;
  ambulance_reg: string;
  service_type: string;
  crew_phone: string;
  origin_label: string;
  origin_pincode: string | null;
  origin_lat: string;
  origin_lon: string;
  distance_km: string | null;
  patient_age: number | null;
  patient_gender: string;
  chief_complaint: string;
  condition_id: number | null;
  condition_name: string | null;
  esi_level: number;
  heart_rate: number | null;
  spo2: number | null;
  systolic_bp: number | null;
  gcs: number | null;
  needs_ventilator: boolean;
  eta_minutes: number;
  status: 'Incoming' | 'Arrived' | 'Diverted' | 'Cancelled' | 'Expired';
  created_at: string;
  expected_arrival_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  hold_id: number | null;
  hold_status: string | null;
  hold_until: string | null;
  hold_room: string | null;
  hold_bed_label: string | null;
  hold_ward_type: string | null;
  hold_dept: string | null;
  diverted_to_name: string | null;
  admission_id: number | null;
}

const SCENARIOS = [
  {
    key: 'crash',
    label: 'Highway crash · NH48 Walajapet',
    form: {
      ambulance_reg: 'TN-23-G-1080', service_type: '108', crew_phone: '9443012345', origin_pincode: '632513',
      patient_age: '27', patient_gender: 'M', chief_complaint: 'Two-wheeler crash, abdominal guarding, BP falling',
      condition_id: '3', esi_level: 1, heart_rate: '132', spo2: '91', systolic_bp: '84', gcs: '13', needs_ventilator: true,
    },
  },
  {
    key: 'mi',
    label: 'Chest pain · Katpadi',
    form: {
      ambulance_reg: 'TN-23-AB-4421', service_type: '108', crew_phone: '9443098765', origin_pincode: '632007',
      patient_age: '58', patient_gender: 'M', chief_complaint: 'Crushing chest pain 40 min, sweating, ST elevation on ECG',
      condition_id: '14', esi_level: 2, heart_rate: '112', spo2: '94', systolic_bp: '102', gcs: '15', needs_ventilator: false,
    },
  },
  {
    key: 'stroke',
    label: 'Sudden weakness · Arcot',
    form: {
      ambulance_reg: 'TN-73-C-1081', service_type: '108', crew_phone: '9443055501', origin_pincode: '632503',
      patient_age: '66', patient_gender: 'F', chief_complaint: 'Right-sided weakness and slurred speech since 6:40',
      condition_id: '20', esi_level: 2, heart_rate: '88', spo2: '96', systolic_bp: '178', gcs: '13', needs_ventilator: false,
    },
  },
  {
    key: 'child',
    label: 'Child wheeze · Gudiyatham',
    form: {
      ambulance_reg: 'TN-23-P-2208', service_type: 'Private', crew_phone: '9787012233', origin_pincode: '632602',
      patient_age: '6', patient_gender: 'F', chief_complaint: 'Severe wheeze, unable to speak full sentences',
      condition_id: '25', esi_level: 3, heart_rate: '138', spo2: '92', systolic_bp: '', gcs: '15', needs_ventilator: false,
    },
  },
];

const EMPTY_FORM = {
  ambulance_reg: 'TN-23-G-1080', service_type: '108', crew_phone: '', origin_pincode: '', patient_age: '', patient_gender: 'U',
  chief_complaint: '', condition_id: '', esi_level: 2, heart_rate: '', spo2: '', systolic_bp: '', gcs: '', needs_ventilator: false,
  eta_minutes: '',
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return now;
}

export default function GoldenHourPage() {
  const { toast } = useToast();
  const { tick } = useLive();
  const now = useNow();
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<any>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [nearby, setNearby] = useState<RadarHospital[]>([]);
  const [conditions, setConditions] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [pinQuery, setPinQuery] = useState('');
  const [pinHits, setPinHits] = useState<any[]>([]);
  const [pinLabel, setPinLabel] = useState('');
  const [divertFor, setDivertFor] = useState<Alert | null>(null);
  const [arriveFor, setArriveFor] = useState<Alert | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, cRes] = await Promise.all([fetch('/api/ambulance', { cache: 'no-store' }), fetch('/api/estimates/conditions')]);
      const a = await aRes.json();
      if (aRes.status === 403) {
        setDenied(a);
        return;
      }
      if (a.success) {
        setAlerts(a.alerts);
        setProfile(a.profile);
        setNearby(a.nearby);
      }
      const c = await cRes.json();
      if (c.success) setConditions(c.conditions);
    } catch {
      toast({ type: 'error', title: 'Connection error', message: 'Could not reach hospital_db.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (tick > 0) load();
  }, [tick, load]);

  // pincode lookup against the India Post table
  useEffect(() => {
    const q = pinQuery.trim();
    if (q.length < 2) {
      setPinHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/pincodes?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.success) setPinHits(d.pincodes);
    }, 200);
    return () => clearTimeout(t);
  }, [pinQuery]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f: any) => ({ ...f, [k]: e.target.value }));

  const applyScenario = (s: (typeof SCENARIOS)[number]) => {
    setForm({ ...EMPTY_FORM, ...s.form });
    setPinQuery(s.form.origin_pincode);
    setPinLabel('');
    setPinHits([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.origin_pincode) {
      toast({ type: 'warning', title: 'Crew position needed', message: 'Pick the pincode the ambulance is calling from.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/ambulance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'The pre-alert was not recorded');
      setLastResult(data);
      if (data.hold) {
        toast({
          type: 'success',
          title: `${data.alert.alert_code}: bed held`,
          message: `${data.hold.room_number} ${data.hold.bed_label} (${data.hold.ward_type}) is held until ${new Date(data.hold.hold_until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`,
        });
      } else {
        toast({ type: 'warning', title: `${data.alert.alert_code}: no suitable bed`, message: 'Diversion options are ready below.' });
      }
      load();
    } catch (err: any) {
      toast({ type: 'error', title: 'Pre-alert refused', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (alert: Alert, body: any, ok: string) => {
    const res = await fetch(`/api/ambulance/${alert.alert_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast({ type: 'error', title: 'Action refused', message: data.error });
      return null;
    }
    toast({ type: 'success', title: ok });
    load();
    return data;
  };

  const incoming = alerts.filter((a) => a.status === 'Incoming');
  const resolved = alerts.filter((a) => a.status !== 'Incoming').slice(0, 8);
  const radarAmbulances = useMemo(
    () =>
      incoming.map((a) => ({
        id: a.alert_id,
        code: a.alert_code,
        lat: Number(a.origin_lat),
        lon: Number(a.origin_lon),
        esi: a.esi_level,
        label: a.origin_label,
        minutes: Math.max(0, Math.round((new Date(a.expected_arrival_at).getTime() - now) / 60000)),
      })),
    [incoming, now]
  );

  if (denied) {
    return (
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <PageHeader eyebrow="Golden hour · ambulance pre-alerts" title="Golden Hour Desk" />
        <DbLock what="Ambulance pre-alerts" error={denied.error} role={denied.role} dbRole={denied.dbRole} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <PageHeader
        eyebrow="Golden hour · ambulance pre-alerts"
        title="The bed is ready before the ambulance is."
        accent={['ready']}
        subtitle="A 108 crew calls ahead. PostgreSQL picks the best free bed and holds it for exactly the ETA window: a tsrange that expires by itself, protected by an exclusion constraint so two ambulances can never be promised the same bed. If nothing fits, the nearest emergency-capable hospitals come from the Government of India's National Hospital Directory."
        actions={
          <GhostButton onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </GhostButton>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Inbound now', value: incoming.length, icon: Ambulance, rgb: '56,189,248' },
          { label: 'Beds on timed hold', value: incoming.filter((a) => a.hold_status === 'Active').length, icon: BedDouble, rgb: '46,230,245' },
          { label: 'Waiting for a bed', value: incoming.filter((a) => a.hold_status !== 'Active').length, icon: Siren, rgb: '251,113,133' },
          { label: 'Real ER hospitals ≤ 45 km', value: nearby.length, icon: Hospital, rgb: '52,211,153' },
        ].map((k) => (
          <div key={k.label} className="glass flex items-center gap-3 rounded-2xl p-4">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border"
              style={{ borderColor: `rgba(${k.rgb},0.35)`, background: `rgba(${k.rgb},0.1)`, color: `rgb(${k.rgb})` }}
            >
              <k.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-2xl font-bold tabular-nums text-fg">{loading ? '–' : k.value}</div>
              <div className="text-[11px] text-fg3">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* INTAKE */}
        <section className="glass rounded-3xl p-5 sm:p-6 lg:col-span-5">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-sky-300" />
            <h2 className="font-display text-lg font-bold text-fg">108 call intake</h2>
          </div>
          <p className="mt-1 text-xs text-fg3">Pick a scenario or type what the crew reports. Position comes from the India Post pincode table.</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => applyScenario(s)}
                className="rounded-full border border-sky-400/30 bg-sky-500/[0.08] px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-500/20"
              >
                {s.label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Ambulance</label>
                <input className="field font-mono uppercase" value={form.ambulance_reg} onChange={set('ambulance_reg')} placeholder="TN-23-G-1080" required />
              </div>
              <div>
                <label className="label">Crew phone</label>
                <input className="field font-mono" value={form.crew_phone} onChange={set('crew_phone')} placeholder="10 digits" required />
              </div>
            </div>

            <div className="relative">
              <label className="label">Crew position (pincode or place)</label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3" />
                <input
                  className="field pl-9"
                  value={pinQuery}
                  onChange={(e) => {
                    setPinQuery(e.target.value);
                    setForm((f: any) => ({ ...f, origin_pincode: /^\d{6}$/.test(e.target.value.trim()) ? e.target.value.trim() : '' }));
                    setPinLabel('');
                  }}
                  placeholder="e.g. 632513 or Ranipet"
                />
              </div>
              {pinLabel && <p className="mt-1 font-mono text-[10.5px] text-emerald-300">{pinLabel}</p>}
              <AnimatePresence>
                {pinHits.length > 0 && !pinLabel && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-tint/[0.14] bg-ink-900/95 p-1 shadow-2xl backdrop-blur"
                  >
                    {pinHits.map((p) => (
                      <li key={p.pincode}>
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f: any) => ({ ...f, origin_pincode: p.pincode }));
                            setPinQuery(p.pincode);
                            setPinLabel(`${p.locality}, ${p.district} · ${Number(p.distance_km).toFixed(1)} km from us`);
                            setPinHits([]);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-tint/[0.06]"
                        >
                          <span className="text-fg">
                            <span className="font-mono text-pulse-300">{p.pincode}</span> {p.locality}, {p.district}
                          </span>
                          <span className="font-mono text-[10px] text-fg3">{Number(p.distance_km).toFixed(0)} km</span>
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Age</label>
                <input className="field" type="number" min={0} max={120} value={form.patient_age} onChange={set('patient_age')} />
              </div>
              <div className="col-span-2">
                <label className="label">Sex</label>
                <select className="field" value={form.patient_gender} onChange={set('patient_gender')}>
                  <option value="U">Not known yet</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Chief complaint</label>
              <textarea className="field resize-none" rows={2} value={form.chief_complaint} onChange={set('chief_complaint')} required />
            </div>

            <div>
              <label className="label">Likely condition (sets ward and department)</label>
              <select className="field" value={form.condition_id} onChange={set('condition_id')}>
                <option value="">Not sure yet</option>
                {conditions.map((c) => (
                  <option key={c.condition_id} value={c.condition_id}>
                    {c.dept_code} · {c.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Triage (ESI)</label>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm((f: any) => ({ ...f, esi_level: n }))}
                    className={`rounded-xl border py-2 font-display text-sm font-bold transition ${
                      form.esi_level === n ? 'border-pulse-300 bg-pulse-400/15 text-fg' : 'border-tint/[0.12] bg-tint/[0.03] text-fg2 hover:text-fg'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[
                ['heart_rate', 'HR'],
                ['spo2', 'SpO₂'],
                ['systolic_bp', 'SBP'],
                ['gcs', 'GCS'],
              ].map(([k, l]) => (
                <div key={k}>
                  <label className="label">{l}</label>
                  <input className="field !px-2.5 font-mono" type="number" value={form[k]} onChange={set(k)} />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-fg2">
                <input
                  type="checkbox"
                  checked={form.needs_ventilator}
                  onChange={(e) => setForm((f: any) => ({ ...f, needs_ventilator: e.target.checked }))}
                  className="h-4 w-4 accent-cyan-400"
                />
                <Wind className="h-3.5 w-3.5 text-plasma-400" /> Needs a ventilator
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-fg3">ETA</span>
                <input
                  className="field !w-20 !py-1.5 font-mono text-xs"
                  type="number"
                  min={1}
                  max={240}
                  placeholder="auto"
                  value={form.eta_minutes}
                  onChange={set('eta_minutes')}
                />
                <span className="text-[11px] text-fg3">min</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-[#04121a] transition hover:bg-sky-300 disabled:opacity-60"
            >
              <Siren className="h-4 w-4" />
              {submitting ? 'Finding a bed in PostgreSQL…' : 'Record pre-alert & hold a bed'}
            </button>
          </form>

          <AnimatePresence>
            {lastResult && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
                {lastResult.hold ? (
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.08] p-4 text-xs text-fg2">
                    <div className="flex items-center gap-2 font-semibold text-emerald-200">
                      <CheckCircle2 className="h-4 w-4" /> {lastResult.alert.alert_code} · {lastResult.hold.room_number}{' '}
                      {lastResult.hold.bed_label} held ({lastResult.hold.match_quality} match)
                    </div>
                    <p className="mt-1.5 font-mono text-[11px]">
                      fn_reserve_bed_for_alert({lastResult.alert.alert_id}) → hold #{lastResult.hold.hold_id}, window ends{' '}
                      {relTime(lastResult.hold.hold_until, now)} · {lastResult.alert.distance_km} km, ETA {lastResult.alert.eta_minutes} min
                    </p>
                  </div>
                ) : (
                  <DiversionList alert={lastResult.alert} diversion={lastResult.diversion} onHover={setHighlight} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* LIVE BOARD */}
        <section className="space-y-6 lg:col-span-7">
          <div className="glass overflow-hidden rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-pulse-300" />
                <h2 className="font-display text-lg font-bold text-fg">Radar · {profile?.city || 'Vellore'}</h2>
              </div>
              <span className="font-mono text-[10px] text-fg3">green = real ER-capable hospitals (National Hospital Directory)</span>
            </div>
            <div className="mx-auto mt-2 max-w-[440px]">
              {profile && (
                <RadarMap
                  center={{ lat: Number(profile.latitude), lon: Number(profile.longitude), name: 'MediResource' }}
                  hospitals={nearby}
                  ambulances={radarAmbulances}
                  highlight={highlight}
                />
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-fg">Inbound</h2>
              <span className="font-mono text-[10.5px] text-fg3">updates arrive by LISTEN/NOTIFY, no refresh needed</span>
            </div>
            {loading ? (
              <div className="h-32 animate-pulse rounded-2xl border border-tint/[0.1] bg-tint/[0.02]" />
            ) : incoming.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-tint/[0.14] p-10 text-center">
                <Ambulance className="mx-auto h-10 w-10 text-fg3" />
                <p className="mt-2 text-sm font-semibold text-fg">No ambulances inbound</p>
                <p className="text-xs text-fg3">Use a scenario on the left to simulate a 108 call.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {incoming.map((a) => (
                    <AlertCard
                      key={a.alert_id}
                      a={a}
                      now={now}
                      onArrive={() => setArriveFor(a)}
                      onDivert={() => setDivertFor(a)}
                      onRetry={() => act(a, { action: 'reserve' }, `${a.alert_code}: trying again`)}
                      onCancel={() => act(a, { action: 'cancel', note: 'Cancelled by the crew' }, `${a.alert_code} cancelled`)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {resolved.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">Last 24 hours</h3>
              <ul className="divide-y divide-tint/[0.08] text-xs">
                {resolved.map((a) => (
                  <li key={a.alert_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-fg">
                      <span className="font-mono text-fg2">{a.alert_code}</span> · {a.chief_complaint}
                    </span>
                    <span
                      className={`chip ${
                        a.status === 'Arrived'
                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                          : a.status === 'Diverted'
                            ? 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                            : 'border-tint/[0.14] bg-tint/[0.04] text-fg2'
                      }`}
                    >
                      {a.status}
                      {a.status === 'Arrived' && a.hold_room ? ` → ${a.hold_room} ${a.hold_bed_label}` : ''}
                      {a.status === 'Diverted' && a.diverted_to_name ? ` → ${a.diverted_to_name}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <DivertModal
        alert={divertFor}
        onClose={() => setDivertFor(null)}
        onDivert={async (nhpId, note) => {
          if (!divertFor) return;
          const ok = await act(divertFor, { action: 'divert', nhp_id: nhpId, note }, `${divertFor.alert_code} diverted`);
          if (ok) setDivertFor(null);
        }}
      />
      <ArriveModal
        alert={arriveFor}
        onClose={() => setArriveFor(null)}
        onArrive={async (patientId, doctorId, diagnosis) => {
          if (!arriveFor) return;
          const ok = await act(
            arriveFor,
            { action: 'arrive', patient_id: patientId, doctor_id: doctorId, diagnosis },
            `${arriveFor.alert_code} arrived · admitted to ${arriveFor.hold_room} ${arriveFor.hold_bed_label}`
          );
          if (ok) setArriveFor(null);
        }}
      />
    </div>
  );
}

function AlertCard({
  a,
  now,
  onArrive,
  onDivert,
  onRetry,
  onCancel,
}: {
  a: Alert;
  now: number;
  onArrive: () => void;
  onDivert: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const secs = Math.round((new Date(a.expected_arrival_at).getTime() - now) / 1000);
  const total = a.eta_minutes * 60;
  const progress = Math.min(1, Math.max(0, 1 - secs / total));
  const held = a.hold_status === 'Active';
  const abs = Math.abs(secs);
  const clock = `${secs < 0 ? '+' : ''}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const r = 26;
  const circ = 2 * Math.PI * r;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 30, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -30, scale: 0.97 }}
      className="relative overflow-hidden rounded-2xl border border-sky-400/25 bg-ink-900/95 p-4"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300 to-transparent" />
      <div className="flex gap-4">
        <div className="relative h-16 w-16 flex-shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
            <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth="5" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke={secs < 0 ? '#fb7185' : '#38bdf8'}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - progress)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`font-mono text-[12px] font-bold tabular-nums ${secs < 0 ? 'text-rose-300' : 'text-sky-100'}`}>{clock}</span>
            <span className="font-mono text-[8px] uppercase text-fg3">{secs < 0 ? 'late' : 'eta'}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-bold text-fg">{a.alert_code}</span>
            <TriageBadge priority={a.esi_level} size="sm" />
            <span className="chip border-tint/[0.14] bg-tint/[0.04] font-mono text-fg2">{a.ambulance_reg}</span>
            <span className="chip border-tint/[0.14] bg-tint/[0.04] text-fg3">{a.service_type}</span>
          </div>
          <p className="mt-1 text-sm text-fg">{a.chief_complaint}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10.5px] text-fg3">
            <span>
              <MapPin className="mr-0.5 inline h-3 w-3" />
              {a.origin_label} · {a.distance_km} km
            </span>
            {a.patient_age !== null && (
              <span>
                {a.patient_age}y {a.patient_gender}
              </span>
            )}
            {a.condition_name && <span className="text-pulse-300/80">{a.condition_name}</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.heart_rate && <Vital icon={HeartPulse} label="HR" v={a.heart_rate} bad={a.heart_rate > 120 || a.heart_rate < 50} />}
            {a.spo2 && <Vital icon={Activity} label="SpO₂" v={`${a.spo2}%`} bad={a.spo2 < 92} />}
            {a.systolic_bp && <Vital icon={Activity} label="SBP" v={a.systolic_bp} bad={a.systolic_bp < 90 || a.systolic_bp > 180} />}
            {a.gcs && <Vital icon={Activity} label="GCS" v={a.gcs} bad={a.gcs < 14} />}
            {a.needs_ventilator && <span className="chip border-plasma-400/30 bg-plasma-500/10 text-plasma-400"><Wind className="h-3 w-3" /> ventilator</span>}
          </div>
        </div>
      </div>

      <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${held ? 'border-emerald-400/25 bg-emerald-500/[0.07]' : 'border-rose-400/30 bg-rose-500/[0.08]'}`}>
        {held ? (
          <span className="flex items-center gap-2 text-emerald-100">
            <BedDouble className="h-4 w-4 text-emerald-300" />
            <b>{a.hold_room} {a.hold_bed_label}</b> · {a.hold_ward_type} · {a.hold_dept}
            <span className="font-mono text-[10.5px] text-fg3">hold ends {relTime(a.hold_until, now)}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-rose-100">
            <Siren className="h-4 w-4 text-rose-300" /> No suitable bed free. Divert, or retry when a bed is cleaned.
          </span>
        )}
        <span className="flex flex-wrap gap-1.5">
          {held ? (
            <button onClick={onArrive} className="rounded-lg bg-emerald-400 px-3 py-1.5 text-[11px] font-bold text-[#04121a] hover:bg-emerald-300">
              Arrived · admit
            </button>
          ) : (
            <button onClick={onRetry} className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/20">
              Retry bed
            </button>
          )}
          <button onClick={onDivert} className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-300/20">
            Divert
          </button>
          <button onClick={onCancel} className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-fg3 hover:bg-tint/[0.06] hover:text-fg" aria-label="Cancel pre-alert">
            <XCircle className="h-4 w-4" />
          </button>
        </span>
      </div>
    </motion.div>
  );
}

function Vital({ icon: Icon, label, v, bad }: { icon: any; label: string; v: any; bad: boolean }) {
  return (
    <span className={`chip font-mono ${bad ? 'border-rose-400/35 bg-rose-500/10 text-rose-200' : 'border-tint/[0.14] bg-tint/[0.04] text-fg2'}`}>
      <Icon className="h-3 w-3" />
      {label} {v}
    </span>
  );
}

function DiversionList({ alert, diversion, onHover, onPick }: { alert: any; diversion: any; onHover?: (id: number | null) => void; onPick?: (h: any) => void }) {
  if (!diversion) return null;
  return (
    <div className="rounded-2xl border border-rose-400/30 bg-rose-500/[0.06] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-rose-100">
        <Siren className="h-4 w-4 text-rose-300" /> {alert?.alert_code}: no suitable bed. Nearest emergency-capable hospitals:
      </div>
      <ul className="mt-2 divide-y divide-tint/[0.08]">
        {diversion.hospitals.map((h: any) => (
          <li
            key={h.nhp_id}
            onMouseEnter={() => onHover?.(h.nhp_id)}
            onMouseLeave={() => onHover?.(null)}
            className="flex items-center justify-between gap-2 py-2 text-xs"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg">{h.hospital_name}</span>
              <span className="font-mono text-[10.5px] text-fg3">
                {h.district} · {Number(h.distance_km).toFixed(1)} km{h.geo_source === 'pincode' ? ' (approx.)' : ''} · NHP #{h.nhp_id}
              </span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-1.5">
              {h.phone ? (
                <a href={`tel:${h.phone}`} className="chip border-emerald-400/30 bg-emerald-500/10 text-emerald-200">
                  <Phone className="h-3 w-3" /> call
                </a>
              ) : (
                <span className="chip border-tint/[0.12] text-fg3">no phone listed</span>
              )}
              {onPick && (
                <button onClick={() => onPick(h)} className="chip border-amber-300/40 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20">
                  divert here
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {diversion.likelyFreeSoon?.length > 0 && (
        <p className="mt-2 border-t border-tint/[0.08] pt-2 text-[11px] text-fg2">
          <Clock className="mr-1 inline h-3 w-3" />
          Likely to free up here (median stay from real data):{' '}
          {diversion.likelyFreeSoon.map((b: any) => `${b.room_number} ${b.bed_label} ${relTime(b.expected_free_at)}`).join(' · ')}
        </p>
      )}
      <p className="mt-2 text-[10.5px] text-fg3">
        The directory has no live bed feed, so call before diverting. That gap is the real-world problem this desk is built around.
      </p>
    </div>
  );
}

function DivertModal({ alert, onClose, onDivert }: { alert: Alert | null; onClose: () => void; onDivert: (nhpId: number | null, note: string) => void }) {
  const [diversion, setDiversion] = useState<any>(null);
  const [picked, setPicked] = useState<any>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!alert) return;
    setDiversion(null);
    setPicked(null);
    setNote('');
    fetch(`/api/ambulance/${alert.alert_id}`)
      .then((r) => r.json())
      .then((d) => d.success && setDiversion(d.diversion));
  }, [alert]);
  return (
    <Modal isOpen={!!alert} onClose={onClose} glow="251,191,36" className="max-w-xl">
      <h3 className="font-display text-lg font-bold text-fg">Divert {alert?.alert_code}</h3>
      <p className="mt-1 text-xs text-fg3">Nearest emergency-capable hospitals to the crew, from the National Hospital Directory (fn_nearest_er_hospitals).</p>
      <div className="mt-4">
        {diversion ? (
          <DiversionList alert={alert} diversion={diversion} onPick={(h) => {
            setPicked(h);
            setNote((n) => n || `No ${alert?.hold_ward_type || 'suitable'} bed free; diverted to ${h.hospital_name}`);
          }} />
        ) : (
          <div className="h-24 animate-pulse rounded-xl bg-tint/[0.04]" />
        )}
      </div>
      <div className="mt-4">
        <label className="label">Reason (saved and sealed in the audit chain)</label>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. No ICU bed with ventilator free" />
        {picked && <p className="mt-1 text-[11px] text-amber-200">Diverting to {picked.hospital_name} ({Number(picked.distance_km).toFixed(1)} km)</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-semibold text-fg2 hover:bg-tint/[0.06]">Back</button>
        <button
          disabled={note.trim().length < 5}
          onClick={() => onDivert(picked?.nhp_id ?? null, note)}
          className="rounded-xl bg-amber-300 px-4 py-2 text-xs font-bold text-[#1a1204] disabled:opacity-50"
        >
          Confirm diversion
        </button>
      </div>
    </Modal>
  );
}

function ArriveModal({ alert, onClose, onArrive }: { alert: Alert | null; onClose: () => void; onArrive: (patientId: number, doctorId: number, diagnosis: string) => void }) {
  const [q, setQ] = useState('');
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [patient, setPatient] = useState<any>(null);
  const [doctorId, setDoctorId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [quick, setQuick] = useState(false);

  useEffect(() => {
    if (!alert) return;
    setPatient(null);
    setQ('');
    setDiagnosis(alert.condition_name ? `${alert.condition_name}: ${alert.chief_complaint}` : alert.chief_complaint);
    fetch('/api/doctors?on_duty=true')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setDoctors(d.doctors);
          setDoctorId(String(d.doctors[0]?.doctor_id || ''));
        }
      });
  }, [alert]);

  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/patients?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.success) setPatients(d.patients.filter((p: any) => !p.active_admission_id).slice(0, 6));
    }, 200);
    return () => clearTimeout(t);
  }, [q, alert]);

  return (
    <>
      <Modal isOpen={!!alert && !quick} onClose={onClose} glow="52,211,153" className="max-w-xl">
        <h3 className="font-display text-lg font-bold text-fg">{alert?.alert_code} has arrived</h3>
        <p className="mt-1 text-xs text-fg3">
          fn_admit_from_alert() converts the hold on {alert?.hold_room} {alert?.hold_bed_label} into an admission in one transaction.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Patient record</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3" />
              <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, NHID or phone" />
            </div>
            <ul className="mt-2 max-h-44 space-y-1 overflow-auto">
              {patients.map((p) => (
                <li key={p.patient_id}>
                  <button
                    onClick={() => setPatient(p)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                      patient?.patient_id === p.patient_id ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-tint/[0.1] hover:bg-tint/[0.05]'
                    }`}
                  >
                    <span className="text-fg">{p.full_name}</span>
                    <span className="font-mono text-[10.5px] text-fg3">{p.national_health_id}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => setQuick(true)} className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-pulse-300 hover:text-pulse-200">
              <UserPlus className="h-3.5 w-3.5" /> Register a new patient
            </button>
          </div>
          <div>
            <label className="label">Receiving doctor</label>
            <select className="field" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              {doctors.map((d) => (
                <option key={d.doctor_id} value={d.doctor_id}>
                  {d.full_name} · {d.specialization}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Admission diagnosis</label>
            <input className="field" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-semibold text-fg2 hover:bg-tint/[0.06]">Back</button>
          <button
            disabled={!patient || !doctorId}
            onClick={() => onArrive(patient.patient_id, parseInt(doctorId, 10), diagnosis)}
            className="rounded-xl bg-emerald-400 px-4 py-2 text-xs font-bold text-[#04121a] disabled:opacity-50"
          >
            Admit to {alert?.hold_room} {alert?.hold_bed_label}
          </button>
        </div>
      </Modal>
      <QuickPatientModal
        isOpen={quick}
        onClose={() => setQuick(false)}
        onPatientCreated={(p) => {
          setPatient(p);
          setPatients((list) => [p, ...list]);
          setQuick(false);
        }}
      />
    </>
  );
}
