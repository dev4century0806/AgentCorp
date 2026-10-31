/**
 * Drag a panel's inner edge to make it wider. Today's width is the floor and
 * twice that is the ceiling; the last width sticks across reloads. The chat
 * panel is pinned on the right, so its grip is on its left edge; the Ideas
 * panel is pinned on the left, with its grip on the right.
 */

export const MIN_WIDTH = 520;
export const MAX_WIDTH = MIN_WIDTH * 2;
export const WIDTH_KEY = 'chatPanelWidth';
const KEY_STEP = 40;

export interface PanelSize {
  /** Where the width is kept between visits. */
  key: string;
  min: number;
  max: number;
  /** The edge the grip is on, the one away from the side the panel is pinned to. */
  edge: 'left' | 'right';
}

export const CHAT_SIZE: PanelSize = { key: WIDTH_KEY, min: MIN_WIDTH, max: MAX_WIDTH, edge: 'left' };
export const IDEAS_SIZE: PanelSize = { key: 'ideasPanelWidth', min: 400, max: 800, edge: 'right' };

type WidthStore = Pick<Storage, 'getItem' | 'setItem'>;

export function clampWidth(w: number, min = MIN_WIDTH, max = MAX_WIDTH): number {
  if (!Number.isFinite(w)) return min;
  return Math.round(Math.min(max, Math.max(min, w)));
}

export function loadWidth(store: WidthStore | undefined = globalThis.localStorage, size: PanelSize = CHAT_SIZE): number {
  try {
    const raw = store?.getItem(size.key);
    return raw ? clampWidth(Number(raw), size.min, size.max) : size.min;
  } catch {
    return size.min;
  }
}

export function saveWidth(w: number, store: WidthStore | undefined = globalThis.localStorage, size: PanelSize = CHAT_SIZE): void {
  try {
    store?.setItem(size.key, String(clampWidth(w, size.min, size.max)));
  } catch {
    return;
  }
}

export function mountPanelResize(panel: HTMLElement, handle: HTMLElement, size: PanelSize = CHAT_SIZE): void {
  handle.setAttribute('aria-valuemin', String(size.min));
  handle.setAttribute('aria-valuemax', String(size.max));

  let width = size.min;
  const apply = (w: number) => {
    width = clampWidth(w, size.min, size.max);
    panel.style.setProperty('--panel-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
  };
  const save = () => saveWidth(width, globalThis.localStorage, size);
  apply(loadWidth(globalThis.localStorage, size));

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    // The width follows the pointer's distance from the edge the panel is
    // pinned to, which stays put while it is dragged, less wherever on the
    // grip it was taken hold of, so the edge does not jump to the pointer.
    const box = panel.getBoundingClientRect();
    const reach = (ev: PointerEvent) => (size.edge === 'left' ? box.right - ev.clientX : ev.clientX - box.left);
    const held = width - reach(e);
    const move = (ev: PointerEvent) => apply(reach(ev) + held);
    const end = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });

  handle.addEventListener('keydown', (e) => {
    // The arrow pointing away from the panel makes it wider.
    const wider = size.edge === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const narrower = size.edge === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const delta = e.key === wider ? KEY_STEP : e.key === narrower ? -KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    apply(width + delta);
    save();
  });

  handle.addEventListener('dblclick', () => {
    apply(size.min);
    save();
  });
}
