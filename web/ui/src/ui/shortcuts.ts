/**
 * Keyboard shortcuts, one plain key each, changed under Settings > Shortcuts.
 * They never fire while you type in a field or a dialog is up, and in the chat
 * window only the chat ones do: a letter typed there is never a shortcut.
 */
import { $, el } from './dom.js';
import { settingCard, subSetting } from './setting-card.js';
import { hasDesktop } from './voice-logic.js';

export const SHORTCUTS = [
  { id: 'prevChat', label: 'Previous chat', description: 'Opens the worker before this one, like the ← button. Works in the chat window too.', key: 'Shift+ArrowLeft', inChat: true },
  { id: 'nextChat', label: 'Next chat', description: 'Opens the next worker, like the → button. Works in the chat window too.', key: 'Shift+ArrowRight', inChat: true },
  { id: 'hire', label: 'Hire', description: 'Opens or closes the Hire panel, to give a worker a ticket or an ask.', key: 'H', inChat: false },
  { id: 'workers', label: 'Workers', description: 'Opens or closes the list of everyone in the office.', key: 'W', inChat: false },
  { id: 'profile', label: 'Profile', description: 'Opens Settings on Profile, for your username and picture.', key: 'P', inChat: false },
  { id: 'ideas', label: 'Ideas', description: 'Opens or closes the Ideas board.', key: 'I', inChat: false },
  { id: 'view', label: 'Change view', description: 'Switches between the office room and the cards view.', key: 'V', inChat: false },
  { id: 'turnLeft', label: 'Turn the room left', description: 'Turns the office room to the left, like its turn button.', key: 'Q', inChat: false },
  { id: 'turnRight', label: 'Turn the room right', description: 'Turns the office room to the right, like its turn button.', key: 'E', inChat: false },
] as const;

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];
/** Each shortcut's key, or null when it has none. */
export type Bindings = Record<ShortcutId, string | null>;

export const SHORTCUTS_KEY = 'shortcuts';
/** Keys that already mean something everywhere, so none can be taken. */
export const FIXED_KEYS = [
  { keys: '1–9', label: 'Open the worker at that desk', description: 'Opens the chat of the worker at desk 1 to 9, counting in desk order.' },
  { keys: 'Esc', label: 'Close the top panel', description: 'Closes whatever panel is on top, one at a time.' },
] as const;

/**
 * The keys that can be held to dictate (voice.ts): one modifier on its own,
 * named by KeyboardEvent.code so left and right differ, and so holding it
 * never types anything. Saved under DICTATE_ID beside the other bindings.
 */
export const DICTATE_KEYS = [
  { code: 'AltRight', label: 'Right Option' },
  { code: 'AltLeft', label: 'Left Option' },
  { code: 'MetaRight', label: 'Right Command' },
  { code: 'MetaLeft', label: 'Left Command' },
  { code: 'ControlRight', label: 'Right Control' },
  { code: 'ControlLeft', label: 'Left Control' },
] as const;
export const DICTATE_ID = 'dictate';
export const DEFAULT_DICTATE_KEY = 'AltRight';

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;
type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>;

const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'Dead', 'Unidentified', 'Process']);
const RESERVED = new Set(['Escape', 'Enter', 'Tab', ' ', 'Backspace', 'Delete']);
const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

export function defaultBindings(): Bindings {
  return Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.key])) as Bindings;
}

/**
 * A key press as a shortcut name, like `H`, `Shift+H` or `Shift+ArrowLeft`, or
 * null for a bare modifier or a Cmd, Ctrl or Alt combination. Letters are named
 * by the key and Shift, so Caps Lock doesn't change them; other characters are
 * named as typed, since Shift already changed them.
 */
export function keyName(e: KeyLike): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey || MODIFIERS.has(e.key)) return null;
  const shift = e.shiftKey ? 'Shift+' : '';
  if (/^[a-z]$/i.test(e.key)) return shift + e.key.toUpperCase();
  if (e.key.length === 1) return e.key;
  return shift + e.key;
}

/** Why a key can't be a shortcut, or null when it can. */
export function bindError(key: string): string | null {
  if (RESERVED.has(key) || RESERVED.has(key.replace(/^Shift\+/, ''))) return `${keyLabel(key)} is kept for typing and buttons.`;
  if (/^[1-9]$/.test(key)) return '1–9 open the worker at that desk.';
  return null;
}

/** A key name as it reads on screen: `Shift+ArrowLeft` is `Shift + ←`. */
export function keyLabel(key: string): string {
  return key
    .replace(/Arrow(Left|Right|Up|Down)$/, (arrow) => ARROWS[arrow] ?? arrow)
    .replace(/^Shift\+(?=.)/, 'Shift + ')
    .replace(/^ $/, 'Space');
}

/** A button's tooltip with its shortcut, when it has one. */
export function withKey(title: string, key: string | null): string {
  return key ? `${title} (${keyLabel(key)})` : title;
}

/** A key press as a dictation key, or null for anything but a lone Option, Command or Control. */
export function dictateKeyName(e: Pick<KeyboardEvent, 'code'>): string | null {
  return DICTATE_KEYS.some((k) => k.code === e.code) ? e.code : null;
}

/** Why a key can't be held to dictate, or null when it can. */
export function dictateBindError(code: string): string | null {
  return DICTATE_KEYS.some((k) => k.code === code) ? null : 'Hold to dictate takes Option, Command or Control on its own, left or right, so holding it never types.';
}

/** A dictation key as it reads on screen: `AltRight` is `Right Option`. */
export function dictateKeyLabel(code: string): string {
  return DICTATE_KEYS.find((k) => k.code === code)?.label ?? code;
}

function readSaved(store: KeyStore | undefined): Record<string, unknown> {
  try {
    const raw = store?.getItem(SHORTCUTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

/** The saved dictation key: Right Option unless another was saved, or null when it was taken away. */
export function loadDictateKey(store: KeyStore | undefined = globalThis.localStorage): string | null {
  const saved = readSaved(store);
  if (!(DICTATE_ID in saved)) return DEFAULT_DICTATE_KEY;
  const key = saved[DICTATE_ID];
  if (key === null) return null;
  return typeof key === 'string' && !dictateBindError(key) ? key : DEFAULT_DICTATE_KEY;
}

export function saveDictateKey(key: string | null, store: KeyStore | undefined = globalThis.localStorage): void {
  try {
    store?.setItem(SHORTCUTS_KEY, JSON.stringify({ ...readSaved(store), [DICTATE_ID]: key }));
  } catch {
    return;
  }
}

/**
 * The saved keys over the defaults. A saved key wins over a default one, and a
 * key saved twice, or one that can't be a shortcut any more, is dropped.
 */
export function loadBindings(store: KeyStore | undefined = globalThis.localStorage): Bindings {
  const defaults = defaultBindings();
  const saved = readSaved(store);
  const out = {} as Bindings;
  const taken = new Set<string>();
  for (const { id } of SHORTCUTS) {
    if (!(id in saved)) continue;
    const key = saved[id];
    out[id] = typeof key === 'string' && !bindError(key) && !taken.has(key) ? key : null;
    if (out[id]) taken.add(out[id]);
  }
  for (const { id } of SHORTCUTS) {
    if (id in out) continue;
    const key = defaults[id];
    out[id] = key && !taken.has(key) ? key : null;
    if (out[id]) taken.add(out[id]);
  }
  return out;
}

/** Saves the shortcuts' keys, keeping the dictation key saved beside them. */
export function saveBindings(bindings: Bindings, store: KeyStore | undefined = globalThis.localStorage): void {
  try {
    const dictate = readSaved(store)[DICTATE_ID];
    store?.setItem(SHORTCUTS_KEY, JSON.stringify(dictate === undefined ? bindings : { ...bindings, [DICTATE_ID]: dictate }));
  } catch {
    return;
  }
}

/** Gives a shortcut a key, or none. The shortcut that had the key loses it. */
export function bindKey(bindings: Bindings, id: ShortcutId, key: string | null): { bindings: Bindings; displaced: ShortcutId | null } {
  const next = { ...bindings };
  const displaced = key ? (SHORTCUTS.find((s) => s.id !== id && next[s.id] === key)?.id ?? null) : null;
  if (displaced) next[displaced] = null;
  next[id] = key;
  return { bindings: next, displaced };
}

export function shortcutFor(bindings: Bindings, key: string): ShortcutId | null {
  return SHORTCUTS.find((s) => bindings[s.id] === key)?.id ?? null;
}

/** The parts of a focused element that say whether it takes keys itself. */
export interface FocusTarget {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
}

const KEY_ROLES = new Set(['textbox', 'combobox', 'listbox', 'menu', 'menubar', 'radiogroup', 'radio', 'slider', 'spinbutton', 'separator']);

/** Whether the focused element uses keys itself: a field, a dropdown, or a widget like the panel's resize grip. */
export function takesKeys(target: FocusTarget | null): boolean {
  if (!target) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return KEY_ROLES.has(target.getAttribute('role') ?? '');
}

/** Whether a shortcut may run here: in the chat window only the chat ones do. */
export function firesHere(id: ShortcutId, inChat: boolean): boolean {
  return !inChat || SHORTCUTS.some((s) => s.id === id && s.inChat);
}

/**
 * Whether you are in the chat window: it is showing, and focus is in it, or,
 * with focus on the page (`focusIn` null), the last click landed in it.
 */
export function inChat(where: { shown: boolean; focusIn: boolean | null; clickedIn: boolean }): boolean {
  return where.shown && (where.focusIn ?? where.clickedIn);
}

let chatPanel: HTMLElement | null = null;
// Clicking the transcript leaves focus on the page, so where the last click
// landed says whether you are in the chat window.
let clickedInChat = false;

/** Whether you are in the chat window now; see inChat. False until mountShortcuts runs. */
export function inChatWindow(): boolean {
  if (!chatPanel) return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return inChat({ shown: !chatPanel.hidden, focusIn: active && active !== document.body ? chatPanel.contains(active) : null, clickedIn: clickedInChat });
}

/** Runs a shortcut; false when there was nothing to do, so the key goes on as usual. */
type Run = () => boolean | void;

const runs = new Map<ShortcutId, Run>();
const watchers = new Set<(bindings: Bindings) => void>();
let bindings = loadBindings();
let dictateKey = loadDictateKey();
const dictateWatchers = new Set<(key: string | null) => void>();

/** What a shortcut does. Each panel says this for its own. */
export function onShortcut(id: ShortcutId, run: Run): void {
  runs.set(id, run);
}

export function currentKey(id: ShortcutId): string | null {
  return bindings[id];
}

/** Calls back now and whenever a key is changed, to keep tooltips current. */
export function watchBindings(watch: (bindings: Bindings) => void): void {
  watchers.add(watch);
  watch(bindings);
}

/** The key held to dictate, or null for none. */
export function currentDictateKey(): string | null {
  return dictateKey;
}

/** Calls back now and whenever the dictation key changes. */
export function watchDictateKey(watch: (key: string | null) => void): void {
  dictateWatchers.add(watch);
  watch(dictateKey);
}

function setDictateKey(next: string | null): void {
  dictateKey = next;
  saveDictateKey(next);
  for (const watch of dictateWatchers) watch(next);
}

function setBindings(next: Bindings): void {
  bindings = next;
  saveBindings(next);
  for (const watch of watchers) watch(next);
}

/** Shortcuts that are the same as a button, and the button that shows the key. */
const BUTTONS: Partial<Record<ShortcutId, { id: string; title: string; click: boolean }>> = {
  hire: { id: 'openTickets', title: 'Hire', click: true },
  workers: { id: 'openWorkers', title: 'Workers', click: true },
  turnLeft: { id: 'turnLeft', title: 'Turn left', click: true },
  turnRight: { id: 'turnRight', title: 'Turn right', click: true },
  profile: { id: 'sProfile', title: 'Profile', click: false },
};

export function mountShortcuts(): void {
  const chat = $<HTMLElement>('agentPanel');
  chatPanel = chat;
  window.addEventListener('pointerdown', (e) => {
    clickedInChat = chat.contains(e.target as Node);
  }, true);

  for (const [id, button] of Object.entries(BUTTONS) as [ShortcutId, NonNullable<(typeof BUTTONS)[ShortcutId]>][]) {
    if (button.click) onShortcut(id, () => $<HTMLButtonElement>(button.id).click());
  }
  onShortcut('profile', () => void window.dispatchEvent(new CustomEvent('open-profile-settings')));
  watchBindings((next) => {
    for (const [id, button] of Object.entries(BUTTONS) as [ShortcutId, NonNullable<(typeof BUTTONS)[ShortcutId]>][]) {
      const node = $(button.id);
      node.title = withKey(button.title, next[id]);
      if (next[id]) node.setAttribute('aria-keyshortcuts', next[id]);
      else node.removeAttribute('aria-keyshortcuts');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || e.isComposing) return;
    const key = keyName(e);
    const id = key && shortcutFor(bindings, key);
    if (!id) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (takesKeys(active)) return;
    if (document.querySelector('dialog[open], [role="dialog"]:not([hidden])')) return;
    if (!firesHere(id, inChatWindow())) return;
    if (runs.get(id)?.() === false) return;
    e.preventDefault();
  });
}

/** Settings > Shortcuts: each shortcut's key, and a way to change it. */
export function shortcutsSection(): HTMLElement {
  const list = el('div', 'settings-list');
  const card = settingCard('Keyboard shortcuts', 'Press a key outside a text box. In the chat window, only the chat ones work, so you can type there safely.');
  const status = el('span', 'msg-line m');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const lines = el('div', 'shortcut-lines');
  card.append(lines, status);

  const draw = (): void => {
    lines.replaceChildren(...SHORTCUTS.map(({ id, label, description }) => {
      const key = bindings[id];
      const shown = el('kbd', `shortcut-key${key ? '' : ' none'}`, key ? keyLabel(key) : 'None');
      const change = el('button', 'btn small', 'Change');
      change.type = 'button';
      change.setAttribute('aria-label', `Change the ${label} shortcut`);
      const line = subSetting(label, description, [shown, change]);
      const listening = (): boolean => change.classList.contains('listening');
      // Stops listening before redrawing, so the old button's blur doesn't redraw again.
      const done = (refocus = true): void => {
        change.classList.remove('listening');
        draw();
        if (refocus) lines.querySelector<HTMLButtonElement>(`[data-shortcut="${id}"]`)?.focus();
      };
      change.dataset.shortcut = id;
      change.addEventListener('click', () => {
        if (listening()) return;
        change.classList.add('listening');
        change.setAttribute('aria-pressed', 'true');
        change.textContent = 'Press a key…';
        status.textContent = 'Esc to cancel, Backspace for none.';
      });
      change.addEventListener('blur', () => {
        if (listening()) done(false);
      });
      change.addEventListener('keydown', (e) => {
        if (!listening()) return;
        // The key is for this button, not Esc closing the panel or a shortcut firing.
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          status.textContent = '';
          return done();
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          setBindings(bindKey(bindings, id, null).bindings);
          status.textContent = `${label} has no shortcut now.`;
          return done();
        }
        if (MODIFIERS.has(e.key)) return;
        const next = keyName(e);
        if (!next) {
          status.textContent = 'Cmd, Ctrl and Alt keys are kept for the app. Pick a plain key, or Shift and a key.';
          return;
        }
        const error = bindError(next);
        if (error) {
          status.textContent = error;
          return;
        }
        const bound = bindKey(bindings, id, next);
        setBindings(bound.bindings);
        const was = bound.displaced && SHORTCUTS.find((s) => s.id === bound.displaced)?.label;
        status.textContent = `${label} is ${keyLabel(next)} now.${was ? ` ${was} has no shortcut.` : ''}`;
        done();
      });
      return line;
    }), ...(hasDesktop() ? [dictateLine()] : []));
  };

  /** Hold to dictate takes a lone modifier, so it has its own rules: see DICTATE_KEYS. */
  const dictateLine = (): HTMLElement => {
    const label = 'Hold to dictate';
    const key = dictateKey;
    const shown = el('kbd', `shortcut-key${key ? '' : ' none'}`, key ? dictateKeyLabel(key) : 'None');
    const change = el('button', 'btn small', 'Change');
    change.type = 'button';
    change.dataset.shortcut = DICTATE_ID;
    change.setAttribute('aria-label', 'Change the Hold to dictate key');
    const line = subSetting(label, 'Hold it in a message box, or anywhere in the chat window, to speak, and let go to stop. Voice input has to be on, in Settings → General.', [shown, change]);
    const listening = (): boolean => change.classList.contains('listening');
    const done = (refocus = true): void => {
      change.classList.remove('listening');
      draw();
      if (refocus) lines.querySelector<HTMLButtonElement>(`[data-shortcut="${DICTATE_ID}"]`)?.focus();
    };
    change.addEventListener('click', () => {
      if (listening()) return;
      change.classList.add('listening');
      change.setAttribute('aria-pressed', 'true');
      change.textContent = 'Press a key…';
      status.textContent = 'Press Option, Command or Control on its own. Esc to cancel, Backspace for none.';
    });
    change.addEventListener('blur', () => {
      if (listening()) done(false);
    });
    change.addEventListener('keydown', (e) => {
      if (!listening()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        status.textContent = '';
        return done();
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setDictateKey(null);
        status.textContent = `${label} has no key now.`;
        return done();
      }
      const next = dictateKeyName(e);
      const error = next ? null : dictateBindError(e.code);
      if (!next || error) {
        status.textContent = error ?? '';
        return;
      }
      setDictateKey(next);
      status.textContent = `${label} is ${dictateKeyLabel(next)} now.`;
      done();
    });
    return line;
  };
  draw();

  const reset = el('button', 'btn small', 'Reset to defaults');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    setBindings(defaultBindings());
    setDictateKey(DEFAULT_DICTATE_KEY);
    status.textContent = 'Shortcuts are back to the defaults.';
    draw();
  });
  card.appendChild(el('div', 'shortcut-reset')).appendChild(reset);

  const fixed = settingCard('Always on', 'These keys can’t be changed or taken.');
  for (const { keys, label, description } of FIXED_KEYS) fixed.appendChild(subSetting(label, description, [el('kbd', 'shortcut-key', keys)]));

  list.append(card, fixed);
  return list;
}
