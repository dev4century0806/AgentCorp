import { DARKWOOD, TRIM, WALL, WOOD } from './boxkit.js';
import type { RenderStyle } from './shading.js';

import type { Room, RoomChoice } from '../state/store.js';

export type Skin = Room;

/** Where the main light shines from. */
type At = [number, number, number];

/** Daylight through the left wall's windows, which casts the long shadows across the floor. */
const WINDOW_SUN: At = [-16, 13, 3];

/**
 * The light each skin is lit by: in the office, warm daylight through the
 * windows.
 */
export const LIGHTING: Record<
  Skin,
  { clear: number; ambient: number; ambientIntensity: number; sky: number; ground: number; sun: number; sunIntensity: number; sunAt: At }
> = {
  office: { clear: 0x15111c, ambient: 0xffd9a8, ambientIntensity: 0.38, sky: 0xffe6c0, ground: 0x3a2a20, sun: 0xffc27a, sunIntensity: 0.95, sunAt: WINDOW_SUN },
};

/**
 * How a room is drawn: the style its surfaces are made in, and the pass that
 * finishes them.
 */
export function drawnAs(choice: RoomChoice, picked: RenderStyle | null, base: Skin): { style: RenderStyle; finish: RenderStyle } {
  const style = picked ?? RENDER[base] ?? 'voxel';
  return { style, finish: style };
}

/** How each skin's surfaces are drawn. */
export const RENDER: Record<Skin, RenderStyle> = {
  office: 'voxel',
};

export interface Palette {
  wall: string;
  trim: string;
  skirt: string;
  shelfFrame: string;
  shelf: string;
  books: string[];
  pot: string;
  potRim: string;
  stem: string;
  leaves: string[];
  doorFrame: string;
  doorLight: string;
  doorLeaf: string;
  doorHandle: string;
  rackBody: string;
  rackTrim: string;
  rackPanel: string;
  rackBlank: string;
  leds: [string, string][];
  term: [string, string];
  screenOn: string;
  screenOff: string;
}

export const PALETTES: Record<Skin, Palette> = {
  office: {
    wall: WALL,
    trim: TRIM,
    skirt: DARKWOOD,
    shelfFrame: DARKWOOD,
    shelf: WOOD,
    books: ['#7b2d26', '#2f5d50', '#c9a227', '#3b4f7a', '#8a4f7d', '#d07a3a', '#5b7a3a', '#a33b3b'],
    pot: '#b5582c',
    potRim: '#9a4622',
    stem: '#5a3a20',
    leaves: ['#4f7a2a', '#6a9a33', '#3e6624', '#7fae3d'],
    doorFrame: DARKWOOD,
    doorLight: '#ffd486',
    doorLeaf: '#7d4a26',
    doorHandle: '#e0c040',
    rackBody: '#1f2230',
    rackTrim: '#2c3042',
    rackPanel: '#3a3f52',
    rackBlank: '#5b6275',
    leds: [
      ['#5dff8a', '#1f4a2c'],
      ['#ffb340', '#4a3414'],
      ['#5ab8ff', '#1c3a52'],
    ],
    term: ['#06140c', '#3ddc84'],
    screenOn: '#3ddc84',
    screenOff: '#2a3a30',
  },
};
