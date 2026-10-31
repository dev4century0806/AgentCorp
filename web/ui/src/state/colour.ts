import type { RoomChoice } from './store.js';

/**
 * The colour the whole app is drawn in, which comes with the room. The
 * it the bubbles over it, the chat and every panel; every other room keeps
 * its colours, and the app with it.
 *
 * The page carries it as `data-colour="mono"` on <html>, and styles.css does
 * the rest: black ink on white paper, the room lit pale, whether the Mac is
 * set to light or dark.
 */
export type Colour = 'full' | 'mono';

export function colourOf(room: RoomChoice): Colour {
  return 'full';
}

/** Marks the page as drawn in `colour`, which is all styles.css needs to draw it so. */
export function markColour(colour: Colour, root: Pick<Element, 'setAttribute' | 'removeAttribute'> = document.documentElement): void {
  if (colour === 'mono') root.setAttribute('data-colour', 'mono');
  else root.removeAttribute('data-colour');
}
