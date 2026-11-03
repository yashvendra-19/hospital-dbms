'use client';

import { useId } from 'react';

interface EcgLineProps {
  /** beats per minute — controls scroll speed */
  bpm?: number;
  color?: string;
  className?: string;
  strokeWidth?: number;
  /** flat line — used for idle states */
  flat?: boolean;
}

// One heartbeat (P wave, QRS complex, T wave). 80 units wide.
const BEAT = 'l14 0 l4 -4 l4 4 l6 0 l3 6 l5 -30 l5 34 l4 -10 l8 0 l6 -6 l6 6 l15 0';
const BEAT_W = 80;
const VISIBLE_BEATS = 4;

/** Scrolling heart-monitor trace. Faster bpm = faster scroll. */
export default function EcgLine({
  bpm = 72,
  color = '#2ee6f5',
  className = '',
  strokeWidth = 1.8,
  flat = false,
}: EcgLineProps) {
  const id = useId().replace(/:/g, '');
  const viewW = VISIBLE_BEATS * BEAT_W;
  const d = flat
    ? `M0 30 l${viewW * 2} 0`
    : `M0 30 ${Array(VISIBLE_BEATS * 2).fill(BEAT).join(' ')}`;
  // time to scroll one full view = VISIBLE_BEATS heartbeats
  const dur = (60 / Math.max(20, bpm)) * VISIBLE_BEATS;

  return (
    <svg viewBox={`0 0 ${viewW} 50`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`fade-${id}`} x1="0" x2={viewW} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`m-${id}`}>
          <rect width={viewW} height="50" fill={`url(#fade-${id})`} />
        </mask>
      </defs>
      <g mask={`url(#m-${id})`}>
        <g className="ecg-scroll" style={{ animationDuration: `${dur}s`, ['--ecg-w' as any]: `-${viewW}px` }}>
          {/* soft glow: a wider, faint copy of the trace instead of a blur filter */}
          <path d={d} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={strokeWidth * 3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
      </g>
    </svg>
  );
}
