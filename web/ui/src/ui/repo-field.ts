import type { Agent, RepoChoice } from '@shared';
import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { clear, closeButton, el } from './dom.js';

/** A repo as Tom knows it: its folder's name, or the office's name for it. */
export function repoName(store: Store, path: string): string {
  return store.state.repos.find((r) => r.path === path)?.name ?? path.split('/').filter(Boolean).at(-1) ?? path;
}

/** A repo's name in a chip, with its path on hover. */
export function repoChip(store: Store, path: string): HTMLElement {
  const chip = el('span', 'idea-repo-chip');
  chip.title = path;
  chip.appendChild(el('span', 'idea-repo-name', repoName(store, path)));
  return chip;
}

export interface RepoField {
  node: HTMLElement;
  value: () => string[];
  reset: () => void;
  /** Draws it again when the repos, or the one it leaves out, have changed. */
  refresh: () => void;
}

/**
 * A list of repos: a chip for each, in order, and a menu of the office's
 * other repos to add one. Optional, so whoever does not know can leave it
 * empty. `except` is a repo it never offers or returns, such as the one a
 * worker already works in.
 */
export function repoField(
  store: Store,
  initial: readonly string[],
  opts: { label?: string; addLabel?: string; except?: () => string | null; onChange?: () => void } = {},
): RepoField {
  let chosen = [...initial];
  let offered = store.state.repos;
  let leftOut = opts.except?.() ?? null;
  const node = el('div', 'setup-field');
  node.appendChild(el('span', 'setup-label', opts.label ?? 'Related repos (optional)'));
  const row = el('div', 'idea-repo-row');
  node.appendChild(row);
  const menu = el('select', 'dropdown idea-repo-add');
  menu.setAttribute('aria-label', opts.addLabel ?? 'Add a related repo');

  const kept = (): string[] => chosen.filter((p) => p !== leftOut);
  const render = (): void => {
    clear(row);
    for (const path of kept()) {
      const chip = repoChip(store, path);
      const remove = closeButton('attach-remove', `Remove ${repoName(store, path)}`);
      remove.addEventListener('click', () => {
        chosen = chosen.filter((p) => p !== path);
        render();
        menu.focus();
        opts.onChange?.();
      });
      chip.appendChild(remove);
      row.appendChild(chip);
    }
    clear(menu);
    const left = store.state.repos.filter((r) => !chosen.includes(r.path) && r.path !== leftOut);
    const prompt = el('option', null, left.length ? (kept().length ? 'Add another repo' : 'Add a repo') : 'No other repos');
    prompt.value = '';
    menu.appendChild(prompt);
    for (const r of left) {
      const o = el('option', null, r.name);
      o.value = r.path;
      o.title = r.path;
      menu.appendChild(o);
    }
    menu.value = '';
    menu.disabled = !left.length;
    row.appendChild(menu);
  };
  menu.addEventListener('change', () => {
    if (!menu.value) return;
    chosen = [...chosen, menu.value];
    render();
    menu.focus();
    opts.onChange?.();
  });
  render();
  return {
    node,
    value: kept,
    reset: () => {
      chosen = [];
      render();
    },
    refresh: () => {
      const except = opts.except?.() ?? null;
      if (store.state.repos === offered && except === leftOut) return;
      offered = store.state.repos;
      leftOut = except;
      render();
    },
  };
}

/**
 * What is ticked in a repo picker. The first repo ticked is the one the
 * worker works in; the rest it reads beside it. "No repo" and "Another repo"
 * are ticked like the others but are not paths.
 */
export interface RepoPick {
  primary: string | null;
  extras: string[];
  none: boolean;
  other: boolean;
}

/** Sentinels for the "no repo" and "type a path" rows; a real path is never either. */
export const NO_REPO = '\u0000none';
export const OTHER_REPO = '\u0000other';

/** The pick after ticking or unticking one row. "No repo" and repos rule each other out. */
export function tickRepo(pick: RepoPick, path: string, checked: boolean): RepoPick {
  if (path === NO_REPO) return checked ? { primary: null, extras: [], none: true, other: false } : { ...pick, none: false };
  if (path === OTHER_REPO) return { ...pick, other: checked, none: checked ? false : pick.none };
  if (!checked) {
    if (pick.primary !== path) return { ...pick, extras: pick.extras.filter((p) => p !== path) };
    const [next = null, ...rest] = pick.extras;
    return { ...pick, primary: next, extras: rest };
  }
  if (pick.primary === path || pick.extras.includes(path)) return pick;
  return pick.primary
    ? { ...pick, extras: [...pick.extras, path], none: false }
    : { ...pick, primary: path, none: false };
}

/** What a picker starts with: the repo it was given, else the default, else the first. */
export function startingPick(repos: readonly RepoChoice[], selected: string | null, mustChoose: boolean): RepoPick {
  const primary = selected ?? (mustChoose ? null : (repos.find((r) => r.isDefault) ?? repos[0])?.path ?? null);
  return { primary, extras: [], none: false, other: false };
}

/** The repos a pick hires with. A path typed by hand becomes the one worked in. */
export function pickedRepos(pick: RepoPick, typed: string): { primary: string | null; extras: string[] } {
  if (pick.none) return { primary: null, extras: [] };
  const ticked = pick.primary ? [pick.primary, ...pick.extras] : [];
  const path = pick.other ? typed.trim() : '';
  if (!path) return { primary: ticked[0] ?? null, extras: ticked.slice(1) };
  return { primary: path, extras: ticked.filter((p) => p !== path) };
}

/**
 * The job a pick hires for: a repo to work in, research with none, or
 * nothing yet. Research only when "no repo" is ticked on purpose, so
 * unticking everything does not quietly hire a worker with no repo.
 */
export function hireKind(pick: RepoPick, primary: string | null): 'ask' | 'research' | null {
  if (primary) return 'ask';
  return pick.none ? 'research' : null;
}

/** What a picker holds: its ticks, and the path typed for "Another repo". */
export interface RepoPickerState {
  pick: RepoPick;
  typed: string;
}

export interface RepoMultiPicker {
  node: HTMLElement;
  value: () => { primary: string | null; extras: string[] };
  pick: () => RepoPick;
  /** What is ticked and typed, to start a redrawn card where this one left off. */
  saved: () => RepoPickerState;
  /** After a hire: keeps the repo worked in, or "no repo", and drops the rest. */
  reset: (kept: string | null) => void;
  refresh: () => void;
  /** Opens the list, for a hire that cannot go ahead without a repo. */
  open: () => void;
}

/**
 * Choosing where a worker will work, and what else it reads: one dropdown
 * with a checkbox per repo. The first ticked is the one it works in.
 *
 * Lists everything found on disk, but will also take a path that is not in
 * the list: refusing a checkout Tom plainly has, because it is absent from a
 * config file, is the kind of thing that makes a tool not worth opening.
 */
export function repoMultiPicker(
  store: Store,
  opts: { allowNone?: boolean; selected?: string | null; mustChoose?: boolean; initial?: RepoPickerState; onChange?: () => void } = {},
): RepoMultiPicker {
  const selected = opts.selected ?? null;
  const mustChoose = !!opts.mustChoose;
  const start = (): RepoPick => startingPick(store.state.repos, selected, mustChoose);
  // Until Tom ticks something, the default stands as the repos change.
  let touched = !!opts.initial;
  let pick = opts.initial?.pick ?? start();
  let listed: RepoChoice[] | null = null;

  const wrap = el('div', 'repo-pick');
  const anchor = el('div', 'repo-multi');
  wrap.appendChild(anchor);
  const button = el('button', 'dropdown ask-repo repo-multi-btn');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  anchor.appendChild(button);
  const pop = el('div', 'repo-multi-pop');
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', 'Repos to work in and read');
  pop.hidden = true;
  anchor.appendChild(pop);

  const path = el('input', 'ask-path');
  path.type = 'text';
  path.placeholder = '~/code/my-repo, owner/repo, or a GitHub link';
  path.hidden = true;
  path.setAttribute('aria-label', 'Path to a git repo');
  path.value = opts.initial?.typed ?? '';
  wrap.appendChild(path);

  const entries = (): Array<{ path: string; name: string }> => {
    const repos = store.state.repos;
    return [
      ...(selected && !repos.some((r) => r.path === selected) ? [{ path: selected, name: selected }] : []),
      ...repos.map((r) => ({ path: r.path, name: r.isDefault ? `${r.name} (default)` : r.name })),
    ];
  };
  const nameOf = (p: string): string => entries().find((e) => e.path === p)?.name ?? repoName(store, p);

  const summary = (): string => {
    if (pick.none) return 'No repo — reads anywhere, changes nothing';
    const { primary, extras } = pickedRepos(pick, path.value);
    if (!primary) return pick.other ? 'Another repo…' : 'Choose a repo…';
    const main = pick.other && path.value.trim() ? primary : nameOf(primary);
    return extras.length ? `${main} + ${extras.map((p) => repoName(store, p)).join(', ')}` : main;
  };

  const box = (key: string, text: string, checked: boolean, title?: string, main = false): HTMLElement => {
    const label = el('label', 'check');
    if (title) label.title = title;
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.dataset.repo = key;
    input.addEventListener('change', () => {
      touched = true;
      pick = tickRepo(pick, key, input.checked);
      render();
      // Not by selector: CSS reads the sentinels' NUL as another character.
      [...pop.querySelectorAll<HTMLInputElement>('input')].find((i) => i.dataset.repo === key)?.focus();
      if (key === OTHER_REPO && pick.other) path.focus();
      opts.onChange?.();
    });
    label.appendChild(input);
    label.appendChild(el('span', null, text));
    if (main) label.appendChild(el('span', 'repo-multi-main', 'works here'));
    return label;
  };

  const render = (): void => {
    button.textContent = summary();
    clear(pop);
    const now = pickedRepos(pick, path.value);
    const main = (p: string): boolean => p === now.primary && now.extras.length > 0;
    for (const e of entries()) pop.appendChild(box(e.path, e.name, e.path === pick.primary || pick.extras.includes(e.path), e.path, main(e.path)));
    if (opts.allowNone !== false) {
      // Said plainly: this worker can read around the machine, which the
      // repo-bound ones cannot.
      pop.appendChild(box(NO_REPO, 'No repo — reads anywhere, changes nothing', pick.none));
    }
    pop.appendChild(box(OTHER_REPO, 'Another repo…', pick.other, undefined, !!path.value.trim() && main(path.value.trim())));
    path.hidden = !pick.other;
  };

  const fill = (): void => {
    if (listed === store.state.repos) return;
    listed = store.state.repos;
    if (!touched) pick = start();
    else {
      // A repo that has gone from the list cannot stay ticked.
      const known = new Set(entries().map((e) => e.path));
      for (const p of [pick.primary, ...pick.extras]) if (p && !known.has(p)) pick = tickRepo(pick, p, false);
    }
    render();
  };

  // Listening only while open, as ticket cards are drawn again on every refresh.
  const outside = (e: PointerEvent): void => {
    if (!anchor.contains(e.target as Node)) setOpen(false);
  };
  const setOpen = (open: boolean, focus = false): void => {
    pop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) document.addEventListener('pointerdown', outside);
    else document.removeEventListener('pointerdown', outside);
    if (open && focus) pop.querySelector<HTMLInputElement>('input')?.focus();
  };
  button.addEventListener('click', () => setOpen(pop.hidden));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    setOpen(true, true);
  });
  pop.addEventListener('keydown', (e) => {
    const boxes = [...pop.querySelectorAll<HTMLInputElement>('input')];
    const at = boxes.indexOf(document.activeElement as HTMLInputElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      boxes[(at + (e.key === 'ArrowDown' ? 1 : boxes.length - 1)) % boxes.length]?.focus();
    }
  });
  // Tabbing out closes it too. No related target means focus went nowhere,
  // as when a tick redraws the list, so that keeps it open.
  anchor.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (to && !anchor.contains(to)) setOpen(false);
  });
  anchor.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pop.hidden) return;
    e.stopPropagation();
    setOpen(false);
    button.focus();
  });
  path.addEventListener('input', () => {
    render();
    opts.onChange?.();
  });
  fill();

  return {
    node: wrap,
    value: () => pickedRepos(pick, path.value),
    pick: () => pick,
    saved: () => ({ pick, typed: path.value }),
    reset: (kept) => {
      touched = !!kept || pick.none;
      pick = kept ? { primary: kept, extras: [], none: false, other: false } : pick.none ? pick : start();
      path.value = '';
      render();
    },
    refresh: fill,
    open: () => setOpen(true, true),
  };
}

/**
 * Changes the repos a worker reads, mid-chat: its own repo and the ones it
 * reads beside it. The conversation carries on; the server refuses once there
 * is a branch, and `blocked` says why it cannot happen right now.
 */
export function reposControl(agent: Agent, store: Store, blocked: string | null): HTMLElement {
  const wrap = el('div', 'setup repos-change');
  const field = el('label', 'setup-field');
  field.appendChild(el('span', 'setup-label', 'Repo'));
  const primary = el('select', 'dropdown');
  primary.setAttribute('aria-label', 'Repo to read');
  const listed = store.state.repos;
  // One it was hired on by path still shows, rather than reading as another.
  const options = [
    ...(agent.repoPath && !listed.some((r) => r.path === agent.repoPath) ? [{ path: agent.repoPath, name: repoName(store, agent.repoPath) }] : []),
    ...listed,
  ];
  for (const r of options) {
    const o = el('option', null, r.name);
    o.value = r.path;
    o.title = r.path;
    primary.appendChild(o);
  }
  // Only research can work with no repo; anything else would have nowhere to land.
  if (agent.kind === 'research' || !agent.repoPath) {
    const none = el('option', null, 'No repo');
    none.value = '';
    primary.appendChild(none);
  }
  primary.value = agent.repoPath ?? '';
  // A repo agent is the agent of its repo, so only what it reads beside it can change.
  primary.disabled = !!agent.personaRepo;
  field.appendChild(primary);
  wrap.appendChild(field);

  const before = (): string => JSON.stringify([agent.repoPath ?? '', agent.extraRepos ?? []]);
  const now = (): string => JSON.stringify([primary.value, also.value()]);
  const sync = (): void => {
    also.node.hidden = !primary.value;
    apply.disabled = !!blocked || now() === before();
  };
  const also = repoField(store, agent.extraRepos ?? [], { label: 'Also read', addLabel: 'Add a repo to read', except: () => primary.value || null, onChange: sync });
  wrap.appendChild(also.node);
  primary.addEventListener('change', () => {
    also.refresh();
    sync();
  });

  const apply = el('button', 'btn small', 'Change repos');
  apply.type = 'button';
  apply.title = blocked ?? 'The conversation carries on, reading the repos picked here';
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try {
      await api.setRepos(agent.id, {
        ...(primary.value !== (agent.repoPath ?? '') ? { primary: primary.value || null } : {}),
        extra: primary.value ? also.value() : [],
      });
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
      sync();
    }
  });
  wrap.appendChild(apply);
  if (blocked) wrap.appendChild(el('span', 'why', blocked));
  sync();
  // Keep clicks from selecting another worker.
  wrap.addEventListener('click', (e) => e.stopPropagation());
  return wrap;
}
