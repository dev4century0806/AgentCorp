import type { WorkerLook } from '@shared';
import { portrait } from '../scene/portrait.js';
import { el } from './dom.js';

/** A persona's face, drawn from its look; hidden where the browser cannot draw one. */
export function personaPicture(look: WorkerLook, seed: string): HTMLImageElement {
  const img = el('img', 'persona-pic');
  img.alt = '';
  showPortrait(img, look, seed);
  return img;
}

export function showPortrait(img: HTMLImageElement, look: WorkerLook, seed: string): void {
  const url = portrait(look, seed);
  img.hidden = !url;
  if (url) img.src = url;
}
