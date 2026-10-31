import * as THREE from 'three';
import { DEFAULT_LOOK, type AgentLook, type WorkerLook } from '@shared';
import { box } from './boxkit.js';
import type { Spot } from './desks.js';
import { effects, type Effects } from './effects.js';

/** A voxel worker, built as a rig so the loop can pose it. */
export interface Person {
  root: THREE.Group;
  hips: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  /** Props, shown only by the pose for the spot they belong to. */
  mug: THREE.Group;
  book: THREE.Group;
  /** Motion on a generated office's add-ons, stepped by `pose`. Absent on every other figure. */
  fx?: Effects;
}

/** The parts a uniform dresses. */
type Body = Pick<Person, 'hips' | 'legL' | 'legR' | 'armL' | 'armR' | 'head'>;

const WHITE = '#f3ece0';

export function buildPerson(
  shirt: string,
  hair: string,
  skin: string,
  look: WorkerLook = DEFAULT_LOOK,
  uniform: null = null,
  costume: null = null,
  custom: AgentLook | null = null,
): Person {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.5;
  root.add(hips);

  const legL = new THREE.Group();
  legL.position.set(-0.13, 0, 0);
  hips.add(legL);
  const legR = new THREE.Group();
  legR.position.set(0.13, 0, 0);
  hips.add(legR);
  const armL = new THREE.Group();
  armL.position.set(-0.36, 0.52, 0);
  hips.add(armL);
  const armR = new THREE.Group();
  armR.position.set(0.36, 0.52, 0);
  hips.add(armR);
  const head = new THREE.Group();
  head.position.y = 0.78;
  hips.add(head);

  const body = { hips, legL, legR, armL, armR, head };
  let fx: Effects | undefined;
  if (custom) {
    fx = effects(false);
    clothes(body, custom.shirt, custom.hair, custom.skin, customLook(custom), false, custom.pants, custom.hairStyle === 'none');
    addons(body, custom, fx);
  } else {
    clothes(body, shirt, hair, skin, look, false);
  }

  // In the right hand. ZYX undoes the arm's XYZ, so the pose can keep it upright.
  const mug = new THREE.Group();
  mug.position.set(0, -0.52, 0.11);
  mug.rotation.order = 'ZYX';
  mug.visible = false;
  armR.add(mug);
  box(0.12, 0.14, 0.12, '#f3ece0', 0, 0, 0, mug, { cast: false });
  box(0.03, 0.08, 0.05, '#f3ece0', 0.075, 0, 0, mug, { cast: false });
  box(0.1, 0.01, 0.1, '#5a3a20', 0, 0.066, 0, mug, { cast: false });

  // Open between both hands, tipped up towards the face. In uniform it is a datapad, lit.
  const book = new THREE.Group();
  book.position.set(0, 0.44, 0.47);
  book.rotation.x = -0.6;
  book.visible = false;
  hips.add(book);
  box(0.44, 0.04, 0.3, uniform ? '#2a2d33' : '#2f5d50', 0, 0, 0, book, { cast: false });
  box(0.4, 0.03, 0.27, uniform ? '#6fe0c4' : '#f3ece0', 0, 0.025, 0, book, { cast: false, glow: uniform !== null });

  return { root, hips, legL, legR, armL, armR, head, mug, book, ...(fx?.count ? { fx } : {}) };
}

/** The built-in pieces a generated look keeps: its hair style, its outfit, and no hat, beard or colour of the worker's own. */
function customLook(l: AgentLook): WorkerLook {
  return { hair: l.hairStyle === 'none' ? 'crop' : l.hairStyle, hat: 'none', face: 'none', outfit: l.outfit, shirtColor: null, hairColor: null };
}

/**
 * A look's add-ons, each fixed to the limb it names so it moves with it. The
 * origin of each is the pivot: the head's middle, the middle of the torso, a
 * shoulder or a hip, with arms and legs hanging down −y.
 */
function addons(b: Body, l: AgentLook, fx: Effects): void {
  for (const a of l.addons) {
    let holder: THREE.Object3D;
    if (a.anchor === 'body') {
      holder = new THREE.Group();
      holder.position.set(0, 0.28, 0);
      b.hips.add(holder);
    } else holder = b[a.anchor];
    for (const part of a.parts) fx.add(part, holder);
  }
}

/** The worker's own clothes and face, or an officer's uniform in place of the clothes. */
function clothes(b: Body, shirt: string, hair: string, skin: string, look: WorkerLook, officer: boolean, pants = '#33384a', bald = false): void {
  for (const leg of [b.legL, b.legR]) {
    box(0.2, 0.5, 0.22, pants, 0, -0.25, 0, leg);
    // An officer's boots come up to the knee.
    box(0.22, 0.08, 0.3, '#1e1e24', 0, -0.47, 0.04, leg);
  }

  // A shirt and tie or a lab coat is white; the tie or the pocket takes the colour.
  const cloth = look.outfit === 'tie' || look.outfit === 'labcoat' || look.outfit === 'cardigan' ? WHITE : shirt;
  box(0.56, 0.56, 0.32, cloth, 0, 0.28, 0, b.hips);
  outfit(look.outfit, shirt, b.hips);

  for (const arm of [b.armL, b.armR]) {
    box(0.16, 0.46, 0.18, cloth, 0, -0.2, 0, arm);
    box(0.15, 0.12, 0.16, skin, 0, -0.48, 0, arm);
  }

  const head = b.head;
  box(0.44, 0.42, 0.42, skin, 0, 0, 0, head);
  if (!bald) hairdo(look.hair, hair, head);
  box(0.07, 0.07, 0.02, '#1a1a1a', -0.1, 0.02, 0.215, head, { cast: false });
  box(0.07, 0.07, 0.02, '#1a1a1a', 0.1, 0.02, 0.215, head, { cast: false });
  if (look.face === 'beard') {
    const c = shade(hair, 1.1);
    box(0.44, 0.14, 0.08, c, 0, -0.15, 0.19, head);
    box(0.06, 0.2, 0.3, c, -0.22, -0.1, 0.06, head);
    box(0.06, 0.2, 0.3, c, 0.22, -0.1, 0.06, head);
  }
  if (!officer) {
    hat(look.hat, shirt, head);
    return;
  }
}

function hairdo(style: WorkerLook['hair'], c: string, head: THREE.Group): void {
  if (style === 'mohawk') {
    box(0.46, 0.04, 0.44, shade(c, 1.15), 0, 0.22, 0, head);
    box(0.1, 0.2, 0.46, c, 0, 0.32, 0, head);
    return;
  }
  box(0.48, 0.14, 0.46, c, 0, 0.24, 0, head);
  box(0.48, 0.32, 0.12, c, 0, 0.08, -0.19, head);
  if (style === 'bun') box(0.2, 0.18, 0.2, c, 0, 0.38, -0.1, head);
  if (style === 'shoulder') {
    box(0.1, 0.55, 0.34, c, -0.23, -0.05, -0.05, head);
    box(0.1, 0.55, 0.34, c, 0.23, -0.05, -0.05, head);
    box(0.42, 0.38, 0.1, c, 0, -0.05, -0.2, head);
  }
}

/** Worn on the head group, so a hat follows every turn and nod of the head. */
function hat(kind: WorkerLook['hat'], shirt: string, head: THREE.Group): void {
  switch (kind) {
    case 'cap': {
      const c = shade(shirt, 0.8);
      box(0.5, 0.14, 0.48, c, 0, 0.28, 0, head);
      box(0.42, 0.03, 0.22, shade(c, 0.85), 0, 0.22, 0.3, head);
      return;
    }
    case 'headphones':
      box(0.5, 0.06, 0.08, '#2a2a33', 0, 0.33, 0, head);
      for (const x of [-0.27, 0.27]) {
        box(0.06, 0.24, 0.06, '#2a2a33', x, 0.2, 0, head);
        box(0.1, 0.18, 0.16, '#f2a93b', x, 0.03, 0, head);
      }
      return;
    case 'headset':
      box(0.5, 0.045, 0.055, '#34323b', 0, 0.31, 0, head);
      box(0.07, 0.18, 0.12, '#34323b', -0.26, 0.04, 0, head);
      box(0.24, 0.035, 0.035, '#34323b', -0.15, -0.04, 0.2, head, { cast: false });
      box(0.055, 0.055, 0.055, '#202027', -0.02, -0.04, 0.215, head, { cast: false });
      return;
    case 'wizard': {
      const c = '#7a4fd0';
      box(0.62, 0.04, 0.6, c, 0, 0.24, 0, head);
      box(0.4, 0.14, 0.4, c, 0, 0.32, 0, head);
      box(0.28, 0.14, 0.28, c, 0.02, 0.46, -0.02, head);
      box(0.16, 0.12, 0.16, c, 0.05, 0.58, -0.05, head);
      box(0.06, 0.06, 0.06, '#f2c230', 0.09, 0.67, -0.08, head);
      box(0.06, 0.05, 0.02, '#f2c230', 0.1, 0.33, 0.205, head, { cast: false });
      return;
    }
    case 'crown':
      box(0.48, 0.1, 0.46, '#f2c230', 0, 0.3, 0, head);
      for (const [x, z] of [[-0.2, 0.19], [0, 0.19], [0.2, 0.19], [-0.2, -0.19], [0.2, -0.19]] as const) {
        box(0.08, 0.08, 0.08, '#f2c230', x, 0.39, z, head);
      }
      return;
  }
}

function outfit(kind: WorkerLook['outfit'], shirt: string, hips: THREE.Group): void {
  switch (kind) {
    case 'hoodie': {
      const dark = shade(shirt, 0.78);
      box(0.42, 0.16, 0.14, dark, 0, 0.54, -0.17, hips);
      box(0.32, 0.14, 0.03, dark, 0, 0.13, 0.17, hips, { cast: false });
      for (const x of [-0.06, 0.06]) box(0.025, 0.14, 0.02, WHITE, x, 0.44, 0.17, hips, { cast: false });
      return;
    }
    case 'tie':
      box(0.3, 0.06, 0.34, WHITE, 0, 0.55, 0, hips);
      box(0.09, 0.07, 0.02, shirt, 0, 0.5, 0.17, hips, { cast: false });
      box(0.08, 0.3, 0.02, shirt, 0, 0.3, 0.17, hips, { cast: false });
      return;
    case 'labcoat':
      box(0.6, 0.22, 0.36, WHITE, 0, -0.06, 0, hips);
      box(0.04, 0.5, 0.02, '#d9d0c0', 0, 0.22, 0.17, hips, { cast: false });
      box(0.1, 0.1, 0.02, shirt, -0.16, 0.42, 0.17, hips, { cast: false });
      box(0.12, 0.03, 0.02, '#4f7fe0', 0.16, 0.44, 0.172, hips, { cast: false });
      return;
    case 'cardigan': {
      const knit = shade(shirt, 0.88);
      box(0.19, 0.5, 0.04, knit, -0.19, 0.27, 0.17, hips, { cast: false });
      box(0.19, 0.5, 0.04, knit, 0.19, 0.27, 0.17, hips, { cast: false });
      box(0.08, 0.06, 0.03, WHITE, 0, 0.5, 0.19, hips, { cast: false });
      for (const y of [0.38, 0.25, 0.12]) box(0.025, 0.025, 0.025, '#d8c2a6', 0.02, y, 0.2, hips, { cast: false });
      return;
    }
  }
}

/** Lightens or darkens a hex colour, for trim cut from the worker's own colours. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): string => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

export type Pose = 'sit' | 'walk' | 'stand';

export interface PoseInput {
  mode: Pose;
  /** Drives the idle animation; seeded per worker so they are out of phase. */
  t: number;
  /** The visual state, already mapped from the server's AgentStatus. */
  look: 'working' | 'needs' | 'review' | 'quiet';
  /** Where a standing worker is, which says what it is doing there. */
  place: Spot | null;
  /** Mid-turn between steps: chin in hand rather than typing. */
  thinking: boolean;
  /** Gesture with the left arm: turned away from the camera, the right one is hidden. */
  mirror: boolean;
  reduceMotion: boolean;
}

/**
 * Poses the rig for one frame. The raised hand for `needs` is the single most
 * important read in the room, so it is a full overhead arm, not a subtle cue.
 */
export function pose(p: Person, i: PoseInput): void {
  const { t } = i;
  const m = i.reduceMotion ? 0 : 1;
  p.fx?.tick(i.reduceMotion ? 0 : t);
  p.mug.visible = i.mode === 'stand' && i.place === 'coffee';
  p.book.visible = i.mode === 'stand' && i.place === 'books';

  // One-armed gestures are written for the right arm; `s` mirrors their sideways tilt.
  const near = i.mirror ? p.armL : p.armR;
  const far = i.mirror ? p.armR : p.armL;
  const s = i.mirror ? -1 : 1;

  if (i.mode === 'sit') {
    p.hips.position.y = 0.5;
    p.legL.rotation.x = -Math.PI / 2;
    p.legR.rotation.x = -Math.PI / 2;

    if (i.look === 'needs') {
      raiseHand(near, far, p.head, t, m);
    } else if (i.look === 'review') {
      p.armR.rotation.set(-0.5, 0, 0);
      p.armL.rotation.set(-0.5, 0, 0);
      p.head.rotation.set(-0.15, Math.sin(t * 0.8) * 0.3, 0);
    } else if (i.look === 'quiet') {
      // Idle or errored: hands off the keyboard, glancing around the room.
      // Still visibly breathing, or it reads as a frozen scene rather than a
      // worker with nothing to do.
      const breathe = Math.sin(t * 1.6) * 0.03 * m;
      p.hips.position.y = 0.5 + breathe;
      p.armL.rotation.set(-0.2 + breathe, 0, 0.05);
      p.armR.rotation.set(-0.2 + breathe, 0, -0.05);
      p.head.rotation.set(0.05 + breathe, Math.sin(t * 0.45) * 0.45 * m, 0);
    } else if (i.thinking) {
      // A straight arm only reaches the chin pointed up and well inwards.
      near.rotation.set(-1.88, 0, -0.86 * s);
      far.rotation.set(-0.9, 0, 0.1 * s);
      p.head.rotation.set(-0.15, Math.sin(t * 0.5) * 0.3 * m, 0.08 * s);
    } else {
      const k = 0.12 * m;
      p.armL.rotation.set(-1.25 + Math.sin(t * 14) * k, 0, 0);
      p.armR.rotation.set(-1.25 + Math.sin(t * 14 + 1.7) * k, 0, 0);
      p.head.rotation.set(0.1, 0, 0);
    }
    return;
  }

  if (i.mode === 'walk') {
    const s = i.reduceMotion ? 0.25 : 0.7;
    const ph = t * 9;
    p.hips.position.y = 0.5 + Math.abs(Math.sin(ph)) * 0.04 * m;
    p.legL.rotation.x = Math.sin(ph) * s;
    p.legR.rotation.x = -Math.sin(ph) * s;
    p.armL.rotation.set(-Math.sin(ph) * s * 0.8, 0, 0);
    p.armR.rotation.set(Math.sin(ph) * s * 0.8, 0, 0);
    p.head.rotation.set(0, 0, 0);
    return;
  }

  p.hips.position.y = 0.5;
  p.legL.rotation.x = 0;
  p.legR.rotation.x = 0;

  if (i.look === 'needs') {
    raiseHand(near, far, p.head, t, m);
    return;
  }

  switch (i.place) {
    case 'rack': {
      const k = 0.12 * m;
      p.armL.rotation.set(-1.5 + Math.sin(t * 14) * k, 0, 0.12);
      p.armR.rotation.set(-1.5 + Math.sin(t * 14 + 1.7) * k, 0, -0.12);
      p.head.rotation.set(0.05 + Math.sin(t * 0.7) * 0.08 * m, 0, 0);
      return;
    }
    case 'board':
      // Pointing at a card, reading along the columns.
      near.rotation.set(-2.5 + Math.sin(t * 0.8) * 0.15 * m, 0, -0.1 * s);
      far.rotation.set(0, 0, 0.05 * s);
      p.head.rotation.set(-0.35, Math.sin(t * 0.6) * 0.2 * m, 0);
      return;
    case 'books':
      p.armL.rotation.set(-1.35, 0, 0.3);
      p.armR.rotation.set(-1.35, 0, -0.3);
      p.head.rotation.set(0.45, Math.sin(t * 0.4) * 0.1 * m, 0);
      return;
    case 'coffee': {
      const sip = Math.max(0, Math.sin(t * 1.3)) ** 3 * m;
      p.armR.rotation.set(-1.2 - sip * 0.8, 0, -0.35);
      p.armL.rotation.set(0, 0, 0.05);
      p.head.rotation.set(-0.05 - sip * 0.15, 0, 0);
      p.mug.rotation.set(-p.armR.rotation.x, 0, -p.armR.rotation.z);
      return;
    }
    default:
      p.armL.rotation.set(0, 0, 0);
      p.armR.rotation.set(-0.3, 0, 0.2);
      p.head.rotation.set(-0.2, Math.sin(t * 0.9) * 0.35 * m, 0);
  }
}

function raiseHand(near: THREE.Group, far: THREE.Group, head: THREE.Group, t: number, m: number): void {
  near.rotation.set(Math.PI, 0, Math.sin(t * 6) * 0.25 * m);
  far.rotation.set(-0.3, 0, 0);
  head.rotation.set(0, 0, 0);
}
