import * as THREE from 'three';

/**
 * How a room's surfaces take the light: its base's way, unless one is picked
 * for every room in Settings (see pickRenderStyle).
 *
 * - voxel: flat Lambert faces lit smoothly, the office as it has always been.
 * - storybook: toon faces lit in a few flat steps, which the office draws
 *   over with ink lines and a paper grain (see ink.ts).
 * - smooth: physically based surfaces on rounded boxes, under a sun whose
 *   shadows soften with distance, which the office darkens where things
 *   shelter each other (see smooth.ts): a first look at the Smooth 3D
 *   style, before modelled furniture takes the place of the boxes.
 */
export const RENDER_STYLES = ['voxel', 'storybook', 'smooth'] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];

let current: RenderStyle = 'voxel';

/** The style surfaces are made in: the one a room is being built in, or voxel outside any. */
export function shading(): RenderStyle {
  return current;
}

/**
 * Builds with every surface made in `style`. Builders read it as they go
 * rather than being handed it, so the thousands of boxes a room is made of
 * need not pass it along.
 */
export function shadedAs<T>(style: RenderStyle, build: () => T): T {
  const was = current;
  current = style;
  try {
    return build();
  } finally {
    current = was;
  }
}

/**
 * A builder that runs later, once the room is up (a cabinet that fills as
 * tickets are done, sweets thrown from a bowl), made to keep the style it was
 * made in, since by then nothing is being built in any.
 */
export function keepShading<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const style = current;
  return (...args) => shadedAs(style, () => fn(...args));
}

/** What a surface may be made with: what Lambert and toon materials have in common. */
export type SurfaceParameters = Pick<
  THREE.MeshLambertMaterialParameters,
  'color' | 'map' | 'emissive' | 'emissiveIntensity' | 'transparent' | 'opacity' | 'side' | 'alphaTest'
>;

/** A lit surface: Lambert in the voxel style, toon in the storybook one, physically based in the smooth one. */
export type Surface = THREE.MeshLambertMaterial | THREE.MeshToonMaterial | THREE.MeshStandardMaterial;

/** How rough a smooth surface is: a soft sheen where the sun or a lamp catches it, and no mirror. */
const SMOOTH_ROUGHNESS = 0.62;

/** A lit surface in the style being built in. */
export function surface(params: SurfaceParameters): Surface {
  if (current === 'storybook') return new THREE.MeshToonMaterial({ ...params, gradientMap: toonSteps() });
  if (current === 'smooth') {
    const m = new THREE.MeshStandardMaterial({ ...params, roughness: SMOOTH_ROUGHNESS, metalness: 0 });
    m.onBeforeCompile = softSunShadows;
    return m;
  }
  return new THREE.MeshLambertMaterial(params);
}

/**
 * How the smooth style's sun softens its shadows, set from the sun's shadow
 * camera (see smooth.ts). x: how far a shadow's edge blurs, in the shadow
 * map, for each unit of its depth that the surface lies behind what shades
 * it. y: the furthest round itself a surface looks for what does.
 */
export const sunPenumbra = { value: new THREE.Vector2() };

const SOFT_SUN = /* glsl */ `
	uniform vec2 sunPenumbra;

	// The i-th of count places on a disc, spread evenly out from its middle and turned by spin.
	vec2 sunDisc( float i, float count, float spin ) {
		float a = i * 2.3999632 + spin;
		return vec2( cos( a ), sin( a ) ) * sqrt( ( i + 0.5 ) / count );
	}

	// The sun's shadow on a smooth surface: sharp where it meets what casts
	// it and softer further off, as a wide sun's is. The surface looks round
	// itself for what stands between it and the sun, and blurs by how far
	// behind that it lies (Fernando, "Percentage-Closer Soft Shadows", 2005).
	float softSun( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord ) {
		// Each pixel turns its discs its own way, so neighbours look in different places.
		float spin = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		float blocker = 0.0;
		float found = 0.0;
		for ( int i = 0; i < 12; i ++ ) {
			float d = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + sunDisc( float( i ), 12.0, spin ) * sunPenumbra.y ) );
			if ( d < shadowCoord.z ) {
				blocker += d;
				found += 1.0;
			}
		}
		if ( found == 0.0 ) return 1.0;
		float radius = clamp( ( shadowCoord.z - blocker / found ) * sunPenumbra.x, 1.0 / shadowMapSize.x, sunPenumbra.y );
		float lit = 0.0;
		for ( int i = 0; i < 20; i ++ ) {
			lit += step( shadowCoord.z, unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + sunDisc( float( i ), 20.0, spin + 1.7 ) * radius ) ) );
		}
		return lit / 20.0;
	}
`;

/** Three's shadow code with the soft sun in place of its own filter: made the first time a smooth surface is drawn. */
let softShadowChunk: string | null = null;

/** Gives a smooth surface the soft sun. Every smooth surface shares this one function, and so its compiled shaders. */
function softSunShadows(shader: Parameters<THREE.Material['onBeforeCompile']>[0]): void {
  shader.uniforms.sunPenumbra = sunPenumbra;
  softShadowChunk ??= THREE.ShaderChunk.shadowmap_pars_fragment
    .replace('float getShadow(', `${SOFT_SUN}\n\tfloat getShadow(`)
    .replace('if ( frustumTest ) {', 'if ( frustumTest ) {\n\t\t\treturn softSun( shadowMap, shadowMapSize, shadowCoord );');
  shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', softShadowChunk);
}

/**
 * A surface that gives light rather than takes it (a lamp shade, a strip of
 * light): lit in its own colour. In the storybook and smooth styles it writes
 * no alpha, which is how their last pass knows to leave it be: a strip
 * thinner than a line would otherwise drown in one, and a lamp is not
 * darkened by what stands round it.
 */
export function glowSurface(color: THREE.ColorRepresentation, intensity: number): Surface {
  const m = surface({ color, emissive: color, emissiveIntensity: intensity });
  if (m instanceof THREE.MeshToonMaterial) m.onBeforeCompile = writeNoAlpha;
  if (m instanceof THREE.MeshStandardMaterial) m.onBeforeCompile = softGlow;
  return m;
}

/** Opaque materials have their alpha forced to 1 in the shader, so it is set after that. */
function writeNoAlpha(shader: Parameters<THREE.Material['onBeforeCompile']>[0]): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <output_fragment>\n\tgl_FragColor.a = 0.0;');
}

/** A smooth glow: the soft sun like any smooth surface, and no alpha. */
function softGlow(shader: Parameters<THREE.Material['onBeforeCompile']>[0]): void {
  softSunShadows(shader);
  writeNoAlpha(shader);
}

/**
 * How much of a light a storybook surface takes, by how squarely it faces it
 * (the cosine, from 1 facing it to 0 side on): nothing turned away or grazed,
 * then three flat steps. A box's faces each land on one step, and round
 * things break into bands.
 */
export function toonLight(facing: number): number {
  if (facing < 0.12) return 0;
  if (facing < 0.4) return 0.3;
  if (facing < 0.75) return 0.7;
  return 1;
}

/** Texels across the steps: enough that each threshold lands within a few hundredths of where it says. */
const STEP_TEXELS = 64;
let steps: THREE.DataTexture | null = null;

/** The steps as the toon shader reads them: one row, from facing away (left) to facing the light (right). */
export function toonSteps(): THREE.DataTexture {
  if (steps) return steps;
  const data = new Uint8Array(STEP_TEXELS * 4);
  for (let i = 0; i < STEP_TEXELS; i++) {
    // The shader looks a cosine c up at (c + 1) / 2; read each texel at its middle.
    const v = Math.round(toonLight(((i + 0.5) / STEP_TEXELS) * 2 - 1) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  steps = new THREE.DataTexture(data, STEP_TEXELS, 1, THREE.RGBAFormat);
  steps.minFilter = THREE.NearestFilter;
  steps.magFilter = THREE.NearestFilter;
  steps.generateMipmaps = false;
  steps.needsUpdate = true;
  return steps;
}

/** A render style asked for in the page's address (`?render=storybook`), for trying a style on any room; null if none or not one there is. */
export function renderOverride(search: string): RenderStyle | null {
  const asked = new URLSearchParams(search).get('render');
  return RENDER_STYLES.find((s) => s === asked) ?? null;
}

/** What each style is called where it can be picked. */
export const RENDER_NAMES: Record<RenderStyle, string> = {
  voxel: 'Blocky',
  storybook: 'Storybook',
  smooth: 'Smooth 3D',
};

const PICKED_KEY = 'agent-corp.render';

/** The style kept as picked in Settings; null if none, or not one there is. */
export function savedRenderStyle(storage?: Pick<Storage, 'getItem'>): RenderStyle | null {
  try {
    const saved = (storage ?? localStorage).getItem(PICKED_KEY);
    return RENDER_STYLES.find((s) => s === saved) ?? null;
  } catch {
    return null;
  }
}

/** The style a visit starts in: the one its address asks for (see renderOverride), or else the one kept. */
export function startingRenderStyle(search: string, storage?: Pick<Storage, 'getItem'>): RenderStyle | null {
  return renderOverride(search) ?? savedRenderStyle(storage);
}

let picked: RenderStyle | null | undefined;
const pickListeners = new Set<(style: RenderStyle) => void>();

/** The style every room is drawn in, or null for each room's own: the one the visit started in, until one is picked in Settings. */
export function pickedRenderStyle(): RenderStyle | null {
  if (picked === undefined) picked = startingRenderStyle(typeof location === 'undefined' ? '' : location.search);
  return picked;
}

/** Draws every room in `style` from now on, kept in this browser. */
export function pickRenderStyle(style: RenderStyle, storage?: Pick<Storage, 'setItem'>): void {
  picked = style;
  try {
    (storage ?? localStorage).setItem(PICKED_KEY, style);
  } catch {
    // Storage blocked: the pick lasts until the page reloads.
  }
  for (const fn of pickListeners) fn(style);
}

export function onRenderStylePicked(fn: (style: RenderStyle) => void): () => void {
  pickListeners.add(fn);
  return () => pickListeners.delete(fn);
}
