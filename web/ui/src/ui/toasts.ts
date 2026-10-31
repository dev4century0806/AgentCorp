import type { Store } from '../state/store.js';
import { $, el } from './dom.js';

const VISIBLE_MS = 5000;
const MAX_STACKED = 4;

/** Short messages for joins, questions, errors, and level ups. */
export function mountToasts(store: Store): void {
  const host = $<HTMLElement>('toasts');

  store.onToast((toast) => {
    const node = el('div', `toast ${toast.kind}`, toast.text);
    node.setAttribute('role', 'status');

    if (toast.agentId) {
      node.title = 'Show this worker';
      node.addEventListener('click', () => {
        store.selectAgent(toast.agentId);
        node.remove();
      });
    } else {
      node.addEventListener('click', () => node.remove());
    }

    host.appendChild(node);
    while (host.childElementCount > MAX_STACKED) host.firstElementChild?.remove();

    setTimeout(() => node.remove(), toast.kind === 'error' ? VISIBLE_MS * 2 : VISIBLE_MS);
  });
}

/** A toast raised by the app itself rather than the server, with an optional button. */
export function showToast(text: string, kind: 'info' | 'done' | 'error' = 'info', action?: { label: string; run: () => void }): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', `toast ${kind}`);
  node.setAttribute('role', 'status');
  node.appendChild(el('span', null, text));
  if (action) {
    const b = el('button', 'btn small toast-action', action.label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      node.remove();
      action.run();
    });
    node.appendChild(b);
  }
  node.addEventListener('click', () => node.remove());
  host.appendChild(node);
  while (host.childElementCount > MAX_STACKED) host.firstElementChild?.remove();
  setTimeout(() => node.remove(), kind === 'error' || action ? VISIBLE_MS * 2 : VISIBLE_MS);
}
