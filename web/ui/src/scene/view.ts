/**
 * Which way the office camera looks in, as plain maths so it can be tested
 * without a window or a renderer.
 *
 * The camera looks in from one corner of the room. A turn is a quarter turn of
 * the camera round the room's centre: 0 is the corner it has always used, at
 * +x +z. Turns may be fractional while the view is easing from one to the next.
 */

/** The middle of the floor: 20 wide (x −10…10) by 20 deep (z −8…12). */
export const ROOM_CENTER = { x: 0, z: 2 } as const;

export type Wall = 'back' | 'left' | 'front' | 'right';
export const WALLS: readonly Wall[] = ['back', 'left', 'front', 'right'];

/** The way each wall's outside faces. */
const OUTWARD: Record<Wall, { x: number; z: number }> = {
  back: { x: 0, z: -1 },
  left: { x: -1, z: 0 },
  front: { x: 0, z: 1 },
  right: { x: 1, z: 0 },
};

/** The camera's angle round the room for a turn, in radians about +y. */
export function azimuth(turn: number): number {
  return (turn * Math.PI) / 2;
}

/** A turn brought into 0…3. */
export function wrapTurn(turn: number): number {
  return ((Math.round(turn) % 4) + 4) % 4;
}

/** Where the camera sits relative to what it looks at: (20, 17, 20) turned about +y. */
export function camOffset(turn: number): { x: number; y: number; z: number } {
  const a = azimuth(turn);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: 20 * c + 20 * s, y: 17, z: -20 * s + 20 * c };
}

/**
 * What the camera takes in at zoom 1: the whole room from any corner, from
 * the tops of the far walls down to the floor's near corner, with a little to
 * spare. `across` is the width across the screen and `up` the height up it,
 * in metres; `lookAt` is how high over the middle of the floor the camera
 * looks, which puts the room in the middle of the frame.
 */
export const FRAME = { across: 30.6, up: 21, lookAt: 2.5 } as const;

/** How tall the view is, in metres, on a stage `aspect` times as wide as it is tall, at `zoom`. */
export function viewHeight(aspect: number, zoom: number): number {
  return Math.max(FRAME.up, FRAME.across / aspect) / zoom;
}

/** The two walls whose outside faces away from the camera: the ones it looks at, not through. */
export function farWalls(turn: number): Wall[] {
  const cam = camOffset(wrapTurn(turn));
  return WALLS.filter((w) => OUTWARD[w].x * cam.x + OUTWARD[w].z * cam.z < 0);
}

/**
 * Drag-to-pan directions on the floor: `right` runs across the screen to the
 * right, `forward` runs up it, away from the camera.
 */
export function panAxes(turn: number): { right: { x: number; z: number }; forward: { x: number; z: number } } {
  const cam = camOffset(turn);
  const len = Math.hypot(cam.x, cam.z);
  const forward = { x: -cam.x / len, z: -cam.z / len };
  // forward × up, with up = +y.
  return { right: { x: -forward.z, z: forward.x }, forward };
}

/**
 * Whether a figure turned to `ry` shows the camera its back-right, so its pose
 * is drawn mirrored. At azimuth 0 this is the office's old cos(ry) − sin(ry) < 0.
 */
export function mirrored(ry: number, az: number): boolean {
  return Math.cos(ry - az) - Math.sin(ry - az) < 0;
}
