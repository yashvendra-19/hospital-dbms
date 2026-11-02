'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon, CheckCircle2, Fingerprint, Link2, Lock, RefreshCw, RotateCcw, Search, ShieldCheck, Skull } from 'lucide-react';
import PageHeader, { GhostButton } from '@/components/PageHeader';
import { useSession } from '@/components/auth/SessionContext';
import { useToast } from '@/components/ToastContext';
import { useLive } from '@/components/LiveContext';

const TABLE_TONE: Record<string, string> = {
  billing: '251,191,36',
  admissions: '251,113,133',
  patients: '46,230,245',
  wards_beds: '52,211,153',
  ambulance_prealerts: '56,189,248',
  bed_holds: '56,189,248',
  cost_estimates: '148,116,255',
  login_audit: '148,163,184',
  audit_chain: '231,236,245',
};

const short = (h?: string | null, n = 10) => (h ? `${h.slice(0, n)}…` : '');

export default function IntegrityPage() {
  const { session } = useSession();
  const { toast } = useToast();
  const { tick } = useLive();
  const [data, setData] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [table, setTable] = useState<string>('');
  const [open, setOpen] = useState<number | null>(null);
  const [sealSeq, setSealSeq] = useState('');
  const [sealHash, setSealHash] = useState('');
  const [sealResult, setSealResult] = useState<any>(null);
  const [drillBusy, setDrillBusy] = useState(false);
  const isAdmin = session?.role === 'Admin';

  const load = useCallback(async () => {
    setVerifying(true);
    try {
      const r = await fetch(`/api/audit?limit=60${table ? `&table=${table}` : ''}`, { cache: 'no-store' });
      const d = await r.json();
      if (d.success) setData(d);
    } finally {
      setTimeout(() => setVerifying(false), 500);
    }
  }, [table]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (tick > 0) load();
  }, [tick, load]);

  const drill = async (action: 'tamper' | 'restore') => {
    setDrillBusy(true);
    try {
      const r = await fetch('/api/audit/drill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      toast(
        action === 'tamper'
          ? { type: 'warning', title: `Row #${d.seq} edited behind the database's back`, message: `${d.table}.${d.field}: ${d.before} → ${d.after}. Now verify the chain.` }
          : { type: 'success', title: 'Original row restored', message: 'The chain verifies again.' }
      );
      load();
    } catch (e: any) {
      toast({ type: 'error', title: 'Drill failed', message: e.message });
    } finally {
      setDrillBusy(false);
    }
  };

  const checkSeal = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/audit/seal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: sealSeq, hash: sealHash }) });
    const d = await r.json();
    if (!d.success) {
      toast({ type: 'error', title: 'Seal check failed', message: d.error });
      return;
    }
    setSealResult(d.check);
  };

  const s = data?.summary;
  const intact = s && !s.first_bad_seq;
  const activeDrill = data?.drills?.find((d: any) => !d.restored_at);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <PageHeader
        eyebrow="Integrity ledger · SHA-256 hash chain"
        title="Change one old record and the chain shows it."
        accent={['chain']}
        subtitle="Every change to a patient, admission, bill, bed, ambulance hold, estimate or login is appended to audit_chain by a trigger. Each row stores the SHA-256 of the row before it, so a silent edit, a deleted row or a re-ordered row breaks every seal after it. The table refuses UPDATE, DELETE and TRUNCATE, even for its owner."
        actions={
          <GhostButton onClick={load} disabled={verifying}>
            <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} /> Verify again
          </GhostButton>
        }
      />

      {/* VERDICT */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div
          key={String(intact) + (s?.total_rows ?? '')}
          initial={{ scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`relative overflow-hidden rounded-3xl border p-6 lg:col-span-2 ${
            !s ? 'border-tint/[0.1]' : intact ? 'border-emerald-400/35 bg-emerald-500/[0.06]' : 'border-rose-500/45 bg-rose-500/[0.08]'
          }`}
        >
          {s && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div
                className={`flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border ${
                  intact ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-rose-400/50 bg-rose-500/15'
                }`}
              >
                {intact ? <ShieldCheck className="h-8 w-8 text-emerald-300" /> : <AlertOctagon className="h-8 w-8 text-rose-300" />}
              </div>
              <div className="min-w-0">
                <div className={`font-display text-2xl font-bold ${intact ? 'text-emerald-200' : 'text-rose-100'}`}>
                  {intact ? 'Chain intact' : 'Tampering detected'}
                </div>
                <p className="mt-1 text-sm text-fg2">
                  {intact
                    ? `All ${s.total_rows} rows re-hashed and every link checked by fn_verify_audit_chain().`
                    : s.problem}
                </p>
                <p className="mt-2 font-mono text-[11px] text-fg3">
                  verified {s.verified_rows}/{s.total_rows} · head #{s.head_seq} {short(s.head_hash, 24)}
                </p>
              </div>
            </div>
          )}
          {!s && <div className="h-20 animate-pulse rounded-xl bg-tint/[0.03]" />}
        </motion.div>

        <form onSubmit={checkSeal} className="glass rounded-3xl p-5">
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg3">
            <Search className="h-3.5 w-3.5 text-plasma-400" /> Check a receipt seal
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <input className="field font-mono" placeholder="#seq" value={sealSeq} onChange={(e) => setSealSeq(e.target.value)} />
            <input className="field col-span-2 font-mono" placeholder="first 8+ hash chars" value={sealHash} onChange={(e) => setSealHash(e.target.value)} />
          </div>
          <button className="mt-2 w-full rounded-xl border border-plasma-400/40 bg-plasma-500/10 py-2 text-xs font-semibold text-fg hover:bg-plasma-500/20">
            Check with fn_check_seal()
          </button>
          {sealResult && (
            <div className={`mt-3 rounded-xl border p-2.5 text-[11px] ${sealResult.found && sealResult.hash_matches && sealResult.chain_intact_to_here ? 'border-emerald-400/30 text-emerald-200' : 'border-rose-400/30 text-rose-200'}`}>
              {!sealResult.found
                ? 'No row with that number.'
                : !sealResult.hash_matches
                  ? 'Hash does not match this row: the receipt or the record is not genuine.'
                  : sealResult.chain_intact_to_here
                    ? `Genuine: ${sealResult.table_name} ${sealResult.operation} sealed ${new Date(sealResult.occurred_at).toLocaleString('en-IN')}, chain intact up to here.`
                    : 'Hash matches, but an earlier part of the chain has been altered.'}
            </div>
          )}
        </form>
      </section>

      {/* DRILL (admin) */}
      <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-tint/[0.1] bg-ink-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-fg2">
          <span className="font-semibold text-fg">Tamper drill.</span> Plays a rogue database owner who switches off the append-only trigger and quietly
          cuts a sealed bill to 40%. {isAdmin ? 'Run it, verify, then restore.' : 'Administrators only.'}
        </div>
        <div className="flex gap-2">
          <button
            disabled={!isAdmin || drillBusy || !!activeDrill}
            onClick={() => drill('tamper')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            <Skull className="h-3.5 w-3.5" /> Tamper with a sealed bill
          </button>
          <button
            disabled={!isAdmin || drillBusy || !activeDrill}
            onClick={() => drill('restore')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restore original
          </button>
        </div>
      </section>

      {/* CHAIN */}
      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-fg">Latest blocks</h2>
          {data?.byTable && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setTable('')} className={`chip ${!table ? 'border-pulse-300 text-fg' : 'border-tint/[0.12] text-fg2'}`}>
                all
              </button>
              {data.byTable.map((t: any) => (
                <button
                  key={t.table_name}
                  onClick={() => setTable(t.table_name)}
                  className={`chip ${table === t.table_name ? 'border-pulse-300 text-fg' : 'border-tint/[0.12] text-fg2'}`}
                >
                  {t.table_name} {t.n}
                </button>
              ))}
            </div>
          )}
        </div>

        {data && !data.canReadRows ? (
          <div className="rounded-2xl border border-plasma-400/30 bg-plasma-500/[0.06] p-6 text-sm text-fg2">
            <Lock className="mb-2 h-5 w-5 text-plasma-400" />
            Only administrators can read sealed rows (they hold patient data): <code className="font-mono text-plasma-400">GRANT SELECT ON audit_chain TO mr_admin</code>.
            Anyone can still run the verification above, because fn_verify_audit_chain() returns no record contents.
          </div>
        ) : (
          <div className="relative">
            <div aria-hidden className="absolute bottom-0 left-[22px] top-0 w-px bg-gradient-to-b from-pulse-400/50 via-plasma-500/30 to-transparent" />
            <ul className="space-y-2.5">
              <AnimatePresence initial={false}>
                {(data?.rows || []).map((r: any, i: number) => {
                  const ok = r.seal_ok && r.link_ok;
                  const rgb = TABLE_TONE[r.table_name] || '148,163,184';
                  return (
                    <motion.li
                      key={r.seq}
                      layout
                      initial={{ opacity: 0, x: -14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i, 15) * 0.025 }}
                      className="relative pl-12"
                    >
                      <span
                        className={`absolute left-[14px] top-4 flex h-4 w-4 items-center justify-center rounded-full border-2 ${ok ? 'border-emerald-400 bg-ink-950' : 'border-rose-400 bg-rose-500'}`}
                      >
                        {verifying && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />}
                      </span>
                      <button
                        onClick={() => setOpen(open === r.seq ? null : r.seq)}
                        className={`w-full rounded-2xl border p-3 text-left transition ${ok ? 'border-tint/[0.1] bg-ink-900/70 hover:bg-ink-900' : 'border-rose-500/50 bg-rose-500/[0.08]'}`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-fg">#{r.seq}</span>
                          <span className="chip font-mono" style={{ color: `rgb(${rgb})`, borderColor: `rgba(${rgb},0.35)`, background: `rgba(${rgb},0.08)` }}>
                            {r.operation} {r.table_name}:{r.record_pk}
                          </span>
                          <span className="font-mono text-[10.5px] text-fg3">
                            {r.staff_code || 'system'} · {r.db_role}
                            {r.access_mode === 'break_glass' && <span className="text-rose-300"> · break-glass</span>}
                          </span>
                          <span className="ml-auto font-mono text-[10.5px] text-fg3">{new Date(r.occurred_at).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px]">
                          <span className="text-fg3">
                            <Link2 className="mr-0.5 inline h-3 w-3" /> prev {short(r.prev_hash)}
                          </span>
                          <span className={ok ? 'text-emerald-300' : 'text-rose-300'}>
                            <Fingerprint className="mr-0.5 inline h-3 w-3" /> seal {short(r.row_hash)}
                          </span>
                          {!r.seal_ok && <span className="font-bold text-rose-300">contents no longer match the seal</span>}
                          {r.seal_ok && !r.link_ok && <span className="font-bold text-rose-300">link to previous row broken</span>}
                          {ok && <CheckCircle2 className="h-3 w-3 text-emerald-300" />}
                        </div>
                        <AnimatePresence>
                          {open === r.seq && (
                            <motion.pre
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-2 max-h-64 overflow-auto rounded-lg bg-ground/80 p-2.5 font-mono text-[10.5px] text-fg2"
                            >
                              {JSON.stringify(r.new_data ?? r.old_data, null, 2)}
                            </motion.pre>
                          )}
                        </AnimatePresence>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
