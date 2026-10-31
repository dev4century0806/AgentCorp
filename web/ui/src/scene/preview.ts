import * as THREE from 'three';
import { disposeRoom } from './boxkit.js';
import type { OfficeManifest } from '@shared';
import { buildDesks, buildReception, seatPlace, setScreen } from './desks.js';
import { lookFor } from './looks.js';
import { buildPerson, pose } from './person.js';
import type { Pass } from './pass.js';
import { buildRoom, type RoomFixtures } from './room.js';
import { shadedAs } from './shading.js';
import { LIGHTING, type Skin } from './skin.js';
import type { RoomPick } from '../state/store.js';
import { roomStyle } from './style.js';
import { FRAME, ROOM_CENTER, WALLS, camOffset, farWalls, viewHeight } from './view.js';

const WIDTH = 360;
const HEIGHT = 220;

const previews = new Map<RoomPick, Promise<string>>();

/**
 * A picture of a room style, for the picker in Settings: the real room built
 * in that skin, empty of workers, from the office's own camera angle. The
 *
 * Each is rendered once per page and kept, on a short-lived renderer of its
 * own so the office's is never touched.
 */
export function roomPreview(room: RoomPick): Promise<string> {
  let preview = previews.get(room);
  if (!preview) {
    // A frame later, so opening Settings paints before the rooms are built.
    preview = new Promise((resolve, reject) =>
      requestAnimationFrame(() => {
        try {
          resolve(render(room));
        } catch (err) {
          previews.delete(room);
          reject(err as Error);
        }
      }),
    );
    previews.set(room, preview);
  }
  return preview;
}

function render(pick: RoomPick): string {
  return shoot(LIGHTING[pick], WIDTH, HEIGHT, 0, 0, (world) => {
    const room = buildRoom(world, pick);
    const { desks } = buildDesks(world, pick);
    return { room, retire: desks.flatMap((d) => [d.screenOn, d.screenOff]) };
  });
}

const offices = new Map<string, Promise<string>>();
const OFFICE_CACHE = 16;

/** Workers shown at their desks in an office preview, one for each look in turn. Spread across the pods so the front rows show. */
const SAMPLE_DESKS = [1, 6, 8, 11, 13, 4];

/**
 * A picture of a generated office, for the create, preview and publish
 * dialogs and the picker: the real room built from the manifest, framed like
 * `roomPreview`, with a few workers seated wearing its looks and the assistant at
 * reception in the first. PNG data URL, 360 by 220 unless asked otherwise.
 * `turn` (quarter turns of the view, 0 by default) is for looking at the other sides of the room.
 * Kept by manifest and size, since the dialogs ask again and again.
 */
export function officePreview(manifest: OfficeManifest, opts: { width?: number; height?: number; turn?: number } = {}): Promise<string> {
  const width = Math.max(64, Math.min(1920, Math.round(opts.width ?? WIDTH)));
  const height = Math.max(48, Math.min(1080, Math.round(opts.height ?? HEIGHT)));
  const turn = opts.turn ?? 0;
  const key = JSON.stringify([manifest, width, height, turn]);
  let preview = offices.get(key);
  if (!preview) {
    preview = new Promise((resolve, reject) =>
      requestAnimationFrame(() => {
        try {
          resolve(renderOffice(manifest, width, height, turn));
        } catch (err) {
          offices.delete(key);
          reject(err as Error);
        }
      }),
    );
    if (offices.size >= OFFICE_CACHE) offices.delete(offices.keys().next().value as string);
    offices.set(key, preview);
  }
  return preview;
}

function renderOffice(manifest: OfficeManifest, width: number, height: number, turn: number): string {
  const style = roomStyle(manifest);
  return shoot(style.lighting, width, height, 1.2, turn, (world) => {
    const room = buildRoom(world, manifest.base, true, style);
    const { desks } = buildDesks(world, manifest.base, style);
    const reception = buildReception(world, manifest.base, 'preview-pam', style);
    const retire = [...desks.flatMap((d) => [d.screenOn, d.screenOff]), reception.desk.screenOn, reception.desk.screenOff];

    // the assistant at the front desk in the first look, and a few workers at theirs, each look worn once round.
    const seat = (desk: (typeof desks)[number], look: number, workingAt: number): void => {
      const l = manifest.looks[look % manifest.looks.length]!;
      const person = buildPerson(l.shirt, l.hair, l.skin, undefined, null, null, l);
      const at = seatPlace(desk);
      person.root.position.set(at.x, 0, at.z);
      person.root.rotation.y = at.face;
      pose(person, { mode: 'sit', t: workingAt, look: 'working', place: null, thinking: false, mirror: false, reduceMotion: false });
      world.add(person.root);
    };
    seat(reception.desk, lookFor(manifest, 'preview-pam', true).index, 0.3);
    setScreen(reception.desk, true);
    SAMPLE_DESKS.slice(0, Math.max(manifest.looks.length, 3)).forEach((d, i) => {
      const desk = desks[d];
      if (!desk) return;
      seat(desk, i + 1, 0.2 + i * 0.37);
      setScreen(desk, true);
    });
    return { room, retire };
  });
}

/**
 * Renders what `build` puts in a world, lit by `light` and ticked to scene time `at`, from the office's own
 * camera angle, and gives back a PNG data URL. A short-lived renderer of its
 * own is used and freed, so the office's is never touched.
 */
function shoot(
  light: (typeof LIGHTING)[Skin],
  width: number,
  height: number,
  at: number,
  turn: number,
  build: (world: THREE.Group) => { room: RoomFixtures; retire: THREE.Material[] },
  finish?: (renderer: THREE.WebGLRenderer) => Pass,
): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    renderer.setClearColor(light.clear);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(light.ambient, light.ambientIntensity));
    scene.add(new THREE.HemisphereLight(light.sky, light.ground, 0.35));
    const sun = new THREE.DirectionalLight(light.sun, light.sunIntensity);
    const [sx, sy, sz] = light.sunAt;
    sun.position.set(sx + ROOM_CENTER.x, sy, sz + ROOM_CENTER.z);
    sun.target.position.set(ROOM_CENTER.x, 0, ROOM_CENTER.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);

    const world = new THREE.Group();
    scene.add(world);
    const { room, retire } = build(world);
    room.redrawBoard({ todo: 3, doing: 2, done: 1 });
    room.redrawIdeas({ inbox: 2, shaping: 1, ready: 1, ticket: 1 });
    room.tick(at, { rack: false, coffee: false, door: false }, 0);
    const far = farWalls(turn);
    for (const w of WALLS) room.walls[w].visible = far.includes(w);

    // The office's framing, a little tighter, since a thumbnail has no HUD to clear.
    const aspect = width / height;
    const h = viewHeight(aspect, 1.08);
    const target = new THREE.Vector3(ROOM_CENTER.x, FRAME.lookAt, ROOM_CENTER.z);
    const cam = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, 0.1, 200);
    const off = camOffset(turn);
    cam.position.set(target.x + off.x, target.y + off.y, target.z + off.z);
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    if (finish) {
      const last = finish(renderer);
      last.render(scene, cam, cam.far);
      last.dispose();
    } else renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');

    disposeRoom(world, retire);
    sun.shadow.map?.dispose();
    return url;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
