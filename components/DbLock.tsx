'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Lock, ScanEye } from 'lucide-react';

interface DbLockProps {
  /** what the user tried to open, e.g. "Bills and invoices" */
  what: string;
  /** error message returned by the API (PostgreSQL's own words) */
  error?: string | null;
  dbRole?: string | null;
  role?: string | null;
  compact?: boolean;
}

/** Shown when PostgreSQL itself refuses a request for the signed-in role (SQLSTATE 42501). */
export default function DbLock({ what, error, dbRole, role, compact }: DbLockProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl border border-plasma-400/30 bg-plasma-500/[0.06] ${compact ? 'p-4' : 'p-6 sm:p-8'}`}
    >
      <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-plasma-500/20 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-plasma-400/40 bg-ground/60">
          <Lock className="h-5 w-5 text-plasma-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-plasma-400">SQLSTATE 42501 · enforced by PostgreSQL</div>
          <h3 className="mt-1 font-display text-lg font-bold text-fg">{what} are not available to your role</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-fg2">
            {role ? <>You are signed in as <b className="text-fg">{role}</b>, so every query runs as </> : 'Every query runs as '}
            <code className="rounded bg-ground/70 px-1.5 py-0.5 font-mono text-[12px] text-plasma-400">SET LOCAL ROLE {dbRole || 'mr_…'}</code>.
            The database refused this request. Hiding the button would not be enough: the grant itself is missing.
          </p>
          {error && (
            <p className="mt-3 rounded-lg border border-tint/[0.1] bg-ground/60 p-2.5 font-mono text-[11.5px] text-fg2">{error}</p>
          )}
          {!compact && (
            <Link
              href="/privacy"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-plasma-400/40 bg-plasma-500/10 px-3.5 py-2 text-xs font-semibold text-fg transition hover:bg-plasma-500/20"
            >
              <ScanEye className="h-3.5 w-3.5" /> See every role&apos;s access in the Privacy Lens
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}
