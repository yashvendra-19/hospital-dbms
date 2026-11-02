'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Ambulance, BarChart3, BedDouble, Database, Fingerprint, LogOut, PhoneCall, Receipt, ScanEye, ShieldAlert, UserPlus } from 'lucide-react';
import FloatingDock, { DockItem } from './fx/FloatingDock';
import EcgLine from './fx/EcgLine';
import ShinyText from './fx/ShinyText';
import { DB_ROLE_OF, ROLE_STYLE, initials, useSession } from './auth/SessionContext';
import { useLive } from './LiveContext';

export const NAV_ITEMS: DockItem[] = [
  { href: '/', label: 'Bed Grid & Triage', icon: BedDouble, hint: '3D digital twin' },
  { href: '/admissions', label: 'Emergency Admission', icon: UserPlus, hint: 'Triage intake' },
  { href: '/ambulance', label: 'Golden Hour Desk', icon: Ambulance, hint: 'Ambulance pre-alerts' },
  { href: '/billing', label: 'Discharge & Billing', icon: Receipt, hint: 'Invoices' },
  { href: '/analytics', label: 'Capacity Analytics', icon: BarChart3, hint: 'Real-world data' },
  { href: '/privacy', label: 'Privacy Lens', icon: ScanEye, hint: 'Row-level security' },
  { href: '/integrity', label: 'Integrity Ledger', icon: Fingerprint, hint: 'SHA-256 audit chain' },
];

/** Glass top bar (brand, live DB status, clock) + floating dock navigation. */
export default function Navbar() {
  const pathname = usePathname() || '/';
  const [time, setTime] = useState('');
  const { session, logout } = useSession();
  const [left, setLeft] = useState<number | null>(null);
  const { tick, connected } = useLive();
  const [incoming, setIncoming] = useState<number | null>(null);

  // Incoming ambulance count, refreshed whenever PostgreSQL pushes an event
  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => alive && d.success && setIncoming(d.stats.incomingAmbulances))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, tick, pathname]);

  // Break-glass sessions count down and sign out at zero.
  useEffect(() => {
    if (!session || session.mode !== 'break_glass') {
      setLeft(null);
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) logout('expired');
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [session, logout]);

  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const current = NAV_ITEMS.find((n) => n.href === pathname);

  return (
    <>
      <motion.header
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
        className="sticky top-0 z-40 border-b border-tint/[0.11] bg-ink-950/60 backdrop-blur-2xl"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="group flex items-center gap-3">
            <div className="screen relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-pulse-400/40 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)]">
              <EcgLine className="h-6 w-9" bpm={78} strokeWidth={2.2} color="#7af7ff" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-[17px] font-bold tracking-tight text-fg">
                Medi<span className="text-gradient">Resource</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]">
                <ShinyText>Clinical Command Center</ShinyText>
              </div>
            </div>
          </Link>

          {current && (
            <motion.div
              key={current.href}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden items-center gap-2 font-mono text-[11px] text-fg2 xl:flex"
            >
              <span className="text-fg3">~/</span>
              <span className="text-fg">{current.label.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-')}</span>
            </motion.div>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            <span
              title={connected ? 'Subscribed to PostgreSQL LISTEN mediresource_live' : 'Reconnecting to the live feed'}
              className={`hidden items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10.5px] md:inline-flex ${
                connected ? 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300' : 'border-amber-300/25 bg-amber-300/[0.06] text-amber-200'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {connected && <span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-emerald-400" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-300'}`} />
              </span>
              <Database className="h-3 w-3" />
              {connected ? 'LISTEN live' : 'connecting'}
            </span>
            {session && (
              <span
                className="hidden items-center gap-1.5 rounded-full border border-plasma-400/25 bg-plasma-500/[0.07] px-3 py-1 font-mono text-[10.5px] text-plasma-400 2xl:inline-flex"
                title="Every query runs as this PostgreSQL role, so grants and row-level security apply"
              >
                db role · {DB_ROLE_OF[session.role]}
              </span>
            )}
            {incoming ? (
              <Link
                href="/ambulance"
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-500/15 px-3 py-1 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-500/25"
              >
                <Ambulance className="h-3.5 w-3.5 animate-pulse" />
                {incoming} inbound
              </Link>
            ) : null}
            <a
              href="tel:108"
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/20"
            >
              <PhoneCall className="h-3 w-3" />
              <span className="hidden sm:inline">ER</span> 108
            </a>
            {time && (
              <span className="hidden rounded-lg border border-tint/[0.14] bg-tint/[0.03] px-2.5 py-1 font-mono text-[11px] tabular-nums text-fg2 lg:inline">
                {time}
              </span>
            )}
            {session && (
              <div className="flex items-center gap-2 rounded-xl border border-tint/[0.14] bg-tint/[0.03] py-1 pl-1 pr-1.5">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg font-display text-[11px] font-bold text-[#060812]"
                  style={{ background: ROLE_STYLE[session.role].hex }}
                >
                  {initials(session.fullName)}
                </span>
                <span className="hidden leading-tight md:block">
                  <span className="block max-w-[150px] truncate text-[12px] font-semibold text-fg">{session.fullName}</span>
                  <span className="block font-mono text-[9.5px] uppercase tracking-wider" style={{ color: ROLE_STYLE[session.role].hex }}>
                    {session.role} · {session.staffCode}
                  </span>
                </span>
                <button
                  onClick={() => logout('signed_out')}
                  aria-label="Sign out"
                  title="Sign out"
                  className="ml-1 rounded-lg p-1.5 text-fg2 transition hover:bg-tint/[0.08] hover:text-fg"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        {left !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden border-t border-rose-500/40 bg-rose-500/[0.12]"
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
              <span className="flex items-center gap-2 font-semibold text-rose-100">
                <ShieldAlert className="h-4 w-4 text-rose-300" />
                Break-glass emergency access · every action is audited
              </span>
              <span className="flex items-center gap-3">
                <span className="hidden max-w-[360px] truncate italic text-rose-200/80 md:inline">“{session?.reason}”</span>
                <span className="rounded-md border border-rose-400/40 bg-black/30 px-2 py-0.5 font-mono font-bold tabular-nums text-rose-100">
                  {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')} left
                </span>
              </span>
            </div>
          </motion.div>
        )}
      </motion.header>

      <FloatingDock items={NAV_ITEMS} active={pathname} />
    </>
  );
}
