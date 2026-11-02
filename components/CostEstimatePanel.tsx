'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Database, IndianRupee, ShieldCheck, Users } from 'lucide-react';

export interface EstimateChoice {
  condition_id: string;
  severity: number;
  scheme_code: string;
  cover_remaining: string;
  explained_to: string;
  relation: string;
}

export const EMPTY_ESTIMATE: EstimateChoice = {
  condition_id: '',
  severity: 2,
  scheme_code: 'SELF',
  cover_remaining: '',
  explained_to: '',
  relation: '',
};

const SEVERITY = [
  { v: 1, label: 'Minor' },
  { v: 2, label: 'Moderate' },
  { v: 3, label: 'Major' },
  { v: 4, label: 'Extreme' },
];

const inr = (n: any) =>
  n === null || n === undefined ? '–' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const lakh = (n: any) => {
  const v = Number(n);
  return v >= 100000 ? `₹${(v / 100000).toFixed(2).replace(/\.?0+$/, '')} L` : inr(v);
};

/** ESI triage to a starting APR severity (the desk can change it). */
export const severityFromEsi = (esi: number) => (esi <= 1 ? 4 : esi === 2 ? 3 : esi === 3 ? 2 : 1);

interface Props {
  value: EstimateChoice;
  onChange: (v: EstimateChoice) => void;
  wardType?: string | null;
  deptId?: number | null;
  patientIsChild?: boolean | null;
}

/**
 * Upfront cost estimate for the family. PostgreSQL's fn_estimate_admission_cost() turns real
 * length-of-stay outcomes (NY SPARCS 2021, de-identified) into a range priced at this hospital's tariff.
 */
export default function CostEstimatePanel({ value, onChange, wardType, deptId, patientIsChild }: Props) {
  const [conditions, setConditions] = useState<any[]>([]);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/estimates/conditions')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setConditions(d.conditions);
          setSchemes(d.schemes);
        }
      })
      .catch(() => undefined);
  }, []);

  const options = useMemo(() => {
    const scoped = conditions.filter((c) => patientIsChild === null || patientIsChild === undefined || (patientIsChild ? c.age_scope === 'child' : c.age_scope === 'adult'));
    return [...scoped].sort((a, b) => Number(b.dept_id === deptId) - Number(a.dept_id === deptId) || a.dept_id - b.dept_id);
  }, [conditions, patientIsChild, deptId]);

  useEffect(() => {
    if (!value.condition_id) {
      setData(null);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          condition_id: value.condition_id,
          severity: String(value.severity),
          scheme: value.scheme_code,
          ...(wardType ? { ward_type: wardType } : {}),
          ...(value.cover_remaining !== '' ? { cover: value.cover_remaining } : {}),
        });
        const r = await fetch(`/api/estimates/preview?${qs}`);
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error);
        setData(d);
        setError(null);
      } catch (e: any) {
        setError(e.message || 'Could not compute the estimate');
        setData(null);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [value.condition_id, value.severity, value.scheme_code, value.cover_remaining, wardType]);

  const e = data?.estimate;
  const scheme = schemes.find((s) => s.scheme_code === value.scheme_code);
  const maxStays = data ? Math.max(...data.histogram.map((h: any) => h.stays), 1) : 1;
  const totalStays = data ? data.histogram.reduce((s: number, h: any) => s + h.stays, 0) : 0;
  const set = (patch: Partial<EstimateChoice>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Condition (CCSR group)</label>
          <select className="field" value={value.condition_id} onChange={(ev) => set({ condition_id: ev.target.value })}>
            <option value="">Skip the estimate</option>
            {options.map((c) => (
              <option key={c.condition_id} value={c.condition_id}>
                {c.dept_code} · {c.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Severity</label>
          <div className="grid grid-cols-4 gap-1">
            {SEVERITY.map((s) => (
              <button
                key={s.v}
                type="button"
                onClick={() => set({ severity: s.v })}
                className={`rounded-lg border px-1 py-2 text-[11px] font-semibold transition ${
                  value.severity === s.v ? 'border-pulse-300 bg-pulse-400/15 text-fg' : 'border-tint/[0.12] text-fg2 hover:text-fg'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {value.condition_id && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Insurance / scheme</label>
                <select className="field" value={value.scheme_code} onChange={(ev) => set({ scheme_code: ev.target.value, cover_remaining: '' })}>
                  {schemes.map((s) => (
                    <option key={s.scheme_code} value={s.scheme_code}>
                      {s.scheme_name}
                      {s.annual_cover_inr ? ` · ${lakh(s.annual_cover_inr)} ${s.cover_basis}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {value.scheme_code !== 'SELF' && (
                <div>
                  <label className="label">{value.scheme_code === 'PRIVATE' ? 'Sum insured left (₹)' : 'Balance left this year (₹)'}</label>
                  <input
                    className="field font-mono"
                    type="number"
                    min={0}
                    value={value.cover_remaining}
                    onChange={(ev) => set({ cover_remaining: ev.target.value })}
                    placeholder={scheme?.annual_cover_inr ? String(Math.round(scheme.annual_cover_inr)) : 'e.g. 300000'}
                  />
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-pulse-400/25 bg-pulse-400/[0.04] p-4">
              {error ? (
                <p className="text-xs text-rose-200">{error}</p>
              ) : !e ? (
                <div className="h-28 animate-pulse rounded-xl bg-tint/[0.03]" />
              ) : (
                <div className={loading ? 'opacity-60 transition' : 'transition'}>
                  <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg3">Likely total bill</div>
                      <div className="font-display text-3xl font-bold text-fg">{inr(e.est_typical)}</div>
                      <div className="text-[11px] text-fg2">
                        usually {inr(e.est_low)} – {inr(e.est_high)} · {e.los_low}–{e.los_high} days in {e.ward_type} at {inr(e.daily_tariff)}/day
                      </div>
                    </div>
                    <div className="sm:text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg3">Family pays (typical)</div>
                      <div className={`font-display text-2xl font-bold ${Number(e.oop_typical) === 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                        {inr(e.oop_typical)}
                      </div>
                      <div className="text-[11px] text-fg2">
                        {Number(e.cover_available) > 0 ? `after ${inr(e.cover_available)} cover (${e.scheme_name})` : 'no insurance applied'}
                      </div>
                    </div>
                  </div>

                  {/* range bar */}
                  <div className="relative mt-4 h-2.5 rounded-full bg-tint/[0.08]">
                    {(() => {
                      const max = Number(e.est_worst) || 1;
                      const l = (Number(e.est_low) / max) * 100;
                      const h = (Number(e.est_high) / max) * 100;
                      const m = (Number(e.est_typical) / max) * 100;
                      return (
                        <>
                          <motion.div
                            className="absolute inset-y-0 rounded-full bg-gradient-to-r from-pulse-400 to-plasma-500"
                            initial={false}
                            animate={{ left: `${l}%`, width: `${Math.max(2, h - l)}%` }}
                          />
                          <motion.div className="absolute -top-1 h-4.5 w-1 rounded bg-white" style={{ height: 18 }} initial={false} animate={{ left: `${m}%` }} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[9.5px] text-fg3">
                    <span>₹0</span>
                    <span>1 in 10 stays cost more than {inr(e.est_worst)}</span>
                  </div>

                  {/* real length-of-stay distribution */}
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-fg3">
                      <span>Length of stay of {totalStays.toLocaleString('en-IN')} real patients</span>
                      <span>days →</span>
                    </div>
                    <div className="flex h-16 items-end gap-[2px]">
                      {data.histogram.map((h: any) => {
                        const inRange = h.days >= e.los_low && h.days <= e.los_high;
                        return (
                          <motion.div
                            key={h.days}
                            title={`${h.days}${h.days === 30 ? '+' : ''} days: ${h.stays} stays`}
                            className="flex-1 rounded-t-sm"
                            initial={{ height: 0 }}
                            animate={{ height: `${Math.max(4, (h.stays / maxStays) * 100)}%` }}
                            style={{ background: inRange ? 'linear-gradient(180deg,#2ee6f5,#9474ff)' : 'rgba(231,236,245,0.14)' }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {data.outcomes.map((o: any) => (
                      <span key={o.outcome} className="chip border-tint/[0.12] bg-tint/[0.03] text-fg2">
                        {o.outcome} {Math.round((o.stays / totalStays) * 100)}%
                      </span>
                    ))}
                  </div>

                  <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-fg3">
                    <Database className="mt-0.5 h-3 w-3 flex-shrink-0 text-pulse-300" />
                    Based on {e.cases.toLocaleString('en-IN')} real {e.used_fallback ? 'stays (all severities: too few at this level)' : 'stays at this severity'} from{' '}
                    {data.facts?.hospitals} hospitals ({data.source?.title}, {Number(data.source?.rows_in_source).toLocaleString('en-IN')} stays).
                    Days come from real outcomes; prices from our own tariff; resource intensity ×{Number(e.intensity_index).toFixed(2)} from real costs.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">
                  <Users className="mr-1 inline h-3 w-3" /> Explained to
                </label>
                <input className="field" value={value.explained_to} onChange={(ev) => set({ explained_to: ev.target.value })} placeholder="Family member's name" />
              </div>
              <div>
                <label className="label">Relation</label>
                <input className="field" value={value.relation} onChange={(ev) => set({ relation: ev.target.value })} placeholder="e.g. Spouse" />
              </div>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-fg3">
              <ShieldCheck className="h-3 w-3 text-emerald-300" />
              Saved with the admission in <code className="font-mono">cost_estimates</code> and sealed in the audit chain; the final bill is compared with it at discharge.
              <IndianRupee className="hidden" />
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
