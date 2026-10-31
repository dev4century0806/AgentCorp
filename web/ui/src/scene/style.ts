import type { OfficeManifest } from '@shared';
import type { RenderStyle } from './shading.js';
import { LIGHTING, PALETTES, RENDER, type Palette, type Skin } from './skin.js';

/**
 * How a generated office dresses its base room: the manifest's palette merged
 * over the base's, its lighting in place of the base's, its floor, and whether
 * the base's decorative clutter stays. Built once from a manifest that passed
 * the contract's validator; the room builders take it as an optional last
 * argument, and with none they draw the built-in room exactly as before.
 */
export type Lighting = (typeof LIGHTING)[Skin];

export interface RoomStyle {
  base: Skin;
  /** How surfaces are drawn: the base's, as a manifest has no say in it. */
  render: RenderStyle;
  palette: Palette;
  lighting: Lighting;
  floor: OfficeManifest['floor'];
  /** `minimal` drops the base's windows, plants and wall clutter, and keeps every fixture workers use. */
  minimal: boolean;
  /** No motion: effects hold still and there are no particles. */
  reduceMotion: boolean;
  manifest: OfficeManifest;
}

const hex = (c: string): number => parseInt(c.slice(1), 16);

export function roomStyle(manifest: OfficeManifest, o: { reduceMotion?: boolean } = {}): RoomStyle {
  const base = manifest.base;
  const l = manifest.lighting;
  // Only the keys the manifest set override the base's; the lists replace whole.
  const palette = { ...PALETTES[base] } as Record<string, unknown>;
  for (const [k, v] of Object.entries(manifest.palette)) if (v !== undefined) palette[k] = v;
  return {
    base,
    render: RENDER[base],
    palette: palette as unknown as Palette,
    lighting: {
      clear: hex(l.clear),
      ambient: hex(l.ambient),
      ambientIntensity: l.ambientIntensity,
      sky: hex(l.sky),
      ground: hex(l.ground),
      sun: hex(l.sun),
      sunIntensity: l.sunIntensity,
      sunAt: l.sunAt,
    },
    floor: manifest.floor,
    minimal: manifest.furnishing === 'minimal',
    reduceMotion: o.reduceMotion ?? false,
    manifest,
  };
}
