'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BedDouble, Calendar, CheckCircle2, Minus, Plus, Printer, Receipt, Stethoscope } from 'lucide-react';
import { useToast } from './ToastContext';
import Modal from './fx/Modal';
import Segmented from './fx/Segmented';
import CountUp from './fx/CountUp';

export interface InpatientBillingItem {
  admission_id: number;
  patient_id: number;
  national_health_id: string;
  patient_name: string;
  room_number: string;
  bed_label: string;
  ward_type: string;
  daily_tariff: number;
  dept_name: string;
  doctor_name: string;
  admission_time: string;
  billable_days: number;
  actual_days_elapsed: number;
  estimated_bed_charges: number;
  admission_diagnosis: string | null;
  triage_priority?: number;
  estimate_code?: string | null;
  est_low_inr?: number | string | null;
  est_typical_inr?: number | string | null;
  est_high_inr?: number | string | null;
  estimate_condition?: string | null;
  estimate_explained_to?: string | null;
}

interface DischargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  inpatient: InpatientBillingItem | null;
  onDischargeSuccess: (invoice: any) => void;
}

const inr = (n: number, d = 2) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export default function DischargeModal({ isOpen, onClose, inpatient, onDischargeSuccess }: DischargeModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [bedCharges, setBedCharges] = useState(0);
  const [procedureCharges, setProcedureCharges] = useState(0);
  const [pharmacyCharges, setPharmacyCharges] = useState(0);
  const [insuranceApproved, setInsuranceApproved] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState('Settled');
  const [nextBedStatus, setNextBedStatus] = useState('Available');
  const [completedInvoice, setCompletedInvoice] = useState<any | null>(null);

  useEffect(() => {
    if (inpatient) {
      const billDays = inpatient.billable_days || 1;
      setDays(billDays);
      setBedCharges(billDays * Number(inpatient.daily_tariff));
      setProcedureCharges(1500);
      setPharmacyCharges(750);
      setInsuranceApproved(0);
      setDiscountPercent(0);
      setPaymentStatus('Settled');
      setNextBedStatus('Available');
      setCompletedInvoice(null);
      setError(null);
    }
  }, [inpatient]);

  if (!inpatient) return null;

  const grossAmount = bedCharges + procedureCharges + pharmacyCharges;
  const discountAmount = grossAmount * (discountPercent / 100);
  const netPayable = Math.max(0, grossAmount - insuranceApproved - discountAmount);
  const insuranceOver = insuranceApproved > grossAmount;

  const changeDays = (n: number) => {
    const val = Math.max(1, n);
    setDays(val);
    setBedCharges(val * Number(inpatient.daily_tariff));
  };

  const handleDischargeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (insuranceOver) throw new Error('Insurance claim cannot exceed gross hospital billing.');
      const res = await fetch('/api/billing/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admission_id: inpatient.admission_id,
          bed_charges: bedCharges,
          clinical_procedure_charges: procedureCharges,
          pharmacy_charges: pharmacyCharges,
          insurance_claim_approved: insuranceApproved,
          discount_percentage: discountPercent,
          payment_status: paymentStatus,
          next_bed_status: nextBedStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to discharge patient');
      toast({
        type: 'success',
        title: 'Discharge Finalized',
        message: `${inpatient.patient_name} discharged. Bill #${data.invoice.bill_id} generated. Bed ${inpatient.room_number} (${inpatient.bed_label}) set to ${nextBedStatus}.`,
      });
      setCompletedInvoice(data.invoice);
      onDischargeSuccess(data.invoice);
    } catch (err: any) {
      setError(err.message || 'Error executing discharge');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-4xl" glow={completedInvoice ? '52,211,153' : '251,113,133'}>
      <div style={{ perspective: 1600 }}>
        <AnimatePresence mode="wait" initial={false}>
          {!completedInvoice ? (
            <motion.div
              key="form"
              exit={{ rotateY: -90, opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="flex items-center gap-3 pb-5 pr-8">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-rose-400/40 bg-rose-500/15 text-rose-300">
                  <Receipt className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-fg">Discharge & billing terminal</h3>
                  <p className="font-mono text-[11px] text-fg3">
                    admission #{inpatient.admission_id} · atomic transaction (UPDATE admissions · UPDATE wards_beds · INSERT billing)
                  </p>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto', x: [0, -8, 8, -4, 0] }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 overflow-hidden rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200"
                  >
                    <span className="font-semibold">Discharge failed: </span>
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleDischargeSubmit} className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                {/* LEFT: inputs */}
                <div className="space-y-4 lg:col-span-3">
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-tint/[0.12] bg-tint/[0.02] p-4 text-xs sm:grid-cols-3">
                    <Info label="Patient" value={inpatient.patient_name} sub={inpatient.national_health_id} mono />
                    <Info
                      label="Bed"
                      value={`${inpatient.room_number} · ${inpatient.bed_label}`}
                      sub={`${inpatient.ward_type} · ${inpatient.dept_name}`}
                      icon={<BedDouble className="h-3 w-3" />}
                    />
                    <Info
                      label="Physician"
                      value={inpatient.doctor_name}
                      sub={inpatient.admission_diagnosis ?? "Diagnosis hidden: no column grant for billing"}
                      icon={<Stethoscope className="h-3 w-3" />}
                    />
                  </div>

                  <div className="rounded-xl border border-pulse-400/20 bg-pulse-400/[0.04] p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-semibold text-pulse-200">
                        <Calendar className="h-4 w-4" /> Length of stay
                      </span>
                      <span className="font-mono text-[11px] text-fg2">
                        {inr(inpatient.daily_tariff, 0)}/day · actual {inpatient.actual_days_elapsed}d
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => changeDays(days - 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-tint/[0.14] bg-tint/5 text-fg2 transition hover:bg-tint/10"
                        aria-label="Fewer days"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={days}
                        onChange={(e) => changeDays(parseInt(e.target.value, 10) || 1)}
                        className="field w-20 text-center font-display text-lg font-bold"
                        aria-label="Billable days"
                      />
                      <button
                        type="button"
                        onClick={() => changeDays(days + 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-tint/[0.14] bg-tint/5 text-fg2 transition hover:bg-tint/10"
                        aria-label="More days"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <span className="ml-auto text-right">
                        <span className="block font-mono text-[10px] uppercase tracking-wider text-fg3">bed charges</span>
                        <CountUp value={bedCharges} decimals={2} prefix="₹" className="font-mono text-sm font-bold text-fg" />
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MoneyInput label="Procedure charges" hint="Diagnostics, surgery, nursing" value={procedureCharges} onChange={setProcedureCharges} />
                    <MoneyInput label="Pharmacy charges" hint="Medications, IV fluids" value={pharmacyCharges} onChange={setPharmacyCharges} />
                    <MoneyInput
                      label="Insurance approved"
                      hint={`Max ${inr(grossAmount, 0)} · chk_insurance_limit`}
                      value={insuranceApproved}
                      onChange={setInsuranceApproved}
                      danger={insuranceOver}
                    />
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="label">Discount</label>
                        <span className="mb-1.5 font-mono text-xs font-bold text-amber-300">{discountPercent}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(parseInt(e.target.value, 10) || 0)}
                        className="neon mt-3 w-full"
                        style={{ ['--p' as any]: `${(discountPercent / 50) * 100}%`, ['--c1' as any]: '#fbbf24' }}
                        aria-label="Discount percentage"
                      />
                      <span className="mt-2 block text-[10px] text-fg3">0–50% · chk_discount</span>
                    </div>
                  </div>

                  <div>
                    <label className="label">Payment status</label>
                    <Segmented
                      id="pay"
                      size="sm"
                      value={paymentStatus}
                      onChange={setPaymentStatus}
                      options={[
                        { value: 'Settled', label: 'Settled', glow: '52,211,153' },
                        { value: 'Unpaid', label: 'Unpaid', glow: '251,113,133' },
                        { value: 'Partially-Paid', label: 'Partial', glow: '251,191,36' },
                        { value: 'Insurance-Pending', label: 'Insurance pending', glow: '96,165,250' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="label">Release bed as</label>
                    <Segmented
                      id="nextbed"
                      size="sm"
                      value={nextBedStatus}
                      onChange={setNextBedStatus}
                      options={[
                        { value: 'Available', label: 'Available', glow: '52,211,153' },
                        { value: 'Sanitizing', label: 'Send for sanitizing', glow: '251,191,36' },
                      ]}
                    />
                  </div>
                </div>

                {/* RIGHT: live receipt */}
                <div className="lg:col-span-2">
                  <div className="sticky top-0 overflow-hidden rounded-2xl border border-tint/[0.14] bg-gradient-to-b from-tint/[0.06] to-tint/[0.01] p-5">
                    <div
                      aria-hidden
                      className="absolute inset-0 opacity-30"
                      style={{ background: 'radial-gradient(circle at 80% 0%, rgba(148,116,255,0.35), transparent 50%)' }}
                    />
                    <div className="relative">
                      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg2">Live invoice preview</div>
                      <div className="mt-4 space-y-2 text-xs">
                        <Row label="Bed" value={bedCharges} />
                        <Row label="Procedures" value={procedureCharges} />
                        <Row label="Pharmacy" value={pharmacyCharges} />
                        <div className="my-2 border-t border-dashed border-tint/[0.14]" />
                        <Row label="Gross amount" value={grossAmount} strong />
                        <AnimatePresence>
                          {discountAmount > 0 && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                              <Row label={`Discount ${discountPercent}%`} value={-discountAmount} tone="text-amber-300" />
                            </motion.div>
                          )}
                          {insuranceApproved > 0 && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                              <Row label="Insurance" value={-insuranceApproved} tone="text-emerald-300" />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {inpatient.estimate_code && (
                        <EstimateCompare
                          code={inpatient.estimate_code}
                          low={Number(inpatient.est_low_inr)}
                          high={Number(inpatient.est_high_inr)}
                          actual={grossAmount}
                          condition={inpatient.estimate_condition}
                          to={inpatient.estimate_explained_to}
                        />
                      )}
                      <div className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300/80">Net patient payable</div>
                        <CountUp
                          value={netPayable}
                          decimals={2}
                          prefix="₹"
                          className="mt-1 block font-display text-3xl font-bold text-emerald-300"
                        />
                        <div className="mt-1 font-mono text-[10px] text-fg3">GENERATED ALWAYS AS (…) STORED</div>
                      </div>
                      <button
                        type="submit"
                        disabled={loading || insuranceOver}
                        className="mt-5 w-full rounded-xl bg-rose-500 py-3 text-sm font-bold text-white hover:bg-rose-600 transition hover:brightness-110 disabled:opacity-50"
                      >
                        {loading ? 'Committing transaction…' : 'Confirm discharge & bill'}
                      </button>
                      <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl py-2 text-xs text-fg2 transition hover:text-fg">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="receipt"
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 120, damping: 16 }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="py-2 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.25 }}
                  className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                >
                  <CheckCircle2 className="h-8 w-8" />
                </motion.div>
                <h3 className="font-display text-2xl font-bold text-fg">Discharge clearance finalized</h3>
                <p className="text-xs text-fg2">Committed to hospital_db · bill #{completedInvoice.bill_id}</p>
              </div>

              <div className="print-area mx-auto mt-5 max-w-xl overflow-hidden rounded-2xl border border-tint/[0.14] bg-tint/[0.03] font-sans">
                <div className="h-1 bg-gradient-to-r from-pulse-400 via-plasma-500 to-pink-500" />
                <div className="p-5">
                  <div className="flex justify-between border-b border-tint/[0.14] pb-3 text-xs">
                    <div>
                      <p className="font-display text-sm font-bold text-fg">CENTRALIZED HOSPITAL NETWORK</p>
                      <p className="text-fg3">Emergency & Critical Inpatient Care</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-bold text-pulse-300">INVOICE #{completedInvoice.bill_id}</p>
                      <p className="text-fg3">{new Date().toLocaleDateString('en-IN')}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-b border-tint/[0.14] py-3 text-xs">
                    <div>
                      <p className="text-fg3">Patient</p>
                      <p className="font-semibold text-fg">{completedInvoice.patient_name}</p>
                      <p className="font-mono text-fg2">{completedInvoice.national_health_id}</p>
                    </div>
                    <div>
                      <p className="text-fg3">Stay & physician</p>
                      <p className="font-semibold text-fg">
                        {completedInvoice.room_number} ({completedInvoice.bed_label}) · {completedInvoice.ward_type}
                      </p>
                      <p className="text-fg2">{completedInvoice.doctor_name}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 py-3 text-xs">
                    {[
                      ['Bed charges', completedInvoice.bed_charges],
                      ['Clinical procedures', completedInvoice.clinical_procedure_charges],
                      ['Pharmacy', completedInvoice.pharmacy_charges],
                    ].map(([l, v], i) => (
                      <motion.div
                        key={l as string}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.35 + i * 0.08 }}
                        className="flex justify-between text-fg2"
                      >
                        <span>{l}</span>
                        <span className="font-mono">{inr(Number(v))}</span>
                      </motion.div>
                    ))}
                    <div className="flex justify-between border-t border-tint/[0.14] pt-1.5 font-semibold text-fg">
                      <span>Gross hospital bill</span>
                      <span className="font-mono">{inr(completedInvoice.gross_amount)}</span>
                    </div>
                    {Number(completedInvoice.discount_percentage) > 0 && (
                      <div className="flex justify-between text-amber-300">
                        <span>Discount ({completedInvoice.discount_percentage}%)</span>
                        <span className="font-mono">
                          − {inr(Number(completedInvoice.gross_amount) * (Number(completedInvoice.discount_percentage) / 100))}
                        </span>
                      </div>
                    )}
                    {Number(completedInvoice.insurance_claim_approved) > 0 && (
                      <div className="flex justify-between text-emerald-300">
                        <span>Insurance approved</span>
                        <span className="font-mono">− {inr(completedInvoice.insurance_claim_approved)}</span>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between border-t border-tint/[0.14] pt-2">
                      <span className="text-sm font-bold text-fg">Net patient payable</span>
                      <CountUp
                        value={Number(completedInvoice.net_patient_payable)}
                        decimals={2}
                        prefix="₹"
                        className="font-display text-xl font-bold text-emerald-300"
                      />
                    </div>
                  </div>
                  {completedInvoice.estimate && (
                    <EstimateCompare
                      code={completedInvoice.estimate.estimate_code}
                      low={Number(completedInvoice.estimate.est_low_inr)}
                      high={Number(completedInvoice.estimate.est_high_inr)}
                      actual={Number(completedInvoice.gross_amount)}
                    />
                  )}
                  {completedInvoice.seal_hash && (
                    <div className="rounded-lg border border-plasma-400/25 bg-plasma-500/[0.06] p-2.5 text-[11px] text-fg2">
                      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-plasma-400">Audit seal (SHA-256 chain)</div>
                      <div className="mt-0.5 font-mono text-fg">
                        #{completedInvoice.seal_seq} · {String(completedInvoice.seal_hash).slice(0, 16)}…
                      </div>
                      <div className="text-[10px] text-fg3">Anyone can check this seal on the Integrity Ledger page. Editing the bill later breaks it.</div>
                    </div>
                  )}
                  <div className="rounded-lg bg-tint/[0.04] p-2 text-center text-xs text-fg2">
                    Status: <span className="font-semibold text-emerald-300">{completedInvoice.payment_status}</span>
                    {completedInvoice.settled_at && ` · settled ${new Date(completedInvoice.settled_at).toLocaleTimeString()}`}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-center gap-3">
                {!(typeof window !== 'undefined' && (window as any).__MEDIRESOURCE_DEMO__) && (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-tint/20 px-4 py-2.5 text-xs font-semibold text-fg transition hover:bg-tint/5"
                >
                  <Printer className="h-4 w-4" /> Print receipt
                </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl bg-pulse-400 px-5 py-2.5 text-xs font-bold text-[#04121a] hover:bg-pulse-300 transition hover:brightness-110"
                >
                  Close terminal
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}

function Info({ label, value, sub, mono, icon }: { label: string; value: string; sub?: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg3">
        {icon}
        {label}
      </span>
      <span className="mt-0.5 block truncate text-sm font-semibold text-fg">{value}</span>
      {sub && <span className={`block truncate text-[11px] text-fg3 ${mono ? 'font-mono' : 'italic'}`}>{sub}</span>}
    </div>
  );
}

function MoneyInput({
  label,
  hint,
  value,
  onChange,
  danger,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  danger?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-fg3">₹</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`field pl-7 font-mono ${danger ? '!border-rose-500/70 !' : ''}`}
        />
      </div>
      <span className={`mt-1 block text-[10px] ${danger ? 'text-rose-300' : 'text-fg3'}`}>{hint}</span>
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between ${tone ?? (strong ? 'font-semibold text-fg' : 'text-fg2')}`}>
      <span>{label}</span>
      <span className="font-mono">
        {value < 0 ? '− ' : ''}
        {inr(Math.abs(value))}
      </span>
    </div>
  );
}


/** Final bill against the range the family was given at admission. */
function EstimateCompare({ code, low, high, actual, condition, to }: { code: string; low: number; high: number; actual: number; condition?: string | null; to?: string | null }) {
  const within = actual >= low && actual <= high;
  const tone = within ? 'emerald' : actual > high ? 'rose' : 'sky';
  const max = Math.max(high * 1.25, actual * 1.05, 1);
  return (
    <div className={`mt-4 rounded-xl border p-3 text-[11px] ${within ? 'border-emerald-400/25 bg-emerald-400/[0.05]' : tone === 'rose' ? 'border-rose-400/30 bg-rose-500/[0.06]' : 'border-sky-400/30 bg-sky-500/[0.06]'}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fg3">Estimate {code}</span>
        <span className={`font-semibold ${within ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-sky-300'}`}>
          {within ? 'Within the range given' : actual > high ? 'Above the range given' : 'Below the range given'}
        </span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-tint/[0.08]">
        <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-pulse-400/70 to-plasma-500/70" style={{ left: `${(low / max) * 100}%`, width: `${((high - low) / max) * 100}%` }} />
        <div className="absolute -top-1 h-4 w-1 rounded bg-white" style={{ left: `${Math.min(99, (actual / max) * 100)}%` }} />
      </div>
      <div className="mt-1.5 text-fg2">
        ₹{low.toLocaleString('en-IN')} – ₹{high.toLocaleString('en-IN')} promised{condition ? ` for ${condition}` : ''}
        {to ? `, explained to ${to}` : ''}. Bill now ₹{Math.round(actual).toLocaleString('en-IN')}.
      </div>
    </div>
  );
}
