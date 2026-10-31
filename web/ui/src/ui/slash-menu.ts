import type { SlashCommand } from '@shared';
import { clear, el } from './dom.js';

/**
 * The command name being typed at the cursor, and where its `/` is. The slash
 * must start the text or follow a space, so paths and URLs do not count.
 */
export function slashQuery(text: string, cursorPos: number): { query: string; start: number } | null {
  const match = /(?:^|\s)\/(\S*)$/.exec(text.slice(0, cursorPos));
  if (!match) return null;
  // Text right after the cursor that is not a space means the cursor is inside a word.
  if (/^\S/.test(text.slice(cursorPos))) return null;
  return { query: match[1]!.toLowerCase(), start: cursorPos - match[1]!.length - 1 };
}

/** The text with the `/query` token at `start..end` swapped for `/name `, and where the cursor goes. */
export function insertCommand(text: string, start: number, end: number, name: string): { text: string; cursor: number } {
  const inserted = `/${name} `;
  const after = text.slice(end).replace(/^ /, '');
  return { text: text.slice(0, start) + inserted + after, cursor: start + inserted.length };
}

/** The commands matching a query: those whose name starts with it first, then those containing it. */
export function matchCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(query)) starts.push(c);
    else if (name.includes(query)) contains.push(c);
  }
  const byName = (a: SlashCommand, b: SlashCommand) => a.name.localeCompare(b.name);
  return [...starts.sort(byName), ...contains.sort(byName)];
}

export interface SlashMenu {
  /** Redraws from what is typed and the worker's commands; call on input and when the worker changes. */
  refresh(): void;
  /** Handles a key in the chat box; true when the menu used it, so it must not also send. */
  onKey(e: KeyboardEvent): boolean;
}

/**
 * The menu over the chat box when a `/` is typed at the start of the message
 * or after a space: the commands the worker's session offers, its skills among
 * them. Picking one puts `/name ` in place of what was typed, leaving the rest
 * of the message as it was.
 */
export function mountSlashMenu(
  menu: HTMLElement,
  input: HTMLTextAreaElement,
  commands: () => SlashCommand[],
  picked: () => void,
): SlashMenu {
  let shown: SlashCommand[] = [];
  let active = 0;
  /** The text Escape closed the menu on, so it stays shut until the text changes. */
  let dismissedAt: string | null = null;

  const close = () => {
    shown = [];
    menu.hidden = true;
    input.removeAttribute('aria-activedescendant');
  };

  const pick = (command: SlashCommand) => {
    const end = input.selectionStart ?? input.value.length;
    const at = slashQuery(input.value, end);
    if (!at) return close();
    const next = insertCommand(input.value, at.start, end, command.name);
    input.value = next.text;
    close();
    input.focus();
    input.setSelectionRange(next.cursor, next.cursor);
    picked();
  };

  const draw = () => {
    clear(menu);
    shown.forEach((command, i) => {
      const item = el('div', 'slash-item');
      item.id = `slash-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === active));
      const head = el('div', 'slash-head');
      head.appendChild(el('span', 'slash-name', `/${command.name}`));
      if (command.hint) head.appendChild(el('span', 'slash-hint', command.hint));
      item.appendChild(head);
      if (command.description) item.appendChild(el('div', 'slash-desc', command.description));
      // Mousedown, not click, so the chat box keeps focus.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(command);
      });
      item.addEventListener('mousemove', () => {
        if (active === i) return;
        active = i;
        draw();
      });
      menu.appendChild(item);
    });
    menu.hidden = false;
    input.setAttribute('aria-activedescendant', `slash-${active}`);
    menu.querySelector<HTMLElement>(`#slash-${active}`)?.scrollIntoView({ block: 'nearest' });
  };

  const refresh = () => {
    const at = slashQuery(input.value, input.selectionStart ?? input.value.length);
    if (dismissedAt !== null && input.value !== dismissedAt) dismissedAt = null;
    const next = at === null || dismissedAt !== null ? [] : matchCommands(commands(), at.query);
    if (!next.length) return close();
    const current = shown[active]?.name;
    shown = next;
    active = Math.max(0, shown.findIndex((c) => c.name === current));
    draw();
  };

  input.addEventListener('blur', close);
  input.addEventListener('focus', refresh);
  // Moving the cursor into or out of a `/name` changes what the menu is for.
  input.addEventListener('click', refresh);
  input.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) refresh();
  });

  return {
    refresh,
    onKey(e) {
      if (menu.hidden || !shown.length || e.isComposing) return false;
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
          draw();
          break;
        case 'Enter':
        case 'Tab':
          if (e.shiftKey) return false;
          pick(shown[active]!);
          break;
        case 'Escape':
          // Only the menu closes, not the worker panel behind it.
          e.stopPropagation();
          dismissedAt = input.value;
          close();
          break;
        default:
          return false;
      }
      e.preventDefault();
      return true;
    },
  };
}
