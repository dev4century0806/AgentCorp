import type { Agent } from '@shared';
import { clear, el } from './dom.js';

/**
 * Represents a worker that can be @-mentioned.
 */
export interface AtCandidate {
  id: string;
  name: string;
  ticketKey: string;
  status: string;
  isPam: boolean;
}

/**
 * An @-mention chip inserted into the message.
 */
export interface AtChip {
  workerId: string;
  workerName: string;
  /** Position in the text where the chip starts. */
  start: number;
  /** Position in the text where the chip ends. */
  end: number;
}

/**
 * Detects if the cursor is positioned after an @ that could be the start of a mention.
 * Returns the query text after the @, or null if not in a mention context.
 */
export function atQuery(text: string, cursorPos: number): { query: string; start: number } | null {
  // Look backwards from cursor for @ not preceded by word character
  const beforeCursor = text.slice(0, cursorPos);
  const match = /@(\w*)$/.exec(beforeCursor);
  if (!match) return null;
  return { query: match[1]!.toLowerCase(), start: cursorPos - match[0].length };
}

/**
 * Filter and sort candidates based on the query.
 * Those whose name starts with the query come first, then those containing it.
 */
export function matchCandidates(candidates: AtCandidate[], query: string): AtCandidate[] {
  const starts: AtCandidate[] = [];
  const contains: AtCandidate[] = [];
  const q = query.toLowerCase();
  for (const c of candidates) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) starts.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  const byName = (a: AtCandidate, b: AtCandidate) => a.name.localeCompare(b.name);
  return [...starts.sort(byName), ...contains.sort(byName)];
}

export interface AtMenu {
  /** Redraws from what is typed and the current workers. */
  refresh(): void;
  /** Handles a key in the chat box; true when the menu used it. */
  onKey(e: KeyboardEvent): boolean;
  /** Get the @-mentions parsed from the current input. */
  getChips(): AtChip[];
  /** Clear all chips (e.g., after sending). */
  clearChips(): void;
}

/**
 * The @-mention menu over the chat box: shows workers when @ is typed.
 * Picking one inserts a chip tied to the worker's ID.
 */
export function mountAtMenu(
  menu: HTMLElement,
  input: HTMLTextAreaElement,
  currentWorkerId: () => string | null,
  allWorkers: () => Agent[],
  picked: (chip: AtChip) => void,
): AtMenu {
  let shown: AtCandidate[] = [];
  let active = 0;
  let currentQuery: { query: string; start: number } | null = null;
  /** Text Escape closed the menu on, so it stays shut until text changes. */
  let dismissedAt: string | null = null;
  /** Chips inserted by picking from the menu. */
  let chips: AtChip[] = [];

  const close = () => {
    shown = [];
    currentQuery = null;
    menu.hidden = true;
    input.removeAttribute('aria-activedescendant');
  };

  /**
   * Build the list of workers that can be mentioned:
   * - All active workers except the current one
   * - the assistant is always listed
   * - Fired workers are excluded
   */
  const getCandidates = (): AtCandidate[] => {
    const current = currentWorkerId();
    return allWorkers()
      .filter((a) => a.id !== current) // Exclude self
      .map((a) => ({
        id: a.id,
        name: a.name,
        ticketKey: a.ticketKey,
        status: a.status,
        isPam: a.builtInPam,
      }));
  };

  const pick = (candidate: AtCandidate) => {
    if (!currentQuery) return;

    // Replace the @query with @Name
    const before = input.value.slice(0, currentQuery.start);
    const after = input.value.slice(input.selectionStart ?? currentQuery.start + currentQuery.query.length + 1);
    const mention = `@${candidate.name} `;
    input.value = before + mention + after;

    // Track the chip
    const chip: AtChip = {
      workerId: candidate.id,
      workerName: candidate.name,
      start: currentQuery.start,
      end: currentQuery.start + mention.length - 1, // -1 for the trailing space
    };
    chips.push(chip);

    close();
    input.focus();
    const newPos = currentQuery.start + mention.length;
    input.setSelectionRange(newPos, newPos);
    picked(chip);
  };

  const draw = () => {
    clear(menu);
    shown.forEach((candidate, i) => {
      const item = el('div', 'at-item');
      item.id = `at-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === active));

      const head = el('div', 'at-head');
      const nameEl = el('span', 'at-name', `@${candidate.name}`);
      head.appendChild(nameEl);
      if (candidate.isPam) {
        head.appendChild(el('span', 'at-badge', 'Reception'));
      }
      item.appendChild(head);

      const meta = el('div', 'at-meta', `${candidate.ticketKey} · ${candidate.status}`);
      item.appendChild(meta);

      // Mousedown, not click, so the chat box keeps focus.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(candidate);
      });
      item.addEventListener('mousemove', () => {
        if (active === i) return;
        active = i;
        draw();
      });
      menu.appendChild(item);
    });
    menu.hidden = false;
    input.setAttribute('aria-activedescendant', `at-${active}`);
    menu.querySelector<HTMLElement>(`#at-${active}`)?.scrollIntoView({ block: 'nearest' });
  };

  const refresh = () => {
    const cursorPos = input.selectionStart ?? input.value.length;
    currentQuery = atQuery(input.value, cursorPos);

    if (dismissedAt !== null && input.value !== dismissedAt) dismissedAt = null;

    if (currentQuery === null || dismissedAt !== null) {
      close();
      return;
    }

    const candidates = getCandidates();
    const next = matchCandidates(candidates, currentQuery.query);

    if (!next.length) {
      close();
      return;
    }

    const current = shown[active]?.id;
    shown = next;
    active = Math.max(0, shown.findIndex((c) => c.id === current));
    draw();
  };

  // Clean up chips when text is edited (user may delete part of a mention)
  const cleanChips = () => {
    chips = chips.filter((chip) => {
      const text = input.value;
      const expected = `@${chip.workerName}`;
      return text.slice(chip.start, chip.start + expected.length) === expected;
    });
  };

  input.addEventListener('blur', close);
  input.addEventListener('focus', refresh);
  input.addEventListener('input', cleanChips);

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
    getChips() {
      cleanChips();
      return [...chips];
    },
    clearChips() {
      chips = [];
    },
  };
}
