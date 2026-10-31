import * as THREE from 'three';
import { drawn, sheet, type Pass } from './pass.js';
import { sunPenumbra } from './shading.js';

/** How wide the smooth style's sun is, as the tangent of its radius: a shadow's edge blurs this much for each metre it falls from what casts it. */
const SUN_SPREAD = 0.025;
/** The furthest a shadow falls from what casts it before it blurs no more, in metres. */
const SUN_REACH = 3;

/**
 * Sets how the smooth style's sun softens its shadows, from the sun's shadow
 * camera, which the shadows are measured in. Only smooth surfaces read it.
 */
export function softenSun(sun: THREE.DirectionalLight): void {
  const { left, right, near, far } = sun.shadow.camera;
  sunPenumbra.value.set((SUN_SPREAD * (far - near)) / (right - left), (SUN_SPREAD * SUN_REACH) / (right - left));
}

/** How far round a point the smooth style looks for what shelters it, in metres: the gap under a desk, the foot of a wall. */
const SHELTER_REACH = 0.6;
/** How many places it looks, on a spiral out to that far, and how many times the spiral turns. */
const SHELTER_SAMPLES = 16;
const SHELTER_TURNS = 7;
/** How dark shelter is, and the darkest it gets. */
const SHELTER_STRENGTH = 0.8;
const SHELTER_DEEPEST = 0.6;

/**
 * How sheltered each pixel of a half-size texture is: how much of what is
 * near the surface there stands in front of it, nearer counting more
 * (McGuire, Mara and Luebke, "Scalable Ambient Obscurance", 2012). A flat face
 * shelters none of itself, at any tilt.
 */
const findShader = /* glsl */ `
// Where the surface at uv is, in metres, in the camera's frame.
vec3 at(vec2 uv) {
  return vec3(uv / texel * pixelWorld, -dist(uv));
}

// Which way the surface at uv faces, from its neighbours on whichever side
// lies flatter with it, so a point by an edge is not bent round it.
vec3 facing(vec2 uv, vec3 p) {
  vec3 r = at(uv + vec2(texel.x, 0.0)) - p;
  vec3 l = p - at(uv - vec2(texel.x, 0.0));
  vec3 u = at(uv + vec2(0.0, texel.y)) - p;
  vec3 d = p - at(uv - vec2(0.0, texel.y));
  return normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(d.z) ? u : d));
}

void main() {
  const float reach = ${SHELTER_REACH.toFixed(3)};
  // A pixel of the half-size texture sits on the corner of four of the
  // room's; it reads the middle of one of them, as reading on the corner
  // would land on whichever of the four the GPU rounds to.
  vec2 uv = vUv - 0.5 * texel;
  vec3 p = at(uv);
  vec3 n = facing(uv, p);
  // The sixteen pixels of each square of four by four look in sixteen
  // different turns of the spiral, at sixteen different steps out along it,
  // so between them they look in all the places evening out takes in.
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
  float k = cell.x + 4.0 * cell.y;
  float spin = 6.2831853 * (k + 0.5) / 16.0;
  float along = fract((k + 0.5) * 0.618034);
  float across = reach / pixelWorld;
  float sum = 0.0;
  for (int i = 0; i < ${SHELTER_SAMPLES}; i++) {
    float t = (float(i) + along) / ${SHELTER_SAMPLES.toFixed(1)};
    float a = spin + t * ${(SHELTER_TURNS * 2 * Math.PI).toFixed(5)};
    vec3 v = at(uv + vec2(cos(a), sin(a)) * t * across * texel) - p;
    float vv = dot(v, v);
    float f = max(reach * reach - vv, 0.0);
    sum += f * f * f * max((dot(v, n) - 0.01) / (vv + 0.01), 0.0);
  }
  gl_FragColor = vec4(min(${SHELTER_DEEPEST.toFixed(3)}, sum * ${SHELTER_STRENGTH.toFixed(3)} * 5.0 / (pow(reach, 6.0) * ${SHELTER_SAMPLES.toFixed(1)})), 0.0, 0.0, 1.0);
}
`;

/** The shelter evened out over each square of four by four, leaving out what lies at another depth, so it does not bleed across an edge. */
const evenShader = /* glsl */ `
uniform sampler2D tShelter;
uniform vec2 shelterTexel;
void main() {
  // The depth read as the shelter was found: in the middle of one of the room's pixels, not on their corner.
  vec2 middle = -0.5 * texel;
  float c = dist(vUv + middle);
  // How far apart in depth two pixels can be and still be one surface: a
  // floor seen at a slant drops away across the square, more so zoomed out.
  float apart = 0.2 + 24.0 * pixelWorld;
  float sum = 0.0;
  float weight = 0.0;
  for (int y = -2; y < 2; y++) {
    for (int x = -2; x < 2; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * shelterTexel;
      float w = max(0.0, 1.0 - abs(dist(uv + middle) - c) / apart);
      sum += texture2D(tShelter, uv).r * w;
      weight += w;
    }
  }
  gl_FragColor = vec4(sum / weight, 0.0, 0.0, 1.0);
}
`;

/** The room, darkened by its shelter. */
const layShader = /* glsl */ `
uniform sampler2D tShelter;
void main() {
  vec4 seen = texture2D(tColor, vUv);
  // What gives light was drawn with no alpha, and is not darkened.
  gl_FragColor = vec4(darken(seen.rgb, vec3(1.0 - texture2D(tShelter, vUv).r * seen.a)), 1.0);
}
`;

/**
 * The smooth style's last pass: the room darkened where it is sheltered,
 * under a desk or at the foot of a wall, as light baked into it would be.
 * The room is drawn with four samples a pixel, as there are no lines to hide
 * its edges; the shelter is found at half the size, which is plenty for
 * something so soft, and evened out.
 */
export function shelter(renderer: THREE.WebGLRenderer): Pass {
  const room = drawn(renderer, 4);
  const half = (): [number, number] => [Math.max(1, Math.round(room.size.x / 2)), Math.max(1, Math.round(room.size.y / 2))];
  const found = new THREE.WebGLRenderTarget(...half(), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const evened = new THREE.WebGLRenderTarget(...half(), { depthBuffer: false });
  const shelterTexel = { value: new THREE.Vector2(1 / found.width, 1 / found.height) };
  const find = sheet(renderer, room.uniforms, findShader);
  const even = sheet(renderer, { ...room.uniforms, tShelter: { value: found.texture }, shelterTexel }, evenShader);
  const lay = sheet(renderer, { ...room.uniforms, tShelter: { value: evened.texture } }, layShader);
  return {
    render(scene, cam, far) {
      room.draw(scene, cam, far);
      find.draw(found);
      even.draw(evened);
      lay.draw(null);
    },
    resize() {
      room.resize();
      found.setSize(...half());
      evened.setSize(...half());
      shelterTexel.value.set(1 / found.width, 1 / found.height);
    },
    dispose() {
      room.dispose();
      found.dispose();
      evened.dispose();
      for (const s of [find, even, lay]) s.dispose();
    },
  };
}
