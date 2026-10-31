import * as THREE from 'three';
import type { FloorPattern } from '@shared';
import { floorSlab } from './boxkit.js';
import { mix } from './noise.js';
import type { RoomStyle } from './style.js';

/**
 * The floor of a generated office: one of the contract's four patterns in the
 * manifest's two colours, drawn on a 320 px canvas over the 20 m by 20 m room
 * (16 px to the metre, like the built-in floors) and laid in the same slab.
 */

/** A colour lightened (k > 1) or darkened (k < 1). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): string => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** A steady pseudo-random 0..1 for a tile, so a floor looks the same every time it is drawn. */
function grain(i: number, j: number): number {
  return mix(i, j);
}

export function drawFloor(g: CanvasRenderingContext2D, pattern: FloorPattern, color: string, alt: string): void {
  g.fillStyle = color;
  g.fillRect(0, 0, 320, 320);
  switch (pattern) {
    case 'plain':
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++) {
          g.fillStyle = shade(color, 0.98 + grain(i, j) * 0.04);
          g.fillRect(i * 16, j * 16, 16, 16);
        }
      }
      return;
    case 'checker':
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++) {
          g.fillStyle = shade((i + j) % 2 === 0 ? color : alt, 0.97 + grain(i, j) * 0.06);
          g.fillRect(i * 16, j * 16, 16, 16);
          g.fillStyle = 'rgba(255,255,255,.1)';
          g.fillRect(i * 16, j * 16, 16, 1);
          g.fillRect(i * 16, j * 16, 1, 16);
        }
      }
      return;
    case 'planks':
      // Boards 0.5 m wide running across the room, alternating in two tones, with butt joints staggered row by row.
      for (let row = 0; row < 40; row++) {
        const y = row * 8;
        let x = -((row * 37) % 64);
        while (x < 320) {
          const len = 48 + Math.floor(grain(x, row) * 48);
          g.fillStyle = shade(row % 2 === 0 ? color : alt, 0.94 + grain(row, x) * 0.1);
          g.fillRect(x, y, len, 8);
          g.fillStyle = 'rgba(0,0,0,.28)';
          g.fillRect(x, y, len, 1);
          g.fillRect(x + len - 1, y, 1, 8);
          x += len;
        }
      }
      return;
    case 'tiles':
      // Square tiles a metre across, `alt` the grout between them.
      g.fillStyle = alt;
      g.fillRect(0, 0, 320, 320);
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++) {
          g.fillStyle = shade(color, 0.95 + grain(i, j) * 0.08);
          g.fillRect(i * 16 + 1, j * 16 + 1, 14, 14);
          g.fillStyle = 'rgba(255,255,255,.12)';
          g.fillRect(i * 16 + 1, j * 16 + 1, 14, 1);
        }
      }
  }
}

/** Lays the manifest's floor and trims its edges. */
export function userFloor(scene: THREE.Object3D, style: RoomStyle): void {
  const { pattern, color, alt } = style.floor;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 320;
  const g = c.getContext('2d');
  if (g) drawFloor(g, pattern, color, alt);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  // The manifest's colours are sRGB like every other colour in it, so the floor reads them as such.
  tex.colorSpace = THREE.SRGBColorSpace;
  floorSlab(scene, tex, shade(color, 0.55));
}

const MONO_SEAM_EVERY = 2;

/**
 * MONO_SEAM_EVERY metres, so it reads as a floor without filling the room
 * with lines. Drawn at 32 px to the metre so a seam can be one pixel and
 */
export function monoFloor(scene: THREE.Object3D): void {
  const size = 640;
  const metre = size / 20;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    for (let m = MONO_SEAM_EVERY; m < 20; m += MONO_SEAM_EVERY) {
      g.fillRect(m * metre, 0, 1, size);
      g.fillRect(0, m * metre, size, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  floorSlab(scene, tex, '#5a321a');
}
