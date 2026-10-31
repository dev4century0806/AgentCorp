/**
 * Profile pictures (issue #236): the default blocky bot everyone starts with,
 * and the <img> the leaderboards and the showcase draw beside a username.
 *
 * The bot is a flat take on public/logo.svg (blocky charcoal hair, a dark
 * visor, two yellow eyes) whose colours come from a hash of the username, so a
 * page of default avatars does not all look the same.
 *
 * packages/site/src/avatar.ts is a byte-identical copy (the site cannot import
 * the app's sources); avatar-copy.test.ts in the site keeps them together. So
 * this file imports nothing.
 */

const BACKGROUNDS = ['#4f7fe0', '#3e9a5c', '#c8553d', '#f2a93b', '#7a5cc8', '#2f9fa8', '#d0568f', '#5c6b80'];
const HAIR = ['#2c3440', '#5a3a26', '#1f262f', '#8a5a2b'];
const EYES = ['#fed538', '#7ce0ff', '#9cf28a'];
const SKIN = '#fedba9';
const VISOR = '#1e242e';

/** 32-bit FNV-1a over the lower-cased seed: stable across sessions, clients and machines. */
export function avatarHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (const ch of seed.toLowerCase()) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface AvatarPalette {
  background: string;
  hair: string;
  eyes: string;
}

export function avatarPalette(seed: string): AvatarPalette {
  const hash = avatarHash(seed);
  return {
    background: BACKGROUNDS[hash % BACKGROUNDS.length]!,
    hair: HAIR[(hash >>> 8) % HAIR.length]!,
    eyes: EYES[(hash >>> 16) % EYES.length]!,
  };
}

/** The default blocky bot for a username, as an SVG data URI. */
export function defaultAvatar(seed: string): string {
  const { background, hair, eyes } = avatarPalette(seed);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + `<rect width="64" height="64" fill="${background}"/>`
    + `<g fill="${hair}"><rect x="15" y="7" width="34" height="8" rx="1.5"/><rect x="8" y="11" width="12" height="10" rx="1.5"/>`
    + '<rect x="45" y="11" width="11" height="10" rx="1.5"/><rect x="5" y="19" width="9" height="20" rx="1.5"/>'
    + '<rect x="50" y="17" width="9" height="22" rx="1.5"/></g>'
    + `<rect x="12" y="20" width="40" height="40" rx="2.5" fill="${SKIN}"/>`
    + `<g fill="${hair}"><rect x="10" y="18" width="23" height="11" rx="1.5"/><rect x="18" y="12" width="30" height="8" rx="1.5"/>`
    + '<rect x="40" y="18" width="12" height="14" rx="1.5"/></g>'
    + `<rect x="16" y="35" width="32" height="19" rx="2.5" fill="${VISOR}"/>`
    + `<g fill="${eyes}"><rect x="21" y="40" width="5" height="10" rx="1"/><rect x="38" y="40" width="5" height="10" rx="1"/></g>`
    + '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The picture to draw: an uploaded one when it is an https URL, the default bot otherwise. */
export function avatarSource(url: string | null | undefined, seed: string): string {
  return typeof url === 'string' && url.length <= 500 && /^https:\/\//i.test(url) ? url : defaultAvatar(seed);
}

/** Just enough of `document` to make an image, so tests can pass a fake. */
export interface AvatarDocument {
  createElement(tag: 'img'): HTMLImageElement;
}

/**
 * A square avatar <img>. A null or unusable URL draws the default bot, and an
 * uploaded picture that fails to load is swapped for it. The username sits
 * beside it everywhere it is used, so the image itself is decorative.
 */
export function avatarImg(url: string | null | undefined, seed: string, size: number, doc: AvatarDocument = document): HTMLImageElement {
  const img = doc.createElement('img');
  img.className = 'avatar';
  img.width = size;
  img.height = size;
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  const fallback = defaultAvatar(seed);
  const src = avatarSource(url, seed);
  if (src !== fallback) {
    img.addEventListener('error', () => {
      img.src = fallback;
    }, { once: true });
  }
  img.src = src;
  return img;
}
