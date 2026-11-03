'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { useVisible } from './useVisible';
import { Html, Sparkles } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';

export interface VialDatum {
  id: number;
  code: string;
  name: string;
  pct: number; // 0-100
  occupied: number;
  total: number;
}

const H = 3;
const R = 0.52;

const levelColor = (p: number) => (p >= 80 ? '#fb7185' : p >= 50 ? '#fbbf24' : p > 0 ? '#2ee6f5' : '#34d399');

/** Departments as IV-style glass vials; liquid level = bed occupancy %. */
export default function CapacityVials({ data }: { data: VialDatum[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const visible = useVisible(wrap);
  const gap = 1.7;
  const startX = -((data.length - 1) * gap) / 2;
  return (
    <div ref={wrap} className="h-full w-full">
    <Canvas
      dpr={[1, 1.25]}
      frameloop={visible ? 'always' : 'never'}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: [0, 0.6, 10.5], fov: 30 }}
    >
      <color attach="background" args={['#04060c']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 6, 5]} intensity={1.2} />
      <pointLight position={[-4, 2, 3]} intensity={25} color="#9474ff" />
      <Sway>
        {data.map((d, i) => (
          <Vial key={d.id} d={d} x={startX + i * gap} delay={0.2 + i * 0.15} />
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -H / 2 - 0.12, 0]}>
          <circleGeometry args={[5, 64]} />
          <meshStandardMaterial color="#0a1220" roughness={0.4} metalness={0.6} />
        </mesh>
      </Sway>
      <Sparkles count={24} scale={[9, 5, 4]} size={2} speed={0.4} color="#b79bff" />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom mipmapBlur levels={5} resolutionScale={0.5} luminanceThreshold={0.6} intensity={0.9} />
      </EffectComposer>
    </Canvas>
    </div>
  );
}

function Sway({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock, pointer }) => {
    if (!g.current) return;
    const target = Math.sin(clock.elapsedTime * 0.3) * 0.18 + pointer.x * 0.3;
    g.current.rotation.y += (target - g.current.rotation.y) * 0.05;
    g.current.rotation.x += (-pointer.y * 0.06 - g.current.rotation.x) * 0.05;
  });
  return <group ref={g}>{children}</group>;
}

function Vial({ d, x, delay }: { d: VialDatum; x: number; delay: number }) {
  const liquid = useRef<THREE.Mesh>(null);
  const surface = useRef<THREE.Mesh>(null);
  const bubbles = useRef<THREE.Group>(null);
  const color = levelColor(d.pct);
  const fill = Math.max(0.04, Math.min(1, d.pct / 100));

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const p = Math.min(1, Math.max(0, (t - delay) / 1.8));
    const e = 1 - Math.pow(1 - p, 3);
    const h = H * fill * e + 0.001;
    if (liquid.current) {
      liquid.current.scale.y = h;
      liquid.current.position.y = -H / 2 + h / 2;
    }
    if (surface.current) {
      surface.current.position.y = -H / 2 + h;
      surface.current.rotation.x = -Math.PI / 2 + Math.sin(t * 2 + x) * 0.06;
      surface.current.rotation.y = Math.cos(t * 1.7 + x) * 0.06;
    }
    if (bubbles.current) {
      bubbles.current.children.forEach((b, i) => {
        const speed = 0.35 + (i % 3) * 0.15;
        const y = ((t * speed + i * 0.37) % 1) * h;
        b.position.y = -H / 2 + y;
        b.visible = h > 0.2;
      });
    }
  });

  return (
    <group position={[x, 0, 0]}>
      {/* Glass tube */}
      <mesh>
        <cylinderGeometry args={[R, R, H, 48, 1, true]} />
        <meshPhysicalMaterial
          color="#bfefff"
          transparent
          opacity={0.06}
          depthWrite={false}
          roughness={0.05}
          metalness={0.1}
          clearcoat={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Graduation marks */}
      {[0.25, 0.5, 0.75].map((m) => (
        <mesh key={m} position={[0, -H / 2 + H * m, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[R + 0.005, 0.006, 6, 48, Math.PI * 0.6]} />
          <meshBasicMaterial color="#bfefff" transparent opacity={0.35} />
        </mesh>
      ))}
      {/* Liquid */}
      <mesh ref={liquid} position={[0, -H / 2, 0]}>
        <cylinderGeometry args={[R * 0.92, R * 0.92, 1, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} transparent opacity={0.75} toneMapped={false} />
      </mesh>
      <mesh ref={surface}>
        <circleGeometry args={[R * 0.92, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <group ref={bubbles}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[Math.sin(i * 2.1) * R * 0.5, 0, Math.cos(i * 1.3) * R * 0.5]}>
            <sphereGeometry args={[0.035 + (i % 3) * 0.012, 10, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
      {/* Caps */}
      <mesh position={[0, H / 2 + 0.08, 0]}>
        <cylinderGeometry args={[R * 1.08, R * 1.08, 0.16, 48]} />
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -H / 2 - 0.06, 0]}>
        <cylinderGeometry args={[R * 1.12, R * 1.18, 0.12, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} toneMapped={false} />
      </mesh>

      <Html position={[0, -H / 2 - 0.62, 0]} center distanceFactor={7}>
        <div className="pointer-events-none select-none whitespace-nowrap text-center">
          <div className="font-display text-lg font-bold text-fg">{d.pct.toFixed(1)}%</div>
          <div className="font-mono text-[10px] tracking-wider text-fg2">
            {d.code} · {d.occupied}/{d.total}
          </div>
        </div>
      </Html>
    </group>
  );
}
