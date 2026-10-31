import * as THREE from 'three';
import { box, mat, pick, rand } from './boxkit.js';
import { surface } from './shading.js';
import { pixelScreen } from './screens.js';
import type { Palette } from './skin.js';

/**
 * The furniture the front of the room is made from, in any skin's colours:
 * sofas, chairs, low tables, rugs, cabinets and plants for the floor, and
 * pictures, screens, shelves, banners and a clock for the walls; and where
 * the front's pieces stand, which is the same in every skin.
 *
 * Floor pieces take a position and a `rot`, the way a desk chair does: 0
 * faces +z. Wall pieces are drawn as `onWall` draws, against the back wall's
 * inside face at z = −10, in a group that is turned onto the wall they hang on.
 */

/** The inside face of a wall, in the frame `onWall` draws in. */
const FACE = -10;

/** A group at (x, z), turned so its +z faces `rot`, for building something that faces +z. */
export function placed(parent: THREE.Object3D, x: number, z: number, rot: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  parent.add(g);
  return g;
}

export interface Upholstery {
  frame: string;
  seat: string;
  leg: string;
}

/** Somewhere to sit at (x, z), facing `rot`. */
export type Seat = (x: number, z: number, rot: number) => void;

/** One of a skin's desk chairs, facing `dir`. */
export type Chair = (scene: THREE.Object3D, x: number, z: number, dir: { x: number; z: number }) => void;

/** The way a `rot` faces, for a chair that takes a direction. */
export const facing = (rot: number): { x: number; z: number } => ({ x: Math.sin(rot), z: Math.cos(rot) });

/** A table's top and legs. */
export type TableColours = [top: string, leg: string];

/** A low table: a plain one in these colours, or one a skin builds itself at (x, z). */
export type LowTable = TableColours | ((x: number, z: number) => void);

/** A rug's border and the field inside it. */
export type RugColours = [border: string, field: string];

/** A sofa `len` long, its seat facing `rot` and its back behind it, low enough never to hide a desk. */
export function sofa(parent: THREE.Object3D, x: number, z: number, rot: number, len: number, c: Upholstery): void {
  const g = placed(parent, x, z, rot);
  const d = 0.9;
  box(len, 0.3, d, c.frame, 0, 0.25, 0, g);
  box(len, 0.55, 0.22, c.frame, 0, 0.675, -d / 2 + 0.11, g);
  const inner = len - 0.3;
  const n = Math.max(1, Math.round(inner / 0.7));
  const w = inner / n;
  for (let k = 0; k < n; k++) {
    const cx = -inner / 2 + w * (k + 0.5);
    box(w - 0.04, 0.12, d - 0.28, c.seat, cx, 0.46, 0.1, g);
    box(w - 0.06, 0.34, 0.12, c.seat, cx, 0.72, -d / 2 + 0.28, g, { cast: false });
  }
  for (const s of [-1, 1]) box(0.15, 0.62, d, c.frame, s * (len / 2 - 0.075), 0.41, 0, g);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(0.07, 0.1, 0.07, c.leg, sx * (len / 2 - 0.1), 0.05, sz * (d / 2 - 0.1), g, { cast: false });
  }
}

/** A one-seat sofa. */
export function armchair(parent: THREE.Object3D, x: number, z: number, rot: number, c: Upholstery): void {
  sofa(parent, x, z, rot, 1.0, c);
}

/** A bean bag slumped facing `rot`: a fat seat, and a higher back in a darker shade where it has been sat in. */
export function beanBag(parent: THREE.Object3D, x: number, z: number, rot: number, color: string, shade: string): void {
  const g = placed(parent, x, z, rot);
  box(0.84, 0.3, 0.84, color, 0, 0.15, 0, g);
  box(0.7, 0.12, 0.6, color, 0, 0.36, 0.08, g);
  box(0.78, 0.4, 0.3, shade, 0, 0.48, -0.26, g);
}

/** A low table `w` across x and `d` across z. */
export function lowTable(parent: THREE.Object3D, x: number, z: number, w: number, d: number, top: string, leg: string): void {
  box(w, 0.06, d, top, x, 0.42, z, parent);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(0.06, 0.39, 0.06, leg, x + sx * (w / 2 - 0.08), 0.195, z + sz * (d / 2 - 0.08), parent);
  }
}

/** A rug: a border, and a field inside it a hair higher. */
export function rug(parent: THREE.Object3D, x: number, z: number, w: number, d: number, border: string, field: string): void {
  box(w, 0.02, d, border, x, 0.01, z, parent, { cast: false });
  box(w - 0.24, 0.022, d - 0.24, field, x, 0.012, z, parent, { cast: false });
}

/** A meeting table `w` across x and `d` across z, on two panel legs. */
export function meetingTable(parent: THREE.Object3D, x: number, z: number, w: number, d: number, top: string, base: string): void {
  box(w, 0.07, d, top, x, 0.74, z, parent);
  for (const s of [-1, 1]) {
    box(0.12, 0.7, d * 0.55, base, x + s * (w / 2 - 0.45), 0.36, z, parent);
    box(0.5, 0.04, d * 0.7, base, x + s * (w / 2 - 0.45), 0.02, z, parent, { cast: false });
  }
}

/** A low cabinet `len` long, its doors facing `rot`, for standing things on. Returns its group, whose top is at 0.87. */
export function sideboard(parent: THREE.Object3D, x: number, z: number, rot: number, len: number, body: string, top: string): THREE.Group {
  const g = placed(parent, x, z, rot);
  box(len, 0.78, 0.5, body, 0, 0.43, 0, g);
  box(len + 0.04, 0.05, 0.54, top, 0, 0.845, 0, g);
  const n = Math.max(1, Math.round(len / 0.6));
  for (let k = 0; k < n; k++) {
    const dx = -len / 2 + (len / n) * (k + 0.5);
    box(len / n - 0.06, 0.62, 0.01, top, dx, 0.44, 0.255, g, { cast: false });
    box(0.03, 0.12, 0.02, '#c9cdd3', dx + (k % 2 ? -1 : 1) * (len / n / 2 - 0.08), 0.5, 0.265, g, { cast: false });
  }
  for (const s of [-1, 1]) box(0.06, 0.04, 0.46, top, s * (len / 2 - 0.05), 0.02, 0, g, { cast: false });
  return g;
}

/** A desk printer standing on something at `y`, its tray of printed pages towards +z. */
export function printer(parent: THREE.Object3D, x: number, y: number, z: number): void {
  box(0.56, 0.26, 0.44, '#dcdcd4', x, y + 0.13, z, parent);
  box(0.5, 0.02, 0.36, '#9a9a94', x, y + 0.27, z - 0.02, parent, { cast: false });
  box(0.4, 0.03, 0.18, '#f6f4ee', x, y + 0.1, z + 0.28, parent, { cast: false });
  box(0.06, 0.03, 0.02, '#3ddc84', x + 0.2, y + 0.2, z + 0.225, parent, { glow: true, cast: false });
}

/** Turns a builder that faces +x round to face `rot`, by building it in a group of its own at (x, z). */
export function turned(parent: THREE.Object3D, x: number, z: number, rot: number, build: (g: THREE.Group) => void): void {
  build(placed(parent, x, z, rot - Math.PI / 2));
}

/** A coat stand: a pole on a cross foot, pegs at the top, and a coat left on one. */
export function coatStand(parent: THREE.Object3D, x: number, z: number, pole: string, coat: string): void {
  box(0.5, 0.04, 0.08, pole, x, 0.02, z, parent);
  box(0.08, 0.04, 0.5, pole, x, 0.02, z, parent);
  box(0.05, 1.8, 0.05, pole, x, 0.92, z, parent);
  for (const [dx, dz] of [[0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]] as const) box(0.16, 0.03, 0.03, pole, x + dx / 2, 1.72, z + dz / 2, parent, { cast: false });
  box(0.3, 0.7, 0.16, coat, x + 0.1, 1.38, z, parent);
}

/** A potted plant, scaled by `s`, in the skin's pot and leaves. */
export function plant(parent: THREE.Object3D, x: number, z: number, s: number, P: Palette): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  parent.add(g);
  box(0.6, 0.55, 0.6, P.pot, 0, 0.275, 0, g);
  box(0.68, 0.1, 0.68, P.potRim, 0, 0.55, 0, g);
  box(0.08, 1.0, 0.08, P.stem, 0, 1.0, 0, g);
  const leaves = P.leaves;
  for (let i = 0; i < 26; i++) {
    box(0.24, 0.24, 0.24, pick(leaves), rand(-0.42, 0.42), rand(1.3, 2.1), rand(-0.42, 0.42), g);
  }
}

/* ---------- where the front's pieces stand ---------- */

/*
 * The strip along the front wall is laid out the same in every skin: a waiting
 * area by reception, a meeting table in the middle and a lounge in the corner.
 * All of it is in front of the front corridor and the path along it to the
 * break perks (z 7.5), so no worker's route crosses it, and none of it is tall
 * enough to hide a desk. What is tall stands in a corner, against a wall, and
 * goes with that wall.
 */

/** How a skin furnishes one of the front's seating areas. */
export interface SeatingLook {
  rug?: RugColours;
  sofa: Upholstery;
  table: LowTable;
  seat: Seat;
}

function table(scene: THREE.Object3D, look: LowTable, x: number, z: number, w: number, d: number): void {
  if (typeof look === 'function') look(x, z);
  else lowTable(scene, x, z, w, d, ...look);
}

/** The waiting area by reception: a sofa against the left wall facing into the room, a low table, and `seat` across it. */
export function waitingArea(scene: THREE.Object3D, look: SeatingLook): void {
  if (look.rug) rug(scene, -7.7, 9.9, 3.6, 3.0, ...look.rug);
  sofa(scene, -9.4, 9.9, Math.PI / 2, 2.0, look.sofa);
  table(scene, look.table, -8.1, 9.9, 0.7, 1.1);
  look.seat(-6.6, 9.9, -Math.PI / 2);
}

/** The meeting table that `table` builds, `w` by `d`, with four of `chair` down each side, facing it. Returns what `table` does. */
export function meetingArea<T>(scene: THREE.Object3D, table: (x: number, z: number, w: number, d: number) => T, chair: Chair): T {
  const x = -0.5;
  const z = 9.9;
  for (let k = 0; k < 4; k++) {
    chair(scene, x - 1.5 + k, z - 1, { x: 0, z: 1 });
    chair(scene, x - 1.5 + k, z + 1, { x: 0, z: -1 });
  }
  return table(x, z, 4.2, 1.3);
}

/** The lounge in the front-right corner: a sofa with its back to the front wall, a low table, and `seat` at either end. */
export function loungeArea(scene: THREE.Object3D, look: SeatingLook): void {
  if (look.rug) rug(scene, 7.0, 9.9, 4.4, 3.2, ...look.rug);
  sofa(scene, 7.0, 11.35, Math.PI, 2.4, look.sofa);
  table(scene, look.table, 7.0, 9.95, 1.3, 0.7);
  look.seat(5.0, 9.9, Math.PI / 2);
  look.seat(9.0, 9.9, -Math.PI / 2);
}

/** Where the long cabinet against the right wall stands. */
export const LONG_CABINET = { x: 9.6, z: -5.6, rot: -Math.PI / 2, len: 2.2 } as const;

/**
 * Low cabinets against the right wall, either side of the plant and clear of
 * the break perks: a long one and a short one. Returns both, whose tops are
 * at 0.87 and which run along their x, for a skin to stand things on.
 */
export function rightCabinets(scene: THREE.Object3D, body: string, top: string): { long: THREE.Group; short: THREE.Group } {
  const { x, z, rot, len } = LONG_CABINET;
  return {
    long: sideboard(scene, x, z, rot, len, body, top),
    short: sideboard(scene, 9.6, -1.6, rot, 1.6, body, top),
  };
}

/** Where one more thing stands against the right wall, between the cabinets and the break sofa, facing into the room. */
export const BESIDE_CABINETS = { x: 9.62, z: 0.2, rot: -Math.PI / 2 } as const;

/** The front corners, for the tall things that go with a wall: by the left wall, and either side of the far corner. */
export const CORNERS = {
  left: { x: -9.45, z: 11.45 },
  front: { x: 4.3, z: 11.35 },
  right: { x: 9.3, z: 11.35 },
} as const;

/**
 * Where things hang on the front and right walls, along each as `onWall`
 * draws it. On the right wall: three windows over the cabinets and the break
 * over the lounge. On the front wall: up to three over the lounge, two
 * windows, one over the meeting table and one over the waiting area.
 */
export const HUNG = {
  right: { windows: [-7.0, -3.4, 0], overPerks: 3.5, overLounge: [6.3, 8.6] },
  front: { overLounge: [-7.9, -7.0, -6.1], windows: [-3.4, 4.4], overTable: 0.5, overWaiting: 7.7 },
} as const;

/* ---------- on the walls ---------- */

/** A canvas in true colour, `ppm` pixels to the metre, painted now and again once the web fonts have loaded. */
export function paintedTexture(w: number, h: number, ppm: number, paint: Art): THREE.CanvasTexture {
  const pw = Math.round(w * ppm);
  const ph = Math.round(h * ppm);
  const screen = pixelScreen(pw, ph);
  screen.tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (): void => {
    if (!screen.g) return;
    paint(screen.g, pw, ph);
    screen.tex.needsUpdate = true;
  };
  draw();
  void document.fonts?.ready.then(draw);
  return screen.tex;
}

/** What is painted on a picture, screen or banner. It may be painted again, so it must come out the same each time. */
export type Art = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** A framed picture, `w` by `h` with its frame, centred at (x, y) along the wall. */
export function picture(wall: THREE.Object3D, x: number, y: number, w: number, h: number, frame: string, art: Art, ppm = 20): void {
  box(w, h, 0.06, frame, x, y, FACE + 0.03, wall, { cast: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.14), surface({ map: paintedTexture(w - 0.14, h - 0.14, ppm, art) }));
  face.position.set(x, y, FACE + 0.065);
  wall.add(face);
}

/** A flat screen on the wall, lit whatever the room's light. */
export function wallScreen(wall: THREE.Object3D, x: number, y: number, w: number, h: number, bezel: string, paint: Art): void {
  box(w, h, 0.08, bezel, x, y, FACE + 0.04, wall, { cast: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.1), new THREE.MeshBasicMaterial({ map: paintedTexture(w - 0.1, h - 0.1, 40, paint) }));
  face.position.set(x, y, FACE + 0.085);
  wall.add(face);
}

/** A banner `w` by `h` hung from a rod whose top is at `top`. */
export function banner(wall: THREE.Object3D, x: number, top: number, w: number, h: number, rod: string, art: Art, ppm = 40): void {
  box(w + 0.16, 0.05, 0.05, rod, x, top - 0.025, FACE + 0.07, wall, { cast: false });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surface({ map: paintedTexture(w, h, ppm, art) }));
  cloth.position.set(x, top - 0.05 - h / 2, FACE + 0.04);
  wall.add(cloth);
}

/** A floating shelf with a row of things on it: books, pots, a framed photo. */
export function wallShelf(wall: THREE.Object3D, x: number, y: number, w: number, board: string, things: string[]): void {
  box(w, 0.05, 0.26, board, x, y, FACE + 0.13, wall);
  let at = x - w / 2 + 0.12;
  things.forEach((color, k) => {
    const tall = k % 3 === 1;
    const tw = tall ? 0.1 : 0.2;
    const th = tall ? 0.34 : 0.22;
    box(tw, th, 0.16, color, at + tw / 2, y + 0.025 + th / 2, FACE + 0.13, wall, { cast: false });
    at += tw + 0.08;
  });
}

const ROUND = {
  rim: new THREE.CylinderGeometry(0.3, 0.3, 0.05, 28),
  face: new THREE.CylinderGeometry(0.26, 0.26, 0.012, 28),
};

/**
 * A wall clock that keeps the real time. Returns the step that moves its
 * hands, which only does anything once a second.
 */
export function wallClock(wall: THREE.Object3D, x: number, y: number, rim: string, face: string, ink: string): (t: number) => void {
  const disc = (geometry: THREE.CylinderGeometry, color: string, out: number): void => {
    const m = new THREE.Mesh(geometry, mat(color));
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, FACE + out);
    wall.add(m);
  };
  disc(ROUND.rim, rim, 0.025);
  disc(ROUND.face, face, 0.056);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const s = k % 3 === 0 ? 0.04 : 0.025;
    box(s, s, 0.01, ink, x + Math.sin(a) * 0.21, y + Math.cos(a) * 0.21, FACE + 0.066, wall, { cast: false });
  }
  const hand = (length: number, width: number, out: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, FACE + out);
    wall.add(pivot);
    box(width, length, 0.01, ink, 0, length / 2 - 0.03, 0, pivot, { cast: false });
    return pivot;
  };
  const hours = hand(0.15, 0.03, 0.07);
  const minutes = hand(0.21, 0.02, 0.078);
  let shown = -1;
  const step = (t: number): void => {
    const second = Math.floor(t);
    if (second === shown) return;
    shown = second;
    const now = new Date();
    const m = now.getMinutes() + now.getSeconds() / 60;
    // Seen from the room, clockwise carries 12 o'clock (+y) towards 3 (+x): a negative turn about z.
    minutes.rotation.z = -(m / 60) * Math.PI * 2;
    hours.rotation.z = -(((now.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
  };
  step(0);
  return step;
}

/* ---------- what hangs in the pictures ---------- */

/** Hills under a low sun. */
export const hills: Art = (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#f4b860');
  sky.addColorStop(0.6, '#f7dca0');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff4c8';
  g.beginPath();
  g.arc(w * 0.7, h * 0.42, h * 0.14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a9a4a';
  g.beginPath();
  g.ellipse(w * 0.25, h, w * 0.5, h * 0.42, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#4f7a3a';
  g.beginPath();
  g.ellipse(w * 0.85, h, w * 0.45, h * 0.3, 0, Math.PI, 0);
  g.fill();
};

/** Coloured blocks between black lines. */
export const blocks: Art = (g, w, h) => {
  g.fillStyle = '#f4f1e8';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c8553d';
  g.fillRect(0, 0, w * 0.55, h * 0.6);
  g.fillStyle = '#3b6ea8';
  g.fillRect(w * 0.7, h * 0.65, w * 0.3, h * 0.35);
  g.fillStyle = '#e0c040';
  g.fillRect(w * 0.55, 0, w * 0.45, h * 0.25);
  g.fillStyle = '#1d1e22';
  const line = Math.max(1, Math.round(w / 30));
  g.fillRect(w * 0.55, 0, line, h);
  g.fillRect(0, h * 0.6, w, line);
  g.fillRect(w * 0.55, h * 0.25, w * 0.45, line);
  g.fillRect(w * 0.7, h * 0.6, line, h * 0.4);
};

/** A boat out at sea. */
export const sea: Art = (g, w, h) => {
  g.fillStyle = '#a9d0e8';
  g.fillRect(0, 0, w, h * 0.6);
  g.fillStyle = '#3f78a8';
  g.fillRect(0, h * 0.6, w, h * 0.4);
  g.fillStyle = '#6aa0c8';
  for (let x = 0; x < w; x += 6) g.fillRect(x, h * 0.72 + ((x / 6) % 2) * 3, 3, 1);
  g.fillStyle = '#7a4a28';
  g.fillRect(w * 0.35, h * 0.56, w * 0.3, h * 0.06);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.18);
  g.lineTo(w * 0.5, h * 0.55);
  g.lineTo(w * 0.66, h * 0.55);
  g.closePath();
  g.fill();
};

/** A dashboard of the week: a header, a line chart and a row of bars, on dark glass. */
export const dashboard =
  (bg: string, accent: string, second: string): Art =>
  (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(w * 0.05, h * 0.08, w * 0.22, h * 0.06);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(w * 0.3, h * 0.08, w * 0.3, h * 0.06);
    g.strokeStyle = accent;
    g.lineWidth = Math.max(1, h / 40);
    g.beginPath();
    const pts = [0.62, 0.55, 0.58, 0.44, 0.48, 0.36, 0.4, 0.3, 0.33, 0.24];
    pts.forEach((v, i) => {
      const px = w * (0.05 + (i / (pts.length - 1)) * 0.5);
      if (i === 0) g.moveTo(px, h * v);
      else g.lineTo(px, h * v);
    });
    g.stroke();
    const bars = [0.3, 0.45, 0.38, 0.6, 0.52, 0.7];
    bars.forEach((v, i) => {
      g.fillStyle = i % 2 ? second : accent;
      g.fillRect(w * (0.62 + i * 0.055), h * (0.88 - v * 0.7), w * 0.035, h * v * 0.7);
    });
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(w * 0.05, h * 0.86, w * 0.52, 1);
  };

/**
 * A whiteboard: a heading and three columns of marker scrawl in `ink`, with
 * sticky notes in `notes` stuck on down the columns.
 */
export const whiteboard =
  (ink: string, notes: readonly string[]): Art =>
  (g, w, h) => {
    g.fillStyle = '#f7f7f2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = ink;
    const line = Math.max(1, Math.round(h / 40));
    g.fillRect(w * 0.06, h * 0.08, w * 0.3, line * 2);
    for (let c = 0; c < 3; c++) {
      const cx = w * (0.06 + c * 0.32);
      g.fillRect(cx, h * 0.2, w * 0.26, line);
      for (let r = 0; r < 5; r++) g.fillRect(cx, h * (0.3 + r * 0.12), w * (0.1 + ((c * 5 + r) % 4) * 0.04), line);
    }
    const n = Math.max(4, Math.round(w / h) * 3);
    for (let k = 0; k < n; k++) {
      g.fillStyle = notes[k % notes.length] as string;
      const s = h * 0.14;
      g.fillRect(w * (0.2 + (k % 3) * 0.32), h * (0.28 + Math.floor(k / 3) * 0.2), s, s);
    }
  };
