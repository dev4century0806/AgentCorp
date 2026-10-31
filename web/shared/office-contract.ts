/**
 * The office contract (issue #157): what a generated office is allowed to be.
 *
 * A generated office is data only: one JSON manifest that restyles a built-in
 * room and dresses it with decorations and agent looks built from a fixed set
 * of primitive parts. Nothing in it is ever run. The working parts of the room
 * because walking, clicks and quests depend on them; decorations go into named
 * slots the renderer places clear of them.
 *
 * The server validates every manifest an agent writes or a download brings in,
 * and the UI and the website draw only manifests that passed. This module has
 * no imports, so the site can copy it as it is.
 */

export const OFFICE_CONTRACT_VERSION = 1;

/** Every office seats exactly this many workers, at the built-in desks. */
export const OFFICE_SEATS = 16;

/** The built-in room a generated office restyles: its desks, fixtures and shape. */
export const OFFICE_BASES = ['office'] as const;
export type OfficeBase = (typeof OFFICE_BASES)[number];

export const OFFICE_STYLES = ['cozy', 'sleek', 'retro', 'spooky', 'playful', 'realistic'] as const;
export type OfficeStyle = (typeof OFFICE_STYLES)[number];

export const PART_SHAPES = ['box', 'cylinder', 'sphere', 'cone'] as const;
export type PartShape = (typeof PART_SHAPES)[number];

/** Motion and light a part can have, all drawn by the app. */
export const PART_EFFECTS = ['none', 'glow', 'flicker', 'pulse', 'float', 'spin'] as const;
export type PartEffect = (typeof PART_EFFECTS)[number];

export const FLOOR_PATTERNS = ['plain', 'checker', 'planks', 'tiles'] as const;
export type FloorPattern = (typeof FLOOR_PATTERNS)[number];

export const PARTICLE_KINDS = ['none', 'snow', 'embers', 'bubbles', 'dust', 'leaves', 'sparkles'] as const;
export type ParticleKind = (typeof PARTICLE_KINDS)[number];

/** Built-in hair a look can keep, or none (for helmets, hoods and heads that are not heads). */
export const LOOK_HAIR = ['none', 'crop', 'bun', 'mohawk', 'shoulder'] as const;
export const LOOK_OUTFITS = ['tee', 'hoodie', 'tie', 'labcoat', 'cardigan'] as const;

/** Where on a person an add-on is fixed, so it moves with that limb. */
export const LOOK_ANCHORS = ['head', 'body', 'armL', 'armR', 'legL', 'legR'] as const;
export type LookAnchor = (typeof LOOK_ANCHORS)[number];

/** A colour, `#rrggbb`. */
export type Hex = string;
export type Vec3 = [number, number, number];

/**
 * One primitive: a shape of `size` (width, height, depth) centred at `at`,
 * relative to whatever holds it. It is first tipped `tilt` degrees about the
 * width axis (90 stands a flat disc up on its edge, like a wheel facing the
 * room), then turned `rotate` degrees about the vertical. Cylinders and cones
 * use width as the diameter; spheres use all three. A spinning part spins
 * about its own (tipped) vertical axis.
 */
export interface Part {
  shape: PartShape;
  size: Vec3;
  at: Vec3;
  color: Hex;
  rotate?: number;
  tilt?: number;
  effect?: PartEffect;
}

/**
 * Where decorations may go. Floor and desk slots are measured from the middle
 * of their footprint, with y going up from the floor or desk top (0). Wall
 * slots are measured from the middle of their area on the wall, with z going
 * out of the wall into the room from its face (0). The renderer
 * owns where each slot is; the contract only fixes how big it may be.
 */
export interface SlotSpec {
  kind: 'floor' | 'wall' | 'desk';
  /** Width, height, depth the parts must fit inside. */
  max: Vec3;
  /** For agents writing a manifest: where it is and what fits there. */
  about: string;
}

export const OFFICE_SLOTS = {
  'back-left-corner': { kind: 'floor', max: [1.6, 3.2, 1.4], about: 'Floor in the back-left corner, beside the bookshelf.' },
  'back-right-corner': { kind: 'floor', max: [1, 3.2, 1.4], about: 'Floor in the back-right corner, beside the back wall.' },
  'right-wall-floor': { kind: 'floor', max: [1.2, 2.6, 3.4], about: 'Floor along the right wall, between the shelves and the lounge.' },
  'front-left': { kind: 'floor', max: [3, 3, 2.4], about: 'Floor in the front-left of the room, past reception.' },
  'front-centre': { kind: 'floor', max: [4, 2.4, 2.4], about: 'Floor at the front of the room, in the middle. Keep it low: it is nearest the camera.' },
  'front-right': { kind: 'floor', max: [3, 3, 2.4], about: 'Floor in the front-right of the room, past the pinball machine.' },
  'back-wall-high': { kind: 'wall', max: [18, 1.2, 0.3], about: 'A long band high on the back wall, above everything else: banners, garlands, signs.' },
  'left-wall-high': { kind: 'wall', max: [18, 1.2, 0.3], about: 'A long band high on the left wall.' },
  'right-wall-high': { kind: 'wall', max: [18, 1.2, 0.3], about: 'A long band high on the right wall.' },
  'right-wall': { kind: 'wall', max: [3.4, 2.4, 0.3], about: 'The right wall above the free floor between the shelves and the lounge: a picture, a window, a map.' },
  'front-wall': { kind: 'wall', max: [16, 3.4, 0.3], about: 'The front wall, seen only when the view is turned.' },
  desk: { kind: 'desk', max: [0.36, 0.36, 0.3], about: 'A small thing standing on every desk, beside the screen. Repeated on all sixteen desks.' },
} as const satisfies Record<string, SlotSpec>;
export type OfficeSlot = keyof typeof OFFICE_SLOTS;

export interface Decoration {
  slot: OfficeSlot;
  /** What it is, for people reading the manifest: "ship's wheel". */
  name: string;
  parts: Part[];
}

/** One of the looks workers wear in this office. */
export interface AgentLook {
  name: string;
  skin: Hex;
  hair: Hex;
  hairStyle: (typeof LOOK_HAIR)[number];
  shirt: Hex;
  pants: Hex;
  outfit: (typeof LOOK_OUTFITS)[number];
  /** Extra parts on top of the person, each fixed to a limb so it moves with it. */
  addons: { anchor: LookAnchor; parts: Part[] }[];
}

export interface OfficeLighting {
  /** The colour behind the room. */
  clear: Hex;
  ambient: Hex;
  ambientIntensity: number;
  sky: Hex;
  ground: Hex;
  sun: Hex;
  sunIntensity: number;
  /** Where the main light shines from, relative to the room's middle. */
  sunAt: Vec3;
}

/** The colours of the room itself. Anything left out keeps the base room's colour. */
export interface OfficePalette {
  wall?: Hex;
  trim?: Hex;
  skirt?: Hex;
  shelfFrame?: Hex;
  shelf?: Hex;
  books?: Hex[];
  pot?: Hex;
  potRim?: Hex;
  stem?: Hex;
  leaves?: Hex[];
  doorFrame?: Hex;
  doorLight?: Hex;
  doorLeaf?: Hex;
  doorHandle?: Hex;
  rackBody?: Hex;
  rackTrim?: Hex;
  rackPanel?: Hex;
  rackBlank?: Hex;
  screenOn?: Hex;
  screenOff?: Hex;
}
export const PALETTE_KEYS = [
  'wall', 'trim', 'skirt', 'shelfFrame', 'shelf', 'books', 'pot', 'potRim', 'stem', 'leaves', 'doorFrame', 'doorLight',
  'doorLeaf', 'doorHandle', 'rackBody', 'rackTrim', 'rackPanel', 'rackBlank', 'screenOn', 'screenOff',
] as const satisfies readonly (keyof OfficePalette)[];
const PALETTE_LISTS = new Set<string>(['books', 'leaves']);

export interface OfficeManifest {
  version: typeof OFFICE_CONTRACT_VERSION;
  name: string;
  description: string;
  tags: string[];
  base: OfficeBase;
  /** `minimal` drops the base room's clutter (windows, shelves, plants), keeping every working fixture. */
  furnishing: 'full' | 'minimal';
  lighting: OfficeLighting;
  palette: OfficePalette;
  floor: { pattern: FloorPattern; color: Hex; alt: Hex };
  particles: { kind: ParticleKind; color: Hex; density: number };
  decorations: Decoration[];
  /** Three to six; each worker wears one, the same one every time. */
  looks: AgentLook[];
}

export const OFFICE_LIMITS = {
  name: 40,
  description: 240,
  tags: 5,
  tag: 20,
  partName: 40,
  decorations: 40,
  partsPerDecoration: 48,
  parts: 900,
  looks: [3, 6] as const,
  addonParts: 24,
  /** The whole manifest, as JSON. */
  bytes: 256 * 1024,
  /** Largest size of any single part, in any direction. */
  partSize: 18,
} as const;

/** What a person's add-ons on each anchor must fit inside, measured from that limb's pivot. */
export const ANCHOR_BOUNDS: Record<LookAnchor, Vec3> = {
  head: [0.9, 1.2, 0.9],
  body: [0.9, 1.0, 0.8],
  armL: [0.5, 1.3, 0.5],
  armR: [0.5, 1.3, 0.5],
  legL: [0.5, 1.3, 0.6],
  legR: [0.5, 1.3, 0.6],
};

/* ---------- briefs, the answers a user gives when making an office ---------- */

export interface OfficeDetails {
  theme: string;
  scene: string;
  people: string;
  decor: string;
  notes: string;
  style: OfficeStyle;
}
export const DETAIL_FIELDS = ['theme', 'scene', 'people', 'decor', 'notes'] as const;
export const DETAIL_LIMIT = 600;
export const PROMPT_LIMIT = 600;

export interface OfficeBrief {
  /** The one-line prompt the user started from. */
  prompt: string;
  details: OfficeDetails;
}

/* ---------- validation ---------- */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const HEX = /^#[0-9a-fA-F]{6}$/;
const TAG = /^[a-z0-9][a-z0-9-]*$/;
/** Text that looks like markup, script or a template: never allowed, even though nothing would run it. */
const CODE_LIKE = /<|>|javascript:|data:|\bon\w+\s*=|\{\{|\$\{|`/i;
const MAX_ERRORS = 40;

class Check {
  errors: string[] = [];
  fail(path: string, message: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push(`${path}: ${message}`);
  }
  object(v: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.fail(path, 'must be an object');
      return null;
    }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k)) this.fail(`${path}.${k}`, 'is not part of the contract');
    for (const k of keys) if (!(k in o)) this.fail(`${path}.${k}`, 'is required');
    return o;
  }
  array(v: unknown, path: string, min: number, max: number): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, 'must be a list');
      return [];
    }
    if (v.length < min || v.length > max) this.fail(path, min === max ? `must have exactly ${min}` : `must have ${min} to ${max} entries`);
    return v.slice(0, max);
  }
  text(v: unknown, path: string, max: number, min = 1): string {
    if (typeof v !== 'string') {
      this.fail(path, 'must be text');
      return '';
    }
    if (v.trim().length < min) this.fail(path, 'must not be empty');
    if (v.length > max) this.fail(path, `must be at most ${max} characters`);
    if (CODE_LIKE.test(v)) this.fail(path, 'must be plain words, with no markup, links or code');
    return v;
  }
  hex(v: unknown, path: string): string {
    if (typeof v !== 'string' || !HEX.test(v)) {
      this.fail(path, 'must be a colour like #a1b2c3');
      return '#000000';
    }
    return v.toLowerCase();
  }
  number(v: unknown, path: string, min: number, max: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(path, 'must be a number');
      return min;
    }
    if (v < min || v > max) this.fail(path, `must be between ${min} and ${max}`);
    return v;
  }
  oneOf<T extends string>(values: readonly T[], v: unknown, path: string): T {
    if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T;
    this.fail(path, `must be one of ${values.join(', ')}`);
    return values[0]!;
  }
  vec(v: unknown, path: string, min: number, max: number): Vec3 {
    const a = this.array(v, path, 3, 3);
    return [0, 1, 2].map((i) => this.number(a[i], `${path}[${i}]`, min, max)) as Vec3;
  }
}

/** Half-extents of a part about its centre, once tipped and turned: the bounding box of its box. */
function extent(p: Part): Vec3 {
  const [w, h, d] = p.size;
  const t = ((p.tilt ?? 0) * Math.PI) / 180;
  const ct = Math.abs(Math.cos(t));
  const st = Math.abs(Math.sin(t));
  const hy = (h * ct + d * st) / 2;
  const hz = (h * st + d * ct) / 2;
  const r = ((p.rotate ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return [(w / 2) * c + hz * s, hy, (w / 2) * s + hz * c];
}

function part(c: Check, v: unknown, path: string): Part | null {
  const o = c.object(v, path, ['shape', 'size', 'at', 'color'], ['rotate', 'tilt', 'effect']);
  if (!o) return null;
  const p: Part = {
    shape: c.oneOf(PART_SHAPES, o.shape, `${path}.shape`),
    size: c.vec(o.size, `${path}.size`, 0.01, OFFICE_LIMITS.partSize),
    at: c.vec(o.at, `${path}.at`, -OFFICE_LIMITS.partSize, OFFICE_LIMITS.partSize),
    color: c.hex(o.color, `${path}.color`),
  };
  if (o.rotate !== undefined) p.rotate = c.number(o.rotate, `${path}.rotate`, -360, 360);
  if (o.tilt !== undefined) p.tilt = c.number(o.tilt, `${path}.tilt`, -180, 180);
  if (o.effect !== undefined) p.effect = c.oneOf(PART_EFFECTS, o.effect, `${path}.effect`);
  return p;
}

/**
 * How a slot's box sits about its origin: `floor` boxes stand on y = 0, `wall`
 * boxes stand out from z = 0, and `centred` boxes (a person's limbs) are
 * centred on all three.
 */
type Mount = 'floor' | 'wall' | 'centred';

/** Whether a part stays inside a box of `max` (width, height, depth) mounted as `mount`. */
function inside(p: Part, max: Vec3, mount: Mount): boolean {
  const [hx, hy, hz] = extent(p);
  const [x, y, z] = p.at;
  const e = 1e-6;
  const within = (v: number, half: number, size: number, from0: boolean) =>
    from0 ? v - half >= -e && v + half <= size + e : Math.abs(v) + half <= size / 2 + e;
  return within(x, hx, max[0], false) && within(y, hy, max[1], mount === 'floor') && within(z, hz, max[2], mount === 'wall');
}

function parts(c: Check, v: unknown, path: string, max: number, bounds: Vec3, mount: Mount): Part[] {
  const out: Part[] = [];
  c.array(v, path, 1, max).forEach((raw, i) => {
    const p = part(c, raw, `${path}[${i}]`);
    if (!p) return;
    if (!inside(p, bounds, mount)) c.fail(`${path}[${i}]`, `does not fit inside ${bounds.join(' x ')}`);
    out.push(p);
  });
  return out;
}

function lighting(c: Check, v: unknown, path: string): OfficeLighting {
  const o = c.object(v, path, ['clear', 'ambient', 'ambientIntensity', 'sky', 'ground', 'sun', 'sunIntensity', 'sunAt']) ?? {};
  return {
    clear: c.hex(o.clear, `${path}.clear`),
    ambient: c.hex(o.ambient, `${path}.ambient`),
    ambientIntensity: c.number(o.ambientIntensity, `${path}.ambientIntensity`, 0.1, 1.5),
    sky: c.hex(o.sky, `${path}.sky`),
    ground: c.hex(o.ground, `${path}.ground`),
    sun: c.hex(o.sun, `${path}.sun`),
    sunIntensity: c.number(o.sunIntensity, `${path}.sunIntensity`, 0, 1.5),
    sunAt: c.vec(o.sunAt, `${path}.sunAt`, -30, 30),
  };
}

function palette(c: Check, v: unknown, path: string): OfficePalette {
  const o = c.object(v, path, [], PALETTE_KEYS) ?? {};
  const out: Record<string, string | string[]> = {};
  for (const k of PALETTE_KEYS) {
    if (o[k] === undefined) continue;
    out[k] = PALETTE_LISTS.has(k)
      ? c.array(o[k], `${path}.${k}`, 1, 8).map((x, i) => c.hex(x, `${path}.${k}[${i}]`))
      : c.hex(o[k], `${path}.${k}`);
  }
  return out as OfficePalette;
}

function look(c: Check, v: unknown, path: string): AgentLook {
  const o = c.object(v, path, ['name', 'skin', 'hair', 'hairStyle', 'shirt', 'pants', 'outfit', 'addons']) ?? {};
  const addons: AgentLook['addons'] = [];
  let count = 0;
  c.array(o.addons, `${path}.addons`, 0, LOOK_ANCHORS.length).forEach((raw, i) => {
    const a = c.object(raw, `${path}.addons[${i}]`, ['anchor', 'parts']);
    if (!a) return;
    const anchor = c.oneOf(LOOK_ANCHORS, a.anchor, `${path}.addons[${i}].anchor`);
    const ps = parts(c, a.parts, `${path}.addons[${i}].parts`, OFFICE_LIMITS.addonParts, ANCHOR_BOUNDS[anchor], 'centred');
    count += ps.length;
    addons.push({ anchor, parts: ps });
  });
  if (count > OFFICE_LIMITS.addonParts) c.fail(`${path}.addons`, `must have at most ${OFFICE_LIMITS.addonParts} parts in all`);
  return {
    name: c.text(o.name, `${path}.name`, OFFICE_LIMITS.partName),
    skin: c.hex(o.skin, `${path}.skin`),
    hair: c.hex(o.hair, `${path}.hair`),
    hairStyle: c.oneOf(LOOK_HAIR, o.hairStyle, `${path}.hairStyle`),
    shirt: c.hex(o.shirt, `${path}.shirt`),
    pants: c.hex(o.pants, `${path}.pants`),
    outfit: c.oneOf(LOOK_OUTFITS, o.outfit, `${path}.outfit`),
    addons,
  };
}

/**
 * Checks a manifest against the contract. Takes the parsed JSON, or the raw
 * text (which also gets the size limit). Returns a clean copy holding only
 * contract fields, or every problem found, worded so an agent can fix them.
 */
export function validateOfficeManifest(input: unknown): ValidationResult<OfficeManifest> {
  const c = new Check();
  let raw = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > OFFICE_LIMITS.bytes) return { ok: false, errors: [`manifest: must be at most ${OFFICE_LIMITS.bytes} bytes`] };
    try {
      raw = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`manifest: is not valid JSON (${(err as Error).message})`] };
    }
  }
  const o = c.object(raw, 'manifest', [
    'version', 'name', 'description', 'tags', 'base', 'furnishing', 'lighting', 'palette', 'floor', 'particles', 'decorations', 'looks',
  ]);
  if (!o) return { ok: false, errors: c.errors };
  if (o.version !== OFFICE_CONTRACT_VERSION) c.fail('manifest.version', `must be ${OFFICE_CONTRACT_VERSION}`);

  const tags = c.array(o.tags, 'manifest.tags', 0, OFFICE_LIMITS.tags).map((t, i) => {
    const tag = c.text(t, `manifest.tags[${i}]`, OFFICE_LIMITS.tag);
    if (tag && !TAG.test(tag)) c.fail(`manifest.tags[${i}]`, 'must be lower-case letters, digits and dashes');
    return tag;
  });

  const floorO = c.object(o.floor, 'manifest.floor', ['pattern', 'color', 'alt']) ?? {};
  const partsO = c.object(o.particles, 'manifest.particles', ['kind', 'color', 'density']) ?? {};

  let total = 0;
  const decorations: Decoration[] = [];
  c.array(o.decorations, 'manifest.decorations', 0, OFFICE_LIMITS.decorations).forEach((raw, i) => {
    const path = `manifest.decorations[${i}]`;
    const d = c.object(raw, path, ['slot', 'name', 'parts']);
    if (!d) return;
    const slot = c.oneOf(Object.keys(OFFICE_SLOTS) as OfficeSlot[], d.slot, `${path}.slot`);
    const spec: SlotSpec = OFFICE_SLOTS[slot];
    const ps = parts(c, d.parts, `${path}.parts`, OFFICE_LIMITS.partsPerDecoration, spec.max, spec.kind === 'wall' ? 'wall' : 'floor');
    total += ps.length;
    decorations.push({ slot, name: c.text(d.name, `${path}.name`, OFFICE_LIMITS.partName), parts: ps });
  });
  if (total > OFFICE_LIMITS.parts) c.fail('manifest.decorations', `must have at most ${OFFICE_LIMITS.parts} parts in all`);
  const deskItems = decorations.filter((d) => d.slot === 'desk').length;
  if (deskItems > 1) c.fail('manifest.decorations', 'may have only one desk decoration (it is repeated on every desk)');

  const [minLooks, maxLooks] = OFFICE_LIMITS.looks;
  const looks = c.array(o.looks, 'manifest.looks', minLooks, maxLooks).map((l, i) => look(c, l, `manifest.looks[${i}]`));

  const manifest: OfficeManifest = {
    version: OFFICE_CONTRACT_VERSION,
    name: c.text(o.name, 'manifest.name', OFFICE_LIMITS.name),
    description: c.text(o.description, 'manifest.description', OFFICE_LIMITS.description, 0),
    tags,
    base: c.oneOf(OFFICE_BASES, o.base, 'manifest.base'),
    furnishing: c.oneOf(['full', 'minimal'] as const, o.furnishing, 'manifest.furnishing'),
    lighting: lighting(c, o.lighting, 'manifest.lighting'),
    palette: palette(c, o.palette, 'manifest.palette'),
    floor: {
      pattern: c.oneOf(FLOOR_PATTERNS, floorO.pattern, 'manifest.floor.pattern'),
      color: c.hex(floorO.color, 'manifest.floor.color'),
      alt: c.hex(floorO.alt, 'manifest.floor.alt'),
    },
    particles: {
      kind: c.oneOf(PARTICLE_KINDS, partsO.kind, 'manifest.particles.kind'),
      color: c.hex(partsO.color, 'manifest.particles.color'),
      density: c.number(partsO.density, 'manifest.particles.density', 0, 1),
    },
    decorations,
    looks,
  };
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: manifest };
}

/** Checks the answers a user gave, trimming them; the style must be one of the chips. */
export function validateOfficeBrief(input: unknown): ValidationResult<OfficeBrief> {
  const c = new Check();
  const o = c.object(input, 'brief', ['prompt', 'details']);
  if (!o) return { ok: false, errors: c.errors };
  const d = c.object(o.details, 'brief.details', [...DETAIL_FIELDS, 'style']) ?? {};
  const details = {} as OfficeDetails;
  for (const k of DETAIL_FIELDS) details[k] = c.text(d[k] ?? '', `brief.details.${k}`, DETAIL_LIMIT, k === 'theme' ? 1 : 0).trim();
  details.style = c.oneOf(OFFICE_STYLES, d.style, 'brief.details.style');
  const brief: OfficeBrief = { prompt: c.text(o.prompt, 'brief.prompt', PROMPT_LIMIT).trim(), details };
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: brief };
}

/* ---------- ids and the wire ---------- */

/** Local office ids and published listing ids: lower-case letters, digits and dashes. */
export const OFFICE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** The room choice for a generated office, as the UI saves it. */
export const USER_ROOM_PREFIX = 'user:';

export type OfficeSource =
  | { kind: 'generated' }
  | { kind: 'installed'; listingId: string; creator: string; installedAt: string };

/** A saved office, as the picker lists it. */
export interface OfficeSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  base: OfficeBase;
  source: OfficeSource;
  createdAt: string;
  updatedAt: string;
  hasThumbnail: boolean;
  /** Set once the creator publishes it. */
  listingId: string | null;
}

/** A generation in progress, shown in the dialog and on its task card. */
export interface OfficeGeneration {
  id: string;
  /** The office it edits, or null for a new one. */
  officeId: string | null;
  /** When the build began, for the clock. */
  startedAt: string;
  /** False until the designer's runner is up. */
  started: boolean;
  /** What the designer is doing now, in plain words, or null before it says. */
  line: string | null;
  attempt: number;
  state: 'running' | 'failed' | 'done';
  errors: string[];
  /** The saved office, once done. */
  resultId: string | null;
  /** A failed build cut off mid-turn (a timeout, a crash, a lost connection) that can carry on where it stopped. */
  resumable: boolean;
}

/** One line of a designer's log, for the build window: what it said, a tool it ran, or a note from the office. */
export interface DesignerLogEntry {
  kind: 'said' | 'tool' | 'office';
  text: string;
  at: string;
}

export const OFFICE_ATTEMPTS = 3;
