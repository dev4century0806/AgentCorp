import * as THREE from 'three';
import type { AgentLook, WorkerLook } from '@shared';
import { hashString } from '../state/look.js';
import { HAIRS, SHIRTS, SKINS } from './boxkit.js';
import { buildPerson, type Person } from './person.js';

/**
 * Still pictures of a worker in a given look, for pickers that cannot hold a
 * live scene. Drawn the way the office draws them: the same figure, palette,
 * lights and camera angle, from one small offscreen renderer shared by every
 * picture and cached by look, so each one is drawn once.
 */

const W = 96;
const H = 112;
const cache = new Map<string, string | null>();
let stage: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera } | null = null;

/**
 * A data URL of a worker wearing `look`, coloured from `seed` the way a hired
 * worker is coloured from its id. Null where WebGL is unavailable.
 */
export function portrait(look: WorkerLook, seed: string): string | null {
  const h = hashString(seed);
  return picture(`${seed}|${JSON.stringify(look)}`, () =>
    buildPerson(
      look.shirtColor ?? (SHIRTS[h % SHIRTS.length] as string),
      look.hairColor ?? (HAIRS[(h >>> 3) % HAIRS.length] as string),
      SKINS[(h >>> 6) % SKINS.length] as string,
      look,
    ),
  );
}

/**
 * A data URL of a worker wearing one of a generated office's looks: its own
 * colours, hair, outfit and add-ons. `seed` only tells pictures apart in the
 * cache, since a look carries every colour. Null where WebGL is unavailable.
 */
export function lookPortrait(look: AgentLook, seed: string): string | null {
  return picture(`look|${seed}|${JSON.stringify(look)}`, () => buildPerson(look.shirt, look.hair, look.skin, undefined, null, null, look));
}

/** One picture of a figure, drawn once and kept under `key`. */
function picture(key: string, make: () => Person): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;

  let url: string | null = null;
  try {
    const { renderer, scene, cam } = (stage ??= makeStage());
    const person = make();
    person.root.rotation.y = 0.45;
    person.head.rotation.set(-0.06, 0.12, 0);
    person.fx?.tick(0);
    scene.add(person.root);
    renderer.render(scene, cam);
    url = renderer.domElement.toDataURL('image/png');
    scene.remove(person.root);
  } catch {
    url = null;
  }
  cache.set(key, url);
  return url;
}

function makeStage(): NonNullable<typeof stage> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(2);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffd9a8, 0.38));
  scene.add(new THREE.HemisphereLight(0xffe6c0, 0x3a2a20, 0.35));
  const sun = new THREE.DirectionalLight(0xffc27a, 0.95);
  sun.position.set(-6, 5, 1.2);
  scene.add(sun);

  // Framed on the head and shoulders, where hats, hair and outfits differ.
  const span = 1.5;
  const target = new THREE.Vector3(0, 1.08, 0);
  const cam = new THREE.OrthographicCamera((-span * W) / H / 2, (span * W) / H / 2, span / 2, -span / 2, 0.1, 100);
  cam.position.copy(target).add(new THREE.Vector3(20, 17, 20).normalize().multiplyScalar(30));
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  return { renderer, scene, cam };
}
