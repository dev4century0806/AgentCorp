import * as THREE from 'three';
import type { ParticleKind } from '@shared';
import { mix } from './noise.js';
import type { RoomStyle } from './style.js';

/**
 * The air of a generated office: snow, embers, bubbles, dust, leaves or
 * sparkles drifting through the room. A few dozen to a couple of hundred
 * points in one draw call, each a pure function of the time (no state to step),
 * so it costs one loop over a small array a frame. None at all with reduced
 * motion, and none when density is 0.
 */

const VOLUME = { x: [-9.3, 9.3], y: [0.05, 4.8], z: [-7.3, 11.3] } as const;

/** How many points a density of 0..1 draws. */
export function particleCount(density: number): number {
  return density <= 0 ? 0 : Math.round(16 + 200 * Math.min(1, density));
}

interface Kind {
  /** Metres a second, down (negative: up). */
  fall: [number, number];
  /** How far it wanders sideways, and how fast. */
  sway: number;
  rate: number;
  /** Pixels across, and how see-through. */
  size: number;
  opacity: number;
  /** Whether it breathes in and out together. */
  twinkle: boolean;
}

const KINDS: Record<Exclude<ParticleKind, 'none'>, Kind> = {
  snow: { fall: [0.35, 0.7], sway: 0.3, rate: 0.7, size: 3.5, opacity: 0.9, twinkle: false },
  embers: { fall: [-1.1, -0.5], sway: 0.35, rate: 1.1, size: 2.5, opacity: 0.9, twinkle: true },
  bubbles: { fall: [-0.5, -0.25], sway: 0.25, rate: 0.9, size: 5, opacity: 0.5, twinkle: false },
  dust: { fall: [0.02, 0.06], sway: 0.6, rate: 0.25, size: 2, opacity: 0.55, twinkle: false },
  leaves: { fall: [0.3, 0.55], sway: 0.9, rate: 0.9, size: 4, opacity: 0.95, twinkle: false },
  sparkles: { fall: [-0.05, 0.05], sway: 0.15, rate: 0.6, size: 3, opacity: 0.9, twinkle: true },
};

export interface Particles {
  points: THREE.Points;
  /** Moves every point to scene time `t` seconds. */
  tick(t: number): void;
}

const r = mix;

export function particles(style: Pick<RoomStyle, 'manifest' | 'reduceMotion'>): Particles | null {
  const { kind, color, density } = style.manifest.particles;
  const n = particleCount(density);
  if (kind === 'none' || n === 0 || style.reduceMotion) return null;
  const k = KINDS[kind];
  const [x0, x1] = VOLUME.x;
  const [y0, y1] = VOLUME.y;
  const [z0, z1] = VOLUME.z;
  const H = y1 - y0;

  // Start far enough in that wandering sideways never carries a point through a wall.
  const base = Array.from({ length: n }, (_, i) => ({
    x: x0 + k.sway + r(i, 1) * (x1 - x0 - 2 * k.sway),
    y: r(i, 2) * H,
    z: z0 + k.sway + r(i, 3) * (z1 - z0 - 2 * k.sway),
    v: k.fall[0] + r(i, 4) * (k.fall[1] - k.fall[0]),
    phase: r(i, 5) * Math.PI * 2,
  }));
  const pos = new Float32Array(n * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({
    color,
    size: k.size,
    sizeAttenuation: false,
    transparent: true,
    opacity: k.opacity,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'particles';
  points.frustumCulled = false;
  // Freed with the room, which would otherwise only free its materials.
  points.userData.ownGeometry = true;

  const tick = (t: number): void => {
    for (let i = 0; i < n; i++) {
      const b = base[i]!;
      // Falling wraps from the floor to the ceiling and rising the other way, so the room never empties.
      const y = (((b.y - b.v * t) % H) + H) % H;
      pos[i * 3] = b.x + Math.sin(t * k.rate + b.phase) * k.sway;
      pos[i * 3 + 1] = y0 + y;
      pos[i * 3 + 2] = b.z + Math.cos(t * k.rate * 0.8 + b.phase * 1.7) * k.sway;
    }
    geometry.attributes.position!.needsUpdate = true;
    if (k.twinkle) material.opacity = k.opacity * (0.65 + 0.35 * Math.sin(t * 3.1));
  };
  tick(0);
  return { points, tick };
}
