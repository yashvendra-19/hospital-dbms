'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Ambulance,
  BedDouble,
  Lock,
  HeartPulse,
  MousePointerClick,
  PlusCircle,
  RefreshCw,
  Search,
  Siren,
  Users,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import BedCard, { BedData } from '@/components/BedCard';
import { useToast } from '@/components/ToastContext';
import ClinicalAlertDialog from '@/components/ClinicalAlertDialog';
import SplitText from '@/components/fx/SplitText';
import MovingBorder from '@/components/fx/MovingBorder';
import Segmented from '@/components/fx/Segmented';
import { GhostButton } from '@/components/PageHeader';
import { useLive } from '@/components/LiveContext';
import Link from 'next/link';

const HospitalTower = dynamic(() => import('@/components/three/HospitalTower'), {
  ssr: false,
  loading: () => <TowerLoading />,
});

function TowerLoading() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-fg3">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-pulse-400/20 border-t-pulse-300" />
      <span className="font-mono text-[11px] uppercase tracking-[0.2em]">Rendering digital twin…</span>
    </div>
  );
}

type StatusFilter = 'all' | 'Available' | 'Occupied' | 'Reserved' | 'Sanitizing' | 'Out-Of-Service';

export default function DashboardPage() {
  const { toast } = useToast();
  const { tick } = useLive();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [beds, setBeds] = useState<BedData[]>([]);
  const [allBeds, setAllBeds] = useState<BedData[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);

  const [selectedDept, setSelectedDept] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [selectedWardType, setSelectedWardType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [focusBed, setFocusBed] = useState<number | null>(null);

  const [alertDialog, setAlertDialog] = useState<{ isOpen: boolean; title: string; message: string; details?: any }>({
    isOpen: false,
    title: '',
    message: '',
  });

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const [statsRes, bedsRes, deptsRes, allRes] = await Promise.all([
          fetch('/api/stats'),
          fetch(
            `/api/beds?dept_id=${selectedDept}&status=${selectedStatus}&ward_type=${selectedWardType}&search=${encodeURIComponent(searchQuery)}`
          ),
          fetch('/api/departments'),
          fetch('/api/beds'),
        ]);
        const [statsData, bedsData, deptsData, allData] = await Promise.all([
          statsRes.json(),
          bedsRes.json(),
          deptsRes.json(),
          allRes.json(),
        ]);
        if (statsData.success) setStats(statsData.stats);
        if (bedsData.success) setBeds(bedsData.beds);
        if (deptsData.success) setDepartments(deptsData.departments);
        if (allData.success) setAllBeds(allData.beds);
      } catch {
        toast({ type: 'error', title: 'Connection Error', message: 'Unable to communicate with PostgreSQL hospital_db.' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedDept, selectedStatus, selectedWardType, searchQuery, toast]
  );

  useEffect(() => {
    const t = setTimeout(() => fetchData(), searchQuery ? 220 : 0);
    return () => clearTimeout(t);
  }, [fetchData, searchQuery]);

  // PostgreSQL pushed a change (ambulance, bed hold, admission, bed status): refresh quietly
  useEffect(() => {
    if (tick > 0) fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Scroll to a bed picked in the 3D tower
  useEffect(() => {
    if (focusBed === null) return;
    const el = document.getElementById(`bed-${focusBed}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => setFocusBed(null), 2600);
      return () => clearTimeout(t);
    }
  }, [focusBed, beds]);

  const pickFromTower = (bed: BedData) => {
    if (!beds.some((b) => b.bed_id === bed.bed_id)) {
      setSelectedDept('all');
      setSelectedStatus('all');
      setSelectedWardType('all');
      setSearchQuery('');
    }
    setFocusBed(bed.bed_id);
  };

  const handleBedStatusUpdate = async (bedId: number, newStatus: string) => {
    try {
      const res = await fetch(`/api/beds/${bedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operational_status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAlertDialog({
          isOpen: true,
          title: 'Bed Status Update Denied',
          message: data.error || 'Failed to update bed status.',
          details: data.details,
        });
        return;
      }
      toast({ type: 'success', title: 'Bed Status Updated', message: `Bed operational status changed to ${newStatus}.` });
      fetchData(true);
    } catch (err: any) {
      toast({ type: 'error', title: 'Update Error', message: err.message });
    }
  };

  const statusOptions = useMemo(
    () => [
      { value: 'all' as StatusFilter, label: <>All <Count n={stats?.totalBeds} /></> },
      { value: 'Available' as StatusFilter, label: <>Available <Count n={stats?.availableBeds} /></>, glow: '52,211,153' },
      { value: 'Occupied' as StatusFilter, label: <>Occupied <Count n={stats?.occupiedBeds} /></>, glow: '251,113,133' },
      { value: 'Reserved' as StatusFilter, label: <>Ambulance hold <Count n={stats?.reservedBeds} /></>, glow: '56,189,248' },
      { value: 'Sanitizing' as StatusFilter, label: <>Sanitizing <Count n={stats?.sanitizingBeds} /></>, glow: '251,191,36' },
      { value: 'Out-Of-Service' as StatusFilter, label: <>Out of service <Count n={stats?.oosBeds} /></>, glow: '148,163,184' },
    ],
    [stats]
  );

  const deptOptions = useMemo(
    () => [
      { value: 'all', label: 'All depts' },
      ...departments.map((d) => ({ value: String(d.dept_id), label: d.dept_code })),
    ],
    [departments]
  );

  const critical = stats?.criticalTriageCount ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <ClinicalAlertDialog
        isOpen={alertDialog.isOpen}
        onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
        title={alertDialog.title}
        message={alertDialog.message}
        details={alertDialog.details}
      />

      {/* HERO: title + 3D digital twin */}
      <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-pulse-400/25 bg-pulse-400/[0.06] px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.2em] text-pulse-300"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pulse-300" />
            Live floor telemetry
          </motion.div>
          <SplitText
            text="Every bed, every heartbeat, one living map."
            accent={['heartbeat,', 'living']}
            className="font-display text-[40px] font-bold leading-[1.02] tracking-tight text-fg sm:text-[54px]"
          />
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-4 max-w-md text-sm leading-relaxed text-fg2"
          >
            A real-time 3D twin of the hospital. Each floor is a department, each pod a physical bed, colour-coded by
            status and pulsing with the patient&apos;s triage acuity. Beds held for incoming ambulances strobe blue, and
            PostgreSQL pushes every change to this screen as it happens.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
            className="mt-6 flex flex-wrap items-center gap-3"
          >
            <MovingBorder href="/admissions" size="lg">
              <PlusCircle className="h-4 w-4" />
              New emergency admission
            </MovingBorder>
            <GhostButton onClick={() => fetchData(true)} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Syncing…' : 'Refresh'}
            </GhostButton>
          </motion.div>

          <AnimatePresence>
            {stats?.incomingAmbulances > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 overflow-hidden"
              >
                <Link
                  href="/ambulance"
                  className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-sky-400/35 bg-sky-500/[0.09] px-4 py-3 transition hover:bg-sky-500/[0.14]"
                >
                  <motion.div
                    aria-hidden
                    className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-sky-300/20 to-transparent"
                    animate={{ x: ['-120%', '520%'] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                  />
                  <Ambulance className="h-5 w-5 flex-shrink-0 text-sky-300" />
                  <div className="text-xs">
                    <span className="font-semibold text-sky-100">
                      {stats.incomingAmbulances} ambulance{stats.incomingAmbulances > 1 ? 's' : ''} inbound
                    </span>
                    <span className="ml-2 font-mono text-sky-300/80">
                      {stats.reservedBeds} bed{stats.reservedBeds === 1 ? '' : 's'} on timed hold
                    </span>
                  </div>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {stats?.protectedInpatients > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 overflow-hidden">
                <Link
                  href="/privacy"
                  className="flex items-center gap-3 rounded-xl border border-plasma-400/25 bg-plasma-500/[0.07] px-4 py-2.5 text-xs text-fg2 transition hover:bg-plasma-500/[0.12]"
                >
                  <Lock className="h-4 w-4 flex-shrink-0 text-plasma-400" />
                  <span>
                    <b className="text-fg">{stats.protectedInpatients} restricted record{stats.protectedInpatients > 1 ? 's' : ''}</b>{' '}
                    hidden from your role by PostgreSQL row-level security. Counts below exclude them.
                  </span>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {critical > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: 0.8 }}
                className="mt-6 overflow-hidden"
              >
                <div className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-rose-500/30 bg-rose-500/[0.08] px-4 py-3">
                  <motion.div
                    aria-hidden
                    className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-rose-400/20 to-transparent"
                    animate={{ x: ['-120%', '520%'] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                  />
                  <Siren className="h-5 w-5 flex-shrink-0 text-rose-300" />
                  <div className="text-xs">
                    <span className="font-semibold text-rose-100">
                      {critical} critical patient{critical > 1 ? 's' : ''} on the floor
                    </span>
                    <span className="ml-2 font-mono text-rose-300/80">
                      ESI-1 {stats?.esi1Resus ?? 0} · ESI-2 {stats?.esi2Emergent ?? 0}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.94, rotateX: 12 }}
          animate={{ opacity: 1, scale: 1, rotateX: 0 }}
          transition={{ type: 'spring', stiffness: 60, damping: 16, delay: 0.15 }}
          style={{ transformPerspective: 1400 }}
          className="lg:col-span-7"
        >
          <div className="screen relative h-[420px] overflow-hidden rounded-3xl border border-tint/[0.14] bg-ink-950 shadow-[0_40px_100px_-40px_rgba(0,0,0,0.9)] sm:h-[480px]">
            {allBeds.length > 0 ? <HospitalTower beds={allBeds} onPick={pickFromTower} /> : <TowerLoading />}
            {/* overlays */}
            <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-tint/[0.14] bg-ink-950/70 px-3 py-2 backdrop-blur">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg2">Digital twin</div>
              <div className="font-display text-sm font-semibold text-fg">
                {allBeds.length} beds · {departments.length} floors
              </div>
            </div>
            <div className="pointer-events-none absolute right-4 top-4 flex flex-col gap-1.5 rounded-xl border border-tint/[0.14] bg-ink-950/70 px-3 py-2 backdrop-blur">
              {[
                ['Available', '#34d399'],
                ['Occupied', '#fb7185'],
                ['Sanitizing', '#fbbf24'],
                ['Ambulance hold', '#38bdf8'],
                ['ESI-1 beacon', '#ff3b5c'],
              ].map(([l, c]) => (
                <span key={l} className="flex items-center gap-2 text-[10.5px] text-fg2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                  {l}
                </span>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-tint/[0.14] bg-ink-950/70 px-3 py-1.5 font-mono text-[10px] text-fg2 backdrop-blur">
              <MousePointerClick className="h-3 w-3 text-pulse-300" /> drag to orbit · scroll to zoom · click a bed
            </div>
          </div>
        </motion.div>
      </section>

      {/* METRICS */}
      <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          index={0}
          title="Total physical beds"
          value={stats?.totalBeds}
          subtitle={`${stats?.availableBeds ?? 0} ready · ${stats?.reservedBeds ?? 0} held for ambulances`}
          icon={BedDouble}
          variant="blue"
          badge={`${stats?.occupancyRate ?? 0}% occupied`}
          progress={stats?.occupancyRate}
        />
        <MetricCard
          index={1}
          title="Occupied beds"
          value={stats?.occupiedBeds}
          subtitle={`${stats?.activeInpatients ?? 0} admitted patients`}
          icon={Users}
          variant="rose"
          badge="Inpatients"
          progress={stats ? (stats.occupiedBeds / Math.max(1, stats.totalBeds)) * 100 : 0}
        />
        <MetricCard
          index={2}
          title="Available ICU beds"
          value={stats?.availableIcuBeds}
          subtitle={`of ${stats?.totalIcuBeds ?? 0} critical-care beds`}
          icon={HeartPulse}
          variant="emerald"
          badge="Critical care"
          progress={stats ? (stats.availableIcuBeds / Math.max(1, stats.totalIcuBeds)) * 100 : 0}
        />
        <MetricCard
          index={3}
          title={stats?.clinicalView === false ? 'Incoming ambulances' : 'Critical triage'}
          value={stats?.clinicalView === false ? stats?.reservedBeds : stats?.criticalTriageCount}
          subtitle={
            stats?.clinicalView === false
              ? 'Triage is clinical data: hidden from billing by column grants'
              : `ESI 1: ${stats?.esi1Resus ?? 0} · ESI 2: ${stats?.esi2Emergent ?? 0} · ${stats?.incomingAmbulances ?? 0} inbound`
          }
          icon={stats?.clinicalView === false ? Ambulance : AlertTriangle}
          variant={critical > 0 ? 'amber' : 'slate'}
          badge={stats?.clinicalView === false ? 'Beds on hold' : 'High alert'}
        />
      </section>

      {/* FILTERS */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass sticky top-[68px] z-30 mt-10 rounded-2xl p-3"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented id="status" options={statusOptions} value={selectedStatus} onChange={setSelectedStatus} size="sm" />
            <Segmented id="dept" options={deptOptions} value={selectedDept} onChange={setSelectedDept} size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedWardType}
              onChange={(e) => setSelectedWardType(e.target.value)}
              className="field !w-auto !py-2 text-xs"
              aria-label="Ward type"
            >
              <option value="all">All ward types</option>
              <option value="ICU">ICU</option>
              <option value="General">General</option>
              <option value="Pediatric">Pediatric</option>
              <option value="Semi-Private">Semi-Private</option>
            </select>
            <div className="relative w-full xl:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3" />
              <input
                type="text"
                placeholder="Search room, bed, patient…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field !py-2 pl-9 text-xs"
              />
            </div>
          </div>
        </div>
      </motion.section>

      {/* BED GRID */}
      <section className="mt-6">
        {loading && beds.length === 0 ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="relative h-72 overflow-hidden rounded-2xl border border-tint/[0.11] bg-tint/[0.02]">
                <motion.div
                  className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-tint/[0.05] to-transparent"
                  animate={{ x: ['-100%', '250%'] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'linear', delay: i * 0.08 }}
                />
              </div>
            ))}
          </div>
        ) : beds.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-dashed border-tint/[0.14] bg-tint/[0.02] p-12 text-center"
          >
            <BedDouble className="mx-auto h-12 w-12 text-fg3" />
            <h3 className="mt-3 font-display text-lg font-semibold text-fg">No beds match these filters</h3>
            <p className="mt-1 text-xs text-fg3">Try a different department, status or search.</p>
            <button
              onClick={() => {
                setSelectedDept('all');
                setSelectedStatus('all');
                setSelectedWardType('all');
                setSearchQuery('');
              }}
              className="mt-5 rounded-xl border border-pulse-400/40 bg-pulse-400/10 px-4 py-2 text-xs font-semibold text-pulse-200 transition hover:bg-pulse-400/20"
            >
              Reset all filters
            </button>
          </motion.div>
        ) : (
          <motion.div layout className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {beds.map((bed, i) => (
                <motion.div
                  key={bed.bed_id}
                  layout
                  initial={{ opacity: 0, y: 30, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.2 } }}
                  transition={{
                    type: 'spring',
                    stiffness: 170,
                    damping: 20,
                    delay: Math.min(i, 12) * 0.035,
                  }}
                >
                  <BedCard bed={bed} onStatusChange={handleBedStatusUpdate} highlight={focusBed === bed.bed_id} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>
    </div>
  );
}

function Count({ n }: { n?: number }) {
  return <span className="rounded-md bg-tint/10 px-1.5 font-mono text-[10px] tabular-nums">{n ?? 0}</span>;
}
