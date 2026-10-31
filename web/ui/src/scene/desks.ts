import * as THREE from 'three';
import { box, mat, DARKWOOD, DOOR_Z, WOOD } from './boxkit.js';
import { PALETTES, type Palette, type Skin } from './skin.js';
import type { RoomStyle } from './style.js';

/**
 * Sixteen desks in four pods, plus the walkable layout the workers use.
 *
 * Desk order is the server's `deskIndex`, so seat assignment is decided once
 * on the server and the scene just honours it.
 */

export interface Desk {
  x: number;
  z: number;
  /** Facing when seated. */
  rot: number;
  /** The corridor this desk feeds into, used by the router. */
  lane: number;
  screen: THREE.Mesh;
  screenOn: THREE.Material;
  screenOff: THREE.Material;
}

/** A desk lamp's glowing part, which goes dark with its light. Null for a pod with no lamp. */
export type LampShade = { mesh: THREE.Mesh; on: THREE.Material; off: THREE.Material } | null;

export interface Place {
  x: number;
  z: number;
  lane: number;
  face: number;
}

const PODS: [number, number][] = [
  [-4, -3.0],
  [3.2, -3.0],
  [-4, 3.3],
  [3.2, 3.3],
];

/** Where one desk's top sits, for anything that stands something on it. */
export interface DeskTop {
  x: number;
  z: number;
  /** Which side of the pod it is on: the sitter is at `z + side * 1.3`. */
  side: number;
  /** Which end of the pair it is: -1 towards the pod's centre line, +1 away from it. */
  outer: number;
}

/**
 * The sixteen desk tops in `deskIndex` order, laid out the same way
 * `buildDesks` lays them out, so a decoration can find a desk without
 * building a room. `desks.test.ts` holds the two in step.
 */
export const DESK_TOPS: readonly DeskTop[] = PODS.flatMap(([cx, cz]) =>
  [-1, 1].flatMap((side) => [-0.78, 0.78].map((dx) => ({ x: cx + dx, z: cz + side * 0.45, side, outer: Math.sign(dx) }))),
);

/**
 * the assistant's counter, where anything left at reception stands: its centre and the
 * height of its top.
 */
export const RECEPTION_COUNTER = { x: -7.15, z: 5.2, top: 0.81 };

/** Anywhere a worker goes other than its own desk. */
export type Spot = 'rack' | 'board' | 'books' | 'coffee' | 'door';

const atBackWall = (x: number, z = -6.8, face = Math.PI): Place => ({ x, z, lane: -6.2, face });
const atLeftWall = (x: number, z: number): Place => ({ x, z, lane: 0.25, face: -Math.PI / 2 });
const atRightWall = (x: number, z: number): Place => ({ x, z, lane: 7.2, face: Math.PI / 2 });

/**
 * Where to stand at each spot, best first. Several workers can be at the rack
 * or the board at once, so each has room for a few side by side.
 */
export const SPOTS: Record<Spot, Place[]> = {
  // At the console, then either side of the rack, turned in towards it.
  rack: [atBackWall(-0.2, -6.5), atBackWall(-0.85, -6.55, Math.PI - 0.55), atBackWall(0.45, -6.55, Math.PI + 0.55)],
  board: [4.9, 4.2, 5.6, 6.3].map((x) => atBackWall(x)),
  // Reading with their back to the shelf: facing it, the book is hidden from the camera.
  // The two bookshelves; the gap between the first one and the window is the Idea corkboard.
  books: [-7.4, 1.6, -7.9, 2.1].map((x) => atBackWall(x, -6.7, 0)),
  coffee: [-0.07, 0.57].map((z) => atLeftWall(-8.5, z)),
  // On the front corridor (z 6.6), then along the wall to the door, so nobody walks through a desk.
  door: [{ x: -9.4, z: DOOR_Z, lane: 6.6, face: -Math.PI / 2 }],
};

const LANES_X = [-7.6, -0.6, 6.6];

export function buildDesks(
  scene: THREE.Object3D,
  skin: Skin,
  style?: RoomStyle,
): { desks: Desk[]; lamps: THREE.PointLight[]; shades: LampShade[]; hitTargets: THREE.Mesh[] } {
  const desks: Desk[] = [];
  const hitTargets: THREE.Mesh[] = [];
  const lamps: THREE.PointLight[] = [];
  const shades: LampShade[] = [];
  const P = style?.palette ?? PALETTES[skin];

  for (const [cx, cz] of PODS) {
    for (const side of [-1, 1]) {
      for (const dx of [-0.78, 0.78]) {
        const dz = side * 0.45;
        const x = cx + dx;
        const z = cz + dz;

        const toCenter = -side;
        const mz = z + toCenter * 0.12;
        const seatZ = cz + side * 1.3;
        const rot = side < 0 ? 0 : Math.PI;
        const dir = { x: Math.sin(rot), z: Math.cos(rot) };

        const top = box(1.5, 0.08, 0.85, WOOD, x, 0.71, z, scene);
        box(0.06, 0.67, 0.8, DARKWOOD, x - 0.72, 0.335, z, scene);
        box(0.06, 0.67, 0.8, DARKWOOD, x + 0.72, 0.335, z, scene);
        box(1.4, 0.4, 0.05, DARKWOOD, x, 0.45, cz + side * 0.04, scene);

        box(0.55, 0.45, 0.5, '#d8cfb2', x, 1.0, mz, scene);
        box(0.3, 0.06, 0.3, '#c4bb9c', x, 0.78, mz, scene);
        const screen = box(0.42, 0.32, 0.02, P.screenOn, x, 1.02, mz + side * 0.26, scene, {
          glow: true,
          cast: false,
        });
        box(0.48, 0.03, 0.16, '#e6dfc8', x, 0.765, z + side * 0.25, scene);

        officeChair(scene, x, seatZ, dir);

        const lane = cz < 0 ? (side < 0 ? -6.2 : 0.25) : side < 0 ? 0.25 : 6.6;
        top.userData = { kind: 'desk', deskIndex: desks.length };
        hitTargets.push(top);
        desks.push({
          x,
          z: seatZ,
          rot,
          lane,
          screen,
          screenOn: mat(P.screenOn, true),
          screenOff: mat(P.screenOff),
        });
      }
    }

    box(0.24, 0.05, 0.24, '#3a2a20', cx, 0.77, cz, scene);
    box(0.05, 0.5, 0.05, '#3a2a20', cx, 1.0, cz, scene);
    const shade = box(0.42, 0.24, 0.42, '#ffcf4a', cx, 1.3, cz, scene, { glow: true });
    shades.push({ mesh: shade, on: mat('#ffcf4a', true), off: mat('#8a7440') });

    const pl = new THREE.PointLight(0xffb54a, 0.7, 5.5, 2);
    pl.position.set(cx, 1.2, cz);
    scene.add(pl);
    lamps.push(pl);
  }

  for (const d of desks) setScreen(d, false);
  return { desks, lamps, shades, hitTargets };
}

/** The office's desk chair, facing `dir`. */
export function officeChair(scene: THREE.Object3D, x: number, z: number, dir: { x: number; z: number }): void {
  box(0.5, 0.08, 0.5, '#3a3d4a', x, 0.44, z, scene);
  box(0.08, 0.4, 0.08, '#2a2c36', x, 0.22, z, scene);
  box(0.5, 0.06, 0.5, '#2a2c36', x, 0.04, z, scene);
  box(0.5, 0.55, 0.08, '#3a3d4a', x - dir.x * 0.25, 0.78, z - dir.z * 0.25, scene);
}

/** The same chair the other desks use, in whichever room style is showing. */
function receptionChair(scene: THREE.Object3D, _skin: Skin, x: number, z: number, rot: number): void {
  const dir = { x: Math.sin(rot), z: Math.cos(rot) };
  officeChair(scene, x, z, dir);
}

/**
 * Reception station by the front door, outside the sixteen hire desks.
 */
export function buildReception(scene: THREE.Object3D, skin: Skin, agentId: string, style?: RoomStyle): { desk: Desk; hitTargets: THREE.Mesh[] } {
  const wood = WOOD;
  const trim = DARKWOOD;
  const counterX = RECEPTION_COUNTER.x;
  const counterZ = RECEPTION_COUNTER.z;
  const counter = box(2.3, 0.1, 0.7, wood, counterX, 0.76, counterZ, scene);
  box(2.2, 0.68, 0.1, trim, counterX, 0.38, counterZ - 0.28, scene);
  box(0.1, 0.68, 0.6, trim, counterX + 1.1, 0.38, counterZ, scene);
  const returnX = -8.2;
  const returnZ = 5.72;
  const wing = box(0.7, 0.1, 1.15, wood, returnX, 0.76, returnZ, scene);
  box(0.1, 0.68, 1.05, trim, returnX - 0.28, 0.38, returnZ, scene);
  box(0.6, 0.68, 0.1, trim, returnX, 0.38, returnZ + 0.52, scene);

  box(0.42, 0.09, 0.3, '#e6ddca', counterX + 0.7, 0.86, counterZ, scene);
  box(0.46, 0.07, 0.1, '#34323b', counterX + 0.7, 0.94, counterZ, scene);

  const seatX = -7.15;
  const seatZ = 6.0;
  const rot = Math.PI;
  receptionChair(scene, skin, seatX, seatZ, rot);

  const computer = receptionComputer(scene, skin, style?.palette ?? PALETTES[skin], seatX, counterZ, 0.06);
  const hitTargets = [counter, wing];
  for (const m of hitTargets) m.userData = { agentId };
  const desk: Desk = {
    x: seatX,
    z: seatZ,
    rot,
    lane: 6.6,
    screen: computer.screen,
    screenOn: computer.screenOn,
    screenOff: computer.screenOff,
  };
  setScreen(desk, false);
  return { desk, hitTargets };
}

/** A monitor and keyboard in the room's style, facing the sitter (+z). */
function receptionComputer(
  scene: THREE.Object3D,
  _skin: Skin,
  P: Palette,
  x: number,
  z: number,
  lift: number,
): { screen: THREE.Mesh; screenOn: THREE.Material; screenOff: THREE.Material } {
  const side = 1;
  const mz = z - 0.08;
  const body = '#d8cfb2';
  const stand = '#c4bb9c';
  const keys = '#e6dfc8';
  box(0.55, 0.45, 0.5, body, x, 1.0 + lift, mz, scene);
  box(0.3, 0.06, 0.3, stand, x, 0.78 + lift, mz, scene);
  const screen = box(0.42, 0.32, 0.02, P.screenOn, x, 1.02 + lift, mz + side * 0.26, scene, { glow: true, cast: false });
  box(0.48, 0.03, 0.16, keys, x, 0.765 + lift, z + 0.2, scene);
  return { screen, screenOn: mat(P.screenOn, true), screenOff: mat(P.screenOff) };
}

export function setScreen(desk: Desk, on: boolean): void {
  desk.screen.material = on ? desk.screenOn : desk.screenOff;
}

export function seatPlace(desk: Desk): Place {
  return { x: desk.x, z: desk.z, lane: desk.lane, face: desk.rot };
}

/** Where a reviewer stands: just behind the sitter's shoulder, looking at the same screen. */
export function besidePlace(desk: Desk): Place {
  return {
    x: desk.x + 0.45 - Math.sin(desk.rot) * 0.55,
    z: desk.z - Math.cos(desk.rot) * 0.55,
    lane: desk.lane,
    face: desk.rot,
  };
}

/**
 * Manhattan route between two places along the three corridors, so workers
 * walk around the pods instead of straight through the furniture. Another
 * walker (the office cat) crosses between its lanes by its own `columns`.
 */
export function route(a: Place, b: Place, columns: readonly number[] = LANES_X): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const P = (x: number, z: number): THREE.Vector2 => new THREE.Vector2(x, z);
  pts.push(P(a.x, a.lane));
  if (a.lane !== b.lane) {
    let best = columns[0] as number;
    let bs = 1e9;
    for (const lx of columns) {
      const s = Math.abs(a.x - lx) + Math.abs(b.x - lx);
      if (s < bs) {
        bs = s;
        best = lx;
      }
    }
    pts.push(P(best, a.lane), P(best, b.lane));
  }
  pts.push(P(b.x, b.lane), P(b.x, b.z));
  return pts;
}
