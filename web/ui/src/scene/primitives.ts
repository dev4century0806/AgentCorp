import * as THREE from 'three';
import type { Part } from '@shared';
import { box, mat } from './boxkit.js';

/**
 * Meshes for the contract's four primitive shapes. Box geometry comes from
 * boxkit's cache; the round shapes are unit geometries made once and scaled,
 * so a hundred barrels share one cylinder. Colours come from boxkit's shared
 * materials, which a thrown-away room keeps.
 */

const round = new Map<string, THREE.BufferGeometry>();

function unit(shape: 'cylinder' | 'sphere' | 'cone'): THREE.BufferGeometry {
  let g = round.get(shape);
  if (!g) {
    g =
      shape === 'cylinder'
        ? new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
        : shape === 'cone'
          ? new THREE.CylinderGeometry(0, 0.5, 1, 16)
          : new THREE.SphereGeometry(0.5, 16, 12);
    round.set(shape, g);
  }
  return g;
}

/**
 * One part as a mesh in `parent`, centred at `part.at`. Cylinders and cones are
 * sized by width and depth like boxes (round when they are equal, which is
 * what the contract asks for). A part is tipped about its width axis, then
 * turned about the vertical, as the contract says.
 * Glowing is the emissive material; the effects module animates the rest.
 */
export function partMesh(part: Part, parent: THREE.Object3D): THREE.Mesh {
  const [w, h, d] = part.size;
  const [x, y, z] = part.at;
  const glow = part.effect === 'glow';
  let mesh: THREE.Mesh;
  if (part.shape === 'box') {
    mesh = box(w, h, d, part.color, x, y, z, parent, { glow });
  } else {
    mesh = new THREE.Mesh(unit(part.shape), mat(part.color, glow));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  mesh.rotation.order = 'YXZ';
  if (part.tilt) mesh.rotation.x = (part.tilt * Math.PI) / 180;
  if (part.rotate) mesh.rotation.y = (part.rotate * Math.PI) / 180;
  return mesh;
}

/** Whether a part needs to be animated each frame. */
export function moves(part: Part): boolean {
  return part.effect === 'flicker' || part.effect === 'pulse' || part.effect === 'float' || part.effect === 'spin';
}
