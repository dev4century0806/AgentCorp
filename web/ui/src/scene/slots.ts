import { OFFICE_SLOTS, type OfficeSlot } from '@shared';
import type { DeskTop } from './desks.js';
import type { Skin } from './skin.js';
import { ROOM_CENTER, type Wall } from './view.js';

/**
 * Where each of the contract's named slots is in the room. The contract fixes
 * only how big a decoration may be (`OFFICE_SLOTS[id].max`); this is where
 * the renderer puts it, chosen to stand clear of everything workers use in
 * every base room: the sixteen desks, the corridors they walk (including the
 * short walks to the board, rack, coffee and the rest), the places they stand,
 * and the fixtures. `slots.test.ts` checks that against the built rooms.
 *
 * Coordinates are the room's: x −10…10 across it, z −8…12 from the back wall
 * to the front, y up from the floor.
 *
 * - Floor slots stand on the floor. Their origin is the middle of the
 *   footprint; the parts' x and z are measured from it, y from the floor.
 *   Local +x is world +x and local +z is towards the front wall, the side the
 *   camera starts on, so a figure facing +z faces the default view.
 * - Wall slots are on the inside of a wall. The origin is the middle of the
 *   area; x runs left to right as seen from inside the room, y up from the
 *   middle, and +z comes out of the wall into the room. The decoration is
 *   built into that wall's group, so it hides with the wall when the view
 *   turns and that wall is one of the two nearest the camera.
 * - The desk slot is on every desk top, beside the screen on the side away
 *   from the pod's centre, and turned to face whoever sits there.
 */

/** A box in room coordinates. */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** Floor footprints: x0…x1 by z0…z1. Each is at least as big as the slot's `max` width and depth. */
export const FLOOR_RECTS = {
  // Beside the back-left shelf, in the corner, short of the back corridor and of the 'books' place.
  'back-left-corner': { x0: -10, x1: -8.4, z0: -8, z1: -6.6 },
  'back-right-corner': { x0: 9, x1: 10, z0: -6.6, z1: -5.2 },
  // Along the right wall between that corner and the sofa.
  'right-wall-floor': { x0: 8.8, x1: 10, z0: -5, z1: -1.6 },
  'front-left': { x0: -10, x1: -7, z0: 8, z1: 10.4 },
  'front-centre': { x0: -2, x1: 2, z0: 8, z1: 10.4 },
  'front-right': { x0: 7, x1: 10, z0: 8, z1: 10.4 },
} as const satisfies Record<string, { x0: number; x1: number; z0: number; z1: number }>;

/** Where along each wall a wall slot's area is centred (`u`: x for the back and front walls, z for the others), and how high. */
export const WALL_AREAS = {
  'back-wall-high': { wall: 'back', u: 0, y: 4.4 },
  'left-wall-high': { wall: 'left', u: ROOM_CENTER.z, y: 4.4 },
  'right-wall-high': { wall: 'right', u: ROOM_CENTER.z, y: 4.4 },
  'right-wall': { wall: 'right', u: -3.3, y: 2.3 },
  'front-wall': { wall: 'front', u: 0, y: 2.5 },
} as const satisfies Record<string, { wall: Wall; u: number; y: number }>;

/** The inside face of a wall in `onWall`'s coordinates, which is drawn as if along the back wall. */
export const WALL_FACE = -10;

export type FloorSlot = keyof typeof FLOOR_RECTS;
export type WallSlot = keyof typeof WALL_AREAS;

export const isFloorSlot = (id: OfficeSlot): id is FloorSlot => id in FLOOR_RECTS;
export const isWallSlot = (id: OfficeSlot): id is WallSlot => id in WALL_AREAS;

/** The middle of a floor slot's footprint. */
export function floorOrigin(id: FloorSlot): { x: number; z: number } {
  const r = FLOOR_RECTS[id];
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

/** A wall slot's middle in the coordinates of that wall's `onWall` group: along it, up it, and on its face. */
export function wallOrigin(id: WallSlot): { wall: Wall; x: number; y: number; z: number } {
  const a = WALL_AREAS[id];
  // `onWall` draws the back wall's x as world x, and turns the others about the middle of the floor.
  const x = a.wall === 'back' ? a.u : a.wall === 'front' ? -a.u : a.wall === 'right' ? a.u - ROOM_CENTER.z : ROOM_CENTER.z - a.u;
  return { wall: a.wall, x, y: a.y, z: WALL_FACE };
}

/** The height of each base's desk tops. */
export const DESK_TOP_Y: Record<Skin, number> = { office: 0.75 };

/**
 * Where a desk's decoration stands: beside the screen on the pod-outer side,
 * takes the edge nearest the pod's middle line, so it stands further out
 * there), turned to face the sitter.
 */
export function deskOrigin(top: DeskTop, base: Skin): { x: number; y: number; z: number; rot: number } {
  return {
    x: top.x + top.outer * 0.56,
    y: DESK_TOP_Y[base],
    z: top.z - top.side * 0.15,
    rot: top.side < 0 ? Math.PI : 0,
  };
}

/** The box a slot's largest decoration fills, in room coordinates (desk: around the first desk). Floor and desk slots only; wall slots are in `wallBox`. */
export function floorBox(id: FloorSlot): Box {
  const r = FLOOR_RECTS[id];
  return { min: [r.x0, 0, r.z0], max: [r.x1, OFFICE_SLOTS[id].max[1], r.z1] };
}

/** The box of a wall slot's area in room coordinates, up to 0.3 m out from the wall. */
export function wallBox(id: WallSlot): Box {
  const a = WALL_AREAS[id];
  const [w, h, d] = OFFICE_SLOTS[id].max;
  const lo = a.u - w / 2;
  const hi = a.u + w / 2;
  const y0 = a.y - h / 2;
  const y1 = a.y + h / 2;
  switch (a.wall) {
    case 'back':
      return { min: [lo, y0, -8], max: [hi, y1, -8 + d] };
    case 'front':
      return { min: [lo, y0, 12 - d], max: [hi, y1, 12] };
    case 'left':
      return { min: [-10, y0, lo], max: [-10 + d, y1, hi] };
    case 'right':
      return { min: [10 - d, y0, lo], max: [10, y1, hi] };
  }
}
