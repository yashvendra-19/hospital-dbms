'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Eye, EyeOff, KeyRound, Lock, RefreshCw, ScanEye, ShieldAlert, X } from 'lucide-react';
import PageHeader, { GhostButton } from '@/components/PageHeader';
import { ROLE_STYLE, useSession } from '@/components/auth/SessionContext';

const ROLE_OF_DB: Record<string, keyof typeof ROLE_STYLE> = {
  mr_doctor: 'Doctor',
  mr_nurse: 'Nurse',
  mr_billing: 'Billing',
  mr_admin: 'Admin',
};

const TABLE_LABEL: Record<string, string> = {
  patients: 'Patients',
  admissions: 'Admissions',
  billing: 'Bills',
  ambulance_prealerts: 'Ambulance pre-alerts',
  cost_estimates: 'Cost estimates',
  login_audit: 'Login trail',
  audit_chain: 'Audit chain',
  nhp_hospitals: 'Hospital directory',
};

export default function PrivacyLensPage() {
  const { session } = useSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/privacy', { cache: 'no-store' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const ctx = data?.me?.ctx;
  const roles = ['mr_doctor', 'mr_nurse', 'mr_billing', 'mr_admin'];
  const cell = (role: string, table: string) => data?.me?.matrix.find((m: any) => m.role === role && m.table_name === table);
  const colCell = (role: string, col: string) => data?.me?.columns.find((m: any) => m.role === role && m.column_name === col)?.can_select;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <PageHeader
        eyebrow="Privacy lens · row-level security"
        title="Same database. Different truth for each role."
        accent={['Different', 'truth']}
        subtitle="Every request runs as a PostgreSQL role (SET LOCAL ROLE mr_doctor, mr_nurse, mr_billing, mr_admin). Column grants hide diagnoses from billing, row-level security hides restricted records (medico-legal cases, VIPs) from anyone outside the care team, and break-glass opens them for 15 audited minutes. None of this depends on the screen: the database refuses."
        actions={
          <GhostButton onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-run as every role
          </GhostButton>
        }
      />

      {error && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}

      {/* WHO AM I TO POSTGRES */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass rounded-3xl p-5 lg:col-span-1">
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">
            <KeyRound className="h-3.5 w-3.5 text-plasma-400" /> You, as PostgreSQL sees you
          </div>
          {ctx ? (
            <dl className="mt-4 space-y-2 font-mono text-[12px]">
              {[
                ['current_user', ctx.db_role],
                ['session_user', ctx.login_role],
                ["app.staff_role", ctx.staff_role],
                ['app.staff_code', ctx.staff_code],
                ['app.doctor_id', ctx.doctor_id ?? 'NULL'],
                ['app_break_glass()', String(ctx.break_glass)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-tint/[0.06] pb-1.5">
                  <dt className="text-fg3">{k}</dt>
                  <dd className="text-fg">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-4 h-40 animate-pulse rounded-xl bg-tint/[0.03]" />
          )}
          {data && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <Stat label="patients you can see" v={data.me.probe.patients} />
              <Stat label="restricted among them" v={data.me.probe.restricted} />
              <Stat label="bills you can read" v={data.me.probe.bills ?? 'denied'} />
              <Stat label="audit rows you can read" v={data.me.probe.auditRows ?? 'denied'} />
            </div>
          )}
        </div>

        {/* SAME QUESTION, SIX PEOPLE */}
        <div className="glass overflow-hidden rounded-3xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">
              <ScanEye className="h-3.5 w-3.5 text-pulse-300" /> The same SQL, run as six different people
            </div>
            <span className="hidden font-mono text-[10px] text-fg3 sm:block">only counts and yes/no come back, never names</span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="font-mono text-[10px] uppercase tracking-wider text-fg3">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Viewer</th>
                  <th className="pb-2 pr-3 font-medium">SELECT patients</th>
                  <th className="pb-2 pr-3 font-medium">MLC patient in ER-TRAUMA B-1</th>
                  <th className="pb-2 pr-3 font-medium">diagnosis column</th>
                  <th className="pb-2 pr-3 font-medium">bills</th>
                  <th className="pb-2 font-medium">audit chain</th>
                </tr>
              </thead>
              <tbody>
                {(data?.comparison || []).map((c: any, i: number) => {
                  const st = ROLE_STYLE[c.role as keyof typeof ROLE_STYLE];
                  const isMe = session && c.role === session.role && (c.mode === session.mode);
                  return (
                    <motion.tr
                      key={c.label}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className={`border-t border-tint/[0.06] ${isMe ? 'bg-tint/[0.03]' : ''}`}
                    >
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: st.hex }} />
                          <span className="text-fg">{c.label}</span>
                        </span>
                        <span className="ml-4 font-mono text-[10px] text-fg3">
                          {c.dbRole}
                          {c.mode === 'break_glass' && <span className="ml-1 text-rose-300">· break-glass</span>}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-fg">
                        {c.patients} rows{c.restricted ? <span className="text-plasma-400"> ({c.restricted} restricted)</span> : null}
                      </td>
                      <td className="py-2.5 pr-3">
                        {c.seesMlcName ? (
                          <span className="chip border-emerald-400/30 bg-emerald-500/10 text-emerald-300"><Eye className="h-3 w-3" /> sees name</span>
                        ) : (
                          <span className="chip border-plasma-400/30 bg-plasma-500/10 text-plasma-400"><EyeOff className="h-3 w-3" /> hidden by RLS</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">{c.diagnosis ? <Yes /> : <No text="column grant" />}</td>
                      <td className="py-2.5 pr-3">{c.bills !== null ? <Yes text={`${c.bills} rows`} /> : <No text="no grant" />}</td>
                      <td className="py-2.5">{c.auditRows !== null ? <Yes text={`${c.auditRows} rows`} /> : <No text="no grant" />}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-fg3">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-300" />
            Sr. Lakshmi normally cannot see the medico-legal patient; with break-glass she can, and that session is
            sealed in the audit chain with her reason.
          </p>
        </div>
      </section>

      {/* GRANT MATRIX */}
      <section className="glass mt-6 overflow-hidden rounded-3xl p-5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">
          Privilege matrix, read live from has_table_privilege() and has_column_privilege()
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider text-fg3">
                <th className="pb-2 text-left font-medium">Table</th>
                {roles.map((r) => (
                  <th key={r} className="pb-2 font-medium" style={{ color: ROLE_STYLE[ROLE_OF_DB[r]].hex }}>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(TABLE_LABEL).map((t) => (
                <tr key={t} className="border-t border-tint/[0.06]">
                  <td className="py-2 pr-3">
                    <span className="text-fg">{TABLE_LABEL[t]}</span> <span className="font-mono text-[10px] text-fg3">{t}</span>
                    {data?.me?.rlsTables?.some((x: any) => x.table_name === t) && (
                      <span className="ml-2 chip border-plasma-400/30 bg-plasma-500/10 text-plasma-400"><Lock className="h-2.5 w-2.5" /> RLS</span>
                    )}
                  </td>
                  {roles.map((r) => {
                    const c = cell(r, t);
                    return (
                      <td key={r} className="py-2 text-center font-mono text-[10.5px]">
                        {c ? (
                          <span className="inline-flex gap-1">
                            <Priv on={c.can_select} l="R" />
                            <Priv on={c.can_insert} l="W" />
                            <Priv on={c.can_update} l="U" />
                          </span>
                        ) : (
                          '…'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {['admission_diagnosis', 'triage_priority'].map((col) => (
                <tr key={col} className="border-t border-tint/[0.06]">
                  <td className="py-2 pr-3">
                    <span className="text-fg">admissions.{col}</span> <span className="font-mono text-[10px] text-fg3">column grant</span>
                  </td>
                  {roles.map((r) => (
                    <td key={r} className="py-2 text-center">
                      <Priv on={!!colCell(r, col)} l="R" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-[10px] text-fg3">R = SELECT · W = INSERT · U = UPDATE</p>
      </section>

      {/* POLICIES */}
      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-bold text-fg">Policies in force (pg_policies)</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(data?.me?.policies || []).map((p: any) => (
            <div key={p.policyname} className="rounded-2xl border border-tint/[0.1] bg-ink-900/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] font-semibold text-fg">{p.policyname}</span>
                <span className="chip border-pulse-400/25 bg-pulse-400/[0.06] font-mono text-pulse-300">
                  {p.cmd} ON {p.tablename}
                </span>
              </div>
              {p.qual && (
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-ground/70 p-2 font-mono text-[10.5px] text-fg2">USING {p.qual}</pre>
              )}
              {p.with_check && (
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-ground/70 p-2 font-mono text-[10.5px] text-fg2">WITH CHECK {p.with_check}</pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: any }) {
  return (
    <div className="rounded-xl border border-tint/[0.08] bg-ground/50 p-2.5">
      <div className="font-display text-xl font-bold text-fg">{v}</div>
      <div className="text-[10px] leading-tight text-fg3">{label}</div>
    </div>
  );
}

function Yes({ text = 'allowed' }: { text?: string }) {
  return (
    <span className="chip border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
      <Check className="h-3 w-3" /> {text}
    </span>
  );
}

function No({ text }: { text: string }) {
  return (
    <span className="chip border-rose-400/30 bg-rose-500/10 text-rose-300">
      <X className="h-3 w-3" /> {text}
    </span>
  );
}

function Priv({ on, l }: { on: boolean; l: string }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded ${
        on ? 'bg-emerald-500/20 font-bold text-emerald-300' : 'bg-tint/[0.04] text-fg3 line-through'
      }`}
    >
      {l}
    </span>
  );
}
