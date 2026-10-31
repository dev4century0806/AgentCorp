import { el } from './dom.js';

/**
 * One setting: its title and description on the left, its actions on the
 * right. A string description is one muted line; nodes are used as they are.
 */
export function settingLine(title: HTMLElement, description: string | Node[], actions: Node[] = []): HTMLElement {
  const line = el('div', 'setting-line');
  const text = el('div', 'setting-text');
  text.append(title, ...(typeof description === 'string' ? [el('span', 'm', description)] : description));
  line.appendChild(text);
  if (actions.length) {
    const right = el('div', 'setting-actions');
    right.append(...actions);
    line.appendChild(right);
  }
  return line;
}

/** A settings card that starts with its own setting line. */
export function settingCard(title: string, description: string | Node[], actions: Node[] = []): HTMLElement {
  const card = el('div', 'ticket settings-card');
  card.appendChild(settingLine(el('b', null, title), description, actions));
  return card;
}

/** A smaller setting inside a card, under the card's own. */
export function subSetting(title: string, description: string | Node[], actions: Node[] = []): HTMLElement {
  const line = settingLine(el('span', 'settings-label', title), description, actions);
  line.classList.add('sub-setting');
  return line;
}
