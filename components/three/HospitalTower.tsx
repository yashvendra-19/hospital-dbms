'use client';

import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Edges, Html, OrbitControls, RoundedBox, Sparkles } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { BedData } from '@/components/BedCard';

export const STATUS_HEX: Record<string, string> = {
  Available: '#34d399',
  Occupied: '#fb7185',
  Sanitizing: '#fbbf24',
  Reserved: '#38bdf8',
  'Out-Of-Service': '#64748b',
};

const FLOOR_H = 1.55;
const POD_GAP = 1.15;
const tmp = new THREE.Vector3();

interface Floor {
  key: number;
  floor: number;
  code: string;
  name: string;
  beds: BedData[];
}

interface TowerProps {
  beds: BedData[];
  onPick?: (bed: BedData) => void;
}

/** Interactive 3D "digital twin" of the hospital: floors = departments, pods = beds. */
export default function HospitalTower({ beds, onPick }: TowerProps) {
  const floors = useMemo<Floor[]>(() => {
    const map = new Map<number, Floor>();
    for (const b of beds) {
      if (!map.has(b.dept_id)) {
        map.set(b.dept_id, { key: b.dept_id, floor: b.floor_number, code: b.dept_code, name: b.dept_name, beds: [] });
      }
      map.get(b.dept_id)!.beds.push(b);
    }
    const list = Array.from(map.values()).sort((a, b) => a.floor - b.floor);
    list.forEach((f) => f.beds.sort((a, b) => a.bed_id - b.bed_id));
    return list;
  }, [beds]);

  const maxPods = Math.max(3, ...floors.map((f) => f.beds.length));
  const slabW = maxPods * POD_GAP + 1.1;
  const towerH = Math.max(1, floors.length) * FLOOR_H;

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [9.2, towerH * 0.9 + 3, 11.2], fov: 36 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#04060c']} />
      <fog attach="fog" args={['#04060c', 13, 28]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} color="#cdefff" />
      <pointLight position={[-6, 3, -4]} intensity={30} color="#9474ff" />
      <pointLight position={[6, 1, 5]} intensity={20} color="#2ee6f5" />

      <group position={[0, -towerH / 2 + 0.2, 0]}>
        {floors.map((f, i) => (
          <FloorSlab key={f.key} floor={f} index={i} width={slabW} onPick={onPick} />
        ))}
        <ElevatorCore height={towerH} z={-1.45} />
        <Ground />
      </group>

      <Sparkles count={70} scale={[12, 9, 12]} size={2.2} speed={0.35} color="#7af7ff" opacity={0.6} />

      <OrbitControls
        enablePan={false}
        enableZoom
        minDistance={7}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.05}
        autoRotate
        autoRotateSpeed={0.55}
        enableDamping
      />

      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={0.55} luminanceSmoothing={0.2} intensity={1.15} />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}

function FloorSlab({
  floor,
  index,
  width,
  onPick,
}: {
  floor: Floor;
  index: number;
  width: number;
  onPick?: (bed: BedData) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const [landed, setLanded] = useState(false);
  const targetY = index * FLOOR_H;
  const delay = 0.25 + index * 0.18;

  // Floors drop into place one after another
  useFrame(({ clock }) => {
    if (!group.current) return;
    const p = Math.min(1, Math.max(0, (clock.elapsedTime - delay) / 1.1));
    const e = 1 - Math.pow(1 - p, 4);
    group.current.position.y = targetY + (1 - e) * 7;
    group.current.visible = p > 0;
    if (p >= 1 && !landed) setLanded(true);
  });

  const startX = -((floor.beds.length - 1) * POD_GAP) / 2;

  return (
    <group ref={group} position={[0, targetY + 7, 0]} visible={false}>
      {/* Glass slab */}
      <RoundedBox args={[width, 0.1, 2.5]} radius={0.04} smoothness={2}>
        <meshStandardMaterial color="#0d1a2a" transparent opacity={0.55} roughness={0.15} metalness={0.6} />
        <Edges color="#2ee6f5" threshold={15} />
      </RoundedBox>
      {/* Neon trim */}
      <mesh position={[0, 0.06, 1.25]}>
        <boxGeometry args={[width, 0.015, 0.015]} />
        <meshBasicMaterial color="#7af7ff" toneMapped={false} />
      </mesh>

      {floor.beds.map((b, i) => (
        <Pod key={b.bed_id} bed={b} position={[startX + i * POD_GAP, 0.22, 0.15]} onPick={onPick} />
      ))}

      {landed && (
      <Html position={[-width / 2 - 0.15, 0.1, 1.2]} center distanceFactor={11} zIndexRange={[20, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded-md border border-pulse-400/30 bg-ink-950/80 px-2 py-1 font-mono text-[11px] text-pulse-300 shadow-[0_0_20px_-4px_rgba(46,230,245,0.6)] backdrop-blur">
          F{floor.floor} · {floor.code}
        </div>
      </Html>
      )}
    </group>
  );
}

function Pod({
  bed,
  position,
  onPick,
}: {
  bed: BedData;
  position: [number, number, number];
  onPick?: (bed: BedData) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const [hover, setHover] = useState(false);
  const color = STATUS_HEX[bed.operational_status] ?? '#94a3b8';
  const occupied = bed.operational_status === 'Occupied';
  const critical = occupied && bed.triage_priority === 1;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    let k = 0.55;
    if (occupied) {
      // heartbeat: sharp spike then decay, faster for critical patients
      const bpm = critical ? 130 : 72;
      const phase = (t * bpm) / 60 % 1;
      k = 0.6 + Math.exp(-phase * 9) * (critical ? 3.2 : 1.8);
    } else if (bed.operational_status === 'Sanitizing') {
      k = 0.5 + (Math.sin(t * 2.4) * 0.5 + 0.5) * 1.2;
    } else if (bed.operational_status === 'Reserved') {
      // ambulance strobe: two quick flashes every second
      const p = t % 1;
      k = 0.5 + (p < 0.08 || (p > 0.16 && p < 0.24) ? 3.4 : 0);
    } else if (bed.operational_status === 'Available') {
      k = 0.75;
    } else {
      k = 0.15;
    }
    if (hover) k += 0.8;
    if (mat.current) mat.current.emissiveIntensity = k;
    if (mesh.current) {
      const s = hover ? 1.16 : 1;
      mesh.current.scale.lerp(tmp.set(s, s, s), 0.18);
    }
  });

  return (
    <group position={position}>
      <RoundedBox
        ref={mesh as any}
        args={[0.82, 0.26, 1.3]}
        radius={0.08}
        smoothness={3}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onPick?.(bed);
        }}
      >
        <meshStandardMaterial
          ref={mat}
          color={color}
          emissive={color}
          emissiveIntensity={0.7}
          roughness={0.35}
          metalness={0.1}
          toneMapped={false}
        />
      </RoundedBox>
      {/* Pillow */}
      <RoundedBox args={[0.58, 0.08, 0.26]} radius={0.03} position={[0, 0.17, -0.42]}>
        <meshStandardMaterial color="#e2e8f0" emissive="#ffffff" emissiveIntensity={0.15} />
      </RoundedBox>
      {/* Bed rail glow underneath */}
      <mesh position={[0, -0.14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.1, 1.6]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} toneMapped={false} />
      </mesh>

      {critical && <Beacon />}
      {bed.operational_status === 'Reserved' && <Beacon color="#38bdf8" speed={11} />}
      {bed.has_ventilator && (
        <mesh position={[0.5, 0.25, -0.5]}>
          <cylinderGeometry args={[0.05, 0.05, 0.5, 12]} />
          <meshStandardMaterial color="#b79bff" emissive="#9474ff" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      )}

      {hover && (
        <Html position={[0, 1.05, 0]} center distanceFactor={9} zIndexRange={[60, 40]}>
          <div className="pointer-events-none w-48 select-none rounded-xl border border-tint/20 bg-ink-950/90 p-2.5 text-left shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-fg">
                {bed.room_number} · {bed.bed_label}
              </span>
              <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color }}>
              {bed.operational_status} · {bed.ward_type}
            </div>
            {bed.operational_status === 'Reserved' && bed.hold_alert_code && (
              <div className="mt-1.5 border-t border-tint/[0.14] pt-1.5 text-[11px] text-sky-200">
                Held for ambulance {bed.hold_alert_code}
                {bed.hold_esi ? <span className="ml-1 font-mono text-sky-300">ESI {bed.hold_esi}</span> : null}
              </div>
            )}
            {occupied && bed.patient_name && (
              <div className="mt-1.5 border-t border-tint/[0.14] pt-1.5 text-[11px] text-fg2">
                {bed.patient_name}
                {bed.triage_priority ? (
                  <span className="ml-1 font-mono text-rose-300">ESI {bed.triage_priority}</span>
                ) : null}
              </div>
            )}
            <div className="mt-1 text-[10px] text-fg3">Click to locate in grid</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/** Pulsing vertical light shaft marking an ESI-1 patient. */
function Beacon({ color = '#ff3b5c', speed = 7 }: { color?: string; speed?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.25 + (Math.sin(clock.elapsedTime * speed) * 0.5 + 0.5) * 0.45;
  });
  return (
    <mesh position={[0, 1.6, 0]}>
      <cylinderGeometry args={[0.06, 0.22, 3, 16, 1, true]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Glass elevator shaft with a car travelling between floors. */
function ElevatorCore({ height, z }: { height: number; z: number }) {
  const car = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (car.current) car.current.position.y = (Math.sin(clock.elapsedTime * 0.6) * 0.5 + 0.5) * (height - 0.4) + 0.2;
  });
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, height / 2 - 0.2, 0]}>
        <boxGeometry args={[0.5, height + 0.4, 0.5]} />
        <meshStandardMaterial color="#2ee6f5" transparent opacity={0.06} />
        <Edges color="#2ee6f5" />
      </mesh>
      <mesh ref={car}>
        <boxGeometry args={[0.36, 0.3, 0.36]} />
        <meshStandardMaterial color="#7af7ff" emissive="#2ee6f5" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Ground() {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) {
      const s = 1 + ((clock.elapsedTime * 0.35) % 1) * 1.4;
      ring.current.scale.set(s, s, s);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ((clock.elapsedTime * 0.35) % 1));
    }
  });
  return (
    <group position={[0, -0.35, 0]}>
      <gridHelper args={[26, 26, '#13c8db', '#0f2236']} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[3.6, 3.66, 96]} />
        <meshBasicMaterial color="#2ee6f5" transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[3.6, 3.64, 96]} />
        <meshBasicMaterial color="#9474ff" transparent opacity={0.5} toneMapped={false} />
      </mesh>
    </group>
  );
}
