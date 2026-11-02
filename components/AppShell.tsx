'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MotionConfig, motion } from 'framer-motion';
import Navbar from './Navbar';
import Aurora from './fx/Aurora';
import ClickSpark from './fx/ClickSpark';
import EcgLine from './fx/EcgLine';
import { ToastProvider } from './ToastContext';
import { LiveProvider } from './LiveContext';
import { ClientSession, SessionContext } from './auth/SessionContext';

/** Shared chrome for every page: backdrop, session gate, navigation, toasts, footer. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const isLogin = pathname === '/login';
  const [session, setSession] = useState<ClientSession | null | undefined>(undefined);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.session) {
        setSession(data.session);
        return true;
      }
    } catch {
      /* treated as signed out */
    }
    setSession(null);
    return false;
  }, []);

  // Verify the session on every protected route, and re-check every minute.
  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    check().then((ok) => {
      if (alive && !ok) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
    const i = setInterval(async () => {
      if (!(await check())) router.replace('/login?expired=1');
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [isLogin, pathname, check, router]);

  const logout = useCallback(
    async (reason: 'signed_out' | 'expired' = 'signed_out') => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        /* cookie is cleared server-side when reachable */
      }
      setSession(null);
      router.replace(reason === 'expired' ? '/login?expired=1' : '/login?signed_out=1');
    },
    [router]
  );

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <Aurora />
        <ClickSpark />
        {isLogin ? (
          children
        ) : !session ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4">
            <div className="screen h-14 w-48 overflow-hidden rounded-xl border border-tint/[0.12]">
              <EcgLine bpm={72} className="h-full w-full" />
            </div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-mono text-[11px] uppercase tracking-[0.22em] text-fg3"
            >
              Verifying staff session…
            </motion.p>
          </div>
        ) : (
          <SessionContext.Provider value={{ session, logout }}>
            <LiveProvider>
            <div className="relative flex min-h-screen flex-col">
              <Navbar />
              <main className="flex-1 pb-32">{children}</main>
              <footer className="border-t border-tint/[0.11] py-6 pb-28 text-xs text-fg3">
                <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6">
                  <span>
                    <span className="font-display font-semibold text-fg2">Hospital Bed & Emergency Resource Management</span>
                    <span className="mx-2 text-fg3">/</span>
                    PostgreSQL · PL/pgSQL · RLS · LISTEN/NOTIFY · Next.js
                  </span>
                  <span className="font-mono text-[10.5px] text-fg3">
                    Real data: National Hospital Directory (Govt. of India) · NY SPARCS 2021 · India Post pincodes
                  </span>
                </div>
              </footer>
            </div>
            </LiveProvider>
          </SessionContext.Provider>
        )}
      </ToastProvider>
    </MotionConfig>
  );
}
