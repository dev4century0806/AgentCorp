import * as THREE from 'three';
import { box, floorSlab, geo, mat, onEveryWall, onWall, sharedSurface, DARKWOOD, WOOD, pick, rand, DOOR_Z, WINDOWS, type Walls } from './boxkit.js';
import { officeChair } from './desks.js';
import {
  armchair,
  BESIDE_CABINETS,
  blocks,
  coatStand,
  CORNERS,
  dashboard,
  hills,
  HUNG,
  loungeArea,
  meetingArea,
  meetingTable,
  picture,
  plant,
  printer,
  rightCabinets,
  sea,
  turned,
  waitingArea,
  wallClock,
  wallScreen,
  wallShelf,
  type Upholstery,
} from './lounge.js';
import { ROOM_CENTER, WALLS } from './view.js';
import { pixelScreen } from './screens.js';
import { keepShading, surface } from './shading.js';
import { PALETTES, type Palette, type Skin } from './skin.js';
import { userFloor } from './floors.js';
import { decorate, replacesFront } from './decor.js';
import type { RoomStyle } from './style.js';

/**
 * The room: floor, walls, windows, shelves, plants, door, the server rack and
 *
 * Ported from the approved mock. Positions are kept verbatim so the room
 */

export interface RoomFixtures {
  boardMesh: THREE.Mesh;
  redrawBoard: (counts: { todo: number; doing: number; done: number }) => void;
  /** `door` is whether someone is coming in or going out; `dt` is seconds since the last frame (0 snaps). */
  tick: (t: number, busy: { rack: boolean; coffee: boolean; door: boolean }, dt: number) => void;
  /** Redraws the Idea corkboard's sticky notes from the count in each lane. */
  redrawIdeas: (counts: IdeaCounts) => void;
  /** Meshes that respond to a click, tagged via userData.kind. */
  hitTargets: THREE.Object3D[];
  /** Update visibility of perk items (coffee machine, game console). */
  /** The four walls, each with what is mounted on it, so the two nearest the camera can be hidden. */
  walls: Walls;
  backdrop: THREE.Group | null;
}

/**
 * The four walls round the 20 by 20 floor, each with its top trim, its
 * skirting and, in the future office, its light strips. Each is a group of
 * its own, which whatever is mounted on that wall is built into.
 */
function buildWalls(scene: THREE.Object3D, P: Palette): Walls {
  const walls = Object.fromEntries(
    WALLS.map((w) => {
      const g = new THREE.Group();
      g.name = `wall_${w}`;
      scene.add(g);
      return [w, g];
    }),
  ) as Walls;
  onEveryWall(walls, (wall) => {
    box(20.8, 5, 0.4, P.wall, 0, 2.5, -10.2, wall, { cast: false });
    box(20.9, 0.3, 0.5, P.trim, 0, 5.1, -10.2, wall, { cast: false });
    box(20, 0.25, 0.1, P.skirt, 0, 0.125, -9.97, wall, { cast: false });
  });
  return walls;
}

export interface RoomLook {
  palette: Palette;
  floor: (scene: THREE.Object3D) => void;
}

/**
 * `stocked` is false until the office has found the user's repos.
 */
export function buildRoom(scene: THREE.Object3D, skin: Skin, stocked = true, style?: RoomStyle, look?: RoomLook): RoomFixtures {
  const P = style?.palette ?? look?.palette ?? PALETTES[skin];
  const full = !style?.minimal;
  if (style) userFloor(scene, style);
  else if (look) look.floor(scene);
  else floor(scene);

  const walls = buildWalls(scene, P);
  const { back, left, right } = walls;
  const backdrop = null;

  if (full) {
    windows(walls);
  }
  [-7.4, 1.6].forEach((x) => bookshelf(back, x, -7.6, P, stocked));
  if (full) {
    plant(back, -9.3, -7.3, 1, P);
    plant(left, -9.25, 7.25, 1, P);
    plant(back, 3.35, -7.4, 0.8, P);
    plant(right, 9.4, -3.6, 0.9, P);
  }
  const front = full && !(style && replacesFront(style.manifest)) ? buildFront(scene, walls, skin, P) : null;

  const coffeeGroup = new THREE.Group();
  coffeeGroup.name = 'coffee_machine';
  left.add(coffeeGroup);
  coffee(coffeeGroup);

  const swingDoor = door(left, P);
  const rack = serverRack(back, P);

  const board = ticketBoard(back, skin);
  const ideas = ideaBoard(back, skin);

  const doorHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 2.7, 1.6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  doorHit.position.set(-9.95, 1.35, DOOR_Z);
  doorHit.userData.kind = 'hire';
  left.add(doorHit);

  const decor = style ? decorate(scene, walls, style) : null;

  return {
    boardMesh: board.mesh,
    redrawBoard: board.redraw,
    redrawIdeas: ideas.redraw,
    tick: (t, busy, dt) => {
      rack(t, busy.rack);
      swingDoor(busy.door, dt);
      front?.(t);
      decor?.tick(t, dt);
    },
    hitTargets: [board.mesh, ideas.mesh, doorHit],
    walls,
    backdrop,
  };
}

/**
 * Where git and cloud work happens. Its lights tick over slowly, and flicker
 * and the console scrolls while someone is standing at it.
 */
function serverRack(scene: THREE.Object3D, P: Palette): (t: number, busy: boolean) => void {
  const x = -0.2;
  const z = -7.55;
  const front = z + 0.4;

  box(1.0, 2.4, 0.8, P.rackBody, x, 1.2, z, scene);
  box(1.06, 0.08, 0.86, P.rackTrim, x, 2.44, z, scene);
  box(1.06, 0.08, 0.86, P.rackTrim, x, 0.04, z, scene);
  for (const side of [-1, 1]) box(0.05, 2.3, 0.05, P.rackPanel, x + side * 0.47, 1.2, front, scene, { cast: false });

  const leds: Array<{ mesh: THREE.Mesh; on: THREE.Material; off: THREE.Material; slow: number; fast: number; phase: number; lit: boolean }> = [];
  for (const y of [0.3, 0.54, 0.78, 1.78, 2.02, 2.26]) {
    box(0.86, 0.2, 0.03, P.rackPanel, x, y, front + 0.015, scene, { cast: false });
    for (let k = 0; k < 4; k++) box(0.1, 0.12, 0.02, P.rackBlank, x - 0.36 + k * 0.13, y, front + 0.035, scene, { cast: false });
    P.leds.forEach(([on, off], k) => {
      leds.push({
        mesh: box(0.04, 0.04, 0.02, off, x + 0.24 + k * 0.07, y, front + 0.04, scene, { cast: false }),
        on: mat(on, true),
        off: mat(off),
        slow: rand(0.8, 2.5),
        fast: rand(9, 16),
        phase: rand(0, Math.PI * 2),
        lit: false,
      });
    });
  }

  // The console: a terminal at eye height over a keyboard tray at hand height.
  box(0.62, 0.42, 0.04, '#111018', x, 1.36, front + 0.02, scene, { cast: false });
  box(0.8, 0.04, 0.34, P.rackTrim, x, 0.93, front + 0.15, scene);
  box(0.6, 0.03, 0.16, P.rackBlank, x, 0.965, front + 0.2, scene, { cast: false });
  const term = pixelScreen(64, 40);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshBasicMaterial({ map: term.tex }));
  screen.position.set(x, 1.36, front + 0.045);
  scene.add(screen);

  const lines = Array.from({ length: 24 }, () => Array.from({ length: Math.floor(rand(1, 5)) }, () => Math.floor(rand(2, 12))));
  const drawTerm = (scroll: number, cursor: boolean): void => {
    const g = term.g;
    if (!g) return;
    g.fillStyle = P.term[0];
    g.fillRect(0, 0, 64, 40);
    g.fillStyle = P.term[1];
    for (let row = 0; row < 6; row++) {
      let lx = 3;
      for (const word of lines[(scroll + row) % lines.length] ?? []) {
        g.fillRect(lx, 3 + row * 6, Math.min(word, 61 - lx), 2);
        lx += word + 3;
        if (lx > 58) break;
      }
    }
    g.fillRect(3, 36, 3, 2);
    if (cursor) g.fillRect(8, 34, 3, 4);
    term.tex.needsUpdate = true;
  };

  let scroll = 0;
  let lastStep = 0;
  let drawn = '';
  return (t, busy) => {
    for (const led of leds) {
      const lit = Math.sin(t * (busy ? led.fast : led.slow) + led.phase) > -0.2;
      if (lit !== led.lit) {
        led.lit = lit;
        led.mesh.material = lit ? led.on : led.off;
      }
    }
    const step = Math.floor(t * 6);
    if (busy && step !== lastStep) scroll++;
    lastStep = step;
    const cursor = Math.floor(t * 2) % 2 === 0;
    const key = `${scroll}:${cursor}`;
    if (key !== drawn) {
      drawn = key;
      drawTerm(scroll, cursor);
    }
  };
}

function floor(scene: THREE.Object3D): void {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 320;
  const g = c.getContext('2d');
  if (g) {
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const light = (i + j) % 2 === 0;
        const v = Math.floor(rand(-6, 6));
        g.fillStyle = light ? `rgb(${226 + v},${178 + v},${116 + v})` : `rgb(${201 + v},${146 + v},${88 + v})`;
        g.fillRect(i * 16, j * 16, 16, 16);
        g.fillStyle = 'rgba(255,240,210,.18)';
        g.fillRect(i * 16, j * 16, 16, 2);
        g.fillRect(i * 16, j * 16, 2, 16);
        g.fillStyle = 'rgba(80,40,10,.18)';
        g.fillRect(i * 16, j * 16 + 14, 16, 2);
        g.fillRect(i * 16 + 14, j * 16, 2, 16);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  floorSlab(scene, tex, '#5a321a');
}

/** Warm windows: three in the left wall, each throwing a shaft of sun across the floor, and one in the back wall. */
function windows(walls: Walls): void {
  const { left, back } = walls;
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xffcf80,
    transparent: true,
    opacity: 0.075,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const patchMat = new THREE.MeshBasicMaterial({
    color: 0xffcf80,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const inLeft = onWall(walls, 'left');
  for (const along of WINDOWS.left) {
    officeWindow(inLeft, along);
    const z = ROOM_CENTER.z - along;
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.35), shaftMat);
    shaft.position.set(-7.2, 1.5, z);
    shaft.rotation.set(0, 0, -0.42);
    left.add(shaft);

    const patch = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), patchMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(-5.4, 0.01, z);
    left.add(patch);
  }

  const x = WINDOWS.back;
  box(1.6, 2.3, 0.12, DARKWOOD, x, 2.6, -7.96, back, { cast: false });
  box(1.35, 2.0, 0.06, '#ffd486', x, 2.6, -7.9, back, { glow: true, cast: false });
  for (let k = 0; k < 5; k++) {
    box(1.35, 0.06, 0.05, '#e9a44f', x, 3.5 - k * 0.18, -7.86, back, { glow: true, cast: false });
  }
}

/** One of the office's warm windows, drawn as on `onWall`'s group. Only the left wall's let in shafts of sun. */
function officeWindow(wall: THREE.Object3D, x: number): void {
  box(1.6, 2.3, 0.12, DARKWOOD, x, 2.5, -9.96, wall, { cast: false });
  box(1.35, 2.0, 0.06, '#ffd486', x, 2.5, -9.9, wall, { glow: true, cast: false });
  for (let k = 0; k < 5; k++) box(1.35, 0.06, 0.05, '#e9a44f', x, 3.4 - k * 0.18, -9.86, wall, { glow: true, cast: false });
  box(1.7, 0.08, 0.3, DARKWOOD, x, 1.32, -9.85, wall, { cast: false });
}

/** The waiting area's rust velvet, and the lounge's teal. */
const RUST: Upholstery = { frame: '#8a3a26', seat: '#a8482e', leg: DARKWOOD };
const TEAL: Upholstery = { frame: '#2f6b6b', seat: '#3d8585', leg: DARKWOOD };

/**
 * The front of the office: a waiting area by the door, a meeting table and a
 * lounge, all low enough to see the desks over from any corner, with windows,
 * pictures and a clock on the front and right walls. Returns the clock's step.
 */
function officeFront(scene: THREE.Object3D, walls: Walls, P: Palette): (t: number) => void {
  waitingArea(scene, { rug: ['#5a2a1e', '#7b2d26'], sofa: RUST, table: [WOOD, DARKWOOD], seat: (x, z, rot) => armchair(scene, x, z, rot, RUST) });
  meetingArea(scene, (x, z, w, d) => meetingTable(scene, x, z, w, d, WOOD, DARKWOOD), officeChair);
  loungeArea(scene, { rug: ['#2c3a5c', '#3f5a8a'], sofa: TEAL, table: [WOOD, DARKWOOD], seat: (x, z, rot) => armchair(scene, x, z, rot, TEAL) });
  const { short } = rightCabinets(scene, WOOD, DARKWOOD);
  printer(short, 0.2, 0.87, 0);

  coatStand(walls.left, CORNERS.left.x, CORNERS.left.z, DARKWOOD, '#3b4f7a');
  plant(walls.front, CORNERS.front.x, CORNERS.front.z, 0.9, P);
  plant(walls.right, CORNERS.right.x, CORNERS.right.z, 0.8, P);

  const right = onWall(walls, 'right');
  for (const x of HUNG.right.windows) officeWindow(right, x);
  picture(right, HUNG.right.overPerks, 3.0, 1.7, 1.1, '#c9a227', hills);
  const [clockAt, shelfAt] = HUNG.right.overLounge;
  const clock = wallClock(right, clockAt, 3.3, '#3a2a20', '#f6f0e2', '#2a1c12');
  wallShelf(right, shelfAt, 2.2, 1.6, DARKWOOD, ['#7b2d26', '#4f7a2a', '#3b4f7a', '#c9a227']);

  const front = onWall(walls, 'front');
  const [first, middle, last] = HUNG.front.overLounge;
  picture(front, first, 2.3, 0.8, 1.0, DARKWOOD, sea);
  picture(front, middle, 2.4, 0.7, 0.7, DARKWOOD, blocks);
  picture(front, last, 2.3, 0.8, 1.0, DARKWOOD, hills);
  for (const x of HUNG.front.windows) officeWindow(front, x);
  wallScreen(front, HUNG.front.overTable, 2.3, 2.6, 1.5, '#1d1e22', dashboard('#0f1a14', '#3ddc84', '#ffb340'));
  picture(front, HUNG.front.overWaiting, 2.6, 2.0, 1.3, '#c9a227', blocks);
  return clock;
}

/** The front of the room in the skin's style. Returns the step for whatever on it moves. */
function buildFront(scene: THREE.Object3D, walls: Walls, skin: Skin, P: Palette): ((t: number) => void) | null {
  return officeFront(scene, walls, P);
}

function bookshelf(scene: THREE.Object3D, x: number, z: number, P: Palette, stocked = true): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  box(1.9, 3.2, 0.1, P.shelfFrame, 0, 1.6, -0.25, g);
  box(0.1, 3.2, 0.6, P.shelfFrame, -0.9, 1.6, 0, g);
  box(0.1, 3.2, 0.6, P.shelfFrame, 0.9, 1.6, 0, g);
  box(1.9, 0.1, 0.6, P.shelfFrame, 0, 3.2, 0, g);
  const books = P.books;
  for (let s = 0; s < 4; s++) {
    const y = 0.1 + s * 0.78;
    box(1.8, 0.08, 0.58, P.shelf, 0, y, 0, g);
    if (!stocked) continue;
    let bx = -0.82;
    while (bx < 0.78) {
      const w = rand(0.08, 0.14);
      const h = rand(0.42, 0.6);
      if (Math.random() < 0.08) {
        bx += w;
        continue;
      }
      box(w, h, 0.42, pick(books), bx + w / 2, y + 0.04 + h / 2, 0.02, g, { cast: false });
      bx += w + 0.01;
    }
  }
}

function coffee(scene: THREE.Object3D): void {
  box(0.8, 0.95, 1.4, WOOD, -9.5, 0.475, 0.25, scene);
  box(0.86, 0.06, 1.46, DARKWOOD, -9.5, 0.98, 0.25, scene);
  box(0.42, 0.6, 0.45, '#2b2b33', -9.55, 1.31, 0.0, scene);
  box(0.06, 0.06, 0.06, '#ff4a3a', -9.32, 1.5, 0.0, scene, { glow: true });
  box(0.14, 0.16, 0.14, '#f3ece0', -9.4, 1.09, 0.55, scene);
  box(0.14, 0.16, 0.14, '#4f7fe0', -9.6, 1.09, 0.7, scene);
}

/**
 * The door: a frame, a dark doorway, and a leaf hinged on its far edge that
 * swings into the room while someone comes in or goes out, and shuts behind
 * them. Returns the per-frame step that moves it.
 */
function door(scene: THREE.Object3D, P: Palette): (open: boolean, dt: number) => void {
  const z = DOOR_Z;
  box(0.14, 2.6, 1.5, P.doorFrame, -9.96, 1.3, z, scene, { cast: false });
  box(0.02, 2.4, 1.25, '#120e18', -9.935, 1.2, z, scene, { cast: false });
  box(0.04, 0.04, 1.4, P.doorLight, -9.88, 2.55, z, scene, { glow: true, cast: false });

  // Hinged on the window side, so the open door stands clear of the path
  // workers take along the wall towards the front corridor.
  const hinge = new THREE.Group();
  hinge.position.set(-9.9, 0, z - 0.625);
  scene.add(hinge);
  box(0.1, 2.4, 1.25, P.doorLeaf, 0, 1.2, 0.625, hinge, { cast: false });
  box(0.1, 0.1, 0.1, P.doorHandle, 0.07, 1.2, 1.075, hinge, { cast: false });

  const OPEN = 1.35;
  let angle = 0;
  return (open, dt) => {
    const target = open ? OPEN : 0;
    // Opens briskly and closes a little slower, like a door on a closer.
    angle = dt <= 0 ? target : angle + (target - angle) * Math.min(1, dt * (open ? 7 : 4));
    hinge.rotation.y = angle;
  };
}

export interface IdeaCounts {
  inbox: number;
  shaping: number;
  ready: number;
  ticket: number;
}

/**
 * The Idea board: a corkboard on the back wall, between the first bookshelf
 * and the window, with a pinned sticky note per idea in each lane. It is where
 * ideas start, before they become tickets on the whiteboard; a click opens the
 * Ideas panel.
 */
function ideaBoard(scene: THREE.Object3D, skin: Skin): {
  mesh: THREE.Mesh;
  redraw: (counts: IdeaCounts) => void;
} {
  const x = -4.8;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 336;
  const tex = new THREE.CanvasTexture(canvas);

  // Frame, then the cork, facing into the room like the whiteboard.
  const frame = DARKWOOD;
  box(2.85, 1.95, 0.12, frame, x, 2.45, -7.96, scene, { cast: false });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.7),
    surface({ map: tex, emissive: 0x2a1a0c }),
  );
  mesh.position.set(x, 2.45, -7.89);
  mesh.userData.kind = 'ideas';
  scene.add(mesh);

  // The cork's speckle is drawn once and kept; only the notes change.
  const cork = document.createElement('canvas');
  cork.width = 512;
  cork.height = 336;
  const c = cork.getContext('2d');
  if (c) {
    c.fillStyle = '#b98653';
    c.fillRect(0, 0, 512, 336);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(90,52,24,.28)' : 'rgba(240,200,150,.22)';
      c.fillRect(Math.random() * 512, Math.random() * 336, 2 + Math.random() * 3, 2 + Math.random() * 2);
    }
  }

  const lanes: Array<[keyof IdeaCounts, string, string]> = [
    ['inbox', 'Inbox', '#ffe27a'],
    ['shaping', 'Shaping', '#ffb3c7'],
    ['ready', 'Ready', '#b8f0a8'],
    ['ticket', 'Ticketed', '#a8c8ff'],
  ];

  const redraw = (counts: IdeaCounts): void => {
    const g = canvas.getContext('2d');
    if (!g) return;
    g.drawImage(cork, 0, 0);

    // The title on a pinned paper label.
    g.fillStyle = '#f4f1e8';
    g.fillRect(16, 12, 112, 40);
    g.fillStyle = '#c8553d';
    g.beginPath();
    g.arc(72, 16, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1c12';
    g.font = '700 28px Fredoka, sans-serif';
    g.fillText('Ideas', 36, 44);

    lanes.forEach(([key, label, color], i) => {
      const x = 16 + i * 124;
      const n = counts[key];
      g.fillStyle = '#2a1c12';
      g.font = '700 17px "Atkinson Hyperlegible", sans-serif';
      g.fillText(`${label}  ${n}`, x, 86);
      // Up to six notes a lane, slightly askew, each with a pin.
      for (let k = 0; k < Math.min(n, 6); k++) {
        const cx = x + (k % 2) * 56;
        const cy = 98 + Math.floor(k / 2) * 76;
        g.save();
        g.translate(cx + 25, cy + 30);
        g.rotate((((k * 7 + i * 3) % 5) - 2) * 0.03);
        g.fillStyle = 'rgba(0,0,0,.22)';
        g.fillRect(-23, -26, 50, 58);
        g.fillStyle = color;
        g.fillRect(-25, -30, 50, 58);
        g.fillStyle = 'rgba(0,0,0,.22)';
        g.fillRect(-16, -12, 32, 4);
        g.fillRect(-16, -2, 22, 4);
        g.fillStyle = '#c8553d';
        g.beginPath();
        g.arc(0, -25, 4, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    });
    tex.needsUpdate = true;
  };

  return { mesh, redraw };
}

const BOARD_INK = {
  office: { bg: '#f4f1e8', title: '#2a1c12', label: '#6b5a48', rule: '#d8d2c2', cards: ['#ffd86b', '#9cc2ff', '#9fe0b0'], card: 'rgba(0,0,0,.25)' },
};

/**
 * The whiteboard, with a card per ticket.
 */
function ticketBoard(scene: THREE.Object3D, skin: Skin): {
  mesh: THREE.Mesh;
  redraw: (counts: { todo: number; doing: number; done: number }) => void;
} {
  const ink = BOARD_INK.office;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 300;
  const tex = new THREE.CanvasTexture(canvas);

  box(4.3, 2.5, 0.12, '#a7a299', 4.9, 2.55, -7.95, scene, { cast: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.25), surface({ map: tex, emissive: 0x302820 }));
  mesh.position.set(4.9, 2.55, -7.88);
  mesh.userData.kind = 'board';
  scene.add(mesh);
  box(3.6, 0.08, 0.22, '#a7a299', 4.9, 1.33, -7.8, scene);

  const redraw = (counts: { todo: number; doing: number; done: number }): void => {
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = ink.bg;
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = ink.title;
    g.font = '700 30px Fredoka, sans-serif';
    g.fillText('Ticket board', 20, 42);
    const cols: [string, number, string][] = [
      ['To do', counts.todo, ink.cards[0] as string],
      ['Doing', counts.doing, ink.cards[1] as string],
      ['Done', counts.done, ink.cards[2] as string],
    ];
    cols.forEach(([label, n, color], i) => {
      const x = 20 + i * 164;
      g.fillStyle = ink.label;
      g.font = '700 20px "Atkinson Hyperlegible", sans-serif';
      g.fillText(`${label}  ${n}`, x, 82);
      g.fillStyle = ink.rule;
      g.fillRect(x, 92, 150, 3);
      for (let k = 0; k < Math.min(n, 8); k++) {
        const cx = x + (k % 2) * 76;
        const cy = 106 + Math.floor(k / 2) * 46;
        g.fillStyle = color;
        g.fillRect(cx, cy, 68, 38);
        g.fillStyle = ink.card;
        g.fillRect(cx + 8, cy + 10, 44, 4);
        g.fillRect(cx + 8, cy + 20, 30, 4);
      }
    });
    tex.needsUpdate = true;
  };

  return { mesh, redraw };
}
