import * as THREE from 'three';
import type { Part } from '@shared';
import { partMesh } from './primitives.js';
import { glowSurface, type Surface } from './shading.js';

/**
 * What a part's `effect` does. `glow` is only an emissive material, drawn by
 * `partMesh`. The rest change a little each frame:
 *
 * - flicker: the glow stutters like a candle.
 * - pulse: the glow breathes slowly.
 * - float: the part bobs up and down.
 * - spin: the part turns about its own vertical axis.
 *
 * With reduced motion nothing moves: a flicker or pulse holds a steady glow
 * and a float or spin stays where it was placed.
 */

export interface Effects {
  /** Meshes made so far that animate. */
  add(part: Part, parent: THREE.Object3D, salt?: number): THREE.Mesh;
  /** Advances every animated part to scene time `t` seconds. */
  tick(t: number): void;
  readonly count: number;
}

const BOB = 0.05;
const SPIN = 0.9;
const UP = new THREE.Vector3(0, 1, 0);
const spin = new THREE.Quaternion();

/** A cheap steady noise in 0..1, so a candle never repeats itself obviously. */
function noise(t: number): number {
  return 0.5 + 0.25 * Math.sin(t) + 0.15 * Math.sin(t * 2.3 + 1.3) + 0.1 * Math.sin(t * 5.1 + 0.4);
}

export function effects(reduceMotion: boolean): Effects {
  const glowing: { m: Surface; kind: 'flicker' | 'pulse'; phase: number }[] = [];
  const bobbing: { mesh: THREE.Mesh; y: number; phase: number }[] = [];
  const spinning: { mesh: THREE.Mesh; base: THREE.Quaternion; speed: number }[] = [];
  let count = 0;

  return {
    add(part, parent, salt = 0) {
      const mesh = partMesh(part, parent);
      const phase = (part.at[0] * 7.3 + part.at[1] * 3.1 + part.at[2] * 5.9 + salt) % (Math.PI * 2);
      switch (part.effect) {
        case 'flicker':
        case 'pulse': {
          // Its own material, since the shared glow one belongs to every part of the colour.
          const m = glowSurface(part.color, 0.8);
          mesh.material = m;
          if (!reduceMotion) glowing.push({ m, kind: part.effect, phase });
          count++;
          break;
        }
        case 'float':
          if (!reduceMotion) bobbing.push({ mesh, y: mesh.position.y, phase });
          count++;
          break;
        case 'spin':
          if (!reduceMotion) spinning.push({ mesh, base: mesh.quaternion.clone(), speed: SPIN * (phase > Math.PI ? -1 : 1) });
          count++;
          break;
      }
      return mesh;
    },
    tick(t) {
      for (const g of glowing) {
        g.m.emissiveIntensity = g.kind === 'flicker' ? 0.35 + 0.65 * noise(t * 9 + g.phase) : 0.45 + 0.4 * Math.sin(t * 1.8 + g.phase);
      }
      for (const b of bobbing) b.mesh.position.y = b.y + Math.sin(t * 1.6 + b.phase) * BOB;
      for (const s of spinning) s.mesh.quaternion.copy(s.base).multiply(spin.setFromAxisAngle(UP, t * s.speed));
    },
    get count() {
      return count;
    },
  };
}
