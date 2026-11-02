'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { BedDouble, Building2, Database, IndianRupee, Layers, RefreshCw, ShieldCheck, TrendingUp, Users, Wind } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { useToast } from '@/components/ToastContext';
import PageHeader, { GhostButton } from '@/components/PageHeader';
import RadialGauge from '@/components/fx/RadialGauge';
import CountUp from '@/components/fx/CountUp';
import SpotlightCard from '@/components/fx/SpotlightCard';

const CapacityVials = dynamic(() => import('@/components/three/CapacityVials'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.2em] text-fg3">
      Filling vials…
    </div>
  ),
});

const CONSTRAINTS = [
  {
    name: 'ex_no_double_bed_booking',
    kind: 'EXCLUDE USING gist',
    body: '(bed_id WITH =, stay_duration_range WITH &&) — no two stays may overlap on the same physical bed.',
  },
  {
    name: 'chk_critical_infra',
    kind: 'CHECK',
    body: 'ICU / CCU beds must have has_ventilator = true AND has_oxygen_port = true.',
  },
  {
    name: 'chk_settled_time',
    kind: 'CHECK',
    body: "settled_at is non-null if and only if payment_status = 'Settled'.",
  },
  {
    name: 'chk_insurance_limit',
    kind: 'CHECK',
    body: '0 ≤ insurance_claim_approved ≤ gross_amount (a generated column).',
  },
];

export default function AnalyticsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ departmentCapacity: any[]; wardTypeDistribution: any[]; kpis: any; financeVisible?: boolean; realWorld?: any; estimateAccuracy?: any[] | null } | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to fetch analytics');
      setData(json);
    } catch (err: any) {
      toast({ type: 'error', title: 'Analytics Query Failed', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kpis = data?.kpis;
  const departments = data?.departmentCapacity || [];
  const wardTypes = data?.wardTypeDistribution || [];
  const maxRevenue = Math.max(1, ...departments.map((d) => Number(d.total_revenue_billed)));

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <PageHeader
        eyebrow="SQL aggregate reporting"
        title="Capacity & Clinical Analytics"
        accent={['Clinical', 'Analytics']}
        subtitle="GROUP BY roll-ups across departments, wards_beds, admissions and billing — floor saturation, revenue and staffing in one view."
        actions={
          <GhostButton onClick={fetchAnalytics} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Recalculate aggregates
          </GhostButton>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          index={0}
          title="Overall occupancy"
          value={kpis ? Number(kpis.overallOccupancyPct) : null}
          decimals={1}
          suffix="%"
          subtitle={`${kpis?.total_occupied ?? 0} of ${kpis?.total_beds ?? 0} beds occupied`}
          icon={BedDouble}
          variant={kpis && kpis.overallOccupancyPct > 80 ? 'rose' : 'blue'}
          progress={kpis ? Number(kpis.overallOccupancyPct) : 0}
        />
        <MetricCard
          index={1}
          title="Active inpatients"
          value={kpis ? Number(kpis.total_active_admissions) : null}
          subtitle="Currently receiving care"
          icon={Users}
          variant="rose"
        />
        <MetricCard
          index={2}
          title="Gross billed revenue"
          value={kpis && data?.financeVisible !== false ? Number(kpis.total_gross_billed) : null}
          prefix="₹"
          subtitle={
            data?.financeVisible === false
              ? 'Hidden: your role has no grant on billing'
              : `${kpis?.settled_bills_count ?? 0} settled · ${kpis?.pending_bills_count ?? 0} pending`
          }
          icon={IndianRupee}
          variant="violet"
        />
        <MetricCard
          index={3}
          title="Net patient collections"
          value={kpis && data?.financeVisible !== false ? Number(kpis.total_net_payable) : null}
          prefix="₹"
          subtitle={
            data?.financeVisible === false
              ? 'Finance data stays with billing and admins'
              : `₹${Number(kpis?.total_insurance_claimed ?? 0).toLocaleString('en-IN')} insurance claimed`
          }
          icon={TrendingUp}
          variant="emerald"
        />
      </div>

      {/* 3D vials + gauge */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="screen relative h-[380px] overflow-hidden rounded-3xl border border-tint/[0.14] bg-ink-950 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.6)] lg:col-span-8"
        >
          {departments.length > 0 && (
            <CapacityVials
              data={departments.map((d) => ({
                id: d.dept_id,
                code: d.dept_code,
                name: d.dept_name,
                pct: Number(d.occupancy_rate_pct),
                occupied: Number(d.occupied_beds),
                total: Number(d.total_beds),
              }))}
            />
          )}
          <div className="pointer-events-none absolute left-5 top-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg2">Occupancy vials</div>
            <div className="font-display text-base font-semibold text-fg">Liquid level = bed occupancy %</div>
          </div>
          <div className="pointer-events-none absolute right-5 top-5 rounded-lg border border-tint/[0.14] bg-ink-950/70 px-2.5 py-1.5 font-mono text-[10px] text-fg2 backdrop-blur">
            fn_get_department_occupancy_rate()
          </div>
        </motion.div>

        <SpotlightCard className="lg:col-span-4" innerClassName="flex h-full flex-col items-center justify-center p-6">
          <RadialGauge value={Number(kpis?.overallOccupancyPct ?? 0)} size={210} label="Hospital census" sub={`${kpis?.total_occupied ?? 0}/${kpis?.total_beds ?? 0} beds`} />
          <div className="mt-6 grid w-full grid-cols-3 gap-2 text-center">
            {[
              ['Beds', kpis?.total_beds],
              ['Occupied', kpis?.total_occupied],
              ['Free', kpis ? kpis.total_beds - kpis.total_occupied : 0],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl border border-tint/[0.11] bg-tint/[0.02] py-2">
                <CountUp value={Number(v ?? 0)} className="font-display text-lg font-bold text-fg" />
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg3">{k}</div>
              </div>
            ))}
          </div>
        </SpotlightCard>
      </div>

      {/* Department roll-up */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass mt-8 overflow-hidden rounded-2xl"
      >
        <div className="flex flex-col gap-2 border-b border-tint/[0.11] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-fg">
              <Building2 className="h-5 w-5 text-pulse-300" /> Departmental capacity & revenue
            </h2>
            <p className="text-xs text-fg3">departments ⋈ wards_beds ⋈ admissions ⋈ billing · parameterized GROUP BY</p>
          </div>
          <span className="rounded-md border border-tint/[0.14] bg-sunk px-2.5 py-1 font-mono text-[10.5px] text-pulse-300">GROUP BY d.dept_id</span>
        </div>

        <div className="divide-y divide-tint/[0.09]">
          {loading && departments.length === 0 ? (
            <div className="p-10 text-center font-mono text-xs text-fg3">Executing SQL aggregate analytics…</div>
          ) : (
            departments.map((dept, i) => {
              const occ = Number(dept.occupancy_rate_pct);
              const color = occ >= 80 ? '#fb7185' : occ >= 50 ? '#fbbf24' : '#2ee6f5';
              const rev = Number(dept.total_revenue_billed);
              return (
                <motion.div
                  key={dept.dept_id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="grid grid-cols-2 items-center gap-4 p-5 transition hover:bg-tint/[0.02] lg:grid-cols-12"
                >
                  <div className="col-span-2 lg:col-span-3">
                    <div className="font-display text-sm font-bold text-fg">{dept.dept_name}</div>
                    <div className="font-mono text-[10.5px] text-fg3">
                      {dept.dept_code} · F{dept.floor_number} · ☎ {dept.emergency_contact}
                    </div>
                  </div>
                  <div className="col-span-2 lg:col-span-3">
                    <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px]">
                      <span className="text-fg3">
                        {dept.occupied_beds}/{dept.total_beds} beds
                      </span>
                      <span style={{ color }}>{occ}%</span>
                    </div>
                    <div className="flex h-2.5 gap-0.5">
                      {Array.from({ length: Number(dept.total_beds) }).map((_, b) => (
                        <motion.div
                          key={b}
                          className="h-full flex-1 rounded-sm"
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{ delay: 0.2 + i * 0.08 + b * 0.05 }}
                          style={{
                            background: b < Number(dept.occupied_beds) ? '#fb7185' : 'rgba(52,211,153,0.35)',
                            boxShadow: b < Number(dept.occupied_beds) ? '0 0 10px #fb7185' : undefined,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg3">Active</div>
                    <div className="font-display text-lg font-bold text-fg">{dept.active_admissions}</div>
                  </div>
                  <div className="lg:col-span-2">
                    <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg3">Gross / net</div>
                    <CountUp value={rev} prefix="₹" className="block font-mono text-sm font-bold text-fg" />
                    <CountUp value={Number(dept.total_net_patient_payable)} prefix="₹" className="block font-mono text-[11px] text-emerald-300" />
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-tint/[0.05]">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-plasma-500 to-pink-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${(rev / maxRevenue) * 100}%` }}
                        transition={{ duration: 1.2, delay: 0.3 }}
                      />
                    </div>
                  </div>
                  <div className="col-span-2 lg:col-span-2 lg:text-right">
                    <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg3">Staffing</div>
                    <div className="text-sm text-fg2">
                      <span className="font-bold text-fg">{dept.on_duty_doctors}</span> / {dept.total_doctors} on duty
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </motion.div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Ward types */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-5"
        >
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-fg">
            <Layers className="h-4 w-4 text-plasma-400" /> Ward type distribution
          </h3>
          <p className="text-xs text-fg3">Capacity by clinical specialty and life-support readiness.</p>
          <div className="mt-5 space-y-4">
            {wardTypes.map((w, i) => {
              const total = Number(w.total_beds);
              const seg = (n: number) => `${(Number(n) / Math.max(1, total)) * 100}%`;
              const other = total - Number(w.occupied_beds) - Number(w.available_beds);
              return (
                <div key={w.ward_type}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-fg">
                      {w.ward_type}
                      {Number(w.ventilator_equipped) > 0 && (
                        <span className="chip border-plasma-400/30 bg-plasma-500/10 text-plasma-400">
                          <Wind className="h-3 w-3" /> {w.ventilator_equipped}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10.5px] text-fg3">
                      avg ₹{Number(w.avg_daily_tariff).toLocaleString('en-IN')}/d · {total} beds
                    </span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-tint/[0.05]">
                    {[
                      [w.occupied_beds, '#fb7185'],
                      [w.available_beds, '#34d399'],
                      [other, '#fbbf24'],
                    ].map(([n, c], k) => (
                      <motion.div
                        key={k}
                        className="h-full"
                        style={{ background: c as string, boxShadow: `0 0 12px ${c}` }}
                        initial={{ width: 0 }}
                        animate={{ width: seg(Number(n)) }}
                        transition={{ duration: 1, delay: 0.2 + i * 0.1 + k * 0.1, ease: [0.22, 1, 0.36, 1] }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex gap-4 pt-1 font-mono text-[10px] text-fg3">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" /> occupied</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400" /> available</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-400" /> sanitizing / OOS</span>
            </div>
          </div>
        </motion.div>

        {/* Constraints */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-5"
        >
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-fg">
            <ShieldCheck className="h-4 w-4 text-emerald-300" /> Database integrity guards
          </h3>
          <p className="text-xs text-fg3">PostgreSQL constraints protecting patient safety and hospital operations.</p>
          <div className="mt-4 space-y-2.5">
            {CONSTRAINTS.map((c, i) => (
              <motion.div
                key={c.name}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="group relative overflow-hidden rounded-xl border border-tint/[0.12] bg-sunk/60 p-3"
              >
                <div
                  aria-hidden
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-emerald-400/[0.07] to-transparent transition-transform duration-1000 group-hover:translate-x-full"
                />
                <div className="relative flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-fg">{c.name}</span>
                  <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9.5px] text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ENFORCED
                  </span>
                </div>
                <div className="relative mt-1 font-mono text-[10px] text-plasma-400">{c.kind}</div>
                <p className="relative mt-1 text-[11.5px] text-fg2">{c.body}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-tint/[0.11] pt-3 font-mono text-[10.5px] text-fg3">
            <span className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" /> pg pool · 20 clients max
            </span>
            <span className="text-emerald-300">health: optimal</span>
          </div>
        </motion.div>
      </div>

      {data?.realWorld && <RealWorldSection rw={data.realWorld} accuracy={data.estimateAccuracy} />}
    </div>
  );
}

/** Where the numbers come from: public datasets loaded into hospital_db. */
function RealWorldSection({ rw, accuracy }: { rw: any; accuracy?: any[] | null }) {
  const dir = rw.directory || {};
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-2">
        <Database className="h-5 w-5 text-pulse-300" />
        <h2 className="font-display text-xl font-bold text-fg">Real-world data inside hospital_db</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {(rw.sources || []).map((src: any) => (
          <a
            key={src.key}
            href={src.url}
            target="_blank"
            rel="noreferrer"
            className="glass group rounded-2xl p-4 transition hover:border-pulse-400/30"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-pulse-300">{src.key}</div>
            <div className="mt-1 font-display text-sm font-bold text-fg">{src.title}</div>
            <div className="text-[11px] text-fg3">{src.publisher}</div>
            <div className="mt-3 font-display text-2xl font-bold text-fg">{Number(src.rows).toLocaleString('en-IN')} rows</div>
            {src.rowsInSource && Number(src.rowsInSource) !== Number(src.rows) && (
              <div className="text-[11px] text-fg2">sampled from {Number(src.rowsInSource).toLocaleString('en-IN')}</div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-fg3">{src.notes}</p>
            <div className="mt-2 truncate font-mono text-[9.5px] text-fg3" title={src.sha256}>
              sha256 {String(src.sha256 || '').slice(0, 20)}… · {src.licence}
            </div>
          </a>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="glass rounded-2xl p-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">National Hospital Directory</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              ['hospitals', dir.hospitals],
              ['states & UTs', dir.states],
              ['emergency-capable', dir.erCapable],
              ['geo-located', dir.withCoordinates],
              ['in our district', dir.sameDistrict],
              ['ER-capable nearby', dir.sameDistrictEr],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-tint/[0.08] bg-ground/50 p-2.5">
                <div className="font-display text-lg font-bold text-fg">{Number(v ?? 0).toLocaleString('en-IN')}</div>
                <div className="text-[10px] text-fg3">{l}</div>
              </div>
            ))}
          </div>
          {accuracy && (
            <div className="mt-4 border-t border-tint/[0.08] pt-3 text-xs text-fg2">
              <span className="font-semibold text-fg">Estimate honesty: </span>
              {accuracy.length === 0
                ? 'no estimates given yet.'
                : accuracy.map((a: any) => `${a.outcome}: ${a.n}`).join(' · ')}
            </div>
          )}
        </div>
        <div className="glass rounded-2xl p-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">Real length of stay (NY SPARCS 2021, all severities)</div>
          <table className="mt-3 w-full text-xs">
            <thead className="font-mono text-[10px] uppercase text-fg3">
              <tr>
                <th className="pb-1.5 text-left font-medium">Condition</th>
                <th className="pb-1.5 text-right font-medium">Stays</th>
                <th className="pb-1.5 text-right font-medium">Median</th>
                <th className="pb-1.5 text-right font-medium">P90</th>
                <th className="pb-1.5 text-right font-medium">Died</th>
              </tr>
            </thead>
            <tbody>
              {(rw.top_conditions || []).map((c: any) => (
                <tr key={c.condition} className="border-t border-tint/[0.06]">
                  <td className="py-1.5 text-fg">
                    <span className="mr-1.5 font-mono text-[10px] text-fg3">{c.dept_code}</span>
                    {c.condition}
                  </td>
                  <td className="py-1.5 text-right font-mono text-fg2">{c.cases}</td>
                  <td className="py-1.5 text-right font-mono text-pulse-300">{Number(c.los_median)}d</td>
                  <td className="py-1.5 text-right font-mono text-fg2">{Number(c.los_p90)}d</td>
                  <td className="py-1.5 text-right font-mono text-fg2">{Number(c.mortality_pct).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-fg3">percentile_cont() over historical_discharges, stored in mv_condition_benchmarks.</p>
        </div>
      </div>
    </section>
  );
}
