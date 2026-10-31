import { $ } from './dom.js';
import { signedInAvatarUrl, signedInUsername } from './auth.js';
import { avatarImg, type AvatarDocument } from './avatar.js';

/** The picture's size in the Settings button: the button's 44px less its border. */
const AVATAR_SIZE = 40;

/**
 * The Settings button shows the signed-in user's picture, or their default
 * bot, and draws it again whenever the profile changes: a new username, a
 * new picture or a reset to the bot. The button keeps its "Settings" label,
 * so the picture itself is decorative.
 */
export function mountProfileButton(
  button: Pick<HTMLElement, 'replaceChildren'>,
  read: () => { url: string | null; seed: string },
  events: Pick<EventTarget, 'addEventListener'> = window,
  doc: AvatarDocument = document,
): void {
  const draw = (): void => {
    const { url, seed } = read();
    button.replaceChildren(avatarImg(url, seed, AVATAR_SIZE, doc));
  };
  draw();
  events.addEventListener('profile-changed', draw);
}

export function mountHud(): void {
  mountProfileButton($('openSettings'), () => ({ url: signedInAvatarUrl(), seed: signedInUsername() }));
}
