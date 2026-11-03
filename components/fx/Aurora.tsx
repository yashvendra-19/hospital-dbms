'use client';

import { useEffect, useRef } from 'react';

/**
 * Dark blue backdrop: soft cyan and violet aurora washes, a perspective grid
 * floor and a cursor spotlight, kept at low intensity so content holds its
 * contrast (Aceternity "Aurora Background" / React Bits "Aurora").
 */
export default function Aurora() {
  const spot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    // Move one composited layer instead of restyling the whole page on every mouse move
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (spot.current) spot.current.style.transform = `translate3d(${e.clientX - 560}px, ${e.clientY - 560}px, 0)`;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ground">
      {/* Aurora washes: electric cyan and violet */}
      <div className="absolute -left-[10vw] -top-[25vh] h-[70vh] w-[60vw] animate-aurora1 rounded-full bg-[radial-gradient(closest-side,rgba(46,230,245,0.11),transparent)] will-change-transform" />
      <div className="absolute right-[-15vw] top-[5vh] h-[75vh] w-[55vw] animate-aurora2 rounded-full bg-[radial-gradient(closest-side,rgba(148,116,255,0.10),transparent)] will-change-transform" />
      <div className="absolute bottom-[-35vh] left-[25vw] h-[60vh] w-[55vw] animate-aurora1 rounded-full bg-[radial-gradient(closest-side,rgba(59,130,246,0.07),transparent)] will-change-transform [animation-delay:-9s]" />

      {/* Perspective grid floor */}
      <div
        className="absolute inset-x-0 bottom-0 h-[55vh] opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(rgba(46,230,245,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(46,230,245,0.09) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          transform: 'perspective(600px) rotateX(62deg) translateY(18%) scale(2.2)',
          transformOrigin: 'bottom',
          maskImage: 'linear-gradient(to top, black 10%, transparent 75%)',
          WebkitMaskImage: 'linear-gradient(to top, black 10%, transparent 75%)',
        }}
      />

      {/* Fine dot field near the top */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(rgba(231,236,245,0.1) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at 50% 0%, black, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, black, transparent 70%)',
        }}
      />

      {/* Cursor spotlight */}
      <div
        ref={spot}
        className="absolute left-0 top-0 h-[1120px] w-[1120px] will-change-transform"
        style={{ background: 'radial-gradient(closest-side, rgba(46,230,245,0.05), transparent 80%)', transform: 'translate3d(-2000px,-2000px,0)' }}
      />
    </div>
  );
}
