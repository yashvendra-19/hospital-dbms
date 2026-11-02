'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

export interface RadarHospital {
  nhp_id: number;
  hospital_name: string;
  district?: string | null;
  distance_km: number | string;
  latitude: number | string;
  longitude: number | string;
  phone?: string | null;
  geo_source?: string | null;
  care_type?: string | null;
}

export interface RadarAmbulance {
  id: number;
  code: string;
  lat: number;
  lon: number;
  esi: number;
  label: string;
  minutes: number | null;
}

interface RadarMapProps {
  center: { lat: number; lon: number; name: string };
  hospitals: RadarHospital[];
  ambulances: RadarAmbulance[];
  radiusKm?: number;
  highlight?: number | null;
}

const ESI_HEX = ['#ff3b5c', '#ff3b5c', '#fb923c', '#fbbf24', '#60a5fa', '#34d399'];

/**
 * Local radar around this hospital: real emergency-capable hospitals from the National Hospital
 * Directory (green) and inbound ambulances (pulsing, coloured by ESI). Equirectangular projection.
 */
export default function RadarMap({ center, hospitals, ambulances, radiusKm = 45, highlight }: RadarMapProps) {
  const [hover, setHover] = useState<RadarHospital | null>(null);
  const S = 360;
  const R = S / 2 - 14;
  const project = useMemo(() => {
    const kmPerDegLat = 111.0;
    const kmPerDegLon = 111.0 * Math.cos((center.lat * Math.PI) / 180);
    return (lat: number, lon: number) => {
      const dx = (lon - center.lon) * kmPerDegLon;
      const dy = (lat - center.lat) * kmPerDegLat;
      const k = R / radiusKm;
      const d = Math.hypot(dx, dy);
      const clamp = d * k > R ? R / (d * k) : 1; // pin far-away points to the rim
      return { x: S / 2 + dx * k * clamp, y: S / 2 - dy * k * clamp, outside: clamp < 1 };
    };
  }, [center, radiusKm, R]);

  // hospitals sharing a pincode centroid sit on the same point: fan them out slightly
  const placed = useMemo(() => {
    const seen = new Map<string, number>();
    return hospitals.map((h) => {
      const p = project(Number(h.latitude), Number(h.longitude));
      const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      const a = n * 2.4;
      return { h, x: p.x + (n ? Math.cos(a) * (3 + n * 1.6) : 0), y: p.y + (n ? Math.sin(a) * (3 + n * 1.6) : 0) };
    });
  }, [hospitals, project]);

  const rings = [10, 20, 30, radiusKm].filter((v, i, a) => a.indexOf(v) === i && v <= radiusKm);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${S} ${S}`} className="h-auto w-full" role="img" aria-label="Map of nearby hospitals and inbound ambulances">
        <defs>
          <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(46,230,245,0.10)" />
            <stop offset="100%" stopColor="rgba(46,230,245,0)" />
          </radialGradient>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(46,230,245,0)" />
            <stop offset="100%" stopColor="rgba(46,230,245,0.35)" />
          </linearGradient>
        </defs>
        <circle cx={S / 2} cy={S / 2} r={R} fill="url(#radar-bg)" stroke="rgba(46,230,245,0.25)" />
        {rings.map((km) => (
          <g key={km}>
            <circle cx={S / 2} cy={S / 2} r={(km / radiusKm) * R} fill="none" stroke="rgba(231,236,245,0.08)" strokeDasharray="2 4" />
            <text x={S / 2 + 4} y={S / 2 - (km / radiusKm) * R + 11} fontSize="8.5" fill="rgba(231,236,245,0.35)" fontFamily="var(--font-mono)">
              {km} km
            </text>
          </g>
        ))}
        <line x1={S / 2 - R} y1={S / 2} x2={S / 2 + R} y2={S / 2} stroke="rgba(231,236,245,0.05)" />
        <line x1={S / 2} y1={S / 2 - R} x2={S / 2} y2={S / 2 + R} stroke="rgba(231,236,245,0.05)" />
        <text x={S / 2} y={20} textAnchor="middle" fontSize="8" fill="rgba(231,236,245,0.35)" fontFamily="var(--font-mono)">N</text>

        {/* rotating sweep */}
        <motion.g
          style={{ originX: `${S / 2}px`, originY: `${S / 2}px` }}
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        >
          <path d={`M ${S / 2} ${S / 2} L ${S / 2 + R} ${S / 2} A ${R} ${R} 0 0 0 ${S / 2 + R * Math.cos(-0.6)} ${S / 2 + R * Math.sin(-0.6)} Z`} fill="url(#sweep)" />
        </motion.g>

        {/* ambulance tracks */}
        {ambulances.map((a) => {
          const p = project(a.lat, a.lon);
          const c = ESI_HEX[a.esi] || '#38bdf8';
          return (
            <g key={a.id}>
              <line x1={p.x} y1={p.y} x2={S / 2} y2={S / 2} stroke={c} strokeOpacity={0.55} strokeDasharray="4 4">
                <animate attributeName="stroke-dashoffset" from="16" to="0" dur="0.8s" repeatCount="indefinite" />
              </line>
              <circle cx={p.x} cy={p.y} r={9} fill={c} opacity={0.25}>
                <animate attributeName="r" values="5;14;5" dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1.4s" repeatCount="indefinite" />
              </circle>
              <circle cx={p.x} cy={p.y} r={4.5} fill={c} stroke="#060812" strokeWidth={1.5} />
              <text x={p.x + 8} y={p.y - 6} fontSize="9" fontWeight={700} fill={c} fontFamily="var(--font-mono)">
                {a.code}
                {a.minutes !== null ? ` · ${a.minutes}m` : ''}
              </text>
            </g>
          );
        })}

        {/* real hospitals from the national directory */}
        {placed.map(({ h, x, y }) => {
          const hl = highlight === h.nhp_id || hover?.nhp_id === h.nhp_id;
          return (
            <circle
              key={h.nhp_id}
              cx={x}
              cy={y}
              r={hl ? 5 : 3}
              fill={hl ? '#a7f3d0' : '#34d399'}
              fillOpacity={hl ? 1 : 0.75}
              stroke="#060812"
              strokeWidth={1}
              onMouseEnter={() => setHover(h)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            />
          );
        })}

        {/* this hospital */}
        <circle cx={S / 2} cy={S / 2} r={7} fill="#2ee6f5" stroke="#060812" strokeWidth={2} />
        <circle cx={S / 2} cy={S / 2} r={12} fill="none" stroke="#2ee6f5" strokeOpacity={0.5}>
          <animate attributeName="r" values="8;18;8" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.6;0;0.6" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <text x={S / 2} y={S / 2 + 22} textAnchor="middle" fontSize="9" fontWeight={700} fill="#7af7ff" fontFamily="var(--font-mono)">
          {center.name}
        </text>
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[240px] rounded-xl border border-tint/20 bg-ink-950/90 p-2.5 text-[11px] shadow-2xl backdrop-blur">
          <div className="font-semibold text-fg">{hover.hospital_name}</div>
          <div className="font-mono text-[10px] text-fg3">
            {hover.district} · {Number(hover.distance_km).toFixed(1)} km
            {hover.geo_source === 'pincode' ? ' · approx. (pincode)' : ''}
          </div>
          <div className="mt-1 text-fg2">{hover.phone || 'No phone listed in the directory'}</div>
        </div>
      )}
    </div>
  );
}
