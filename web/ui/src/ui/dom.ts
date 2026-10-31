export function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function dropdown<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T,
  label: string,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = el('select', 'dropdown');
  select.setAttribute('aria-label', label);
  for (const o of options) {
    const opt = el('option', null, o.label);
    opt.value = o.value;
    select.appendChild(opt);
  }
  select.value = current;
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

export function clear(node: HTMLElement): void {
  node.textContent = '';
}

/**
 * Grows a text box with what is typed into it, so a long note reads whole
 * rather than through a slot. It stops at `max()` pixels and scrolls from
 * there; its rows are the least it shows. Returns the fit, for whoever
 * changes its room.
 */
export function autoGrow(box: HTMLTextAreaElement, max: () => number = () => 320): () => void {
  const fit = (): void => {
    // Out of sight it measures as nothing, and would be sized to nothing.
    if (!box.isConnected || !box.offsetParent) return;
    // Shrinking it to measure would scroll whatever it sits in, so that is put back.
    const scroller = box.closest<HTMLElement>('.pb');
    const top = scroller?.scrollTop ?? 0;
    box.style.height = 'auto';
    // scrollHeight leaves the borders out, and the box is sized with them in.
    const full = box.scrollHeight + box.offsetHeight - box.clientHeight;
    const limit = max();
    box.style.height = `${Math.min(full, limit)}px`;
    box.style.overflowY = full > limit ? 'auto' : 'hidden';
    if (scroller) scroller.scrollTop = top;
  };
  box.addEventListener('input', fit);
  // Once it is in the page, with a width to wrap at.
  requestAnimationFrame(fit);
  return fit;
}

/**
 * Watches the size of the texts "Show more" cuts short, with one observer for
 * all of them. Whatever redraws them calls `reset` first, so the texts thrown
 * away are let go of rather than watched for good.
 */
export class ClampWatch {
  private readonly checks = new Map<Element, () => void>();
  private observer: ResizeObserver | null = null;

  constructor(
    private readonly makeObserver: (callback: ResizeObserverCallback) => ResizeObserver = (callback) => new ResizeObserver(callback),
  ) {}

  /** Runs `check` once `text` is laid out, and again whenever its size changes. */
  watch(text: Element, check: () => void): void {
    this.observer ??= this.makeObserver((entries) => {
      for (const entry of entries) this.checks.get(entry.target)?.();
    });
    this.checks.set(text, check);
    this.observer.observe(text);
  }

  /** Stops watching every text, before they are redrawn away. */
  reset(): void {
    this.observer?.disconnect();
    this.checks.clear();
  }

  /** How many texts are being watched. */
  get size(): number {
    return this.checks.size;
  }
}

/**
 * A "Show more" link for text its CSS cuts to a few lines, there only while
 * something is cut. The text has `.expanded` while it shows whole, and
 * `onToggle` hears each change, so a redraw can keep it open.
 */
export function showMore(text: HTMLElement, open: boolean, onToggle: (open: boolean) => void, clamps: ClampWatch): HTMLButtonElement {
  const button = el('button', 'link-button show-more');
  button.type = 'button';
  const set = (on: boolean): void => {
    open = on;
    text.classList.toggle('expanded', on);
    button.textContent = on ? 'Show less' : 'Show more';
    button.setAttribute('aria-expanded', String(on));
  };
  set(open);
  button.hidden = !open;
  // Whether anything is cut is only known once it is laid out, and changes with the panel's width.
  clamps.watch(text, () => {
    if (!open) button.hidden = text.scrollHeight <= text.clientHeight + 1;
  });
  button.addEventListener('click', () => {
    set(!open);
    onToggle(open);
  });
  return button;
}

export type RichTextOptions = { copyFencedCode?: boolean };

/**
 * Fills a node with text, turning the inline markdown agents write into real
 * markup: `code`, **bold**, *italic* and `#` headings (shown bold).
 *
 * Agents write markdown and the CLI titles a shell call as "`npm test`", so
 * the panel was showing the markers as characters. Assembled out of text
 * nodes rather than innerHTML: none of this text is ours to trust.
 */
export function setRichText(node: HTMLElement, text: string, options: RichTextOptions = {}): void {
  node.textContent = '';
  appendRich(node, richParts(text), options);
}

function appendRich(node: HTMLElement, parts: RichPart[], options: RichTextOptions): void {
  for (const part of parts) {
    if (part.kind === 'fenced') {
      const pre = el('pre', 'fenced');
      const code = el('code', part.lang ? `lang-${part.lang}` : null, part.text);
      pre.appendChild(code);
      if (options.copyFencedCode) pre.append(...codeCopyControl(part.text));
      node.appendChild(pre);
    } else if ('text' in part) {
      if (part.kind === 'code') node.appendChild(el('code', null, part.text));
      else appendLinked(node, part.text);
    } else {
      const wrap = el(part.kind);
      appendRich(wrap, part.parts, options);
      node.appendChild(wrap);
    }
  }
}

type ClipboardWriter = Pick<Clipboard, 'writeText'>;

export async function copyCode(text: string, clipboard: ClipboardWriter = navigator.clipboard): Promise<boolean> {
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function codeCopyControl(text: string): [HTMLButtonElement, HTMLSpanElement] {
  const button = el('button', 'code-copy');
  button.type = 'button';
  button.title = 'Copy code';
  button.setAttribute('aria-label', 'Copy code');
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5h2"></path></svg>' + iconSvg(TEXT_ICONS.check, 'code-copy-done');
  const status = el('span', 'code-copy-status');
  status.setAttribute('role', 'status');

  let reset: number | undefined;
  button.addEventListener('click', async () => {
    window.clearTimeout(reset);
    const copied = await copyCode(text);
    button.classList.toggle('copied', copied);
    button.classList.toggle('failed', !copied);
    button.title = copied ? 'Copied!' : 'Could not copy';
    button.setAttribute('aria-label', copied ? 'Copied code' : 'Could not copy code');
    status.textContent = copied ? 'Copied code to clipboard' : 'Could not copy code';
    reset = window.setTimeout(() => {
      button.classList.remove('copied', 'failed');
      button.title = 'Copy code';
      button.setAttribute('aria-label', 'Copy code');
      status.textContent = '';
    }, 2500);
  });
  return [button, status];
}

export type RichPart =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'fenced'; text: string; lang: string | null }
  | { kind: 'strong' | 'em'; parts: RichPart[] };

/**
 * Splits text into plain, code, bold and italic runs.
 *
 * Fenced code blocks (```lang\n...\n```) are extracted first and rendered as
 * proper code blocks; inline formatting is not parsed inside them. Then the
 * remaining text is parsed for inline code, bold, italics and headings.
 *
 * A code span left open by truncation is taken as code too, but only where it
 * ends in an ellipsis and runs to the end of the string — the shape a cut-off
 * label has, and one prose does not. Emphasis markers must hug their text, so
 * `a * b * c` stays arithmetic, and code is matched first, so a `*glob*`
 * inside backticks is left as written.
 */
export function richParts(text: string): RichPart[] {
  const parts: RichPart[] = [];

  // Extract fenced code blocks first, then parse inline formatting in between.
  // The newline after the closing fence goes with it: the block already ends
  // the line, and left behind it showed as an extra blank line under pre-wrap.
  const fencePattern = /^```(\w*)\n([\s\S]*?)^```$\n?/gm;
  let at = 0;

  for (const match of text.matchAll(fencePattern)) {
    // Parse inline formatting in text before this fence
    if (match.index > at) {
      parts.push(...inlineParts(text.slice(at, match.index)));
    }
    const lang = match[1] ?? '';
    const code = match[2] ?? '';
    parts.push({ kind: 'fenced', text: code, lang: lang || null });
    at = match.index + match[0].length;
  }

  // Parse inline formatting in remaining text after last fence
  if (at < text.length) {
    parts.push(...inlineParts(text.slice(at)));
  }

  return parts;
}

/** Parses inline formatting (code, bold, italic, headings) but not fenced blocks. */
function inlineParts(text: string): RichPart[] {
  const parts: RichPart[] = [];
  let at = 0;
  const pattern =
    /`([^`\n]+)`|`([^`\n]*…)(?![\s\S])|\*\*(?=\S)([^\n]*?\S)\*\*|(?<![*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])|^#{1,6}[ \t]+([^\n]+)$/gm;

  for (const match of text.matchAll(pattern)) {
    if (match.index > at) parts.push({ kind: 'text', text: text.slice(at, match.index) });
    const [, code, cut, strong, em, heading] = match;
    if (code !== undefined || cut !== undefined) parts.push({ kind: 'code', text: code ?? cut ?? '' });
    else if (em !== undefined) parts.push({ kind: 'em', parts: inlineParts(em) });
    else parts.push({ kind: 'strong', parts: inlineParts(strong ?? heading ?? '') });
    at = match.index + match[0].length;
  }

  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

function appendLinked(node: HTMLElement, text: string): void {
  for (const part of linkParts(text)) {
    if (typeof part === 'string') {
      node.appendChild(document.createTextNode(part));
      continue;
    }
    const a = el('a', 'rich-link', part.text);
    a.href = part.href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.addEventListener('click', (e) => e.stopPropagation());
    node.appendChild(a);
  }
}

export type LinkPart = string | { text: string; href: string };

export function linkParts(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let at = 0;
  const push = (s: string): void => {
    if (!s) return;
    const last = parts[parts.length - 1];
    if (typeof last === 'string') parts[parts.length - 1] = last + s;
    else parts.push(s);
  };

  for (const match of text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+/g)) {
    push(text.slice(at, match.index));
    if (match[1] && match[2]) {
      parts.push({ text: match[1], href: match[2] });
      at = match.index + match[0].length;
      continue;
    }
    const url = trimUrl(match[0]);
    parts.push({ text: url, href: url });
    at = match.index + url.length;
  }

  push(text.slice(at));
  return parts;
}

function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    const head = url.slice(0, end);
    if (c && '.,;:!?*_'.includes(c)) end--;
    else if (c === ')' && (head.match(/\(/g)?.length ?? 0) < (head.match(/\)/g)?.length ?? 0)) end--;
    else if (c === ']' && !head.includes('[')) end--;
    else return head;
  }
}

/** Short relative time, e.g. "2m ago". */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const ACTION_ICONS = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  delete: '<polyline points="3 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
};

/** Icons for buttons that are only an icon, drawn like ACTION_ICONS. Use these, never an emoji. */
export const BUTTON_ICONS = {
  attach: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  prev: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  next: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};

/** Icons that sit before a heading or a line of text, in place of an emoji. */
export const TEXT_ICONS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  next: BUTTON_ICONS.next,
  prev: BUTTON_ICONS.prev,
  down: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  /** A cat's face, eyes open: a pet awake. */
  awake: '<path d="M5 10V4l4 3h6l4-3v6a7 7 0 0 1-14 0z"/><path d="M9.5 12.5h.01"/><path d="M14.5 12.5h.01"/>',
  /** Two z's, a big one and a small one: a pet asleep. */
  asleep: '<path d="M4 9h6l-6 8h6"/><path d="M14 4h5l-5 6h5"/>',
};

/** An icon's SVG, sized by CSS and hidden from screen readers: the button's aria-label names it. */
export function iconSvg(paths: string, className = 'btn-icon'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Fills a node with an icon and then its text, as a heading or label in place of an emoji. */
export function iconText<T extends HTMLElement>(node: T, paths: string, text: string): T {
  node.innerHTML = iconSvg(paths, 'text-icon');
  node.appendChild(document.createTextNode(text));
  return node;
}

/** An icon-only button that closes or removes something; the label says which. */
export function closeButton(className: string, label: string): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.innerHTML = iconSvg(BUTTON_ICONS.close);
  return button;
}

/**
 * Gives a search box its own clear button, drawn as an icon in place of the
 * browser's (hidden in styles.css). It shows only while there is text, and
 * clearing fires `input` so whatever filters on the box updates. Wraps the box
 * where it stands, or returns the wrapper to place if it is not in the page yet.
 */
export function searchClear(input: HTMLInputElement): HTMLElement {
  const wrap = el('span', 'search-box');
  const button = el('button', 'search-clear');
  button.type = 'button';
  button.title = 'Clear search';
  button.setAttribute('aria-label', 'Clear search');
  button.innerHTML = iconSvg(BUTTON_ICONS.close);
  const sync = (): void => {
    button.hidden = !input.value;
  };
  sync();
  input.addEventListener('input', sync);
  button.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  if (input.parentNode) input.replaceWith(wrap);
  wrap.append(input, button);
  return wrap;
}

/** The paperclip button that opens a file picker, as every composer has it. */
export function attachButton(className = 'btn small attach'): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', 'Attach files');
  button.title = 'Attach files, or paste or drop them here';
  button.innerHTML = iconSvg(BUTTON_ICONS.attach);
  return button;
}

export function actionIcon(label: string, paths: string): HTMLButtonElement {
  const button = el('button', 'icon-btn');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return button;
}
