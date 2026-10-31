import * as THREE from 'three';
import { BUILT_IN_PAM_ID, DEFAULT_LOOK, displayKey, type Activity, type Agent, type AgentStatus, type Message } from '@shared';
import { hashString } from '../state/look.js';
import { loadTurn, saveTurn, type Store } from '../state/store.js';
import { $, el as makeEl, iconSvg, iconText, setRichText, TEXT_ICONS } from '../ui/dom.js';
import { STATUS_LABELS } from '../ui/worker.js';
import { HAIRS, SHIRTS, SKINS, disposeRoom, pick, rand } from './boxkit.js';
import { DESK_TOPS, SPOTS, besidePlace, buildDesks, buildReception, route, seatPlace, setScreen, type Desk, type LampShade, type Place, type Spot } from './desks.js';
import { buildPerson, pose, type Person, type Pose } from './person.js';
import type { Pass } from './pass.js';
import { buildRoom, type RoomFixtures } from './room.js';
import { onRenderStylePicked, pickedRenderStyle, shadedAs, type RenderStyle } from './shading.js';
import { LIGHTING, drawnAs, type Skin } from './skin.js';
import { shelter, softenSun } from './smooth.js';
import { lookFor } from './looks.js';
import { roomStyle, type RoomStyle } from './style.js';
import { cachedManifest, officeManifest } from '../state/offices.js';
import { baseRoom, userOfficeId, type RoomChoice } from '../state/store.js';
import type { OfficeManifest } from '@shared';
import { QUEST_SPOTS, agentReady, firstDayShown, nextQuest } from './quests.js';
import { FRAME, ROOM_CENTER, WALLS, azimuth, camOffset, farWalls, mirrored, panAxes, viewHeight } from './view.js';

/** What the rest of the page may ask of the room. */
export const officeView = {
  /** Where a point in the room is on screen, in pixels within the stage, or null while the room is hidden. */
  project: (_x: number, _y: number, _z: number): { x: number; y: number } | null => null,
};

/** How bright the room is before the agent CLI powers it up, as a share of its full light. */
const DARK = 0.22;
/** Seconds between one desk lamp coming on and the next, when the office powers up. */
const LAMP_STAGGER = 0.35;
/** Seconds the view takes to turn a quarter of the way round the room. */
const TURN_SECONDS = 0.35;

/**
 * The 3D office.
 *
 * The server owns all state. This module owns only where a worker is standing
 * and which way it is facing: everything a worker *is* comes from the store,
 * and every frame reconciles the floor against it.
 *
 * Replaces the M1 roster stand-in. The store contract is unchanged, so the
 * panels and HUD are untouched.
 */

/** How a status reads on the floor, separate from how it reads in the panel. */
type Look = 'working' | 'needs' | 'review' | 'quiet';

function lookOf(status: AgentStatus): Look {
  switch (status) {
    case 'needs_you':
      return 'needs';
    case 'review':
    case 'awaiting_review':
    case 'in_review':
      return 'review';
    case 'working':
    case 'starting':
    case 'fixing_findings':
    case 'reviewing':
      return 'working';
    default:
      return 'quiet';
  }
}

type Where = 'desk' | Spot;

/**
 * Where each kind of work is done, so the floor shows what an agent is doing:
 * git and cloud at the server rack, tickets at the board, research at the
 * bookshelves. Thinking and typing are desk work.
 */
const WORK_PLACE: Record<Activity, Where> = {
  idle: 'desk',
  thinking: 'desk',
  typing: 'desk',
  git: 'rack',
  cloud: 'rack',
  tickets: 'board',
  research: 'books',
};

/**
 * Only an idle worker takes one. A raised hand or a finished PR stays put,
 * since Tom has to be able to find them, and a worker mid-turn is working.
 */
const BREAKS: Spot[] = ['coffee'];
const isBreak = (where: Where): boolean => (BREAKS as Where[]).includes(where);

/** How long an idle worker stays somewhere before getting up again. */
const STAY: Partial<Record<Where, [number, number]>> = {
  desk: [12, 30],
  coffee: [6, 10],
};

/** In place of the agent's bubble, where that would say nothing about why it is there. */
const SPOT_TEXT: Partial<Record<Where, string>> = {
  coffee: 'Grabbing a coffee',
  door: 'Heading home',
};

const SAID_MAX = 60;

/**
 * The hire desk a worker belongs at: its own, or for a reviewer, who has none,
 * the desk of the worker it reviews. Null when that worker is not in the office.
 */
export function homeDeskIndex(
  agent: { deskIndex: number; reviewingId?: string | null },
  agents: ReadonlyArray<{ id: string; deskIndex: number }>,
): number | null {
  if (!agent.reviewingId) return agent.deskIndex;
  return agents.find((a) => a.id === agent.reviewingId)?.deskIndex ?? null;
}

/** How long a routine update stays over a worker before the room quiets down. */
export const BUBBLE_VISIBLE_SECONDS = 8;

/** Requests that still need a person stay visible until their status changes. */
export function bubbleIsVisible(status: AgentStatus, shownAt: number, now: number, hovered = false): boolean {
  return hovered || status === 'needs_you' || status === 'review' || status === 'error' || now - shownAt < BUBBLE_VISIBLE_SECONDS;
}

/** How long a PR-ready or error bubble stays open before it shrinks to an icon. */
export const BUBBLE_COLLAPSE_SECONDS = 30;

/**
 * A finished or failed worker's bubble has said its piece once it has been up
 * a while, so it shrinks to an icon, and opens again while hovered or selected.
 */
export function bubbleIsCollapsed(status: AgentStatus, shownAt: number, now: number, hovered = false, selected = false): boolean {
  return (status === 'review' || status === 'error') && !hovered && !selected && now - shownAt >= BUBBLE_COLLAPSE_SECONDS;
}

/** Break activity explains why an idle worker is away; their last reply is for their desk. */
export function bubbleText(status: AgentStatus, sitting: boolean, where: Where, lastSaid: string, bubble: string, fallback: string): string {
  const spot = !sitting ? SPOT_TEXT[where] : '';
  const said = status === 'idle' ? lastSaid : '';
  return spot || said || bubble || fallback;
}

export function lastSaid(messages: Message[]): Map<string, string> {
  const said = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'agent') continue;
    const line = m.text
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+|\*\*/g, '').trim())
      .find(Boolean);
    if (line) said.set(m.agentId, line.length > SAID_MAX ? `${line.slice(0, SAID_MAX - 1).trimEnd()}…` : line);
  }
  return said;
}

/** Seconds at a work spot before moving on, so a run of quick tool calls is not a dance. */
const DWELL = 2.5;
/**
 * Seconds of desk work before walking back to the desk from a work spot.
 * Agents think between one git command and the next, so thinking waits longer.
 */
const THINK_LINGER = 5;
const TYPE_LINGER = 1.2;

const SPEED = 1.7;

/** The k-th place once a spot is full: rows further out from the wall, towards its corridor. */
function crowdPlace(places: Place[], k: number): Place {
  const base = places[k % places.length] as Place;
  const out = Math.sign(base.lane - base.z) || 1;
  return { ...base, z: base.z + out * 0.7 * (1 + Math.floor(k / places.length)) };
}

interface Worker {
  id: string;
  name: string;
  /** The repo whose agent it was hired as, badged after its name. */
  personaRepo: string | null;
  ticketKey: string;
  status: AgentStatus;
  activity: Activity;
  bubble: string;
  model: string | null;
  lastSaid: string;
  adopted: boolean;
  builtInPam: boolean;
  deskIndex: number;
  /** For a reviewer, who it is reviewing; its `desk` is that worker's, which it stands beside. */
  reviewingId: string | null;
  desk: Desk;
  person: Person;
  /** The look and uniform the figure was built with, to notice when either changes. */
  dressed: string;
  el: HTMLButtonElement;
  mode: Pose;
  /** Where it is, or is walking to, and the exact place there. */
  where: Where;
  spot: Place;
  arrivedAt: number;
  /** Where its status and activity put it, and since when. */
  want: Where;
  wantSince: number;
  /** When an idle worker next gets up, for a break or back from one. */
  breakAt: number;
  path: THREE.Vector2[] | null;
  pi: number;
  t: number;
  /** Set when the agent is done or the server has dropped it, and it is walking out. */
  leaving: boolean;
  bubbleSize: { w: number; h: number };
  /** What last made the bubble resurface, and when it happened. */
  bubbleMoment: string;
  bubbleShownAt: number;
}

/** A bubble placed on screen: anchored by its bottom centre, so `y` is its bottom edge. */
interface Laid {
  w: Worker;
  x: number;
  y: number;
  depth: number;
}

/** Whether two bubbles overlap enough for the front one to hide the other's text. */
function covers(a: Laid, b: Laid): boolean {
  const sa = a.w.bubbleSize;
  const sb = b.w.bubbleSize;
  const across = (sa.w + sb.w) / 2 - Math.abs(a.x - b.x);
  const down = Math.min(a.y, b.y) - Math.max(a.y - sa.h, b.y - sb.h);
  return across > 0.3 * Math.min(sa.w, sb.w) && down > 0.4 * Math.min(sa.h, sb.h);
}

export function mountOffice(store: Store): void {
  const stageEl = $<HTMLElement>('stage');
  const bubblesEl = $<HTMLElement>('bubbles');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  /* ---------- three setup ---------- */
  // Leave three's colour management at its default. Disabling it to mimic
  // r128 was tried and measurably washed the room out against the mock.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x15111c);
  stageEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const target = new THREE.Vector3(ROOM_CENTER.x, FRAME.lookAt, ROOM_CENTER.z);
  let zoom = 1;
  /**
   * Quarter turns of the camera round the room: where it is headed, and where
   * it is while it eases there. Not wrapped, so a turn always goes the short way.
   */
  let turn = loadTurn();
  let shownTurn = turn;
  let turnFrom = turn;
  let turnStart = 0;

  const ambient = new THREE.AmbientLight(0xffd9a8, 0.38);
  const hemi = new THREE.HemisphereLight(0xffe6c0, 0x3a2a20, 0.35);
  scene.add(ambient, hemi);
  const sun = new THREE.DirectionalLight(0xffc27a, 0.95);
  sun.position.set(-16, 13, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
  sun.shadow.bias = -0.0008;
  softenSun(sun);
  sun.target.position.set(ROOM_CENTER.x, 0, ROOM_CENTER.z);
  scene.add(sun, sun.target);

  const world = new THREE.Group();
  scene.add(world);
  let skin: Skin | null = null;
  /**
   * What the room is drawn from: the built-in skin's name, or for a generated
   * office its id and when it was last changed, so an edit rebuilds the room.
   */
  let roomKey = '';
  /** The generated office's style while one is showing; null for a built-in room. */
  let userStyle: RoomStyle | null = null;
  /** Whether the shelves are stocked: the office has found the user's repos. */
  let stocked = true;
  /** The light the room is lit by. */
  let roomLight = LIGHTING.office;
  /** How the room is drawn: in the style picked for every room, or its base's own. */
  let render: RenderStyle = 'voxel';
  /** The desks someone is at. */
  let taken = new Set<number>();

  /* ---------- the first day ---------- */

  // The office is dark until the agent CLI answers; then the light comes up
  // and the desk lamps come on one by one.
  let powered = true;
  let lightLevel = 1;
  let lampsOnAt = -Infinity;

  // A pulsing ring under the next quest's object. The camera stays where it is, so the whole office comes to life in view.
  const questRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.78, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  questRing.rotation.x = -Math.PI / 2;
  questRing.position.y = 0.03;
  questRing.visible = false;
  scene.add(questRing);
  let fixtures!: RoomFixtures;
  let desks: Desk[] = [];
  let lamps: THREE.PointLight[] = [];
  let shades: LampShade[] = [];
  let deskTargets: THREE.Mesh[] = [];
  let receptionDesk!: Desk;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.56, 24),
    new THREE.MeshBasicMaterial({ color: 0xf2a93b, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  scene.add(ring);

  const workers = new Map<string, Worker>();
  const pickables: THREE.Object3D[] = [];
  /** Scene seconds. They stop with the frames while the tab is hidden, so no break runs out unseen. */
  let now = 0;

  /* ---------- sync with the store ---------- */

  /**
   * Builds the room and desks in a skin, replacing whatever was there.
   */
  function furnish(choice: RoomChoice, nextStocked = stocked): void {
    const want = roomWanted(choice);
    if (!want && skin) return;
    const next: Skin = want?.base ?? 'office';
    const key = want?.key ?? 'pending';
    const manifest = want?.manifest ?? null;
    const { style } = drawnAs(choice, pickedRenderStyle(), next);
    if (key === roomKey && nextStocked === stocked && style === render) return;
    skin = next;
    roomKey = key;
    userStyle = manifest ? roomStyle(manifest, { reduceMotion }) : null;
    render = style;
    stocked = nextStocked;
    const retiring = desks.flatMap((d) => [d.screenOn, d.screenOff]);
    if (receptionDesk) retiring.push(receptionDesk.screenOn, receptionDesk.screenOff);
    disposeRoom(world, retiring);
    world.clear();
    shadedAs(render, () => {
      fixtures = buildRoom(world, next, stocked, userStyle ?? undefined);
      faceView();
      ({ desks, lamps, shades, hitTargets: deskTargets } = buildDesks(world, next, userStyle ?? undefined));
      const reception = buildReception(world, next, BUILT_IN_PAM_ID, userStyle ?? undefined);
      receptionDesk = reception.desk;
      deskTargets.push(...reception.hitTargets);
      for (const w of workers.values()) {
        w.desk = deskOf(w) ?? w.desk;
        if (w.builtInPam) {
          w.person.root.position.set(receptionDesk.x, 0, receptionDesk.z);
          w.person.root.rotation.y = receptionDesk.rot;
        }
        applyScreen(w);
      }
      fixtures.redrawBoard(counts);
      fixtures.redrawIdeas(ideaCounts);
    });

    roomLight = userStyle ? userStyle.lighting : LIGHTING[next];
    renderer.setClearColor(roomLight.clear);
    ambient.color.set(roomLight.ambient);
    hemi.color.set(roomLight.sky);
    hemi.groundColor.set(roomLight.ground);
    sun.color.set(roomLight.sun);
    const [sx, sy, sz] = roomLight.sunAt;
    sun.position.set(sx + ROOM_CENTER.x, sy, sz + ROOM_CENTER.z);
    redressAll();
  }

  /**
   * What the choice is drawn as: a built-in skin (the office, for
   * office's manifest is still on its way, which is fetched here and the room
   * built when it lands. A choice the list does not have, or a manifest that
   * fails the contract, is the plain office.
   */
  function roomWanted(choice: RoomChoice): { base: Skin; manifest: OfficeManifest | null; key: string } | null {
    const id = userOfficeId(choice);
    if (id === null) return { base: baseRoom(choice), manifest: null, key: choice };
    const summary = store.state.offices.find((o) => o.id === id);
    if (!summary) return store.state.officesLoaded ? { base: 'office', manifest: null, key: 'office' } : null;
    const m = cachedManifest(id, summary.updatedAt);
    if (m === undefined) {
      void officeManifest(id, summary.updatedAt).then(() => {
        if (store.state.view !== 'cards') furnish(store.state.room, store.state.repos.length > 0);
      });
      return null;
    }
    return m ? { base: m.base, manifest: m, key: `user:${id}@${summary.updatedAt}` } : { base: 'office', manifest: null, key: 'office' };
  }

  /** Dresses everyone again where what they wear has changed, as when a room, its uniforms or its looks do. */
  function redressAll(): void {
    for (const w of workers.values()) {
      const agent = store.state.agents.find((a) => a.id === w.id);
      if (agent && w.dressed !== dressKey(agent)) redress(w, agent);
    }
  }

  /**
   * Builds the room again where it stands, for a Settings toggle (the season
   * on or off, a style picked to draw it in): it and everyone in it change on
   * the spot rather than at whatever the next update from the server happens to be.
   */
  function refreshRoom(): void {
    if (!skin) return;
    furnish(store.state.room, stocked);
    redressAll();
  }
  onRenderStylePicked(refreshRoom);

  /** Reception for the assistant, the reviewed worker's desk for a reviewer, otherwise its own. */
  function deskOf(a: { builtInPam: boolean; deskIndex: number; reviewingId?: string | null }): Desk | undefined {
    if (a.builtInPam) return receptionDesk;
    const index = homeDeskIndex(a, store.state.agents);
    return index === null ? undefined : desks[index % desks.length];
  }

  /** Where 'desk' means for a worker: its seat, or a reviewer's place at the worker's shoulder. */
  function homePlace(w: { reviewingId: string | null; desk: Desk }): Place {
    return w.reviewingId ? besidePlace(w.desk) : seatPlace(w.desk);
  }

  function addWorker(agent: Agent, fromDoor: boolean): void {
    const desk = deskOf(agent);
    if (!desk) return;
    const reviewingId = agent.reviewingId ?? null;

    const person = dress(agent);

    const el = document.createElement('button');
    el.className = 'bubble';
    el.type = 'button';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      store.selectAgent(agent.id);
    });
    el.addEventListener('pointerenter', () => { hoveredBubbleId = agent.id; });
    el.addEventListener('pointerleave', () => { if (hoveredBubbleId === agent.id) hoveredBubbleId = null; });
    el.addEventListener('focus', () => { hoveredBubbleId = agent.id; });
    el.addEventListener('blur', () => { if (hoveredBubbleId === agent.id) hoveredBubbleId = null; });
    bubblesEl.appendChild(el);

    const w: Worker = {
      id: agent.id,
      name: agent.name,
      personaRepo: agent.personaRepo ?? null,
      ticketKey: agent.ticketKey,
      status: agent.status,
      activity: agent.activity,
      bubble: bubbleOf(agent),
      model: agent.model,
      lastSaid: '',
      adopted: agent.adopted,
      builtInPam: agent.builtInPam,
      deskIndex: agent.deskIndex,
      reviewingId,
      desk,
      person,
      dressed: dressKey(agent),
      el,
      mode: reviewingId ? 'stand' : 'sit',
      where: 'desk',
      spot: homePlace({ reviewingId, desk }),
      arrivedAt: now,
      want: 'desk',
      wantSince: now,
      breakAt: now + rand(4, 16),
      path: null,
      pi: 0,
      t: Math.random() * 10,
      leaving: false,
      bubbleSize: { w: 0, h: 0 },
      bubbleMoment: '',
      bubbleShownAt: now,
    };

    if (fromDoor && !agent.builtInPam) {
      const door = SPOTS.door[0] as Place;
      person.root.position.set(door.x, 0, door.z);
      w.where = 'door';
      w.spot = door;
      goTo(w, 'desk');
    } else {
      person.root.position.set(w.spot.x, 0, w.spot.z);
      person.root.rotation.y = w.spot.face;
    }

    workers.set(agent.id, w);
    applyScreen(w);
  }

  function dressKey(agent: Agent): string {
    const custom = userStyle ? `${roomKey}/${lookFor(userStyle.manifest, agent.id, agent.builtInPam).index}` : '';
    return `${render}/${JSON.stringify(agent.look)}${custom}`;
  }

  /**
   * Builds the figure for a worker and makes it clickable.
   */
  function dress(agent: Agent): Person {
    const h = hashString(agent.id);
    const person = shadedAs(render, () =>
      buildPerson(
        agent.look.shirtColor ?? (SHIRTS[h % SHIRTS.length] as string),
        agent.look.hairColor ?? (HAIRS[(h >>> 3) % HAIRS.length] as string),
        SKINS[(h >>> 6) % SKINS.length] as string,
        agent.look,
        null,
        null,
        userStyle ? lookFor(userStyle.manifest, agent.id, agent.builtInPam).look : null,
      ),
    );
    person.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.userData.agentId = agent.id;
        pickables.push(o);
      }
    });
    scene.add(person.root);
    return person;
  }

  /** Swaps in a newly dressed figure where the old one stood, mid-pose. */
  function redress(w: Worker, agent: Agent): void {
    const old = w.person;
    scene.remove(old.root);
    for (let i = pickables.length - 1; i >= 0; i--) {
      if (pickables[i]?.userData.agentId === w.id) pickables.splice(i, 1);
    }
    w.person = dress(agent);
    w.person.root.position.copy(old.root.position);
    w.person.root.rotation.copy(old.root.rotation);
    w.dressed = dressKey(agent);
  }

  function dropWorker(w: Worker): void {
    scene.remove(w.person.root);
    for (let i = pickables.length - 1; i >= 0; i--) {
      if (pickables[i]?.userData.agentId === w.id) pickables.splice(i, 1);
    }
    w.el.remove();
    if (!w.reviewingId) setScreen(w.desk, false);
    workers.delete(w.id);
  }

  /** The monitor glows only when someone is actually seated and working. A reviewer's is the worker's to light. */
  function applyScreen(w: Worker): void {
    if (w.reviewingId) return;
    setScreen(w.desk, w.mode === 'sit' && w.status === 'working');
  }

  function goTo(w: Worker, where: Where): void {
    const to = where === 'desk' ? homePlace(w) : placeAt(w, where);
    w.path = route(w.spot, to);
    w.pi = 0;
    w.mode = 'walk';
    w.where = where;
    w.spot = to;
    applyScreen(w);
  }

  /** The first free place at a spot, or else one in a row behind the others. */
  function placeAt(w: Worker, spot: Spot): Place {
    const places = SPOTS[spot];
    const taken = [...workers.values()].filter((o) => o !== w && o.where === spot).map((o) => o.spot);
    const free = places.find((p) => !taken.includes(p));
    if (free) return free;
    for (let k = 0; ; k++) {
      const p = crowdPlace(places, k);
      if (!taken.some((o) => o.x === p.x && o.z === p.z)) return p;
    }
  }

  function hasRoom(w: Worker, spot: Spot): boolean {
    return SPOTS[spot].some((p) => ![...workers.values()].some((o) => o !== w && o.spot === p));
  }

  /**
   * the assistant's line for the first open of the day while the season is on, which
   * stands in for her usual bubble until it has had its moment over her head.
   */
  function bubbleOf(agent: Agent): string {
    return store.bubbleOf(agent);
  }

  /**
   * Reconciles the floor against the store.
   *
   * A worker the server has dropped is not deleted on the spot: it collects
   * keeps workers the store no longer knows about.
   */
  function sync(agents: Agent[], messages: Message[], firstPaint: boolean): void {
    const seen = new Set<string>();
    const said = lastSaid(messages);

    for (const agent of agents) {
      seen.add(agent.id);
      const existing = workers.get(agent.id);
      if (!existing) {
        // On first paint everyone is already at their desk; afterwards a new
        // hire walks in through the door.
        addWorker(agent, !firstPaint);
        continue;
      }

      const statusChanged = existing.status !== agent.status;
      // A room switch runs just before this, so a uniform goes on or comes off on the same update.
      if (existing.dressed !== dressKey(agent)) redress(existing, agent);
      existing.name = agent.name;
      existing.personaRepo = agent.personaRepo ?? null;
      existing.ticketKey = agent.ticketKey;
      existing.bubble = bubbleOf(agent);
      existing.model = agent.model;
      existing.lastSaid = said.get(agent.id) ?? '';
      existing.adopted = agent.adopted;
      existing.status = agent.status;
      existing.activity = agent.activity;
      if (statusChanged) {
        applyScreen(existing);
        // Someone who just stopped working gets up soon, not half a minute later.
        if (agent.status === 'idle') {
          existing.breakAt = now + (existing.where === 'desk' ? rand(3, 8) : rand(0.5, 2));
        }
        if (agent.status === 'done' && !existing.leaving) {
          existing.leaving = true;
          goTo(existing, 'door');
        }
      }
    }

    for (const w of [...workers.values()]) {
      if (seen.has(w.id) || w.leaving) continue;
      w.leaving = true;
      goTo(w, 'door');
    }
  }

  /* ---------- per-frame movement ---------- */

  /** Where the worker's status and activity say it should be. */
  function wanted(w: Worker): Where {
    if (w.builtInPam) return 'desk';
    switch (w.status) {
      case 'working':
        return WORK_PLACE[w.activity];
      case 'needs_you':
        return w.activity === 'idle' || isBreak(w.where) ? 'desk' : w.where;
      default:
        return 'desk';
    }
  }

  /** Picks where a worker goes next. Only runs while it is not walking. */
  function decide(w: Worker): void {
    if (w.builtInPam) return;
    if (w.leaving) {
      goTo(w, 'door');
      return;
    }

    // With the server gone we no longer know what anyone is doing, so nobody
    // sets off anywhere new. Walkers still finish their current trip rather
    // than stopping mid-stride.
    if (!connected) return;

    // A reviewer stays at the worker's shoulder until the review ends, waiting or not.
    if (w.reviewingId) {
      if (w.where !== 'desk') goTo(w, 'desk');
      return;
    }

    if (w.status === 'idle') {
      takeBreak(w);
      return;
    }

    if (w.want === w.where) return;
    if (now - w.arrivedAt < (isBreak(w.where) ? 0.5 : DWELL)) return;
    if (w.want === 'desk' && w.status === 'working' && !isBreak(w.where)) {
      const linger = w.activity === 'typing' ? TYPE_LINGER : THINK_LINGER;
      if (now - w.wantSince < linger) return;
    }
    goTo(w, w.want);
  }

  /** An idle worker goes back and forth between its desk and a break. */
  function takeBreak(w: Worker): void {
    if (now < w.breakAt) return;
    if (isBreak(w.where)) {
      goTo(w, 'desk');
      return;
    }
    const open = BREAKS.filter((b) => hasRoom(w, b));
    if (open.length) goTo(w, pick(open));
    else if (w.where !== 'desk') goTo(w, 'desk');
    else w.breakAt = now + rand(5, 10);
  }

  function arrive(w: Worker): void {
    w.path = null;
    w.arrivedAt = now;
    if (w.where === 'door') {
      dropWorker(w);
      return;
    }
    if (w.where === 'desk') {
      w.mode = w.reviewingId ? 'stand' : 'sit';
      w.person.root.position.set(w.spot.x, 0, w.spot.z);
      w.person.root.rotation.y = w.spot.face;
    } else {
      w.mode = 'stand';
    }
    const [lo, hi] = STAY[w.where] ?? [2, 5];
    w.breakAt = now + rand(lo, hi);
    applyScreen(w);
  }

  function step(w: Worker, dt: number): void {
    w.t += dt;

    if (w.builtInPam) {
      w.mode = 'sit';
      w.where = 'desk';
      w.person.root.position.set(w.desk.x, 0, w.desk.z);
      w.person.root.rotation.y = w.desk.rot;
      pose(w.person, {
        mode: 'sit', t: w.t, look: lookOf(w.status), place: null,
        thinking: w.status === 'working', mirror: false, reduceMotion,
      });
      return;
    }

    const want = wanted(w);
    if (want !== w.want) {
      w.want = want;
      w.wantSince = now;
    }

    if (w.mode === 'walk' && w.path) {
      const pos = w.person.root.position;
      let remain = SPEED * dt;
      while (remain > 0 && w.path) {
        const tp = w.path[w.pi];
        if (!tp) {
          arrive(w);
          break;
        }
        const dx = tp.x - pos.x;
        const dz = tp.y - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-4) {
          if (++w.pi >= w.path.length) {
            arrive(w);
            break;
          }
          continue;
        }
        const mv = Math.min(d, remain);
        pos.x += (dx / d) * mv;
        pos.z += (dz / d) * mv;
        remain -= mv;
        turnTo(w, Math.atan2(dx, dz), dt * 12);
        if (mv >= d && ++w.pi >= w.path.length) {
          arrive(w);
          break;
        }
      }
    } else {
      decide(w);
      if (w.mode === 'stand') turnTo(w, w.spot.face, dt * 10);
    }

    const ry = w.person.root.rotation.y;
    pose(w.person, {
      mode: w.mode,
      t: w.t,
      look: lookOf(w.status),
      place: w.mode === 'stand' && w.where !== 'desk' ? w.where : null,
      // Mid-turn with nothing reported yet is thinking too.
      thinking: w.activity === 'thinking' || w.activity === 'idle',
      // Whether its right side faces away from the camera, wherever that is round the room.
      mirror: mirrored(ry, azimuth(shownTurn)),
      reduceMotion,
    });
  }

  function turnTo(w: Worker, heading: number, rate: number): void {
    let diff = heading - w.person.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    w.person.root.rotation.y += diff * Math.min(1, rate);
  }

  /* ---------- bubbles ---------- */

  const v3 = new THREE.Vector3();
  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let hoveredBubbleId: string | null = null;
  let connected = false;

  function updateBubbles(): void {
    const W = stageEl.clientWidth;
    const H = stageEl.clientHeight;
    const laid: Laid[] = [];

    for (const w of workers.values()) {
      const pos = w.person.root.position;
      const sitting = w.mode === 'sit';
      v3.set(pos.x, sitting ? 1.95 : 2.15, pos.z).project(cam);

      const status = STATUS_LABELS[w.status];
      const text = bubbleText(w.status, sitting, w.where, w.lastSaid, w.bubble, status.label);
      // A new update or a change of scene (walking to coffee, returning to the
      // desk, and so on) gets its own full display window.
      const moment = `${w.status}|${w.activity}|${w.mode}|${w.where}|${text}`;
      if (w.bubbleMoment !== moment) {
        w.bubbleMoment = moment;
        w.bubbleShownAt = now;
      }
      const hovered = hoveredId === w.id || hoveredBubbleId === w.id;
      const shown = bubbleIsVisible(w.status, w.bubbleShownAt, now, hovered);
      w.el.hidden = !shown;
      if (!shown) continue;
      laid.push({ w, x: ((v3.x + 1) / 2) * W, y: ((1 - v3.y) / 2) * H, depth: v3.z });
      const compact = bubbleIsCollapsed(w.status, w.bubbleShownAt, now, hovered, selectedId === w.id);
      const cls =
        'bubble' +
        (compact ? ' compact' : '') +
        (w.status === 'needs_you' ? ' needs' : '') +
        (w.status === 'review' && !w.leaving ? ' review' : '') +
        (w.status === 'error' ? ' error' : '') +
        (w.adopted && sitting && w.status === 'idle' ? ' adopted' : '') +
        (selectedId === w.id ? ' sel' : '');
      // Shrinking or opening changes the bubble's size, which the lifting below relies on.
      let resized = false;
      if (w.el.className !== cls) {
        resized = w.el.classList.contains('compact') !== compact;
        w.el.className = cls;
      }

      const label = `${status.label}|${w.model}|${text}|${w.name}|${w.personaRepo}|${w.ticketKey}`;
      if (w.el.dataset.l !== label) {
        w.el.dataset.l = label;
        w.el.textContent = '';
        const small = document.createElement('small');
        small.className = 'bubble-head';
        const name = makeEl('span', 'bubble-name', `${w.name}, ${displayKey(w.ticketKey)}`);
        if (w.personaRepo) {
          const badge = makeEl('span', 'repo-badge', w.personaRepo);
          badge.title = `An agent from ${w.personaRepo}`;
          name.appendChild(badge);
        }
        small.appendChild(name);
        const head = makeEl('span', 'st', status.label);
        head.style.setProperty('--st', status.color);
        head.dataset.status = w.status;
        if (w.model) head.appendChild(makeEl('span', 'md', w.model));
        w.el.appendChild(small);
        small.appendChild(head);
        // A bubble is one line over a worker's head, so the command inside it
        // is set in mono but without a box around it — the backticks showing
        // as characters was the thing to be rid of.
        if (text !== status.label) {
          const line = makeEl('span', 'tx');
          setRichText(line, text);
          w.el.appendChild(line);
        }
        // All a shrunk bubble shows; the label below still reads out in full.
        if (w.status === 'review' || w.status === 'error') {
          const icon = makeEl('span', 'bubble-icon', w.status === 'review' ? null : '!');
          if (w.status === 'review') icon.innerHTML = iconSvg(TEXT_ICONS.check, 'bubble-check');
          icon.setAttribute('aria-hidden', 'true');
          icon.style.setProperty('--st', status.color);
          w.el.appendChild(icon);
        }
        w.el.setAttribute('aria-label', `${w.name}, ${displayKey(w.ticketKey)}, ${status.label}${w.model ? `, ${w.model}` : ''}: ${text}`);
        resized = true;
      }
      // Measured here, when the size changes, so the frame loop never forces a layout.
      if (resized) w.bubbleSize = { w: w.el.offsetWidth, h: w.el.offsetHeight };
    }

    // Workers side by side at a spot would hide each other's bubbles, so the
    // one further back moves up above the one in front. Neighbouring desks
    // overlap only at the edges, and stay where they are.
    laid.sort((a, b) => a.depth - b.depth);
    laid.forEach((a, i) => {
      for (let lifts = 0; lifts < i; lifts++) {
        const front = laid.slice(0, i).find((b) => covers(a, b));
        if (!front) break;
        a.y = front.y - front.w.bubbleSize.h - 4;
      }
      a.w.el.style.left = `${a.x}px`;
      a.w.el.style.top = `${a.y}px`;
      a.w.el.style.zIndex = String(Math.round(1000 - a.depth * 500));
    });

    const sel = selectedId ? workers.get(selectedId) : null;
    ring.visible = !!sel;
    if (sel) {
      ring.position.x = sel.person.root.position.x;
      ring.position.z = sel.person.root.position.z;
    }
  }


  /* ---------- camera & input ---------- */

  function updateCam(): void {
    const W = stageEl.clientWidth || 1;
    const H = stageEl.clientHeight || 1;
    const a = W / H;
    const h = viewHeight(a, zoom);
    cam.left = (-h * a) / 2;
    cam.right = (h * a) / 2;
    cam.top = h / 2;
    cam.bottom = -h / 2;
    const off = camOffset(shownTurn);
    cam.position.set(target.x + off.x, target.y + off.y, target.z + off.z);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }

  /**
   * Shows the two walls on the far side of the room and hides the two between
   * the camera and the workers, along with what is mounted on them, and turns
   * whatever else has to keep facing the camera.
   */
  function faceView(): void {
    const far = farWalls(shownTurn);
    for (const w of WALLS) fixtures.walls[w].visible = far.includes(w);
    const az = azimuth(shownTurn);
    if (fixtures.backdrop) fixtures.backdrop.rotation.y = az;
  }

  /** A quarter turn of the view round the room: +1 one way, −1 the other. */
  function turnView(by: number): void {
    turn += by;
    saveTurn(turn);
    turnFrom = shownTurn;
    turnStart = now;
    if (reduceMotion) shownTurn = turn;
    updateCam();
    faceView();
  }

  /** Eases the view towards its turn, a frame at a time. */
  function stepTurn(): void {
    if (shownTurn === turn) return;
    const k = Math.min(1, (now - turnStart) / TURN_SECONDS);
    const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    shownTurn = k >= 1 ? turn : turnFrom + (turn - turnFrom) * eased;
    updateCam();
    faceView();
  }

  function resize(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(stageEl.clientWidth, stageEl.clientHeight, false);
    updateCam();
  }
  window.addEventListener('resize', resize);

  function setZoom(z: number): void {
    zoom = Math.max(0.85, Math.min(3.8, z));
    updateCam();
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;

  function workerAt(cx: number, cy: number): string | null {
    const r = stageEl.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    // Not the cat: hovering a worker it walks in front of still shows that worker's bubble.
    return (ray.intersectObjects(pickables, false)[0]?.object.userData.agentId as string | undefined) ?? null;
  }

  stageEl.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    stageEl.setPointerCapture(e.pointerId);
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') hoveredId = workerAt(e.clientX, e.clientY);
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
      drag.moved = true;
      stageEl.classList.add('dragging');
    }
    if (drag.moved) {
      const u = (cam.top - cam.bottom) / stageEl.clientHeight;
      const { right, forward } = panAxes(shownTurn);
      target.x += right.x * -dx * u + forward.x * dy * u * 1.35;
      target.z += right.z * -dx * u + forward.z * dy * u * 1.35;
      target.x = Math.max(-9, Math.min(9, target.x));
      target.z = Math.max(-7, Math.min(11, target.z));
      updateCam();
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  stageEl.addEventListener('pointerleave', () => { hoveredId = null; });
  stageEl.addEventListener('pointerup', (e) => {
    stageEl.classList.remove('dragging');
    if (drag && !drag.moved) clickAt(e.clientX, e.clientY);
    drag = null;
  });
  stageEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
    },
    { passive: false },
  );

  document.getElementById('zin')?.addEventListener('click', () => setZoom(zoom * 1.2));
  document.getElementById('zout')?.addEventListener('click', () => setZoom(zoom / 1.2));
  document.getElementById('turnLeft')?.addEventListener('click', () => turnView(-1));
  document.getElementById('turnRight')?.addEventListener('click', () => turnView(1));

  /** Whether an object is showing: a hidden wall still catches rays, so what is on it must not take clicks. */
  function shown(o: THREE.Object3D | null): boolean {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  function clickAt(cx: number, cy: number): void {
    const r = stageEl.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects([...pickables, ...fixtures.hitTargets.filter(shown), ...deskTargets], false);
    if (!hits.length) {
      store.patch({ selectedAgentId: null });
      return;
    }
    const u = hits[0]?.object.userData ?? {};
    if (u.agentId) store.selectAgent(u.agentId);
    else if (u.kind === 'board') store.patch({ ticketPanelOpen: true, settingsOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    else if (u.kind === 'ideas') store.patch({ ideasOpen: true, ticketPanelOpen: false, settingsOpen: false, workersOpen: false, memoryOpen: false });
    else if (u.kind === 'hire') {
      store.patch({ ticketPanelOpen: true, settingsOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    }
    else if (u.kind === 'desk') {
      const occupant = store.state.agents.find((a) => a.deskIndex % desks.length === u.deskIndex);
      if (occupant) store.selectAgent(occupant.id);
      else store.patch({ ticketPanelOpen: true, settingsOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    }
  }

  /* ---------- store wiring ---------- */

  let firstPaint = true;
  let lastCounts = '';
  let counts = { todo: 0, doing: 0, done: 0 };
  let ideaCounts = { inbox: 0, shaping: 0, ready: 0, ticket: 0 };
  let lastIdeaCounts = '';

  let visible = true;

  store.subscribe((state) => {
    visible = state.view !== 'cards';
    const o = state.onboarding;
    const nowPowered = agentReady(o, state.health.runners[state.runner].status);
    if (nowPowered && !powered) lampsOnAt = now;
    powered = nowPowered;
    if (state.view !== 'cards') furnish(state.room, state.repos.length > 0);

    // the assistant stays at reception; while the first-day card is up, the ring marks
    // the ticket board once picking a first task is what is left. The other
    // steps are done from the card itself.
    const touring = firstDayShown(o) && nextQuest(o) === 'hire';
    questRing.visible = touring;
    if (touring) {
      const spot = QUEST_SPOTS.hire;
      questRing.position.x = spot.x;
      questRing.position.z = spot.z + 0.9;
    }
    sync(state.agents, state.messages, firstPaint);
    if (state.agents.length || state.tickets.length) firstPaint = false;
    taken = new Set(state.agents.filter((a) => !a.builtInPam && a.deskIndex >= 0).map((a) => a.deskIndex % DESK_TOPS.length));
    selectedId = state.selectedAgentId;

    connected = state.connected;
    stageEl.classList.toggle('offline', !connected);
    $<HTMLElement>('offline').hidden = connected;

    counts = { todo: state.tickets.length, doing: state.agents.filter((a) => !a.builtInPam).length, done: state.done.length };
    const key = `${counts.todo}/${counts.doing}/${counts.done}`;
    if (key !== lastCounts) {
      lastCounts = key;
      fixtures.redrawBoard(counts);
    }

    ideaCounts = { inbox: 0, shaping: 0, ready: 0, ticket: 0 };
    for (const idea of state.ideas) if (!idea.archived) ideaCounts[idea.lane]++;
    const ideaKey = Object.values(ideaCounts).join('/');
    if (ideaKey !== lastIdeaCounts) {
      lastIdeaCounts = ideaKey;
      fixtures.redrawIdeas(ideaCounts);
    }
  });

  /* ---------- loop ---------- */

  const clock = new THREE.Timer();
  clock.connect(document);
  function frame(): void {
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.05);
    now += dt;
    stepTurn();
    for (const w of [...workers.values()]) step(w, dt);

    // The door stands open while anyone is within a couple of steps of it,
    // coming in or going out.
    const doorSpot = SPOTS.door[0] as Place;
    const busy = {
      rack: false,
      coffee: false,
      door: [...workers.values()].some(
        (w) => Math.hypot(w.person.root.position.x - doorSpot.x, w.person.root.position.z - doorSpot.z) < 1.9,
      ),
    };
    for (const w of workers.values()) {
      if (w.mode !== 'stand') continue;
      if (w.where === 'rack') busy.rack = true;
      if (w.where === 'coffee') busy.coffee = true;
    }
    fixtures.tick(reduceMotion ? 0 : now, busy, reduceMotion ? 0 : dt);

    // Dark until powered; then the light comes up over a couple of seconds and the lamps come on in turn.
    const wantLight = powered ? 1 : DARK;
    lightLevel = reduceMotion ? wantLight : lightLevel + (wantLight - lightLevel) * Math.min(1, dt * 1.6);
    if (skin) {
      ambient.intensity = roomLight.ambientIntensity * lightLevel;
      hemi.intensity = 0.35 * lightLevel;
      sun.intensity = roomLight.sunIntensity * lightLevel;
    }
    lamps.forEach((l, i) => {
      const on = powered && (reduceMotion || now - lampsOnAt >= i * LAMP_STAGGER);
      l.intensity = on ? (0.68 + (reduceMotion ? 0 : Math.sin(now * 2 + i) * 0.03)) : 0;
      const shade = shades[i];
      if (shade) shade.mesh.material = on ? shade.on : shade.off;
    });

    if (questRing.visible) {
      const pulse = reduceMotion ? 1 : 1 + Math.sin(now * 3) * 0.12;
      questRing.scale.set(pulse, pulse, pulse);
      (questRing.material as THREE.MeshBasicMaterial).opacity = reduceMotion ? 0.8 : 0.55 + Math.sin(now * 3) * 0.25;
    }
    if (visible) {
      renderer.render(scene, cam);
      updateBubbles();
    }
    requestAnimationFrame(frame);
  }

  // Where a point in the room lands on screen, for things drawn over it.
  const projected = new THREE.Vector3();
  officeView.project = (x, y, z) => {
    if (!visible) return null;
    projected.set(x, y, z).project(cam);
    return { x: ((projected.x + 1) / 2) * stageEl.clientWidth, y: ((1 - projected.y) / 2) * stageEl.clientHeight };
  };

  powered = agentReady(store.state.onboarding, store.state.health.runners[store.state.runner].status);
  lightLevel = powered ? 1 : DARK;
  furnish(store.state.room, store.state.repos.length > 0);
  resize();
  frame();

  // The board is drawn with the display font; redraw once it has loaded. The
  // bubbles were measured in the fallback font, so they are measured again.
  void document.fonts?.ready.then(() => {
    fixtures.redrawBoard(counts);
    fixtures.redrawIdeas(ideaCounts);
    for (const w of workers.values()) delete w.el.dataset.l;
  });
}
