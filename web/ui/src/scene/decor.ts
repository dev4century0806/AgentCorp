import * as THREE from 'three';
import type { Decoration, OfficeManifest, OfficeSlot } from '@shared';
import { onWall, type Walls } from './boxkit.js';
import { DESK_TOPS } from './desks.js';
import { effects } from './effects.js';
import { particles } from './particles.js';
import { deskOrigin, floorBox, floorOrigin, isFloorSlot, isWallSlot, wallBox, wallOrigin, type Box } from './slots.js';
import type { RoomStyle } from './style.js';

/**
 * Puts a generated office's decorations in their slots and its particles in
 * the air. Called last by `buildRoom`, so it can clear what the base room had
 * standing where a decoration now goes; everything it makes is in the room's
 * own groups (or the walls'), so throwing the room away throws it all away.
 */

/** Slots on the near side of the room, where the base room's front dressing (waiting area, lounge, pictures, windows) stands. */
const FRONT: readonly OfficeSlot[] = ['front-left', 'front-centre', 'front-right', 'front-wall', 'right-wall', 'right-wall-floor'];

/** Whether a manifest puts a decoration where the base room's front dressing would be. The room then leaves that dressing out. */
export function replacesFront(manifest: Pick<OfficeManifest, 'decorations'>): boolean {
  return manifest.decorations.some((d) => FRONT.includes(d.slot));
}

export interface Decor {
  tick(t: number, dt: number): void;
}

/** A neighbour whose edge is within this of a box is not in it: the shelves' frames touch the corner slot's edge. */
const EPS = 0.03;

/**
 * Takes out what the base room has standing in `boxes`. Only whole meshes whose
 * bounds reach into a box are removed, never the long pieces of the room
 * itself (walls, skirting, floor trim), and never anything a click or a walk
 * depends on: the slots are placed clear of those, which `slots.test.ts` holds.
 */
export function clearBoxes(scene: THREE.Object3D, boxes: Box[]): number {
  if (!boxes.length) return 0;
  scene.updateMatrixWorld(true);
  const found: THREE.Object3D[] = [];
  const b = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.kind || o.userData.agentId) return;
    b.setFromObject(o);
    if (b.max.x - b.min.x > 15 || b.max.z - b.min.z > 15) return;
    for (const c of boxes) {
      if (b.min.x < c.max[0] - EPS && b.max.x > c.min[0] + EPS && b.min.y < c.max[1] - EPS && b.max.y > c.min[1] + EPS && b.min.z < c.max[2] - EPS && b.max.z > c.min[2] + EPS) {
        found.push(o);
        return;
      }
    }
  });
  for (const o of found) o.parent?.remove(o);
  return found.length;
}

export function decorate(scene: THREE.Object3D, walls: Walls, style: RoomStyle): Decor {
  const { manifest } = style;
  const fx = effects(style.reduceMotion);

  // What the base room has standing where a decoration goes comes out first.
  clearBoxes(
    scene,
    manifest.decorations.flatMap((d): Box[] => (isFloorSlot(d.slot) ? [floorBox(d.slot)] : isWallSlot(d.slot) ? [wallBox(d.slot)] : [])),
  );

  for (const d of manifest.decorations) place(scene, walls, style, fx, d);

  const air = particles(style);
  if (air) scene.add(air.points);

  return {
    tick(t) {
      if (style.reduceMotion) return;
      fx.tick(t);
      air?.tick(t);
    },
  };
}

function place(scene: THREE.Object3D, walls: Walls, style: RoomStyle, fx: ReturnType<typeof effects>, d: Decoration): void {
  const slot = d.slot;
  if (isFloorSlot(slot)) {
    const { x, z } = floorOrigin(slot);
    const g = new THREE.Group();
    g.name = `decor_${slot}`;
    g.position.set(x, 0, z);
    scene.add(g);
    for (const part of d.parts) fx.add(part, g);
  } else if (isWallSlot(slot)) {
    const o = wallOrigin(slot);
    const g = new THREE.Group();
    g.name = `decor_${slot}`;
    g.position.set(o.x, o.y, o.z);
    onWall(walls, o.wall).add(g);
    for (const part of d.parts) fx.add(part, g);
  } else {
    // The desk slot: one copy on each of the sixteen desks, each flickering to its own time.
    DESK_TOPS.forEach((top, i) => {
      const o = deskOrigin(top, style.base);
      const g = new THREE.Group();
      g.name = `decor_desk_${i}`;
      g.position.set(o.x, o.y, o.z);
      g.rotation.y = o.rot;
      scene.add(g);
      for (const part of d.parts) fx.add(part, g, i * 1.7);
    });
  }
}
