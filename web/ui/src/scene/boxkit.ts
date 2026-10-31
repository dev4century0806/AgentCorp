import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glowSurface, shading, surface, type RenderStyle, type Surface, type SurfaceParameters } from './shading.js';
import { ROOM_CENTER, WALLS, type Wall } from './view.js';

/**
 * The voxel vocabulary the whole office is built from.
 *
 * Everything in the room is an axis-aligned box with a flat material (Lambert,
 * or toon in the storybook style), so geometries and materials are shared
 * aggressively: a full office is a few thousand meshes but only a few dozen
 * distinct geo/material pairs.
 */

const matCache = new Map<string, Surface>();
const shared = new WeakSet<THREE.Material>();
const geoCache = new Map<string, THREE.BoxGeometry>();

export function mat(color: string, glow = false): Surface {
  const key = `${shading()}:${color}${glow ? 'g' : ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = glow ? glowSurface(color, 0.9) : surface({ color });
    matCache.set(key, m);
    shared.add(m);
  }
  return m;
}

/** Marks a material made once for every room, so throwing a room away keeps it. */
export function keep<T extends THREE.Material>(m: T): T {
  shared.add(m);
  return m;
}

/**
 * A surface every room in a style shares, and kept: made at once in the
 * style of the moment (voxel, when a module loads), and in another the first
 * time a room is built in it.
 */
export function sharedSurface(params: SurfaceParameters): () => Surface {
  const made = new Map<RenderStyle, Surface>([[shading(), keep(surface(params))]]);
  return () => {
    let m = made.get(shading());
    if (!m) {
      m = keep(surface(params));
      made.set(shading(), m);
    }
    return m;
  };
}

/**
 * Frees what a room made for itself before it is thrown away: its drawn
 * textures and its own materials (and any geometry marked `ownGeometry`). The cached box geometry and materials are
 * shared by every room, so they stay.
 */
export function disposeRoom(root: THREE.Object3D, extra: THREE.Material[] = []): void {
  const seen = new Set<THREE.Material>(extra);
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const one of Array.isArray(m) ? m : m ? [m] : []) seen.add(one);
    // Geometry made for one object (a cloud of particles), not the cached boxes everyone shares.
    if (o.userData.ownGeometry) (o as THREE.Mesh).geometry.dispose();
  });
  for (const m of seen) {
    (m as THREE.MeshBasicMaterial).map?.dispose();
    if (!shared.has(m)) m.dispose();
  }
}

/** A box, with its edges rounded in the smooth style: by a quarter of its thinnest side, and never more than 8 cm. */
export function geo(w: number, h: number, d: number): THREE.BoxGeometry {
  const round = shading() === 'smooth';
  const key = `${round ? 'round:' : ''}${w}_${h}_${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = round ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.08, Math.min(w, h, d) * 0.25)) : new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

export interface BoxOpts {
  glow?: boolean;
  /** Walls and floors receive shadow but should not cast it. */
  cast?: boolean;
}

export function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
  o: BoxOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo(w, h, d), mat(color, o.glow));
  m.position.set(x, y, z);
  m.castShadow = o.cast !== false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

/** The door on the left wall: midway between the corner plant and the nearest window. */
export const DOOR_Z = 4.9;

/**
 * Lays a skin's floor texture over the room's 20 by 20 square and trims all
 * four of its edges, so the floor reads as a slab from whichever corner the
 * camera looks in. `glow` lines the edges with a light strip as well.
 */
export function floorSlab(scene: THREE.Object3D, tex: THREE.Texture, trim: string, glow?: string): void {
  const z = ROOM_CENTER.z;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), surface({ map: tex }));
  f.rotation.x = -Math.PI / 2;
  f.position.z = z;
  f.receiveShadow = true;
  scene.add(f);
  for (const s of [-1, 1]) {
    box(20.4, 0.5, 0.2, trim, 0, -0.25, z + s * 10.1, scene, { cast: false });
    box(0.2, 0.5, 20.4, trim, s * 10.1, -0.25, z, scene, { cast: false });
    if (!glow) continue;
    box(20, 0.03, 0.04, glow, 0, 0.0, z + s * 9.98, scene, { glow: true, cast: false });
    box(0.04, 0.03, 20, glow, s * 9.98, 0.0, z, scene, { glow: true, cast: false });
  }
}

/** The room's four walls, each a group holding the wall and everything mounted on it. */
export type Walls = Record<Wall, THREE.Group>;

/** Each wall's turn about +y from the back wall, round the middle of the floor. */
const WALL_TURN: Record<Wall, number> = { back: 0, left: Math.PI / 2, front: Math.PI, right: -Math.PI / 2 };

/**
 * A group on one wall to build something in. What is built in it is drawn as
 * if along the back wall, in metres from the middle of the floor, where the
 * wall's inside face is at z = −10 and runs x −10…10, left to right as seen
 * from inside the room; the group turns it onto `wall`.
 */
export function onWall(walls: Walls, wall: Wall): THREE.Group {
  const g = new THREE.Group();
  g.position.set(ROOM_CENTER.x, 0, ROOM_CENTER.z);
  g.rotation.y = WALL_TURN[wall];
  walls[wall].add(g);
  return g;
}

/** Builds the same thing on every wall, each copy drawn as on `onWall`'s group. */
export function onEveryWall(walls: Walls, build: (g: THREE.Group, wall: Wall) => void): void {
  for (const wall of WALLS) build(onWall(walls, wall), wall);
}

/**
 * Where every skin has its windows, along each wall as `onWall` draws it:
 * three in the left wall between the far corner and the door, and one in the
 * back wall.
 */
export const WINDOWS = { left: [7.2, 3.6, -0.2], back: -1.9 } as const;

export const WALL = '#2f2d55';
export const TRIM = '#3d3a6b';
export const WOOD = '#9a5a2b';
export const DARKWOOD = '#6e3c1c';

export const SHIRTS = ['#4f7fe0', '#c8553d', '#7a5cc4', '#3e9a5c', '#d98a3d', '#2f8f9a', '#b8476e', '#e0c040'];
export const HAIRS = ['#2a1d14', '#1c1c1c', '#8a5a3b', '#c9a15a', '#5a3a28', '#b0442a'];
export const SKINS = ['#f1c7a0', '#e2a97e', '#c68a5c', '#8d5a3a', '#f5d4b5'];
