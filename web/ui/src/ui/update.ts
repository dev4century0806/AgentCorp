import { el, setRichText } from './dom.js';
import { settingCard } from './setting-card.js';

type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error';

export interface UpdateState {
  current: string;
  status: UpdateStatus;
  latest: string | null;
  notes: string;
  progress: number;
  error: string | null;
  canInstall: boolean;
}

interface DesktopBridge {
  updateState(): Promise<UpdateState | null>;
  checkForUpdate(): Promise<UpdateState | null>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): void;
}

const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;
const listeners = new Set<(state: UpdateState) => void>();
let state: UpdateState | null = null;
let showUpdateModal: ((state: UpdateState) => void) | null = null;

function publish(next: UpdateState | null): void {
  if (!next) return;
  state = next;
  for (const listener of listeners) listener(next);
}

export function updateLabel(s: UpdateState): string {
  if (s.status === 'downloading') return `Downloading ${s.latest} · ${Math.round(s.progress * 100)}%`;
  if (s.status === 'installing') return `Installing ${s.latest}…`;
  return s.canInstall ? `Update to ${s.latest}` : `Download ${s.latest}`;
}

function downloadIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Dash offset for the progress ring's arc, drawn on a pathLength of 100. */
export function ringOffset(progress: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return 100 - clamped * 100;
}

function progressRing(): { ring: SVGSVGElement; arc: SVGCircleElement } {
  const ns = 'http://www.w3.org/2000/svg';
  const ring = document.createElementNS(ns, 'svg');
  ring.setAttribute('class', 'update-ring');
  ring.setAttribute('viewBox', '0 0 18 18');
  ring.setAttribute('aria-hidden', 'true');
  const circle = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '9');
    c.setAttribute('cy', '9');
    c.setAttribute('r', '7.5');
    c.setAttribute('pathLength', '100');
    ring.appendChild(c);
    return c;
  };
  circle('update-ring-track');
  const arc = circle('update-ring-arc');
  arc.style.strokeDashoffset = String(ringOffset(0));
  return { ring, arc };
}

/** The release's section on the site's What's new page. */
export const releaseNotesUrl = (version: string): string => `http://127.0.0.1:4317/releases#${encodeURIComponent(version)}`;

export type NoteBlock = { kind: 'heading'; text: string } | { kind: 'list'; items: string[] } | { kind: 'p'; text: string };

/**
 * The release notes as headings, bullet lists and paragraphs. The notes are
 * packages/site/content/releases/<version>.md as CI publishes it, so the
 * "Read it on …" link and the install section after it are left out: the
 * modal links the page itself, and the app is already installed.
 */
export function noteBlocks(notes: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#+\s*Install on a Mac/i.test(line)) break;
    if (/^Read it on \[/.test(line)) continue;
    const item = /^[-*]\s+(.*)$/.exec(line);
    const heading = /^\*\*([^*]+)\*\*$/.exec(line) ?? /^#+\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (item) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'list') last.items.push(item[1]!);
      else blocks.push({ kind: 'list', items: [item[1]!] });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]! });
    } else para.push(line);
  }
  flush();
  return blocks;
}

function renderNotes(node: HTMLElement, notes: string): void {
  node.textContent = '';
  for (const block of noteBlocks(notes)) {
    if (block.kind === 'list') {
      const list = el('ul');
      for (const item of block.items) {
        const li = el('li');
        setRichText(li, item);
        list.appendChild(li);
      }
      node.appendChild(list);
    } else {
      const p = el(block.kind === 'heading' ? 'h3' : 'p');
      setRichText(p, block.text);
      node.appendChild(p);
    }
  }
}

function busy(s: UpdateState): boolean {
  return s.status === 'downloading' || s.status === 'installing';
}

function statusLine(s: UpdateState): string {
  switch (s.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'current':
      return 'Up to date.';
    case 'available':
      return `${s.latest} is available.`;
    case 'downloading':
    case 'installing':
      return `${updateLabel(s)}. The app restarts when it's done.`;
    case 'error':
      return `Couldn't update: ${s.error ?? 'unknown error'}.`;
    default:
      return 'Checks for updates at launch and every 6 hours.';
  }
}

export function mountUpdate(): void {
  if (!desktop) return;
  const modal = document.getElementById('updateConfirm');
  const title = document.getElementById('updateConfirmTitle');
  const detail = document.getElementById('updateConfirmDetail');
  const notes = document.getElementById('updateConfirmNotes');
  const link = document.getElementById('updateConfirmLink');
  const later = document.getElementById('updateLater');
  const now = document.getElementById('updateNow');
  if (!(modal instanceof HTMLElement) || !(title instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(notes instanceof HTMLElement) || !(link instanceof HTMLAnchorElement) || !(later instanceof HTMLButtonElement) || !(now instanceof HTMLButtonElement)) return;

  let modalState: UpdateState | null = null;
  const closeModal = (): void => {
    modal.hidden = true;
    modalState = null;
  };
  const showModal = (s: UpdateState): void => {
    modalState = s;
    title.textContent = `AgentCorp ${s.latest} is available — you have ${s.current}.`;
    detail.textContent = `Release ${s.latest}`;
    renderNotes(notes, s.notes);
    notes.hidden = !notes.childElementCount;
    link.hidden = !s.latest;
    if (s.latest) {
      link.href = releaseNotesUrl(s.latest);
      link.textContent = `See what's new in ${s.latest}`;
    }
    now.textContent = s.canInstall ? 'Update and restart' : 'Download';
    modal.hidden = false;
    now.focus();
  };
  showUpdateModal = showModal;
  later.addEventListener('click', closeModal);
  now.addEventListener('click', () => {
    if (!modalState) return;
    closeModal();
    void desktop.installUpdate();
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  });

  const badge = el('button', 'btn small primary update-badge');
  badge.id = 'updateBadge';
  badge.type = 'button';
  const { ring, arc } = progressRing();
  badge.append(downloadIcon(), ring);
  badge.hidden = true;
  badge.addEventListener('click', () => {
    if (state?.status === 'available') showModal(state);
  });
  document.querySelector('.zoom')?.after(badge);

  let reportedInstall = false;
  listeners.add((s) => {
    const show = s.status === 'available' || busy(s);
    badge.hidden = !show;
    if (s.status === 'installing' && !reportedInstall) {
      reportedInstall = true;
      ;
    }
    if (!show) return;
    badge.disabled = busy(s);
    badge.classList.toggle('busy', busy(s));
    ring.classList.toggle('installing', s.status === 'installing');
    // Installing has no progress to show, so a quarter arc spins instead.
    arc.style.strokeDashoffset = String(s.status === 'installing' ? 75 : ringOffset(s.progress));
    badge.setAttribute('aria-label', updateLabel(s));
    badge.title = updateLabel(s);
    if (s.status === 'available' && !modalState) showModal(s);
  });
  desktop.onUpdateState(publish);
  void desktop.updateState().then(publish);
}

/** Run the launch check before the sign-in gate can open. */
export async function checkForUpdateBeforeSignIn(): Promise<void> {
  if (!desktop) return;
  publish(await desktop.checkForUpdate());
}

export function versionSection(): HTMLElement | null {
  if (!desktop) return null;
  const version = el('span', 'version-number');
  const status = el('span', 'm');
  const check = el('button', 'btn small', 'Check for updates');
  check.type = 'button';
  const install = el('button', 'btn small primary');
  install.type = 'button';
  const card = settingCard('Version', [version, status], [check, install]);
  card.id = 'versionCard';

  let attached = false;
  const render = (s: UpdateState): void => {
    if (card.isConnected) attached = true;
    else if (attached) {
      listeners.delete(render);
      return;
    }
    version.textContent = `AgentCorp ${s.current}`;
    status.textContent = statusLine(s);
    check.disabled = s.status === 'checking' || busy(s);
    install.hidden = !(s.status === 'available' || busy(s));
    install.disabled = busy(s);
    install.textContent = updateLabel(s);
  };
  check.addEventListener('click', () => void desktop.checkForUpdate().then((next) => {
    publish(next);
    if (!next) return;
    ;
  }));
  install.addEventListener('click', () => {
    if (state?.status === 'available') showUpdateModal?.(state);
  });
  listeners.add(render);
  if (state) render(state);
  else void desktop.updateState().then(publish);
  return card;
}
