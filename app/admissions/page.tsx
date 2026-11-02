'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CostEstimatePanel, { EMPTY_ESTIMATE, EstimateChoice, severityFromEsi } from '@/components/CostEstimatePanel';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BedDouble,
  Check,
  ChevronDown,
  Clock,
  FlaskConical,
  HeartPulse,
  Search,
  ShieldAlert,
  Stethoscope,
  UserPlus,
  Wind,
} from 'lucide-react';
import { useToast } from '@/components/ToastContext';
import TriageBadge, { TRIAGE_CONFIG, triage } from '@/components/TriageBadge';
import QuickPatientModal from '@/components/QuickPatientModal';
import ClinicalAlertDialog from '@/components/ClinicalAlertDialog';
import PageHeader from '@/components/PageHeader';
import EcgLine from '@/components/fx/EcgLine';
import MovingBorder from '@/components/fx/MovingBorder';
import SpotlightCard from '@/components/fx/SpotlightCard';
import { STATUS_RGB } from '@/components/BedCard';

function AdmissionsContent() {
  const searchParams = useSearchParams();
  const preselectedBedId = searchParams.get('bed_id');
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [recentAdmissions, setRecentAdmissions] = useState<any[]>([]);
  const [showAllBedsForTesting, setShowAllBedsForTesting] = useState(false);
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [estimate, setEstimate] = useState<EstimateChoice>(EMPTY_ESTIMATE);
  const [severityTouched, setSeverityTouched] = useState(false);

  const [formData, setFormData] = useState({
    patient_id: '',
    bed_id: preselectedBedId || '',
    admitting_doctor_id: '',
    triage_priority: 3,
    admission_diagnosis: '',
  });

  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    details?: any;
    severity?: 'error' | 'warning' | 'success';
  }>({ isOpen: false, title: '', message: '' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [patRes, docRes, bedRes, admRes] = await Promise.all([
        fetch('/api/patients'),
        fetch('/api/doctors?on_duty=true'),
        fetch('/api/beds'),
        fetch('/api/admissions'),
      ]);
      const [patData, docData, bedData, admData] = await Promise.all([patRes.json(), docRes.json(), bedRes.json(), admRes.json()]);
      if (patData.success) setPatients(patData.patients);
      if (docData.success) setDoctors(docData.doctors);
      if (bedData.success) setBeds(bedData.beds);
      if (admData.success) setRecentAdmissions(admData.admissions);
      if (docData.doctors && docData.doctors.length > 0) {
        setFormData((prev) => (prev.admitting_doctor_id ? prev : { ...prev, admitting_doctor_id: String(docData.doctors[0].doctor_id) }));
      }
    } catch (err: any) {
      toast({ type: 'error', title: 'Failed to load reference clinical data', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (preselectedBedId) setFormData((prev) => ({ ...prev, bed_id: preselectedBedId }));
  }, [preselectedBedId]);

  const availableBeds = beds.filter((b) => b.operational_status === 'Available');
  const displayedBeds = showAllBedsForTesting ? beds : availableBeds;
  const activeInpatients = recentAdmissions.filter((a) => a.admission_status === 'Admitted');

  const handleAdmissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.patient_id) return toast({ type: 'error', title: 'Patient Required', message: 'Please select a patient to admit.' });
    if (!formData.bed_id) return toast({ type: 'error', title: 'Bed Required', message: 'Please select a bed for admission.' });
    if (!formData.admitting_doctor_id)
      return toast({ type: 'error', title: 'Doctor Required', message: 'Please assign an admitting physician.' });
    if (!formData.admission_diagnosis.trim())
      return toast({ type: 'error', title: 'Diagnosis Required', message: 'Please enter clinical admission diagnosis.' });

    setSubmitting(true);
    try {
      const res = await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: parseInt(formData.patient_id, 10),
          bed_id: parseInt(formData.bed_id, 10),
          admitting_doctor_id: parseInt(formData.admitting_doctor_id, 10),
          triage_priority: formData.triage_priority,
          admission_diagnosis: formData.admission_diagnosis.trim(),
          ...(estimate.condition_id
            ? {
                condition_id: parseInt(estimate.condition_id, 10),
                apr_severity: estimate.severity,
                estimate: {
                  scheme_code: estimate.scheme_code,
                  cover_remaining: estimate.cover_remaining,
                  explained_to: estimate.explained_to,
                  relation: estimate.relation,
                },
              }
            : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const errDetails = data.details || {};
        const isDoubleBooking =
          errDetails.constraintName === 'ex_no_double_bed_booking' ||
          errDetails.constraintName === 'ex_bed_held_for_ambulance' ||
          errDetails.code === '23P01' ||
          data.code === 'PATIENT_ALREADY_ADMITTED';
        toast({
          type: 'error',
          title: isDoubleBooking ? 'Exclusion Constraint Violated' : 'Admission Denied',
          message: data.error || 'The PostgreSQL database rejected this bed admission.',
          duration: 7000,
        });
        setAlertDialog({
          isOpen: true,
          title: data.code === 'DB_FORBIDDEN'
            ? `Blocked by PostgreSQL for the ${data.role} role (${data.dbRole})`
            : errDetails.constraintName === 'ex_bed_held_for_ambulance'
            ? 'Bed held for an incoming ambulance [trg_admission_hold_guard]'
            : isDoubleBooking
            ? 'PostgreSQL Exclusion Constraint Violation [ex_no_double_bed_booking]'
            : 'Admission Database Conflict',
          message:
            data.error || 'PostgreSQL constraint ex_no_double_bed_booking caught an overlapping occupancy on this physical bed.',
          details: errDetails,
          severity: 'error',
        });
        return;
      }

      toast({
        type: 'success',
        title: 'Patient Successfully Admitted',
        message: `${data.admission.patient_name} admitted to Room ${data.admission.room_number} (${data.admission.bed_label}) under ${data.admission.doctor_name}.${
          data.estimate ? ` Estimate ${data.estimate.estimate_code} saved: ₹${Number(data.estimate.est_low_inr).toLocaleString('en-IN')}–₹${Number(data.estimate.est_high_inr).toLocaleString('en-IN')}.` : ''
        }`,
      });
      setEstimate(EMPTY_ESTIMATE);
      setSeverityTouched(false);
      setCelebrate((c) => c + 1);
      setFormData({
        patient_id: '',
        bed_id: '',
        admitting_doctor_id: doctors[0] ? String(doctors[0].doctor_id) : '',
        triage_priority: 3,
        admission_diagnosis: '',
      });
      loadData();
    } catch (err: any) {
      toast({ type: 'error', title: 'Network / Server Error', message: err.message || 'Failed to submit admission request.' });
    } finally {
      setSubmitting(false);
    }
  };

  const t = triage(formData.triage_priority);
  const steps = [
    !!formData.patient_id,
    !!formData.admitting_doctor_id,
    !!formData.bed_id,
    true,
    !!formData.admission_diagnosis.trim(),
  ];
  const progress = steps.filter(Boolean).length / steps.length;
  const selectedBed = beds.find((b) => String(b.bed_id) === String(formData.bed_id));
  const selectedPatient = patients.find((p) => String(p.patient_id) === String(formData.patient_id));
  const selectedPatientIsChild = selectedPatient
    ? new Date(selectedPatient.dob) > new Date(new Date().setFullYear(new Date().getFullYear() - 18))
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <QuickPatientModal
        isOpen={isPatientModalOpen}
        onClose={() => setIsPatientModalOpen(false)}
        onPatientCreated={(newPat) => {
          setPatients((prev) => [newPat, ...prev]);
          setFormData((prev) => ({ ...prev, patient_id: String(newPat.patient_id) }));
        }}
      />
      <ClinicalAlertDialog
        isOpen={alertDialog.isOpen}
        onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
        title={alertDialog.title}
        message={alertDialog.message}
        details={alertDialog.details}
        severity={alertDialog.severity}
      />

      <PageHeader
        eyebrow="Trauma intake active"
        title="Emergency Admission Desk"
        accent={['Admission']}
        subtitle="Triage the patient, assign an on-duty physician and lock a physical bed — inside one atomic PostgreSQL transaction guarded by a GiST exclusion constraint."
        actions={
          <label className="group flex cursor-pointer items-center gap-3 rounded-xl border border-tint/[0.14] bg-tint/[0.03] px-3.5 py-2.5 transition hover:border-rose-400/30">
            <span className="relative inline-flex h-5 w-9 items-center">
              <input
                type="checkbox"
                checked={showAllBedsForTesting}
                onChange={(e) => setShowAllBedsForTesting(e.target.checked)}
                className="peer sr-only"
              />
              <span className="absolute inset-0 rounded-full bg-tint/10 transition peer-checked:bg-rose-500/60" />
              <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="text-xs">
              <span className="flex items-center gap-1 font-semibold text-fg">
                <FlaskConical className="h-3.5 w-3.5 text-rose-300" /> Conflict test mode
              </span>
              <span className="block font-mono text-[10px] text-fg3">show occupied beds</span>
            </span>
          </label>
        }
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* FORM */}
        <div className="lg:col-span-7">
          <SpotlightCard innerClassName="p-5 sm:p-7">
            <form onSubmit={handleAdmissionSubmit} className="relative">
              {/* vertical progress rail */}
              <div className="absolute bottom-24 left-[15px] top-4 hidden w-px bg-tint/[0.07] sm:block">
                <motion.div
                  className="w-full bg-gradient-to-b from-pulse-300 via-plasma-400 to-pink-400"
                  animate={{ height: `${progress * 100}%` }}
                  transition={{ type: 'spring', stiffness: 80, damping: 18 }}
                />
              </div>

              <Step n={1} done={steps[0]} title="Patient" right={
                <button
                  type="button"
                  onClick={() => setIsPatientModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-plasma-400/30 bg-plasma-500/10 px-2.5 py-1 text-[11px] font-semibold text-plasma-400 transition hover:bg-plasma-500/20"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Quick-register
                </button>
              }>
                <PatientPicker
                  patients={patients}
                  value={formData.patient_id}
                  onChange={(v) => setFormData({ ...formData, patient_id: v })}
                  loading={loading}
                />
              </Step>

              <Step n={2} done={steps[1]} title="Admitting physician" right={<span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300">{doctors.length} on duty</span>}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {doctors.map((doc) => {
                    const active = String(doc.doctor_id) === String(formData.admitting_doctor_id);
                    return (
                      <motion.button
                        key={doc.doctor_id}
                        type="button"
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setFormData({ ...formData, admitting_doctor_id: String(doc.doctor_id) })}
                        className={`relative flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                          active ? 'border-pulse-400/50' : 'border-tint/[0.12] hover:border-tint/20'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="doc-active"
                            className="absolute inset-0 rounded-xl bg-gradient-to-r from-pulse-400/15 to-plasma-500/10"
                          />
                        )}
                        <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-tint/5 text-pulse-300">
                          <Stethoscope className="h-4 w-4" />
                        </span>
                        <span className="relative min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-fg">{doc.full_name}</span>
                          <span className="block truncate text-[11px] text-fg2">
                            {doc.specialization} · ₹{Number(doc.consultation_fee).toLocaleString('en-IN')}
                          </span>
                        </span>
                        {active && <Check className="relative ml-auto h-4 w-4 flex-shrink-0 text-pulse-300" />}
                      </motion.button>
                    );
                  })}
                </div>
              </Step>

              <Step n={3} done={steps[2]} title="Allocate bed" right={<span className="font-mono text-[11px] text-pulse-300">{availableBeds.length} available</span>}>
                <motion.div layout className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <AnimatePresence mode="popLayout">
                    {displayedBeds.map((bed) => {
                      const active = String(bed.bed_id) === String(formData.bed_id);
                      const occupied = bed.operational_status !== 'Available';
                      const rgb = STATUS_RGB[bed.operational_status] ?? '148,163,184';
                      return (
                        <motion.button
                          layout
                          key={bed.bed_id}
                          type="button"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          whileHover={{ y: -3 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => setFormData({ ...formData, bed_id: String(bed.bed_id) })}
                          className={`relative overflow-hidden rounded-xl border p-2.5 text-left transition ${occupied ? 'conflict-stripes animate-stripes' : ''}`}
                          style={{
                            borderColor: active ? `rgba(${rgb},0.8)` : `rgba(${rgb},0.22)`,
                            background: active ? `rgba(${rgb},0.14)` : undefined,
                            boxShadow: active ? `0 0 0 1px rgba(${rgb},0.5)` : undefined,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-display text-sm font-bold text-fg">{bed.room_number}</span>
                            <span className="h-2 w-2 rounded-full" style={{ background: `rgb(${rgb})`, boxShadow: `0 0 8px rgb(${rgb})` }} />
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-fg2">
                            {bed.bed_label} · {bed.ward_type}
                            {bed.has_ventilator && <Wind className="h-3 w-3 text-plasma-400" />}
                          </div>
                          <div className="mt-1 font-mono text-[10.5px] text-fg3">
                            ₹{Number(bed.daily_tariff).toLocaleString('en-IN')}/d
                          </div>
                          {occupied && (
                            <div className="mt-1 font-mono text-[9.5px] font-bold uppercase text-rose-300">{bed.operational_status} · will conflict</div>
                          )}
                        </motion.button>
                      );
                    })}
                  </AnimatePresence>
                </motion.div>
                <AnimatePresence>
                  {showAllBedsForTesting && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 overflow-hidden rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2.5 text-[11px] text-amber-200"
                    >
                      Conflict test active — pick an <b>occupied</b> bed and PostgreSQL will reject the INSERT via{' '}
                      <code className="font-mono font-bold">ex_no_double_bed_booking</code> (SQLSTATE 23P01).
                    </motion.p>
                  )}
                </AnimatePresence>
              </Step>

              <Step n={4} done title="Emergency Severity Index" right={<TriageBadge priority={formData.triage_priority} size="sm" />}>
                <div className="grid grid-cols-5 gap-2">
                  {(Object.keys(TRIAGE_CONFIG) as unknown as Array<keyof typeof TRIAGE_CONFIG>).map((lvl) => {
                    const cfg = TRIAGE_CONFIG[lvl];
                    const active = Number(lvl) === formData.triage_priority;
                    const Icon = cfg.Icon;
                    return (
                      <motion.button
                        key={lvl}
                        type="button"
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={() => {
                          setFormData({ ...formData, triage_priority: Number(lvl) });
                          if (!severityTouched) setEstimate((est) => ({ ...est, severity: severityFromEsi(Number(lvl)) }));
                        }}
                        className="relative flex flex-col items-center gap-1.5 rounded-xl border border-tint/[0.12] py-3"
                        style={active ? { borderColor: `rgba(${cfg.rgb},0.7)` } : undefined}
                      >
                        {active && (
                          <motion.span
                            layoutId="esi"
                            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                            className="absolute inset-0 rounded-xl"
                            style={{ background: `rgba(${cfg.rgb},0.15)`, boxShadow: `0 0 0 1px rgba(${cfg.rgb},0.45)` }}
                          />
                        )}
                        <span
                          className="relative flex h-9 w-9 items-center justify-center rounded-full"
                          style={{
                            background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.5), rgba(${cfg.rgb},0.9) 45%, rgba(${cfg.rgb},0.35))`,
                            boxShadow: active ? `0 0 22px rgba(${cfg.rgb},1)` : `0 0 10px rgba(${cfg.rgb},0.4)`,
                          }}
                        >
                          <Icon className="h-4 w-4 text-black/75" />
                        </span>
                        <span className="relative font-display text-sm font-bold text-fg">{lvl}</span>
                        <span className="relative hidden text-[10px] text-fg2 sm:block">{cfg.name}</span>
                      </motion.button>
                    );
                  })}
                </div>
                <motion.p
                  key={formData.triage_priority}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2.5 text-xs text-fg2"
                >
                  <span className="font-semibold" style={{ color: t.hex }}>{t.label}</span> — {t.description}
                </motion.p>
              </Step>

              <Step n={5} done={steps[4]} title="Diagnosis & clinical notes">
                <textarea
                  required
                  rows={3}
                  value={formData.admission_diagnosis}
                  onChange={(e) => setFormData({ ...formData, admission_diagnosis: e.target.value })}
                  placeholder="e.g. Acute ST-elevation myocardial infarction (STEMI), diaphoresis and radiating chest pain…"
                  className="field resize-none"
                />
              </Step>

              <Step
                n={6}
                done={!!estimate.condition_id}
                title="Cost estimate for the family"
                right={<span className="font-mono text-[10.5px] text-pulse-300">real outcomes · optional</span>}
                last
              >
                <CostEstimatePanel
                  value={estimate}
                  onChange={(v) => {
                    if (v.severity !== estimate.severity) setSeverityTouched(true);
                    setEstimate(v);
                  }}
                  wardType={selectedBed?.ward_type ?? null}
                  deptId={selectedBed?.dept_id ?? null}
                  patientIsChild={selectedPatientIsChild}
                />
              </Step>

              <div className="mt-6 sm:pl-12">
                <MovingBorder type="submit" disabled={submitting} size="lg" className="w-full">
                  {submitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-tint/30 border-t-white" />
                      Executing admission transaction…
                    </>
                  ) : (
                    <>
                      <HeartPulse className="h-4 w-4" />
                      Admit patient & lock bed
                    </>
                  )}
                </MovingBorder>
                <Burst trigger={celebrate} />
              </div>
            </form>
          </SpotlightCard>
        </div>

        {/* SIDE */}
        <div className="space-y-6 lg:col-span-5">
          {/* Patient monitor */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="screen relative overflow-hidden rounded-2xl border bg-ink-950 p-5"
            style={{ borderColor: `rgba(${t.screenRgb},0.35)`, boxShadow: `0 30px 80px -50px rgba(${t.screenRgb},0.5)` }}
          >
            <div
              aria-hidden
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(0,0,0,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.12) 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />
            <div className="relative flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg3">Triage monitor · lead II</div>
                <div className="mt-1 text-sm font-semibold text-fg">{selectedBed ? `${selectedBed.room_number} · ${selectedBed.bed_label}` : 'No bed locked'}</div>
              </div>
              <div className="text-right">
                <motion.div
                  key={t.bpm}
                  initial={{ scale: 1.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="font-display text-4xl font-bold tabular-nums"
                  style={{ color: t.screen, textShadow: `0 0 24px ${t.screen}` }}
                >
                  {t.bpm}
                </motion.div>
                <div className="font-mono text-[10px] text-fg3">HR bpm (simulated)</div>
              </div>
            </div>
            <div className="relative mt-3 h-24">
              <EcgLine bpm={t.bpm} color={t.screen} className="absolute inset-0 h-full w-full" strokeWidth={2.2} />
            </div>
            <div className="relative mt-3 grid grid-cols-3 gap-2 font-mono text-[10.5px]">
              <Vital k="ESI" v={String(formData.triage_priority)} c={t.screen} />
              <Vital k="SpO₂" v={`${100 - (6 - formData.triage_priority) * 2}%`} c="#7af7ff" />
              <Vital k="O₂ port" v={selectedBed ? (selectedBed.has_oxygen_port ? 'ready' : 'none') : '—'} c="#b79bff" />
            </div>
          </motion.div>

          {/* Current inpatients */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="glass rounded-2xl p-5"
          >
            <h3 className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg2">
              <Clock className="h-4 w-4" /> Current inpatients ({activeInpatients.length})
            </h3>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
              {activeInpatients.length === 0 ? (
                <p className="py-4 text-center text-xs text-fg3">No active admissions currently.</p>
              ) : (
                activeInpatients.map((adm, i) => (
                  <motion.div
                    key={adm.admission_id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.35 + i * 0.06 }}
                    className="rounded-xl border border-tint/[0.11] bg-tint/[0.02] p-3 transition hover:border-tint/20"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-fg">{adm.patient_name}</span>
                        <span className="font-mono text-[10.5px] text-fg3">{adm.national_health_id}</span>
                      </div>
                      <TriageBadge priority={adm.triage_priority} size="sm" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg2">
                      <span className="rounded-md border border-pulse-400/25 bg-pulse-400/10 px-1.5 py-0.5 font-mono text-pulse-200">
                        {adm.room_number} · {adm.bed_label}
                      </span>
                      <span className="truncate">{adm.doctor_name}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] italic text-fg3">“{adm.admission_diagnosis}”</p>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>

          {/* ESI reference */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="glass rounded-2xl p-5"
          >
            <h3 className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg2">
              <ShieldAlert className="h-4 w-4" /> ESI triage reference
            </h3>
            <div className="mt-3 space-y-1.5">
              {Object.entries(TRIAGE_CONFIG).map(([level, cfg]) => (
                <button
                  type="button"
                  key={level}
                  onClick={() => setFormData({ ...formData, triage_priority: Number(level) })}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-tint/[0.04]"
                >
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: cfg.hex, boxShadow: `0 0 8px ${cfg.hex}` }} />
                  <span className="text-xs font-semibold text-fg">{cfg.label}</span>
                  <span className="ml-auto hidden truncate text-[10.5px] text-fg3 sm:block">{cfg.description}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  done,
  title,
  right,
  children,
  last,
}: {
  n: number;
  done: boolean;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + n * 0.07 }}
      className={`relative flex gap-4 ${last ? '' : 'pb-7'}`}
    >
      <div className="relative z-10 hidden sm:block">
        <motion.div
          animate={{
            backgroundColor: done ? 'rgba(46,230,245,0.12)' : 'rgb(13,18,30)',
            borderColor: done ? 'rgba(46,230,245,0.7)' : 'rgba(231,236,245,0.16)',
            boxShadow: done ? '0 0 0 4px rgba(46,230,245,0.12)' : '0 0 0 0 rgba(0,0,0,0)',
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full border bg-ink-900 font-mono text-xs font-bold text-fg"
        >
          <AnimatePresence mode="wait" initial={false}>
            {done ? (
              <motion.span key="c" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}>
                <Check className="h-4 w-4 text-pulse-300" />
              </motion.span>
            ) : (
              <motion.span key="n" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                {n}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="label !mb-0">
            <span className="sm:hidden">{n}. </span>
            {title}
          </span>
          {right}
        </div>
        {children}
      </div>
    </motion.div>
  );
}

function PatientPicker({
  patients,
  value,
  onChange,
  loading,
}: {
  patients: any[];
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = patients.find((p) => String(p.patient_id) === String(value));

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return patients;
    return patients.filter(
      (p) => p.full_name.toLowerCase().includes(s) || p.national_health_id.toLowerCase().includes(s) || String(p.primary_phone).includes(s)
    );
  }, [patients, q]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`field flex items-center justify-between text-left ${open ? '!border-pulse-400/60' : ''}`}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-pulse-400/40 to-plasma-500/40 font-display text-[11px] font-bold">
              {selected.full_name
                .split(' ')
                .map((s: string) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg">{selected.full_name}</span>
              <span className="block truncate font-mono text-[10.5px] text-fg3">
                {selected.national_health_id} · {selected.gender} · {selected.blood_group}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-fg3">{loading ? 'Loading patients…' : 'Choose a registered patient or emergency arrival'}</span>
        )}
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-fg3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-tint/[0.14] bg-ink-850/95 shadow-2xl backdrop-blur-2xl"
          >
            <div className="relative border-b border-tint/[0.11] p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, NHID or phone"
                className="w-full rounded-lg bg-tint/[0.04] py-2 pl-8 pr-3 text-xs text-fg outline-none placeholder:text-fg3"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.length === 0 && <p className="p-3 text-center text-xs text-fg3">No match</p>}
              {filtered.map((p, i) => (
                <motion.button
                  key={p.patient_id}
                  type="button"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => {
                    onChange(String(p.patient_id));
                    setOpen(false);
                    setQ('');
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-tint/[0.06] ${
                    String(p.patient_id) === String(value) ? 'bg-pulse-400/10' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">{p.full_name}</span>
                    <span className="block truncate font-mono text-[10.5px] text-fg3">
                      {p.national_health_id} · {p.gender} · ☎ {p.primary_phone}
                    </span>
                  </span>
                  <span className="rounded border border-rose-400/30 bg-rose-500/10 px-1 font-mono text-[10px] font-bold text-rose-300">
                    {p.blood_group}
                  </span>
                  {p.active_admission_id && (
                    <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300">
                      ADMITTED
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Vital({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div className="rounded-lg border border-tint/[0.11] bg-tint/[0.02] px-2.5 py-1.5">
      <div className="text-fg3">{k}</div>
      <div className="font-bold" style={{ color: c }}>
        {v}
      </div>
    </div>
  );
}

/** Confetti-like radial burst fired after a successful admission. */
function Burst({ trigger }: { trigger: number }) {
  if (!trigger) return null;
  const colors = ['#7af7ff', '#b79bff', '#9474ff', '#34d399', '#fbbf24'];
  return (
    <div key={trigger} className="pointer-events-none relative h-0">
      {Array.from({ length: 28 }).map((_, i) => {
        const a = (i / 28) * Math.PI * 2;
        const d = 90 + (i % 4) * 40;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-[-28px] h-2 w-2 rounded-sm"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d - 40, opacity: 0, rotate: 360, scale: 0.4 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </div>
  );
}

export default function AdmissionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-fg3">Loading admission desk…</div>}>
      <AdmissionsContent />
    </Suspense>
  );
}
