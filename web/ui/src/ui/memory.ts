/**
 * The Memory tab in Settings: the lessons Office Memory keeps for a repo, to
 * read, search, add to, correct, delete and export. Opens from its tab, or
 * from the book beside a worker's name, which picks that worker's repo.
 */

import { displayKey, type Memory, type MemoryInput, type MemoryKind, type RepoChoice } from '@shared';
import type { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { $, ACTION_ICONS, actionIcon, ago, clear, el, searchClear } from './dom.js';

export const MEMORY_KINDS: ReadonlyArray<{ value: MemoryKind; label: string }> = [
  { value: 'convention', label: 'Convention' },
  { value: 'gotcha', label: 'Gotcha' },
  { value: 'correction', label: 'Correction' },
  { value: 'review', label: 'Review' },
  { value: 'approval', label: 'Approval' },
];

/** Typing pauses this long before a search goes out. */
export const SEARCH_DEBOUNCE_MS = 250;

/** The search to run for what is in the box, or null to list everything. */
export function memoryQuery(text: string): string | null {
  const query = text.trim();
  return query ? query : null;
}

/** The repo the tab opens on: the one asked for, the open worker's, then the default. */
export function defaultMemoryRepo(asked: string | null, selectedRepo: string | null, repos: RepoChoice[]): string | null {
  return asked ?? selectedRepo ?? repos.find((r) => r.isDefault)?.path ?? repos[0]?.path ?? null;
}

/** Files typed into the form, one per comma or line. */
export function parseFiles(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((f) => f.trim()).filter(Boolean))];
}

/** The last part of a repo path, which is how it is named everywhere else. */
export function repoName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

export function exportFileName(repo: string): string {
  return `${repoName(repo)}-memories.md`;
}

/** Where a lesson came from, in words. */
export function memorySource(m: Pick<Memory, 'source' | 'workerName' | 'ticketKey' | 'reviewer'>): string {
  if (m.source === 'user') return 'Added by you';
  if (m.source === 'review') return m.reviewer ? `From ${m.reviewer}'s review` : 'From a PR review';
  const who = `Saved by ${m.workerName ?? 'a worker'}`;
  return m.ticketKey ? `${who} on ${displayKey(m.ticketKey)}` : who;
}

export function memorySaved(
  m: Pick<Memory, 'source' | 'workerName' | 'ticketKey' | 'reviewer' | 'createdAt'>,
  since: (iso: string | null) => string = ago,
): string {
  return `${memorySource(m)}, ${since(m.createdAt)}`;
}

/** How much a lesson has been used. */
export function memoryUsage(m: Pick<Memory, 'useCount' | 'lastUsedAt'>, since: (iso: string | null) => string = ago): string {
  if (m.useCount <= 0) return 'Not used yet';
  const times = m.useCount === 1 ? 'Used once' : `Used ${m.useCount} times`;
  return m.lastUsedAt ? `${times}, last ${since(m.lastUsedAt)}` : times;
}

export function kindLabel(kind: MemoryKind): string {
  return MEMORY_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

const ABOUT_DISMISSED_KEY = 'agent-corp.memory-about-dismissed';

type AboutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Whether the intro at the top of the tab was put away. Shown until it is. */
export function memoryAboutDismissed(storage: AboutStorage | null | undefined): boolean {
  try {
    return storage?.getItem(ABOUT_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setMemoryAboutDismissed(storage: AboutStorage | null | undefined, dismissed: boolean): void {
  try {
    if (dismissed) storage?.setItem(ABOUT_DISMISSED_KEY, 'true');
    else storage?.removeItem(ABOUT_DISMISSED_KEY);
  } catch {
    // Storage blocked
  }
}

/** localStorage, or null where reading it throws. */
function localStore(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export type MemoryApi = Pick<
  typeof api,
  'memories' | 'memorySearch' | 'memoryCreate' | 'memoryUpdate' | 'memoryDelete' | 'memoryExport' | 'memoriesSeen'
>;

export interface MemoryView {
  status: 'idle' | 'loading' | 'ready' | 'error';
  memories: Memory[];
  /** The search the list answers, or null for the whole list. */
  query: string | null;
  error: string | null;
}

/**
 * The panel's list and what can be done to it, without any DOM, so the
 * actions can be tested against a stubbed api.
 */
export class MemoryBook {
  view: MemoryView = { status: 'idle', memories: [], query: null, error: null };
  /** Bumped by each load, so an answer to an older search cannot land over a newer one. */
  private loads = 0;

  constructor(
    private readonly memoryApi: MemoryApi,
    private readonly onChange: () => void = () => {},
  ) {}

  async load(repo: string, text: string): Promise<void> {
    const ticket = ++this.loads;
    const query = memoryQuery(text);
    this.update({ status: 'loading', query, error: null });
    try {
      const memories = query
        ? (await this.memoryApi.memorySearch(repo, query)).matches.map((m) => m.memory)
        : (await this.memoryApi.memories(repo)).memories;
      if (ticket !== this.loads) return;
      this.update({ status: 'ready', memories, error: null });
      // The badges stay up for this visit and are gone the next. If this
      // fails they just show again.
      const unseen = memories.filter((m) => m.unseenByUser).map((m) => m.id);
      if (unseen.length) this.memoryApi.memoriesSeen(unseen).catch(() => {});
    } catch (err) {
      if (ticket !== this.loads) return;
      this.update({ status: 'error', memories: [], error: (err as Error).message });
    }
  }

  /** Adds a lesson, or saves changes to one when `id` is given. Throws for the form to show. */
  async save(repo: string, id: number | null, input: MemoryInput): Promise<Memory> {
    const { memory } = id === null
      ? await this.memoryApi.memoryCreate(repo, input)
      : await this.memoryApi.memoryUpdate(id, input);
    const memories = id === null
      ? [memory, ...this.view.memories.filter((m) => m.id !== memory.id)]
      : this.view.memories.map((m) => (m.id === memory.id ? memory : m));
    this.update({ memories, status: 'ready' });
    return memory;
  }

  /** Throws for the card to show. */
  async remove(id: number): Promise<void> {
    await this.memoryApi.memoryDelete(id);
    this.update({ memories: this.view.memories.filter((m) => m.id !== id) });
  }

  exportFile(repo: string): Promise<Blob> {
    return this.memoryApi.memoryExport(repo);
  }

  private update(patch: Partial<MemoryView>): void {
    this.view = { ...this.view, ...patch };
    this.onChange();
  }
}

/** Mounts the Memory tab's view inside Settings. */
export function mountMemoryPanel(store: Store, memoryApi: MemoryApi): void {
  const panel = $<HTMLElement>('memoryView');
  const list = $<HTMLElement>('memoryList');
  const sub = $<HTMLElement>('memorySub');
  const repoPick = $<HTMLSelectElement>('memoryRepo');
  const search = $<HTMLInputElement>('memorySearch');
  const addBtn = $<HTMLButtonElement>('memoryAdd');
  const exportBtn = $<HTMLButtonElement>('memoryExport');
  const status = $<HTMLElement>('memoryStatus');
  const about = $<HTMLElement>('memoryAbout');
  const aboutHide = $<HTMLButtonElement>('memoryAboutHide');
  const aboutShow = $<HTMLButtonElement>('memoryAboutShow');

  const showAbout = (shown: boolean): void => {
    about.hidden = !shown;
    aboutShow.hidden = shown;
  };
  showAbout(!memoryAboutDismissed(localStore()));
  aboutHide.addEventListener('click', () => {
    setMemoryAboutDismissed(localStore(), true);
    showAbout(false);
    aboutShow.focus();
  });
  aboutShow.addEventListener('click', () => {
    setMemoryAboutDismissed(localStore(), false);
    showAbout(true);
    about.focus();
  });

  let repo: string | null = null;
  let asked: string | null = null;
  let wasOpen = false;
  let reposDrawn: RepoChoice[] | null = null;
  /** The lesson being edited, 'new' for the add form, or null. */
  let editing: number | 'new' | null = null;
  let confirming: number | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const book = new MemoryBook(memoryApi, () => draw());

  const load = (): void => {
    editing = null;
    confirming = null;
    status.textContent = '';
    if (repo) void book.load(repo, search.value);
    else draw();
  };

  const choose = (next: string | null): void => {
    repo = next;
    drawRepos(store.state.repos);
    load();
  };

  repoPick.addEventListener('change', () => choose(repoPick.value || null));
  search.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(load, SEARCH_DEBOUNCE_MS);
  });
  searchClear(search);
  addBtn.addEventListener('click', () => {
    editing = 'new';
    confirming = null;
    draw();
  });
  exportBtn.addEventListener('click', async () => {
    if (!repo) return;
    exportBtn.disabled = true;
    status.textContent = 'Exporting…';
    try {
      const url = URL.createObjectURL(await book.exportFile(repo));
      const link = el('a');
      link.href = url;
      link.download = exportFileName(repo);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `Exported ${exportFileName(repo)}.`;
    } catch (err) {
      status.textContent = `Could not export: ${(err as Error).message}`;
    } finally {
      exportBtn.disabled = false;
    }
  });

  /** The repos to pick from, with the open one kept even when it is not a known repo. */
  function drawRepos(repos: RepoChoice[]): void {
    reposDrawn = repos;
    clear(repoPick);
    const choices = repos.map((r) => ({ path: r.path, name: r.name }));
    if (repo && !choices.some((c) => c.path === repo)) choices.unshift({ path: repo, name: repoName(repo) });
    if (!choices.length) {
      repoPick.appendChild(el('option', null, 'No repos yet'));
      repoPick.disabled = true;
      return;
    }
    repoPick.disabled = false;
    for (const c of choices) {
      const option = el('option', null, c.name);
      option.value = c.path;
      option.title = c.path;
      repoPick.appendChild(option);
    }
    repoPick.value = repo ?? '';
  }

  store.subscribe((state) => {
    const open = state.settingsOpen && state.memoryOpen;
    panel.hidden = !open;
    if (!open) {
      wasOpen = false;
      return;
    }
    const opening = !wasOpen;
    wasOpen = true;
    if (opening || state.memoryRepo !== asked) {
      asked = state.memoryRepo;
      const selected = store.selectedAgent();
      const next = defaultMemoryRepo(asked, selected && !selected.builtInPam ? selected.repoPath : null, state.repos);
      if (opening || next !== repo) {
        choose(next);
        return;
      }
    }
    if (state.repos !== reposDrawn) {
      // The repos arrive after the first paint, so a panel opened before then
      // picks one now.
      if (!repo) choose(defaultMemoryRepo(null, null, state.repos));
      else drawRepos(state.repos);
    }
  });

  function draw(): void {
    if (panel.hidden) return;
    const { view } = book;
    const name = repo ? repoName(repo) : null;
    addBtn.disabled = !repo;
    exportBtn.disabled = !repo || view.status !== 'ready' || (!view.memories.length && !view.query);
    search.disabled = !repo;
    list.setAttribute('aria-busy', String(view.status === 'loading'));
    sub.textContent = !name
      ? 'Lessons workers learn, kept per repo'
      : view.status === 'ready'
        ? view.query
          ? `${view.memories.length} matching in ${name}`
          : `${view.memories.length} ${view.memories.length === 1 ? 'lesson' : 'lessons'} in ${name}`
        : `Lessons for ${name}`;

    clear(list);
    if (editing === 'new' && repo) list.appendChild(form(null));

    if (!repo) {
      list.appendChild(el('div', 'empty', 'Add a repo in the Workspace tab, and its lessons will be kept here.'));
      return;
    }
    if (view.status === 'loading' || view.status === 'idle') {
      const loading = el('div', 'empty memory-loading');
      loading.append(el('span', 'spinner'), document.createTextNode(' Loading memories…'));
      list.appendChild(loading);
      return;
    }
    if (view.status === 'error') {
      const box = el('div', 'ticket memory-error');
      box.setAttribute('role', 'alert');
      box.appendChild(el('span', 't', `Could not load memories: ${view.error ?? 'unknown error'}`));
      const retry = el('button', 'btn small', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', load);
      box.appendChild(retry);
      list.appendChild(box);
      return;
    }
    if (!view.memories.length) {
      if (editing !== 'new') {
        list.appendChild(el('div', 'empty', view.query
          ? `No lessons match “${view.query}”.`
          : `No lessons for ${name} yet. Workers save them as they go, or add one yourself.`));
      }
      return;
    }
    for (const m of view.memories) list.appendChild(editing === m.id ? form(m) : card(m));
  }

  function card(m: Memory): HTMLElement {
    const node = el('article', `ticket memory-card${m.stale ? ' stale' : ''}`);
    node.setAttribute('aria-label', `${kindLabel(m.kind)} lesson`);
    const body = el('div', 'memory-body');
    node.appendChild(body);
    const head = el('div', 'memory-tags');
    head.appendChild(el('span', `memory-kind kind-${m.kind}`, kindLabel(m.kind)));
    if (m.unseenByUser) head.appendChild(el('span', 'memory-new', 'New'));
    if (m.stale) head.appendChild(el('span', 'memory-stale', 'Unused for a while'));
    body.appendChild(head);
    body.appendChild(el('p', 't memory-lesson', m.lesson));

    if (m.files.length) {
      const files = el('ul', 'memory-files');
      files.setAttribute('aria-label', 'Related files');
      for (const f of m.files) files.appendChild(el('li', 'mono', f));
      body.appendChild(files);
    }
    const meta = el('div', 'm memory-meta');
    const saved = el('span', null, memorySaved(m));
    saved.title = new Date(m.createdAt).toLocaleString();
    meta.append(saved, el('span', null, memoryUsage(m)));
    if (m.threadUrl) {
      const link = el('a', null, 'Review thread');
      link.href = m.threadUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      meta.appendChild(link);
    }
    body.appendChild(meta);

    const actions = el('div', 'memory-row-actions');
    if (confirming === m.id) {
      const confirm = el('div', 'memory-confirm');
      confirm.setAttribute('role', 'group');
      confirm.setAttribute('aria-label', 'Confirm delete');
      confirm.appendChild(el('span', 'memory-confirm-text', 'Delete this lesson? Workers will no longer be briefed with it.'));
      const error = el('span', 'why');
      const keep = el('button', 'btn small ghost', 'Keep');
      keep.type = 'button';
      keep.addEventListener('click', () => {
        confirming = null;
        draw();
      });
      const del = el('button', 'btn small danger filled', 'Delete');
      del.type = 'button';
      del.addEventListener('click', async () => {
        del.disabled = keep.disabled = true;
        del.textContent = 'Deleting…';
        try {
          await book.remove(m.id);
          confirming = null;
          status.textContent = 'Lesson deleted.';
          draw();
        } catch (err) {
          error.textContent = `Could not delete: ${(err as Error).message}`;
          del.disabled = keep.disabled = false;
          del.textContent = 'Delete';
        }
      });
      const row = el('div', 'actions');
      row.append(keep, del);
      confirm.append(row, error);
      body.appendChild(confirm);
      queueMicrotask(() => keep.focus());
      return node;
    }
    const edit = actionIcon('Edit lesson', ACTION_ICONS.edit);
    edit.addEventListener('click', () => {
      editing = m.id;
      confirming = null;
      draw();
    });
    const del = actionIcon('Delete lesson', ACTION_ICONS.delete);
    del.addEventListener('click', () => {
      confirming = m.id;
      editing = null;
      draw();
    });
    actions.append(edit, del);
    node.appendChild(actions);
    return node;
  }

  /** The add form, or the edit form for `m`. */
  function form(m: Memory | null): HTMLElement {
    const node = el('form', 'ticket memory-form');
    node.setAttribute('aria-label', m ? 'Edit lesson' : 'Add a lesson');
    const id = m ? `m${m.id}` : 'new';

    const lessonLabel = el('label', 'setup-label', 'Lesson');
    lessonLabel.htmlFor = `memoryLesson-${id}`;
    const lesson = el('textarea', 'ask-input');
    lesson.id = `memoryLesson-${id}`;
    lesson.rows = 3;
    lesson.maxLength = 2000;
    lesson.required = true;
    lesson.placeholder = 'What should workers in this repo know?';
    lesson.value = m?.lesson ?? '';

    const kindLabelEl = el('label', 'setup-label', 'Kind');
    kindLabelEl.htmlFor = `memoryKind-${id}`;
    const kind = el('select', 'dropdown');
    kind.id = `memoryKind-${id}`;
    for (const k of MEMORY_KINDS) {
      const option = el('option', null, k.label);
      option.value = k.value;
      kind.appendChild(option);
    }
    kind.value = m?.kind ?? 'convention';

    const filesLabel = el('label', 'setup-label', 'Related files');
    filesLabel.htmlFor = `memoryFiles-${id}`;
    const files = el('input', 'ask-path');
    files.id = `memoryFiles-${id}`;
    files.placeholder = 'src/api.ts, src/api.test.ts';
    files.value = m?.files.join(', ') ?? '';

    const error = el('span', 'why');
    error.setAttribute('role', 'alert');
    const cancel = el('button', 'btn small ghost', 'Cancel');
    cancel.type = 'button';
    const save = el('button', 'btn small primary', m ? 'Save' : 'Add lesson');
    save.type = 'submit';

    const stop = (): void => {
      editing = null;
      draw();
    };
    cancel.addEventListener('click', stop);
    // Esc leaves the form rather than closing Settings.
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      stop();
    });
    node.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = lesson.value.trim();
      if (!text) {
        error.textContent = 'Write the lesson first.';
        lesson.focus();
        return;
      }
      if (!repo) return;
      save.disabled = cancel.disabled = true;
      save.textContent = 'Saving…';
      error.textContent = '';
      try {
        await book.save(repo, m?.id ?? null, { lesson: text, kind: kind.value as MemoryKind, files: parseFiles(files.value) });
        editing = null;
        status.textContent = m ? 'Lesson saved.' : 'Lesson added.';
        draw();
      } catch (err) {
        error.textContent = `Could not save: ${(err as Error).message}`;
        save.disabled = cancel.disabled = false;
        save.textContent = m ? 'Save' : 'Add lesson';
      }
    });

    const meta = el('div', 'memory-form-row');
    const kindWrap = el('div', 'memory-field');
    kindWrap.append(kindLabelEl, kind);
    const filesWrap = el('div', 'memory-field grow');
    filesWrap.append(filesLabel, files);
    meta.append(kindWrap, filesWrap);
    const actions = el('div', 'actions memory-form-actions');
    actions.append(cancel, save);
    node.append(lessonLabel, lesson, meta, error, actions);
    queueMicrotask(() => lesson.focus());
    return node;
  }
}
