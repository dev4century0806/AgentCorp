import * as THREE from 'three';

/** A canvas-backed screen, drawn pixel-chunky like the rest of the room. */
export function pixelScreen(w: number, h: number): { g: CanvasRenderingContext2D | null; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return { g: canvas.getContext('2d'), tex };
}
