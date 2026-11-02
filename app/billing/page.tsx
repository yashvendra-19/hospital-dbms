'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { BedDouble, Clock, IndianRupee, Receipt, RefreshCw, Search, Stethoscope, Users, Wallet } from 'lucide-react';
import DischargeModal, { InpatientBillingItem } from '@/components/DischargeModal';
import { useToast } from '@/components/ToastContext';
import PageHeader, { GhostButton } from '@/components/PageHeader';
import MetricCard from '@/components/MetricCard';
import Segmented from '@/components/fx/Segmented';
import TriageBadge from '@/components/TriageBadge';
import DbLock from '@/components/DbLock';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function BillingTerminalContent() {
  const searchParams = useSearchParams();
  const preselectedAdmissionId = searchParams.get('admission_id');
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [activeInpatients, setActiveInpatients] = useState<InpatientBillingItem[]>([]);
  const [pastInvoices, setPastInvoices] = useState<any[]>([]);
  const [invoiceLock, setInvoiceLock] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'invoices'>('active');
  const [selectedInpatient, setSelectedInpatient] = useState<InpatientBillingItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadBillingData = async () => {
    setLoading(true);
    try {
      const [actRes, invRes] = await Promise.all([fetch('/api/billing/active'), fetch('/api/billing/invoices')]);
      const [actData, invData] = await Promise.all([actRes.json(), invRes.json()]);
      if (actData.success) {
        setActiveInpatients(actData.activeInpatients);
        if (preselectedAdmissionId) {
          const match = actData.activeInpatients.find(
            (item: InpatientBillingItem) => String(item.admission_id) === String(preselectedAdmissionId)
          );
          if (match) {
            setSelectedInpatient(match);
            setIsModalOpen(true);
          }
        }
      }
      if (invData.success) setPastInvoices(invData.invoices);
      setInvoiceLock(invRes.status === 403 ? invData : null);
    } catch (err: any) {
      toast({ type: 'error', title: 'Billing Load Error', message: err.message || 'Failed to fetch billing records.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBillingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedAdmissionId]);

  const q = searchQuery.trim().toLowerCase();
  const filteredInpatients = activeInpatients.filter(
    (i) =>
      !q ||
      i.patient_name.toLowerCase().includes(q) ||
      i.national_health_id.toLowerCase().includes(q) ||
      i.room_number.toLowerCase().includes(q) ||
      i.doctor_name.toLowerCase().includes(q)
  );
  const filteredInvoices = pastInvoices.filter(
    (inv) =>
      !q ||
      inv.patient_name.toLowerCase().includes(q) ||
      inv.national_health_id.toLowerCase().includes(q) ||
      String(inv.bill_id).includes(q)
  );

  const estTotal = activeInpatients.reduce((s, i) => s + Number(i.estimated_bed_charges || 0), 0);
  const netCollected = pastInvoices.reduce((s, i) => s + Number(i.net_patient_payable || 0), 0);
  const grossBilled = pastInvoices.reduce((s, i) => s + Number(i.gross_amount || 0), 0);
  const maxDays = Math.max(1, ...activeInpatients.map((i) => Number(i.billable_days) || 1));

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <DischargeModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        inpatient={selectedInpatient}
        onDischargeSuccess={() => loadBillingData()}
      />

      <PageHeader
        eyebrow="Clearance terminal"
        title="Discharge & Billing"
        accent={['Billing']}
        subtitle="Length-of-stay tracking, automatic tariff calculation, insurance deductions and an atomic discharge that releases the bed and writes the invoice in one commit."
        actions={
          <GhostButton onClick={loadBillingData} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Sync census
          </GhostButton>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard index={0} title="Active inpatients" value={loading ? null : activeInpatients.length} icon={Users} variant="rose" badge="In beds" />
        <MetricCard index={1} title="Accruing bed charges" value={loading ? null : estTotal} prefix="₹" icon={BedDouble} variant="amber" badge="Estimated" />
        <MetricCard index={2} title="Gross billed" value={loading ? null : grossBilled} prefix="₹" icon={IndianRupee} variant="violet" badge={`${pastInvoices.length} invoices`} />
        <MetricCard index={3} title="Net patient payable" value={loading ? null : netCollected} prefix="₹" icon={Wallet} variant="emerald" badge="After ins./disc." />
      </div>

      {invoiceLock && (
        <div className="mt-6">
          <DbLock
            compact
            what="Bills and invoices"
            error={`${invoiceLock.error} Doctors and nurses can see who is in a bed, but PostgreSQL will roll back any discharge that tries to INSERT a bill.`}
            role={invoiceLock.role}
            dbRole={invoiceLock.dbRole}
          />
        </div>
      )}

      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          id="billing-tab"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'active', label: <><Users className="h-3.5 w-3.5" /> Active inpatients ({activeInpatients.length})</>, glow: '251,113,133' },
            { value: 'invoices', label: <><Receipt className="h-3.5 w-3.5" /> Invoices ({pastInvoices.length})</>, glow: '148,116,255' },
          ]}
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3" />
          <input
            placeholder="Search patient, NHID, room…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="field !py-2 pl-9 text-xs"
          />
        </div>
      </div>

      <div className="mt-5">
        <AnimatePresence mode="wait">
          {activeTab === 'active' ? (
            <motion.div
              key="active"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ type: 'spring', stiffness: 200, damping: 26 }}
              className="space-y-3"
            >
              {filteredInpatients.length === 0 ? (
                <Empty text={loading ? 'Loading active census…' : 'No active inpatients found.'} />
              ) : (
                filteredInpatients.map((item, i) => (
                  <motion.div
                    key={item.admission_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, type: 'spring', stiffness: 160, damping: 20 }}
                    whileHover={{ scale: 1.005 }}
                    className="group relative overflow-hidden rounded-2xl border border-tint/[0.12] bg-ink-900/70 p-4 backdrop-blur-xl transition hover:border-rose-400/30 sm:p-5"
                  >
                    <div className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-rose-400 via-pink-500 to-plasma-500" />
                    <div className="grid grid-cols-2 items-center gap-4 lg:grid-cols-12">
                      <div className="col-span-2 lg:col-span-3">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-base font-bold text-fg">{item.patient_name}</span>
                        </div>
                        <div className="font-mono text-[10.5px] text-fg3">{item.national_health_id}</div>
                        {item.triage_priority ? <div className="mt-1.5"><TriageBadge priority={item.triage_priority} size="sm" /></div> : null}
                      </div>
                      <div className="lg:col-span-2">
                        <Lbl>Bed</Lbl>
                        <div className="font-mono text-sm font-semibold text-fg">
                          {item.room_number} · {item.bed_label}
                        </div>
                        <div className="truncate text-[11px] text-fg3">
                          {item.ward_type} · {item.dept_name}
                        </div>
                      </div>
                      <div className="lg:col-span-3">
                        <Lbl>Physician</Lbl>
                        <div className="flex items-center gap-1.5 text-sm text-fg">
                          <Stethoscope className="h-3.5 w-3.5 text-fg3" />
                          <span className="truncate">{item.doctor_name}</span>
                        </div>
                        <div className="truncate text-[11px] italic text-fg3">{item.admission_diagnosis ?? "Diagnosis hidden by column grant"}</div>
                      </div>
                      <div className="lg:col-span-2">
                        <Lbl>Length of stay</Lbl>
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-pulse-300" />
                          <span className="font-display text-sm font-bold text-fg">
                            {item.billable_days} {item.billable_days === 1 ? 'day' : 'days'}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-tint/[0.06]">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-pulse-400 to-plasma-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${(Number(item.billable_days) / maxDays) * 100}%` }}
                            transition={{ duration: 1.1, delay: 0.2 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                          />
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-fg3">
                          {item.actual_days_elapsed}d actual · {inr(item.daily_tariff)}/d
                        </div>
                      </div>
                      <div className="col-span-2 flex items-center justify-between gap-3 lg:col-span-2 lg:flex-col lg:items-end">
                        <div className="lg:text-right">
                          <Lbl>Est. bed charges</Lbl>
                          <div className="font-mono text-base font-bold text-amber-200">{inr(item.estimated_bed_charges)}</div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedInpatient(item);
                            setIsModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3.5 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/25"
                        >
                          <Receipt className="h-3.5 w-3.5" /> Discharge & bill
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          ) : (
            <motion.div
              key="invoices"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ type: 'spring', stiffness: 200, damping: 26 }}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {filteredInvoices.length === 0 ? (
                <div className="md:col-span-2">
                  <Empty text="No billing invoices recorded yet." />
                </div>
              ) : (
                filteredInvoices.map((inv, i) => {
                  const settled = inv.payment_status === 'Settled';
                  const unpaid = inv.payment_status === 'Unpaid';
                  const rgb = settled ? '52,211,153' : unpaid ? '251,113,133' : '251,191,36';
                  return (
                    <motion.div
                      key={inv.bill_id}
                      initial={{ opacity: 0, y: 20, rotateX: 18 }}
                      animate={{ opacity: 1, y: 0, rotateX: 0 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 140, damping: 18 }}
                      style={{ transformPerspective: 1000 }}
                      whileHover={{ y: -4 }}
                      className="relative overflow-hidden rounded-2xl border border-tint/[0.13] bg-ink-900/70 backdrop-blur-xl"
                    >
                      <div className="h-1 bg-gradient-to-r from-pulse-400 via-plasma-500 to-pink-500" />
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-xs font-bold text-pulse-300">INVOICE #{inv.bill_id}</div>
                            <div className="mt-1 font-display text-base font-bold text-fg">{inv.patient_name}</div>
                            <div className="font-mono text-[10.5px] text-fg3">{inv.national_health_id}</div>
                          </div>
                          <span
                            className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                            style={{ color: `rgb(${rgb})`, borderColor: `rgba(${rgb},0.35)`, background: `rgba(${rgb},0.1)` }}
                          >
                            {inv.payment_status}
                          </span>
                        </div>
                        <div className="mt-3 text-[11.5px] text-fg2">
                          {inv.room_number} ({inv.bed_label}) · {inv.ward_type} · {inv.dept_name}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
                          <Cell k="Bed" v={inr(inv.bed_charges)} />
                          <Cell k="Gross" v={inr(inv.gross_amount)} />
                          <Cell
                            k="Ins / Disc"
                            v={
                              Number(inv.insurance_claim_approved) === 0 && Number(inv.discount_percentage) === 0
                                ? 'None'
                                : `${inr(inv.insurance_claim_approved)} · ${Number(inv.discount_percentage)}%`
                            }
                          />
                        </div>
                        {(inv.estimate_outcome || inv.seal_seq) && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {inv.estimate_outcome && (
                              <span
                                className={`chip ${
                                  inv.estimate_outcome === 'Within range'
                                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                                    : inv.estimate_outcome === 'Above range'
                                      ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
                                      : 'border-sky-400/30 bg-sky-500/10 text-sky-300'
                                }`}
                                title={`${inv.estimate_code}: ${inr(inv.est_low_inr)} – ${inr(inv.est_high_inr)}`}
                              >
                                {inv.estimate_code} · {inv.estimate_outcome}
                              </span>
                            )}
                            {inv.seal_seq && (
                              <span className="chip border-plasma-400/30 bg-plasma-500/10 font-mono text-plasma-400" title={inv.seal_hash}>
                                seal #{inv.seal_seq} · {String(inv.seal_hash).slice(0, 10)}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="mt-4 flex items-end justify-between border-t border-dashed border-tint/[0.14] pt-3">
                          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg3">Net payable</span>
                          <span className="font-display text-2xl font-bold text-emerald-300">
                            {inr(inv.net_patient_payable)}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-fg3">{children}</div>;
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-tint/[0.11] bg-tint/[0.02] p-2">
      <div className="text-[9.5px] uppercase tracking-wider text-fg3">{k}</div>
      <div className="mt-0.5 truncate text-fg">{v}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-tint/[0.14] bg-tint/[0.02] p-12 text-center text-sm text-fg3">{text}</div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-fg3">Loading billing terminal…</div>}>
      <BillingTerminalContent />
    </Suspense>
  );
}
