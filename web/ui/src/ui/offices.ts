import {
  CLAUDE_MODEL_MENU,
  DETAIL_FIELDS,
  OFFICE_STYLES,
  type DesignerLogEntry,
  type GenerateOfficeRequest,
  type ModelMenu,
  type OfficeBrief,
  type OfficeDetails,
  type OfficeGeneration,
  type OfficeManifest,
  type OfficeRecord,
  type OfficeSummary,
  type RunnerChoice,
  runnerLabel,
} from '@shared';
import { api } from '../net/client.js';
import { lookPortrait } from '../scene/portrait.js';
import { officePreview } from '../scene/preview.js';
import type { RoomChoice, Store } from '../state/store.js';
import { signedInUsername } from './auth.js';
import { avatarImg } from './avatar.js';
import { SessionEndedError } from './session-logic.js';
import { BUTTON_ICONS, clear, closeButton, dropdown, el, iconSvg, searchClear } from './dom.js';
import {
  FIELD_LABELS,
  GALLERY_SORTS,
  STYLE_LABELS,
  byline,
  briefFrom,
  BUILD_NOTE,
  BUILD_TRADEOFF,
  SUGGEST_NOTE,
  applyLog,
  buildClock,
  buildSteps,
  elapsed,
  tokenNote,
  finishedWatcher,
  installedFrom,
  failureKey,
  generationText,
  PICKER_SHOWCASE,
  showcaseBadge,
  listingChip,
  loadDesignerSetup,
  needsThumbnail,
  normalizeTag,
  officeIdFromSearch,
  pngBase64,
  publishNote,
  saveDesignerSetup,
  splitOffices,
  toggleStyle,
  validateDetails,
  validatePrompt,
  visibleGenerations,
  type DesignerSetup,
  type DetailField,
  type GallerySort,
  type ListingStatus,
} from './offices-logic.js';
import {
  getPublicOffice,
  listPublicOffices,
  myListings,
  publishOffice,
  recordInstall,
  reportOffice,
  unpublishOffice,
  type ListingDetail,
  type ListingRow,
} from './showcase-api.js';
import { setupControls } from './setup.js';
import { RUNNERS } from './tickets.js';
import { switchableRunners } from './runners.js';
import { showToast } from './toasts.js';

/* ---------- small shared pieces ---------- */

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function userRoom(id: string): RoomChoice {
  return `user:${id}` as RoomChoice;
}

/** Switches the office to a saved one. */
export function useOffice(store: Store, id: string): void {
  store.patch({ room: userRoom(id), view: 'office' });
}

interface Shell {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  title: HTMLElement;
  close: () => void;
}

/** A modal in the message dialog's style, built on demand and removed once closed. Esc closes only it. */
function openShell(titleText: string, opts: { wide?: boolean; onClose?: () => void } = {}): Shell {
  const dialog = el('dialog', `message-dialog office-dialog${opts.wide ? ' wide' : ''}`);
  const head = el('div', 'ph');
  const row = el('div', 'row');
  const titleWrap = el('div', 'message-dialog-head');
  const title = el('h2', null, titleText);
  title.id = `officeDialogTitle${Math.random().toString(36).slice(2, 8)}`;
  titleWrap.appendChild(title);
  const closeBtn = closeButton('close', 'Close');
  row.append(titleWrap, closeBtn);
  head.appendChild(row);
  const body = el('div', 'message-dialog-body office-body');
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.append(head, body);
  document.body.appendChild(dialog);

  const close = (): void => {
    if (dialog.open) dialog.close();
  };
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  dialog.addEventListener('close', () => {
    opts.onClose?.();
    dialog.remove();
  });
  dialog.showModal();
  return { dialog, body, title, close };
}

function actionsRow(...buttons: HTMLElement[]): HTMLElement {
  const row = el('div', 'message-actions office-actions');
  row.append(...buttons);
  return row;
}

function button(label: string, cls = 'btn small', onClick?: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function statusLine(): HTMLElement {
  const s = el('span', 'msg-line m office-status');
  s.setAttribute('role', 'status');
  s.setAttribute('aria-live', 'polite');
  return s;
}

function say(node: HTMLElement, text: string, bad = false): void {
  node.className = `msg-line office-status ${bad ? 'why' : 'm'}`;
  node.textContent = text;
}

/** A status line with a spinner, for a wait the user should see is still going. */
function sayBusy(node: HTMLElement, text: string): void {
  node.className = 'msg-line office-status m busy';
  node.replaceChildren(el('span', 'spinner'), el('span', null, text));
}

/** "Runs on your Claude Code, using your own tokens", kept in step with a runner picker. `after` follows it. */
function costNote(extra: string | null, runner: () => string, after: () => string | null = () => null): { node: HTMLElement; update: () => void } {
  const node = el('p', 'm office-cost');
  const update = (): void => {
    node.textContent = [extra, tokenNote(runnerLabel(runner() as RunnerChoice)), after()].filter(Boolean).join(' ');
  };
  update();
  return { node, update };
}

function confirmDialog(opts: { title: string; lines: Array<string | Node>; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const shell = openShell(opts.title, { onClose: () => resolve(answer) });
    for (const line of opts.lines) shell.body.appendChild(typeof line === 'string' ? el('p', 'm', line) : line);
    const ok = button(opts.confirm, `btn small ${opts.danger ? 'danger' : 'primary'}`, () => {
      answer = true;
      shell.close();
    });
    shell.body.appendChild(actionsRow(button('Cancel', 'btn small ghost', shell.close), ok));
    ok.focus();
  });
}

function thumbImg(src: string | null, cls = 'room-pic'): HTMLImageElement {
  const img = el('img', cls);
  img.alt = '';
  img.loading = 'lazy';
  if (src) img.src = src;
  else img.classList.add('empty');
  return img;
}

/** A picture of the office drawn from its manifest, or null where WebGL is missing. */
async function draw(manifest: OfficeManifest, size?: { width: number; height: number }): Promise<string | null> {
  try {
    return await officePreview(manifest, size);
  } catch {
    return null;
  }
}

/* ---------- live views: redrawn from the store, dropped once off the page ---------- */

interface Live {
  node: HTMLElement;
  render: () => void;
  born: number;
  seen: boolean;
}
const lives: Live[] = [];
let liveStore: Store | null = null;

/** Calls `render` on every store change while `node` is on the page. One store subscription serves all. */
export function bindLive(store: Store, node: HTMLElement, render: () => void): void {
  lives.push({ node, render, born: Date.now(), seen: false });
  if (liveStore) return;
  liveStore = store;
  store.subscribe(() => redrawLive());
}

function redrawLive(): void {
  for (let i = lives.length - 1; i >= 0; i--) {
    const live = lives[i]!;
    if (live.node.isConnected) live.seen = true;
    else if (live.seen || Date.now() - live.born > 3000) {
      lives.splice(i, 1);
      continue;
    }
    if (live.node.isConnected) live.render();
  }
}

/* ---------- listing statuses (published offices) ---------- */

const listingStatuses = new Map<string, ListingStatus>();
const rejectReasons = new Map<string, string>();
/** How often listings still in review are checked again. */
const LISTING_POLL_MS = 60_000;

async function refreshListings(): Promise<void> {
  try {
    const rows = await myListings();
    listingStatuses.clear();
    rejectReasons.clear();
    for (const r of rows) {
      listingStatuses.set(r.id, r.status);
      if (r.reject_reason) rejectReasons.set(r.id, r.reject_reason);
    }
  } catch {
    // Signed out or offline: the cards just carry no chip.
  }
  redrawLive();
}

/* ---------- the picker section ---------- */

/** Briefs of generations started here, so a failed one can be retried. Lost on reload, then Retry opens the dialog. */
const sentRequests = new Map<string, GenerateOfficeRequest>();
/** How long a window just resumed waits for the store to hear the build is running again. */
const STALE_WAIT_MS = 5000;

/**
 * The models a designer can be picked from. Only Claude Code takes them from
 * here; the other runners use their own. Health's menu is the Settings
 * runner's, so it only counts when that is Claude Code too.
 */
const designerMenu = (store: Store): ModelMenu => (store.state.runner === 'claude' ? store.state.health.modelMenu : CLAUDE_MODEL_MENU);

/** The designer's model and effort for a request: the chosen ones on Claude Code, nothing (the runner's own) elsewhere. */
const designerFields = (runner: RunnerChoice, setup: DesignerSetup): Pick<GenerateOfficeRequest, 'model' | 'effort'> =>
  runner === 'claude' ? { model: setup.model, effort: setup.effort } : {};

export function officesSection(store: Store): HTMLElement {
  const wrap = el('div', 'office-user');
  const head = el('div', 'row office-user-head');
  head.appendChild(el('b', 'settings-label', 'User generated'));
  wrap.appendChild(head);
  wrap.appendChild(el('span', 'm', 'Offices you describe in a sentence, built by your coding agent. Or browse what others published.'));
  // What others made first, then the user's own.
  wrap.appendChild(showcaseRow(store));
  const ownHead = el('div', 'row office-user-head office-own-head');
  ownHead.appendChild(el('span', 'setup-label', 'Your offices'));
  wrap.appendChild(ownHead);

  const grid = el('div', 'room-picks office-picks');
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'User generated offices');
  wrap.appendChild(grid);

  // Offices installed from the showcase are someone else's, so they get their own row.
  const installedHead = el('div', 'row office-user-head office-own-head');
  installedHead.appendChild(el('span', 'setup-label', 'Installed from the showcase'));
  const installedGrid = el('div', 'room-picks office-picks');
  installedGrid.setAttribute('role', 'radiogroup');
  installedGrid.setAttribute('aria-label', 'Offices installed from the showcase');
  wrap.append(installedHead, installedGrid);

  let drawn = '';
  const render = (): void => {
    const { offices, generations, room } = store.state;
    const key = JSON.stringify([room, offices, generations, [...listingStatuses]]);
    if (key === drawn) return;
    drawn = key;
    const hadFocus = grid.contains(document.activeElement) || installedGrid.contains(document.activeElement);
    const { own, installed } = splitOffices(offices);
    clear(grid);
    clear(installedGrid);
    for (const gen of visibleGenerations(generations)) grid.appendChild(generationCard(store, gen, offices));
    for (const office of own) grid.appendChild(officeCard(store, office, room === userRoom(office.id)));
    const create = button('', 'room-pick create-office', () => openCreate(store));
    create.append(el('span', 'create-plus', '+'), el('span', 'room-name', 'Create office'));
    grid.appendChild(create);
    for (const office of installed) installedGrid.appendChild(officeCard(store, office, room === userRoom(office.id)));
    installedHead.hidden = installedGrid.hidden = installed.length === 0;
    if (hadFocus && !wrap.contains(document.activeElement)) create.focus({ preventScroll: true });
  };
  render();
  bindLive(store, wrap, render);
  // Approval happens elsewhere, so each look at the picker asks again rather than trusting what was loaded at startup.
  void refreshListings();
  return wrap;
}

/**
 * The newest few offices people published, above the user's own, with
 * View more for the whole showcase. Fetched each time the picker is drawn.
 */
function showcaseRow(store: Store): HTMLElement {
  const box = el('div', 'office-showcase-row');
  const head = el('div', 'row office-user-head');
  head.appendChild(el('span', 'setup-label', 'New in the showcase'));
  head.appendChild(button('View more', 'btn small ghost', () => openShowcase(store, 'new')));
  box.appendChild(head);
  const grid = el('div', 'room-picks office-picks');
  grid.setAttribute('aria-label', 'Newest offices in the showcase');
  const status = statusLine();
  box.append(grid, status);
  sayBusy(status, 'Loading the showcase…');

  listPublicOffices({ sort: 'new', tag: null, page: 0, limit: PICKER_SHOWCASE })
    .then((rows) => {
      clear(grid);
      for (const row of rows.slice(0, PICKER_SHOWCASE)) {
        const card = button('', 'room-pick showcase-pick', () => void openListingPreview(store, row.id));
        card.setAttribute('aria-label', `${row.name} by @${row.creator_username}: preview`);
        card.appendChild(thumbImg(row.thumbnail_url));
        card.appendChild(el('span', 'room-name', row.name));
        card.appendChild(creatorLine(row.creator_username, row.creator_avatar_url));
        const badge = showcaseBadge(row.id, store.state.offices);
        if (badge) card.appendChild(el('span', 'room-chip', badge));
        grid.appendChild(card);
      }
      say(status, rows.length ? '' : 'Nothing published yet. Publish one of yours to be first.');
    })
    .catch(() => say(status, "Couldn't load the showcase. View more to try again.", true));
  return box;
}

function officeCard(store: Store, office: OfficeSummary, on: boolean): HTMLElement {
  const cell = el('div', 'room-cell');
  const pick = el('button', `room-pick${on ? ' on' : ''}`);
  pick.type = 'button';
  pick.setAttribute('role', 'radio');
  pick.setAttribute('aria-checked', String(on));
  const img = thumbImg(office.hasThumbnail ? api.officeThumbnailUrl(office.id, office.updatedAt) : null);
  if (!office.hasThumbnail) pick.classList.add('no-pic');
  const name = el('span', 'room-name', office.name);
  pick.append(img, name);
  const by = byline(office);
  if (by) pick.appendChild(el('span', 'room-sub', by));
  const chip = listingChip(office, listingStatuses);
  if (chip) {
    const c = el('span', `room-chip chip-${chip.toLowerCase().replace(/\s+/g, '-')}`, chip);
    pick.appendChild(c);
  }
  pick.addEventListener('click', () => useOffice(store, office.id));
  cell.appendChild(pick);
  cell.appendChild(
    menu(`Actions for ${office.name}`, [
      { label: 'Use', run: () => useOffice(store, office.id) },
      { label: 'Preview', run: () => void openPreview(store, office.id) },
      ...(office.source.kind === 'generated' ? [{ label: 'Edit', run: () => void openPreview(store, office.id, true) }] : []),
      // An installed office is someone else's: it can't be published from here.
      ...(office.listingId
        ? [{ label: 'Unpublish', run: () => void unpublish(store, office) }]
        : office.source.kind === 'generated'
          ? [{ label: 'Publish', run: () => void openPublish(store, office.id) }]
          : []),
      { label: 'Delete', danger: true, run: () => void deleteOffice(store, office) },
    ]),
  );
  return cell;
}

function generationCard(store: Store, gen: OfficeGeneration, offices: OfficeSummary[]): HTMLElement {
  const text = generationText(gen, offices.find((o) => o.id === gen.officeId)?.name);
  const card = el('div', `room-pick gen-card ${text.tone}`);
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `${text.title} ${text.line}`);
  card.appendChild(el('span', 'room-name', text.title));
  if (text.tone === 'running') {
    const line = el('span', 'room-sub gen-line');
    line.append(el('span', 'spinner'), el('span', null, text.line));
    card.appendChild(line);
    if (gen.line) card.appendChild(el('span', 'room-sub gen-saying', gen.line));
    const clock = el('span', 'room-sub m');
    clock.dataset.since = gen.startedAt;
    clock.textContent = buildClock(gen.startedAt, Date.now());
    card.appendChild(clock);
    card.appendChild(button('Open', 'btn small', () => openBuild(store, gen.id)));
    card.appendChild(button('Cancel', 'btn small ghost', () => void dismissGeneration(gen.id)));
    return card;
  }
  card.appendChild(el('span', 'room-sub', text.line));
  if (gen.errors.length) {
    const d = el('details', 'gen-errors');
    d.appendChild(el('summary', null, `${gen.errors.length} problem${gen.errors.length === 1 ? '' : 's'}`));
    const ul = el('ul');
    for (const e of gen.errors) ul.appendChild(el('li', null, e));
    d.appendChild(ul);
    card.appendChild(d);
  }
  const row = el('div', 'gen-actions');
  row.appendChild(
    gen.resumable
      ? button('Resume', 'btn small primary', () => void resumeGeneration(store, gen))
      : button('Retry', 'btn small primary', () => void retryGeneration(store, gen)),
  );
  // The log says what the designer did before it stopped.
  row.appendChild(button('Open', 'btn small', () => openBuild(store, gen.id)));
  row.appendChild(button('Dismiss', 'btn small ghost', () => void dismissGeneration(gen.id)));
  card.appendChild(row);
  return card;
}

async function dismissGeneration(id: string): Promise<void> {
  try {
    await api.cancelOfficeGeneration(id);
    sentRequests.delete(id);
  } catch (err) {
    showToast(messageOf(err), 'error');
  }
}

/** Carries a build that was cut off on where it stopped, and opens its window to watch. */
async function resumeGeneration(store: Store, gen: OfficeGeneration): Promise<void> {
  try {
    await api.resumeOfficeGeneration(gen.id);
    openCreate(store, { watch: gen.id, stale: failureKey(gen) });
  } catch (err) {
    showToast(messageOf(err), 'error');
  }
}

async function retryGeneration(store: Store, gen: OfficeGeneration): Promise<void> {
  const sent = sentRequests.get(gen.id);
  if (!sent) {
    await dismissGeneration(gen.id);
    openCreate(store);
    return;
  }
  try {
    await api.cancelOfficeGeneration(gen.id);
    const { generation } = await api.generateOffice(sent);
    sentRequests.delete(gen.id);
    sentRequests.set(generation.id, sent);
    openBuild(store, generation.id);
  } catch (err) {
    showToast(messageOf(err), 'error');
  }
}

/** The "..." menu on a card: a button that opens a short list of actions. */
function menu(label: string, items: Array<{ label: string; danger?: boolean; run: () => void }>): HTMLElement {
  const wrap = el('div', 'card-menu');
  const trigger = button('⋯', 'card-menu-btn');
  trigger.setAttribute('aria-label', label);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const list = el('div', 'card-menu-list');
  list.setAttribute('role', 'menu');
  list.hidden = true;
  const entries = items.map((item) => {
    const b = el('button', `card-menu-item${item.danger ? ' danger' : ''}`, item.label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      closeMenu(true);
      item.run();
    });
    list.appendChild(b);
    return b;
  });
  const outside = (e: Event): void => {
    if (!wrap.contains(e.target as Node)) closeMenu(false);
  };
  function closeMenu(refocus: boolean): void {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) trigger.focus();
  }
  trigger.addEventListener('click', () => {
    if (!list.hidden) return closeMenu(true);
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    entries[0]?.focus();
  });
  list.addEventListener('keydown', (e) => {
    const i = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      entries[(i + 1) % entries.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      entries[(i - 1 + entries.length) % entries.length]?.focus();
    } else if (e.key === 'Tab') closeMenu(false);
  });
  wrap.append(trigger, list);
  return wrap;
}

async function deleteOffice(store: Store, office: OfficeSummary): Promise<void> {
  const lines = [`“${office.name}” will be removed from this Mac.`];
  if (office.listingId) lines.push('It stays on the showcase until you unpublish it.');
  if (!(await confirmDialog({ title: 'Delete this office?', lines, confirm: 'Delete', danger: true }))) return;
  try {
    await api.deleteOffice(office.id);
    if (store.state.room === userRoom(office.id)) store.patch({ room: 'office' });
    showToast('Office deleted.', 'info');
  } catch (err) {
    showToast(messageOf(err), 'error');
  }
}

async function unpublish(store: Store, office: OfficeSummary): Promise<void> {
  if (!office.listingId) return;
  const ok = await confirmDialog({
    title: 'Unpublish this office?',
    lines: [`“${office.name}” leaves the showcase. Offices others already installed stay with them.`],
    confirm: 'Unpublish',
  });
  if (!ok) return;
  try {
    await unpublishOffice(office.listingId);
    await api.markOfficePublished(office.id, null);
    await refreshListings();
    showToast('Unpublished.', 'info');
  } catch (err) {
    showToast(messageOf(err), 'error');
  }
  void store;
}

/* ---------- create / edit the answers ---------- */

interface CreateOptions {
  /** Reopens step 2 with these answers, to build again over `officeId`. */
  prefill?: { brief: OfficeBrief; officeId: string };
  /** Opens straight on a build already going, to watch it. */
  watch?: string;
  /** Just resumed: the failure it resumed from, which the window waits past rather than draws. */
  stale?: string;
}

/** The progress of a build already going, from its card. */
function openBuild(store: Store, genId: string): void {
  openCreate(store, { watch: genId });
}

const emptyDetails = (style: OfficeDetails['style'] = 'cozy'): OfficeDetails => ({ theme: '', scene: '', people: '', decor: '', notes: '', style });

export function openCreate(store: Store, opts: CreateOptions = {}): void {
  const shell = openShell(opts.watch ? 'Building your office' : opts.prefill ? 'Edit the answers' : 'Create an office');
  const form = {
    prompt: opts.prefill?.brief.prompt ?? '',
    style: null as OfficeDetails['style'] | null,
    runner: store.state.runner as RunnerChoice,
    details: opts.prefill ? { ...opts.prefill.brief.details } : (null as OfficeDetails | null),
    setup: loadDesignerSetup(designerMenu(store)),
  };
  let busy = false;

  /** "Built by", then the designer's model and effort, which show only for Claude Code. Each choice is kept for next time. */
  const runnerPicker = (onChange: () => void = () => {}): HTMLElement => {
    const row = el('div', 'office-builder');
    const f = el('label', 'setup-field');
    f.appendChild(el('span', 'setup-label', 'Built by'));
    let setup: HTMLElement = el('div', 'setup');
    const rebuild = (): void => {
      const next = setupControls({ permission: 'standard', ...form.setup }, designerMenu(store), (chosen) => {
        form.setup = { model: chosen.model, effort: chosen.effort };
        saveDesignerSetup(form.setup);
      }, { permission: false }).node;
      next.hidden = form.runner !== 'claude';
      setup.replaceWith(next);
      setup = next;
    };
    f.appendChild(
      // The office is built on a coding agent, so it can only go to one that is on and ready.
      dropdown(RUNNERS.filter((r) => switchableRunners(store.state.enabledRunners, store.state.health.runners, form.runner).includes(r.value)), form.runner, 'Agent that builds the office', (v) => {
        form.runner = v;
        rebuild();
        onChange();
      }),
    );
    row.append(f, setup);
    rebuild();
    return row;
  };

  const step1 = (): void => {
    clear(shell.body);
    shell.title.textContent = 'Create an office';
    const label = el('label', 'office-field');
    label.appendChild(el('b', null, 'Describe it'));
    const prompt = el('textarea', 'ask-input');
    prompt.rows = 3;
    prompt.maxLength = 600;
    prompt.placeholder = 'a cozy pirate ship office at sunset';
    prompt.value = form.prompt;
    prompt.addEventListener('input', () => (form.prompt = prompt.value));
    label.appendChild(prompt);
    shell.body.appendChild(label);

    const styleBox = el('div', 'office-field');
    styleBox.appendChild(el('span', 'setup-label', 'Style (optional)'));
    const chips = el('div', 'office-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Style');
    const chipButtons = OFFICE_STYLES.map((s) => {
      const b = button(STYLE_LABELS[s], 'btn small office-chip');
      b.addEventListener('click', () => {
        form.style = toggleStyle(form.style, s);
        sync();
      });
      chips.appendChild(b);
      return [s, b] as const;
    });
    const sync = (): void => chipButtons.forEach(([s, b]) => {
      b.setAttribute('aria-pressed', String(form.style === s));
      b.classList.toggle('primary', form.style === s);
    });
    sync();
    styleBox.appendChild(chips);
    shell.body.appendChild(styleBox);
    const cost = costNote(SUGGEST_NOTE, () => form.runner);
    shell.body.appendChild(runnerPicker(cost.update));
    shell.body.appendChild(cost.node);

    const status = statusLine();
    const next = button('Suggest details', 'btn small primary');
    next.addEventListener('click', async () => {
      const problem = validatePrompt(form.prompt);
      if (problem) return say(status, problem, true);
      busy = true;
      next.disabled = true;
      sayBusy(status, 'Suggesting details…');
      try {
        const { details } = await api.suggestOfficeDetails({
          prompt: form.prompt.trim(),
          ...(form.style ? { style: form.style } : {}),
          runner: form.runner,
        });
        form.details = details;
        step2();
      } catch (err) {
        say(status, messageOf(err), true);
      } finally {
        busy = false;
        next.disabled = false;
      }
    });
    shell.body.append(status, actionsRow(button('Cancel', 'btn small ghost', shell.close), next));
    prompt.focus();
  };

  const step2 = (): void => {
    clear(shell.body);
    shell.title.textContent = 'Review the details';
    const details = form.details ?? emptyDetails(form.style ?? 'cozy');
    form.details = details;
    const status = statusLine();
    const inputs = new Map<DetailField, HTMLTextAreaElement>();
    const errors = new Map<DetailField, HTMLElement>();
    const refreshButtons: HTMLButtonElement[] = [];
    const setBusy = (on: boolean): void => {
      busy = on;
      refreshButtons.forEach((b) => (b.disabled = on));
      generate.disabled = on;
      back.disabled = on;
    };

    for (const field of DETAIL_FIELDS) {
      const meta = FIELD_LABELS[field];
      const box = el('div', 'office-field');
      const top = el('div', 'office-field-head');
      const id = `officeField-${field}`;
      const lab = el('label', null, meta.label + (meta.required ? '' : ''));
      lab.htmlFor = id;
      lab.appendChild(el('span', 'm office-hint', ` ${meta.hint}`));
      const again = button('', 'btn small ghost office-again');
      again.innerHTML = iconSvg(BUTTON_ICONS.refresh);
      again.setAttribute('aria-label', 'Suggest again');
      again.title = `Suggest ${meta.label.toLowerCase()} again`;
      refreshButtons.push(again);
      top.append(lab, again);
      const input = el('textarea', 'ask-input');
      input.id = id;
      input.rows = field === 'theme' ? 3 : 4;
      input.maxLength = 600;
      input.value = details[field];
      input.required = meta.required;
      input.addEventListener('input', () => {
        details[field] = input.value;
        errors.get(field)!.textContent = '';
      });
      const err = el('span', 'msg-line why');
      err.setAttribute('role', 'alert');
      inputs.set(field, input);
      errors.set(field, err);
      again.addEventListener('click', async () => {
        setBusy(true);
        sayBusy(status, `Suggesting ${meta.label.toLowerCase()}…`);
        try {
          const res = await api.suggestOfficeDetails({
            prompt: form.prompt.trim(),
            style: details.style,
            runner: form.runner,
            current: { ...details },
            field,
          });
          details[field] = res.details[field];
          input.value = details[field];
          say(status, '');
        } catch (e) {
          say(status, messageOf(e), true);
        } finally {
          setBusy(false);
        }
      });
      box.append(top, input, err);
      shell.body.appendChild(box);
    }

    const styleBox = el('label', 'office-field');
    styleBox.appendChild(el('span', 'setup-label', 'Style'));
    styleBox.appendChild(
      dropdown(OFFICE_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })), details.style, 'Style', (v) => (details.style = v)),
    );
    shell.body.appendChild(styleBox);
    const cost = costNote(BUILD_NOTE, () => form.runner, () => (form.runner === 'claude' ? BUILD_TRADEOFF : null));
    shell.body.appendChild(runnerPicker(cost.update));
    shell.body.appendChild(cost.node);

    const back = button('Back', 'btn small ghost', () => {
      if (opts.prefill) return shell.close();
      step1();
    });
    const generate = button(opts.prefill ? 'Build again' : 'Generate', 'btn small primary');
    generate.addEventListener('click', async () => {
      const problems = validateDetails(details);
      for (const field of DETAIL_FIELDS) errors.get(field)!.textContent = problems[field] ?? '';
      const first = DETAIL_FIELDS.find((f) => problems[f]);
      if (first) return inputs.get(first)!.focus();
      setBusy(true);
      sayBusy(status, 'Starting the designer…');
      try {
        const request: GenerateOfficeRequest = {
          brief: briefFrom(form.prompt, details),
          runner: form.runner,
          ...designerFields(form.runner, form.setup),
          ...(opts.prefill ? { officeId: opts.prefill.officeId } : {}),
        };
        const { generation } = await api.generateOffice(request);
        sentRequests.set(generation.id, request);
        step3(generation.id);
      } catch (e) {
        say(status, messageOf(e), true);
        setBusy(false);
      }
    });
    shell.body.append(status, actionsRow(back, generate));
    inputs.get('theme')!.focus();
  };

  /** Stops the open build window hearing its designer's log. */
  let stopLog = (): void => {};
  shell.dialog.addEventListener('close', () => stopLog());

  /**
   * The build itself: what step it is on, how long it has been, and a
   * read-only log of what the designer says and does. `stale` is a failure
   * just resumed from, not drawn again while the store still holds it.
   */
  const step3 = (genId: string, stale: string | null = null): void => {
    clear(shell.body);
    stopLog();
    const editing = opts.prefill !== undefined || store.state.generations.find((g) => g.id === genId)?.officeId != null;
    shell.title.textContent = editing ? 'Updating your office' : 'Building your office';
    const runner = sentRequests.get(genId)?.runner ?? form.runner;
    const lead = el('div', 'office-progress-lead');
    const spinner = el('span', 'spinner');
    const leadText = el('div', 'office-progress-text');
    const headline = el('b', null, 'Your designer is at work');
    const clock = el('span', 'm');
    leadText.append(headline, clock);
    lead.append(spinner, leadText);
    const steps = el('ol', 'office-steps');
    steps.setAttribute('aria-label', 'Build steps');
    const saying = el('p', 'm office-saying');
    saying.setAttribute('aria-live', 'polite');
    const tradeoff = runner === 'claude' ? ` ${BUILD_TRADEOFF}` : '';
    const note = el('p', 'm office-cost', `${BUILD_NOTE} ${tokenNote(runnerLabel(runner))}${tradeoff} You can close this: it keeps building in the background, and you'll be told when it's ready.`);
    const log = el('div', 'office-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-label', 'What the designer is doing');
    // The line above already speaks up; the log streams too fast to read aloud.
    log.setAttribute('aria-live', 'off');
    log.tabIndex = 0;
    let held: DesignerLogEntry[] = [];
    /** Redraws the log from entry `from` on, following it down while the reader is at the bottom. */
    const showLog = (from: number): void => {
      const following = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
      while (log.children.length > from) log.lastElementChild!.remove();
      for (const e of held.slice(from)) log.appendChild(el('p', `office-log-${e.kind}`, e.text));
      if (following) log.scrollTop = log.scrollHeight;
    };
    const fetchLog = (): void =>
      void api.officeGenerationLog(genId).then(({ entries }) => {
        held = entries;
        showLog(0);
      }, () => undefined);
    stopLog = store.onOfficeLog((id, from, entries) => {
      if (id !== genId) return;
      const next = applyLog(held, from, entries);
      if (!next) return fetchLog();
      held = next;
      showLog(from);
    });
    fetchLog();
    const problems = el('div');
    const cancel = button('Cancel build', 'btn small ghost', async () => {
      if (!(await confirmDialog({ title: 'Cancel the build?', lines: ['The designer stops and nothing is saved.'], confirm: 'Cancel build', danger: true }))) return;
      await dismissGeneration(genId);
      shell.close();
    });
    const done = button('Close', 'btn small primary', shell.close);
    const actions = actionsRow(cancel, done);
    shell.body.append(lead, steps, saying, log, problems, note, actions);
    done.focus();

    let drawn = '';
    const draw = (): void => {
      const gen = store.state.generations.find((g) => g.id === genId);
      if (!gen) return;
      if (stale !== null) {
        if (failureKey(gen) === stale && Date.now() - openedAt < STALE_WAIT_MS) return;
        stale = null;
      }
      clock.textContent = `${elapsed(gen.startedAt, Date.now())} so far`;
      const key = JSON.stringify([gen.state, gen.attempt, gen.errors, gen.started, gen.line]);
      if (key === drawn) return;
      drawn = key;
      steps.replaceChildren(
        ...buildSteps(gen).map((step) => {
          const li = el('li', `office-step ${step.state}`, step.label);
          if (step.state === 'now') li.setAttribute('aria-current', 'step');
          return li;
        }),
      );
      saying.textContent = gen.line ? `Designer: ${gen.line}` : '';
      if (gen.state === 'done') {
        spinner.remove();
        headline.textContent = 'Your office is ready';
        clock.textContent = '';
        cancel.remove();
        note.remove();
        const look = button('Preview it', 'btn small primary', () => {
          shell.close();
          if (gen.resultId) void openPreview(store, gen.resultId);
        });
        done.className = 'btn small ghost';
        actions.prepend(look);
        look.focus();
        stop();
      } else if (gen.state === 'failed') {
        spinner.remove();
        headline.textContent = gen.resumable ? 'The designer was cut off' : "The designer couldn't finish the office";
        clock.textContent = '';
        cancel.remove();
        note.remove();
        if (gen.errors.length) {
          const ul = el('ul', 'gen-errors-list');
          for (const e of gen.errors.slice(0, 8)) ul.appendChild(el('li', null, e));
          problems.replaceChildren(ul);
        }
        const retry = button(gen.resumable ? 'Start over' : 'Try again', gen.resumable ? 'btn small ghost' : 'btn small primary', () => {
          shell.close();
          void retryGeneration(store, gen);
        });
        done.className = 'btn small ghost';
        actions.prepend(retry);
        if (gen.resumable) {
          const resume = button('Resume', 'btn small primary', async () => {
            resume.disabled = true;
            try {
              await api.resumeOfficeGeneration(genId);
              step3(genId, failureKey(gen));
            } catch (err) {
              showToast(messageOf(err), 'error');
              resume.disabled = false;
            }
          });
          actions.prepend(resume);
          resume.focus();
        } else {
          retry.focus();
        }
        stop();
      }
    };
    const openedAt = Date.now();
    const timer = window.setInterval(draw, 1000);
    const stop = (): void => window.clearInterval(timer);
    shell.dialog.addEventListener('close', stop);
    draw();
  };

  void busy;
  if (opts.watch) step3(opts.watch, opts.stale ?? null);
  else if (opts.prefill) step2();
  else step1();
}

/* ---------- preview ---------- */

export async function openPreview(store: Store, id: string, focusEdit = false): Promise<void> {
  const shell = openShell('Office');
  shell.body.appendChild(el('p', 'm', 'Loading…'));
  let record: OfficeRecord;
  try {
    record = await api.office(id);
  } catch (err) {
    clear(shell.body);
    shell.body.appendChild(el('p', 'msg-line why', messageOf(err)));
    return;
  }
  const { summary, manifest, brief } = record;
  clear(shell.body);
  shell.title.textContent = summary.name;
  shell.body.appendChild(previewBody(manifest, summary.description, summary.tags, byline(summary)));

  const status = statusLine();
  const actions = el('div', 'office-actions wrap');
  actions.appendChild(button('Use this office', 'btn small primary', () => {
    useOffice(store, id);
    shell.close();
  }));
  if (summary.source.kind === 'generated' && brief) {
    actions.appendChild(button('Edit the answers', 'btn small', () => {
      shell.close();
      openCreate(store, { prefill: { brief, officeId: id } });
    }));
  }
  actions.appendChild(
    summary.listingId
      ? button('Unpublish', 'btn small', () => { shell.close(); void unpublish(store, summary); })
      : button('Publish', 'btn small', () => void openPublish(store, id)),
  );
  actions.appendChild(button('Delete', 'btn small danger', () => { shell.close(); void deleteOffice(store, summary); }));

  if (summary.source.kind === 'generated' && brief) {
    const form = el('form', 'office-edit');
    const input = el('input', 'ask-repo');
    input.type = 'text';
    input.maxLength = 300;
    input.placeholder = 'Change it: make it night';
    input.setAttribute('aria-label', 'Edit with a prompt');
    const go = button('Edit', 'btn small primary');
    go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const instruction = input.value.trim();
      if (!instruction) return say(status, 'Say what to change first.', true);
      go.disabled = true;
      try {
        const runner = store.state.runner;
        const request: GenerateOfficeRequest = { brief, runner, ...designerFields(runner, loadDesignerSetup(designerMenu(store))), officeId: id, instruction };
        const { generation } = await api.generateOffice(request);
        sentRequests.set(generation.id, request);
        shell.close();
        openBuild(store, generation.id);
      } catch (err) {
        say(status, messageOf(err), true);
        go.disabled = false;
      }
    });
    shell.body.appendChild(form);
    shell.body.appendChild(el('p', 'm office-cost', `An edit takes about 2 to 3 minutes. ${tokenNote(runnerLabel(store.state.runner))}`));
    if (focusEdit) input.focus();
  }
  shell.body.append(status, actions);
}

/** `by @name` with the creator's picture (or the default bot) in front. */
function creatorLine(username: string, avatarUrl: string | null | undefined, extra = '', cls = 'room-sub'): HTMLElement {
  const line = el('span', `${cls} creator-line`);
  line.append(avatarImg(avatarUrl, username, 18), el('span', null, `by @${username}${extra}`));
  return line;
}

/** The picture, the crew and the words, shared by saved and showcase previews. */
function previewBody(manifest: OfficeManifest, description: string, tags: string[], by: HTMLElement | string | null): HTMLElement {
  const box = el('div', 'office-preview');
  const img = el('img', 'office-preview-img');
  img.alt = `Preview of ${manifest.name}`;
  const hold = el('div', 'office-preview-frame');
  hold.append(img, el('span', 'm office-preview-wait', 'Drawing the room…'));
  box.appendChild(hold);
  void draw(manifest, { width: 960, height: 600 }).then((url) => {
    if (url) {
      img.src = url;
      hold.classList.add('ready');
    } else hold.querySelector('.office-preview-wait')!.textContent = 'Preview is not available here.';
  });
  if (by) box.appendChild(typeof by === 'string' ? el('span', 'm', by) : by);
  if (description) box.appendChild(el('p', 'office-desc', description));
  if (tags.length) {
    const t = el('div', 'office-tags');
    for (const tag of tags) t.appendChild(el('span', 'room-chip', tag));
    box.appendChild(t);
  }
  const crew = el('ul', 'office-crew');
  crew.setAttribute('aria-label', 'The crew');
  for (const look of manifest.looks) {
    const li = el('li', 'office-look');
    const url = lookPortrait(look, look.name);
    if (url) {
      const p = el('img', 'wc-face');
      p.src = url;
      p.alt = '';
      li.appendChild(p);
    }
    li.appendChild(el('span', null, look.name));
    crew.appendChild(li);
  }
  box.appendChild(crew);
  return box;
}

/* ---------- publish ---------- */

export async function openPublish(store: Store, id: string): Promise<void> {
  const shell = openShell('Publish this office');
  shell.body.appendChild(el('p', 'm', 'Loading…'));
  let record: OfficeRecord;
  try {
    record = await api.office(id);
  } catch (err) {
    clear(shell.body);
    shell.body.appendChild(el('p', 'msg-line why', messageOf(err)));
    return;
  }
  clear(shell.body);
  const { summary, manifest, brief } = record;
  const frame = el('div', 'office-preview-frame');
  const img = el('img', 'office-preview-img');
  img.alt = `Preview of ${summary.name}`;
  frame.appendChild(img);
  shell.body.appendChild(frame);
  let thumb: string | null = null;
  void draw(manifest, { width: 640, height: 400 }).then((url) => {
    thumb = url;
    if (url) {
      img.src = url;
      frame.classList.add('ready');
    }
  });
  shell.body.appendChild(el('p', 'office-desc', 'Visitors will see this office with a demo crew. They never see your work, files or project names.'));

  const username = signedInUsername();
  const status = statusLine();
  if (summary.source.kind === 'installed') {
    shell.body.appendChild(el('p', 'msg-line why', 'Installed offices cannot be published. Only offices you made can.'));
    shell.body.appendChild(actionsRow(button('Close', 'btn small', shell.close)));
    return;
  }
  if (!username) {
    shell.body.appendChild(el('p', 'msg-line why', 'Set a username first. It is shown as the creator.'));
    shell.body.appendChild(actionsRow(
      button('Close', 'btn small ghost', shell.close),
      button('Set a username', 'btn small primary', () => {
        shell.close();
        window.dispatchEvent(new CustomEvent('open-profile-settings'));
      }),
    ));
    return;
  }
  shell.body.appendChild(el('p', null, `Published as @${username}`));

  const showPrompt = el('label', 'office-check');
  const box = el('input');
  box.type = 'checkbox';
  box.disabled = !brief?.prompt;
  showPrompt.append(box, el('span', null, 'Show the prompt on the office page'));
  shell.body.appendChild(showPrompt);

  const go = button('Publish', 'btn small primary');
  go.addEventListener('click', async () => {
    go.disabled = true;
    // A disabled button drops focus to the page, and then Esc would also close the Settings behind this dialog.
    cancel.focus();
    say(status, 'Publishing…');
    try {
      const png = thumb ?? (await draw(manifest, { width: 640, height: 400 }));
      const base = png ? pngBase64(png) : null;
      if (!base) throw new Error('Could not draw the picture for the listing.');
      const result = await publishOffice({
        localId: id,
        manifest,
        thumbnail: base,
        prompt: box.checked && brief?.prompt ? brief.prompt : null,
      });
      await api.markOfficePublished(id, result.listingId);
      await refreshListings();
      say(status, publishNote(result), result.status === 'rejected');
      go.textContent = 'Done';
      go.disabled = result.status !== 'rejected' ? true : false;
      if (result.status === 'rejected') {
        go.textContent = 'Publish again';
        go.focus();
      } else cancel.textContent = 'Close';
    } catch (err) {
      say(status, messageOf(err), true);
      go.disabled = false;

      go.focus();
    }
  });
  const cancel = button('Cancel', 'btn small ghost', shell.close);
  shell.body.append(status, actionsRow(cancel, go));
  go.focus();
  void store;
}

/* ---------- install ---------- */

export async function installFromListing(store: Store, listingId: string, known?: ListingDetail): Promise<void> {
  // A link opened at startup can arrive before the first snapshot has listed the offices, so ask the server.
  const saved = await api.offices().then((r) => r.offices, () => store.state.offices);
  const already = installedFrom(saved, listingId);
  if (already) {
    useOffice(store, already.id);
    showToast(`“${already.name}” is already installed. Switched to it.`, 'info');
    return;
  }
  let detail: ListingDetail | null | undefined = known;
  try {
    detail ??= await getPublicOffice(listingId);
  } catch (err) {
    return showToast(messageOf(err), 'error');
  }
  if (!detail) return showToast('That office is not on the showcase any more.', 'error');
  const d = detail;
  const pic = thumbImg(d.thumbnail_url, 'office-preview-img');
  pic.alt = `Preview of ${d.name}`;
  const ok = await confirmDialog({
    title: `Install “${d.name}” by @${d.creator_username}?`,
    lines: [pic, 'It is saved on this Mac as a picture and a list of parts. Nothing in it runs.'],
    confirm: 'Install',
  });
  if (!ok) return;
  try {
    const { summary } = await api.installOffice({ listingId: d.id, creator: d.creator_username, manifest: d.manifest });
    void recordInstall(d.id);
    useOffice(store, summary.id);
    showToast(`Installed “${summary.name}”. Your office looks different now.`, 'done');
  } catch (err) {
    showToast(messageOf(err), 'error');
  }
}

/* ---------- showcase ---------- */

export function openShowcase(store: Store, initial: GallerySort = 'trending'): void {
  const shell = openShell('Showcase', { wide: true });
  let sort: GallerySort = initial;
  let tag: string | null = null;
  let page = 0;
  let loading = false;

  const bar = el('div', 'office-bar');
  const tabs = el('div', 'office-chips');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Sort');
  const tabButtons = GALLERY_SORTS.map((s) => {
    const b = button(s[0]!.toUpperCase() + s.slice(1), 'btn small office-chip', () => {
      sort = s;
      load(true);
    });
    tabs.appendChild(b);
    return [s, b] as const;
  });
  const tagForm = el('form', 'office-tag-form');
  const tagInput = el('input', 'ask-repo');
  tagInput.type = 'search';
  tagInput.placeholder = 'Filter by tag';
  tagInput.setAttribute('aria-label', 'Filter by tag');
  tagForm.appendChild(searchClear(tagInput));
  // Typing waits for Enter, but clearing the box drops the filter straight away.
  tagInput.addEventListener('input', () => {
    if (tagInput.value || tag === null) return;
    tag = null;
    load(true);
  });
  tagForm.addEventListener('submit', (e) => {
    e.preventDefault();
    tag = normalizeTag(tagInput.value);
    load(true);
  });
  bar.append(tabs, tagForm);
  const grid = el('div', 'office-gallery');
  const status = statusLine();
  const more = button('Load more', 'btn small', () => load(false));
  more.hidden = true;
  shell.body.append(bar, grid, status, more);

  const card = (row: ListingRow): HTMLElement => {
    const c = el('article', 'gallery-card');
    c.appendChild(thumbImg(row.thumbnail_url, 'room-pic'));
    const info = el('div', 'gallery-info');
    info.appendChild(el('b', null, row.name));
    info.appendChild(creatorLine(row.creator_username, row.creator_avatar_url, row.featured ? ' · Featured' : ''));
    if (row.description) info.appendChild(el('span', 'm gallery-desc', row.description));
    c.appendChild(info);
    const acts = el('div', 'gen-actions');
    acts.appendChild(button('Preview', 'btn small', () => void openListingPreview(store, row.id)));
    acts.appendChild(button('Install', 'btn small primary', () => void installFromListing(store, row.id)));
    c.appendChild(acts);
    return c;
  };

  const load = (reset: boolean): void => {
    if (loading) return;
    if (reset) {
      page = 0;
      clear(grid);
    }
    tabButtons.forEach(([s, b]) => {
      b.setAttribute('aria-pressed', String(s === sort));
      b.classList.toggle('primary', s === sort);
    });
    loading = true;
    more.hidden = true;
    say(status, 'Loading…');
    listPublicOffices({ sort, tag, page })
      .then((rows) => {
        rows.forEach((r) => grid.appendChild(card(r)));
        page += 1;
        more.hidden = rows.length < 24;
        say(status, grid.childElementCount ? '' : tag ? `No offices tagged “${tag}” yet.` : 'No public offices yet. Be the first to publish one.');
      })
      .catch((err) => say(status, messageOf(err), true))
      .finally(() => (loading = false));
  };
  load(true);
  tagInput.focus();
}

async function openListingPreview(store: Store, id: string): Promise<void> {
  let detail: ListingDetail | null;
  try {
    detail = await getPublicOffice(id);
  } catch (err) {
    return showToast(messageOf(err), 'error');
  }
  if (!detail) return showToast('That office is not on the showcase any more.', 'error');
  const d = detail;
  const shell = openShell(d.name);
  shell.body.appendChild(previewBody(d.manifest, d.description, d.tags, creatorLine(d.creator_username, d.creator_avatar_url, '', 'm')));
  if (d.prompt) {
    const p = el('p', 'office-prompt');
    p.append(el('b', null, 'Prompt: '), document.createTextNode(d.prompt));
    shell.body.appendChild(p);
  }
  const status = statusLine();
  const report = button('Report', 'btn small ghost', () => {
    const form = el('form', 'office-edit');
    const input = el('input', 'ask-repo');
    input.type = 'text';
    input.maxLength = 300;
    input.placeholder = 'What is wrong with it?';
    input.setAttribute('aria-label', 'Reason for the report');
    const send = button('Send report', 'btn small danger');
    send.type = 'submit';
    form.append(input, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = input.value.trim();
      if (!reason) return say(status, 'Say what is wrong first.', true);
      send.disabled = true;
      try {
        await reportOffice(d.id, reason);
        form.remove();
        say(status, 'Thanks. We will take a look.');
      } catch (err) {
        say(status, messageOf(err), true);
        send.disabled = false;
      }
    });
    report.replaceWith(form);
    input.focus();
  });
  shell.body.append(status, actionsRow(report, button('Install', 'btn small primary', () => {
    shell.close();
    void installFromListing(store, d.id, d);
  })));
}

/* ---------- finished generations: take the picture, say so ---------- */

const desktopBridge = (): { onOfficeLink?: (listener: (listingId: string) => void) => void } | undefined =>
  (window as unknown as { desktop?: { onOfficeLink?: (listener: (listingId: string) => void) => void } }).desktop;

/** Wires the finished-generation watcher and the office deep links. Call once at startup. */
export function mountOffices(store: Store): void {
  // The building cards' clocks, without redrawing the cards.
  window.setInterval(() => {
    for (const n of document.querySelectorAll<HTMLElement>('.gen-card [data-since]')) {
      n.textContent = buildClock(n.dataset.since!, Date.now());
    }
  }, 1000);
  const handled = new Set<string>();
  const finished = finishedWatcher();
  let chain: Promise<void> = Promise.resolve();

  const capture = (id: string): void => {
    chain = chain.then(async () => {
      try {
        const record = await api.office(id);
        const url = await draw(record.manifest);
        if (url) await api.saveOfficeThumbnail(id, url);
      } catch {
        handled.delete(id);
      }
    });
  };

  store.subscribe((state) => {
    const offices = state.offices ?? [];
    const generations = state.generations ?? [];
    for (const gen of finished({ officesLoaded: state.officesLoaded, generations })) {
      if (!gen.resultId) continue;
      const id = gen.resultId;
      handled.add(id);
      capture(id);
      const name = offices.find((o) => o.id === id)?.name ?? 'Your office';
      showToast(`“${name}” is ready.`, 'done', { label: 'Preview', run: () => void openPreview(store, id) });
    }
    for (const o of needsThumbnail(offices, handled)) {
      handled.add(o.id);
      capture(o.id);
    }
  });

  try {
    desktopBridge()?.onOfficeLink?.((listingId) => void installFromListing(store, listingId));
  } catch {
    // An older desktop shell without the bridge: links just do not open here.
  }

  const linked = officeIdFromSearch(window.location.search);
  if (linked) {
    const url = new URL(window.location.href);
    url.searchParams.delete('office');
    window.history.replaceState(null, '', url);
    void installFromListing(store, linked);
  }
  void refreshListings();
  // A listing in review is approved or rejected by someone else, so look again now and then until none is waiting.
  window.setInterval(() => {
    if ([...listingStatuses.values()].includes('pending')) void refreshListings();
  }, LISTING_POLL_MS);
}
