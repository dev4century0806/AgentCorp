const OFFICE_CONTRACT_VERSION = 1;
const OFFICE_SEATS = 16;
const OFFICE_BASES = ["office"];
const OFFICE_STYLES = ["cozy", "sleek", "retro", "spooky", "playful", "realistic"];
const PART_SHAPES = ["box", "cylinder", "sphere", "cone"];
const PART_EFFECTS = ["none", "glow", "flicker", "pulse", "float", "spin"];
const FLOOR_PATTERNS = ["plain", "checker", "planks", "tiles"];
const PARTICLE_KINDS = ["none", "snow", "embers", "bubbles", "dust", "leaves", "sparkles"];
const LOOK_HAIR = ["none", "crop", "bun", "mohawk", "shoulder"];
const LOOK_OUTFITS = ["tee", "hoodie", "tie", "labcoat", "cardigan"];
const LOOK_ANCHORS = ["head", "body", "armL", "armR", "legL", "legR"];
const OFFICE_SLOTS = {
  "back-left-corner": { kind: "floor", max: [1.6, 3.2, 1.4], about: "Floor in the back-left corner, beside the bookshelf." },
  "back-right-corner": { kind: "floor", max: [1, 3.2, 1.4], about: "Floor in the back-right corner, beside the back wall." },
  "right-wall-floor": { kind: "floor", max: [1.2, 2.6, 3.4], about: "Floor along the right wall, between the shelves and the lounge." },
  "front-left": { kind: "floor", max: [3, 3, 2.4], about: "Floor in the front-left of the room, past reception." },
  "front-centre": { kind: "floor", max: [4, 2.4, 2.4], about: "Floor at the front of the room, in the middle. Keep it low: it is nearest the camera." },
  "front-right": { kind: "floor", max: [3, 3, 2.4], about: "Floor in the front-right of the room, past the pinball machine." },
  "back-wall-high": { kind: "wall", max: [18, 1.2, 0.3], about: "A long band high on the back wall, above everything else: banners, garlands, signs." },
  "left-wall-high": { kind: "wall", max: [18, 1.2, 0.3], about: "A long band high on the left wall." },
  "right-wall-high": { kind: "wall", max: [18, 1.2, 0.3], about: "A long band high on the right wall." },
  "right-wall": { kind: "wall", max: [3.4, 2.4, 0.3], about: "The right wall above the free floor between the shelves and the lounge: a picture, a window, a map." },
  "front-wall": { kind: "wall", max: [16, 3.4, 0.3], about: "The front wall, seen only when the view is turned." },
  desk: { kind: "desk", max: [0.36, 0.36, 0.3], about: "A small thing standing on every desk, beside the screen. Repeated on all sixteen desks." }
};
const PALETTE_KEYS = [
  "wall",
  "trim",
  "skirt",
  "shelfFrame",
  "shelf",
  "books",
  "pot",
  "potRim",
  "stem",
  "leaves",
  "doorFrame",
  "doorLight",
  "doorLeaf",
  "doorHandle",
  "rackBody",
  "rackTrim",
  "rackPanel",
  "rackBlank",
  "screenOn",
  "screenOff"
];
const PALETTE_LISTS = /* @__PURE__ */ new Set(["books", "leaves"]);
const OFFICE_LIMITS = {
  name: 40,
  description: 240,
  tags: 5,
  tag: 20,
  partName: 40,
  decorations: 40,
  partsPerDecoration: 48,
  parts: 900,
  looks: [3, 6],
  addonParts: 24,
  /** The whole manifest, as JSON. */
  bytes: 256 * 1024,
  /** Largest size of any single part, in any direction. */
  partSize: 18
};
const ANCHOR_BOUNDS = {
  head: [0.9, 1.2, 0.9],
  body: [0.9, 1, 0.8],
  armL: [0.5, 1.3, 0.5],
  armR: [0.5, 1.3, 0.5],
  legL: [0.5, 1.3, 0.6],
  legR: [0.5, 1.3, 0.6]
};
const DETAIL_FIELDS = ["theme", "scene", "people", "decor", "notes"];
const DETAIL_LIMIT = 600;
const PROMPT_LIMIT = 600;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TAG = /^[a-z0-9][a-z0-9-]*$/;
const CODE_LIKE = /<|>|javascript:|data:|\bon\w+\s*=|\{\{|\$\{|`/i;
const MAX_ERRORS = 40;
class Check {
  errors = [];
  fail(path, message) {
    if (this.errors.length < MAX_ERRORS) this.errors.push(`${path}: ${message}`);
  }
  object(v, path, keys, optional = []) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, "must be an object");
      return null;
    }
    const o = v;
    for (const k of Object.keys(o)) if (!keys.includes(k) && !optional.includes(k)) this.fail(`${path}.${k}`, "is not part of the contract");
    for (const k of keys) if (!(k in o)) this.fail(`${path}.${k}`, "is required");
    return o;
  }
  array(v, path, min, max) {
    if (!Array.isArray(v)) {
      this.fail(path, "must be a list");
      return [];
    }
    if (v.length < min || v.length > max) this.fail(path, min === max ? `must have exactly ${min}` : `must have ${min} to ${max} entries`);
    return v.slice(0, max);
  }
  text(v, path, max, min = 1) {
    if (typeof v !== "string") {
      this.fail(path, "must be text");
      return "";
    }
    if (v.trim().length < min) this.fail(path, "must not be empty");
    if (v.length > max) this.fail(path, `must be at most ${max} characters`);
    if (CODE_LIKE.test(v)) this.fail(path, "must be plain words, with no markup, links or code");
    return v;
  }
  hex(v, path) {
    if (typeof v !== "string" || !HEX.test(v)) {
      this.fail(path, "must be a colour like #a1b2c3");
      return "#000000";
    }
    return v.toLowerCase();
  }
  number(v, path, min, max) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, "must be a number");
      return min;
    }
    if (v < min || v > max) this.fail(path, `must be between ${min} and ${max}`);
    return v;
  }
  oneOf(values, v, path) {
    if (typeof v === "string" && values.includes(v)) return v;
    this.fail(path, `must be one of ${values.join(", ")}`);
    return values[0];
  }
  vec(v, path, min, max) {
    const a = this.array(v, path, 3, 3);
    return [0, 1, 2].map((i) => this.number(a[i], `${path}[${i}]`, min, max));
  }
}
function extent(p) {
  const [w, h, d] = p.size;
  const t = (p.tilt ?? 0) * Math.PI / 180;
  const ct = Math.abs(Math.cos(t));
  const st = Math.abs(Math.sin(t));
  const hy = (h * ct + d * st) / 2;
  const hz = (h * st + d * ct) / 2;
  const r = (p.rotate ?? 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return [w / 2 * c + hz * s, hy, w / 2 * s + hz * c];
}
function part(c, v, path) {
  const o = c.object(v, path, ["shape", "size", "at", "color"], ["rotate", "tilt", "effect"]);
  if (!o) return null;
  const p = {
    shape: c.oneOf(PART_SHAPES, o.shape, `${path}.shape`),
    size: c.vec(o.size, `${path}.size`, 0.01, OFFICE_LIMITS.partSize),
    at: c.vec(o.at, `${path}.at`, -OFFICE_LIMITS.partSize, OFFICE_LIMITS.partSize),
    color: c.hex(o.color, `${path}.color`)
  };
  if (o.rotate !== void 0) p.rotate = c.number(o.rotate, `${path}.rotate`, -360, 360);
  if (o.tilt !== void 0) p.tilt = c.number(o.tilt, `${path}.tilt`, -180, 180);
  if (o.effect !== void 0) p.effect = c.oneOf(PART_EFFECTS, o.effect, `${path}.effect`);
  return p;
}
function inside(p, max, mount) {
  const [hx, hy, hz] = extent(p);
  const [x, y, z] = p.at;
  const e = 1e-6;
  const within = (v, half, size, from0) => from0 ? v - half >= -e && v + half <= size + e : Math.abs(v) + half <= size / 2 + e;
  return within(x, hx, max[0], false) && within(y, hy, max[1], mount === "floor") && within(z, hz, max[2], mount === "wall");
}
function parts(c, v, path, max, bounds, mount) {
  const out = [];
  c.array(v, path, 1, max).forEach((raw, i) => {
    const p = part(c, raw, `${path}[${i}]`);
    if (!p) return;
    if (!inside(p, bounds, mount)) c.fail(`${path}[${i}]`, `does not fit inside ${bounds.join(" x ")}`);
    out.push(p);
  });
  return out;
}
function lighting(c, v, path) {
  const o = c.object(v, path, ["clear", "ambient", "ambientIntensity", "sky", "ground", "sun", "sunIntensity", "sunAt"]) ?? {};
  return {
    clear: c.hex(o.clear, `${path}.clear`),
    ambient: c.hex(o.ambient, `${path}.ambient`),
    ambientIntensity: c.number(o.ambientIntensity, `${path}.ambientIntensity`, 0.1, 1.5),
    sky: c.hex(o.sky, `${path}.sky`),
    ground: c.hex(o.ground, `${path}.ground`),
    sun: c.hex(o.sun, `${path}.sun`),
    sunIntensity: c.number(o.sunIntensity, `${path}.sunIntensity`, 0, 1.5),
    sunAt: c.vec(o.sunAt, `${path}.sunAt`, -30, 30)
  };
}
function palette(c, v, path) {
  const o = c.object(v, path, [], PALETTE_KEYS) ?? {};
  const out = {};
  for (const k of PALETTE_KEYS) {
    if (o[k] === void 0) continue;
    out[k] = PALETTE_LISTS.has(k) ? c.array(o[k], `${path}.${k}`, 1, 8).map((x, i) => c.hex(x, `${path}.${k}[${i}]`)) : c.hex(o[k], `${path}.${k}`);
  }
  return out;
}
function look(c, v, path) {
  const o = c.object(v, path, ["name", "skin", "hair", "hairStyle", "shirt", "pants", "outfit", "addons"]) ?? {};
  const addons = [];
  let count = 0;
  c.array(o.addons, `${path}.addons`, 0, LOOK_ANCHORS.length).forEach((raw, i) => {
    const a = c.object(raw, `${path}.addons[${i}]`, ["anchor", "parts"]);
    if (!a) return;
    const anchor = c.oneOf(LOOK_ANCHORS, a.anchor, `${path}.addons[${i}].anchor`);
    const ps = parts(c, a.parts, `${path}.addons[${i}].parts`, OFFICE_LIMITS.addonParts, ANCHOR_BOUNDS[anchor], "centred");
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
    addons
  };
}
function validateOfficeManifest(input) {
  const c = new Check();
  let raw = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > OFFICE_LIMITS.bytes) return { ok: false, errors: [`manifest: must be at most ${OFFICE_LIMITS.bytes} bytes`] };
    try {
      raw = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`manifest: is not valid JSON (${err.message})`] };
    }
  }
  const o = c.object(raw, "manifest", [
    "version",
    "name",
    "description",
    "tags",
    "base",
    "furnishing",
    "lighting",
    "palette",
    "floor",
    "particles",
    "decorations",
    "looks"
  ]);
  if (!o) return { ok: false, errors: c.errors };
  if (o.version !== OFFICE_CONTRACT_VERSION) c.fail("manifest.version", `must be ${OFFICE_CONTRACT_VERSION}`);
  const tags = c.array(o.tags, "manifest.tags", 0, OFFICE_LIMITS.tags).map((t, i) => {
    const tag = c.text(t, `manifest.tags[${i}]`, OFFICE_LIMITS.tag);
    if (tag && !TAG.test(tag)) c.fail(`manifest.tags[${i}]`, "must be lower-case letters, digits and dashes");
    return tag;
  });
  const floorO = c.object(o.floor, "manifest.floor", ["pattern", "color", "alt"]) ?? {};
  const partsO = c.object(o.particles, "manifest.particles", ["kind", "color", "density"]) ?? {};
  let total = 0;
  const decorations = [];
  c.array(o.decorations, "manifest.decorations", 0, OFFICE_LIMITS.decorations).forEach((raw2, i) => {
    const path = `manifest.decorations[${i}]`;
    const d = c.object(raw2, path, ["slot", "name", "parts"]);
    if (!d) return;
    const slot = c.oneOf(Object.keys(OFFICE_SLOTS), d.slot, `${path}.slot`);
    const spec = OFFICE_SLOTS[slot];
    const ps = parts(c, d.parts, `${path}.parts`, OFFICE_LIMITS.partsPerDecoration, spec.max, spec.kind === "wall" ? "wall" : "floor");
    total += ps.length;
    decorations.push({ slot, name: c.text(d.name, `${path}.name`, OFFICE_LIMITS.partName), parts: ps });
  });
  if (total > OFFICE_LIMITS.parts) c.fail("manifest.decorations", `must have at most ${OFFICE_LIMITS.parts} parts in all`);
  const deskItems = decorations.filter((d) => d.slot === "desk").length;
  if (deskItems > 1) c.fail("manifest.decorations", "may have only one desk decoration (it is repeated on every desk)");
  const [minLooks, maxLooks] = OFFICE_LIMITS.looks;
  const looks = c.array(o.looks, "manifest.looks", minLooks, maxLooks).map((l, i) => look(c, l, `manifest.looks[${i}]`));
  const manifest = {
    version: OFFICE_CONTRACT_VERSION,
    name: c.text(o.name, "manifest.name", OFFICE_LIMITS.name),
    description: c.text(o.description, "manifest.description", OFFICE_LIMITS.description, 0),
    tags,
    base: c.oneOf(OFFICE_BASES, o.base, "manifest.base"),
    furnishing: c.oneOf(["full", "minimal"], o.furnishing, "manifest.furnishing"),
    lighting: lighting(c, o.lighting, "manifest.lighting"),
    palette: palette(c, o.palette, "manifest.palette"),
    floor: {
      pattern: c.oneOf(FLOOR_PATTERNS, floorO.pattern, "manifest.floor.pattern"),
      color: c.hex(floorO.color, "manifest.floor.color"),
      alt: c.hex(floorO.alt, "manifest.floor.alt")
    },
    particles: {
      kind: c.oneOf(PARTICLE_KINDS, partsO.kind, "manifest.particles.kind"),
      color: c.hex(partsO.color, "manifest.particles.color"),
      density: c.number(partsO.density, "manifest.particles.density", 0, 1)
    },
    decorations,
    looks
  };
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: manifest };
}
function validateOfficeBrief(input) {
  const c = new Check();
  const o = c.object(input, "brief", ["prompt", "details"]);
  if (!o) return { ok: false, errors: c.errors };
  const d = c.object(o.details, "brief.details", [...DETAIL_FIELDS, "style"]) ?? {};
  const details = {};
  for (const k of DETAIL_FIELDS) details[k] = c.text(d[k] ?? "", `brief.details.${k}`, DETAIL_LIMIT, k === "theme" ? 1 : 0).trim();
  details.style = c.oneOf(OFFICE_STYLES, d.style, "brief.details.style");
  const brief = { prompt: c.text(o.prompt, "brief.prompt", PROMPT_LIMIT).trim(), details };
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: brief };
}
const OFFICE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const USER_ROOM_PREFIX = "user:";
const OFFICE_ATTEMPTS = 3;
export {
  ANCHOR_BOUNDS,
  DETAIL_FIELDS,
  DETAIL_LIMIT,
  FLOOR_PATTERNS,
  LOOK_ANCHORS,
  LOOK_HAIR,
  LOOK_OUTFITS,
  OFFICE_ATTEMPTS,
  OFFICE_BASES,
  OFFICE_CONTRACT_VERSION,
  OFFICE_ID,
  OFFICE_LIMITS,
  OFFICE_SEATS,
  OFFICE_SLOTS,
  OFFICE_STYLES,
  PALETTE_KEYS,
  PARTICLE_KINDS,
  PART_EFFECTS,
  PART_SHAPES,
  PROMPT_LIMIT,
  USER_ROOM_PREFIX,
  validateOfficeBrief,
  validateOfficeManifest
};
