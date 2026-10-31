import {
  LOOK_CHOICES,
  NO_EFFORT_MODELS,
  PERMISSION_LEVELS,
  type Agent,
  type ModelMenu,
  type SetupChoice,
  type PermissionLevel,
  type WorkerLook,
  type WorkerSetup,
} from '@shared';
import { el } from './dom.js';

/**
 * The three dropdowns a worker's setup is chosen with: permission level,
 * model and effort. Shared by the hire cards, the Workers list and Settings,
 * so the same words mean the same thing everywhere.
 *
 * Effort is greyed out for a model that has none, rather than hidden, so the
 * layout does not jump when the model changes. `permission: false` leaves
 * the permission dropdown out, for a worker whose permission is not the user's to pick.
 */
export function setupControls(
  current: WorkerSetup,
  menu: ModelMenu,
  onChange: (setup: WorkerSetup) => void,
  opts: { permission?: boolean } = {},
): { node: HTMLElement; value: () => WorkerSetup } {
  const wrap = el('div', 'setup');

  const permission = select('Permission', PERMISSION_LEVELS, current.permission);
  const model = select('Model', menu.models, current.model);
  const effort = select('Effort', menu.efforts, current.effort);

  const value = (): WorkerSetup => {
    const m = model.input.value || null;
    return {
      permission: permission.input.value as PermissionLevel,
      model: m,
      effort: m && NO_EFFORT_MODELS.has(m) ? null : effort.input.value || null,
    };
  };
  const sync = (): void => {
    const m = model.input.value;
    effort.input.disabled = NO_EFFORT_MODELS.has(m);
    effort.input.title = effort.input.disabled ? 'This model has no effort setting' : '';
  };
  sync();

  for (const s of opts.permission === false ? [model, effort] : [permission, model, effort]) {
    s.input.addEventListener('change', () => {
      sync();
      onChange(value());
    });
    // Picking from a dropdown inside a clickable row should not click the row.
    s.node.addEventListener('click', (e) => e.stopPropagation());
    wrap.appendChild(s.node);
  }
  return { node: wrap, value };
}

/** Hair, hat, face and outfit: what a worker wears in the office. Saved on every change. */
export function lookControls(current: WorkerLook, onChange: (patch: Partial<WorkerLook>) => void): HTMLElement {
  const wrap = el('div', 'setup');
  const parts: Array<[keyof WorkerLook, string]> = [
    ['hair', 'Hair'],
    ['hairColor', 'Hair colour'],
    ['hat', 'Hat'],
    ['face', 'Face'],
    ['outfit', 'Outfit'],
    ['shirtColor', 'Shirt colour'],
  ];
  for (const [key, label] of parts) {
    const s = select<string | null>(label, LOOK_CHOICES[key], current[key]);
    // An empty option is "Automatic", which the look stores as null.
    s.input.addEventListener('change', () => onChange({ [key]: s.input.value || null } as Partial<WorkerLook>));
    s.node.addEventListener('click', (e) => e.stopPropagation());
    wrap.appendChild(s.node);
  }
  return wrap;
}

/** "Standard · Sonnet · High effort", for a row too small for the dropdowns. */
export function setupSummary(setup: WorkerSetup, menu: ModelMenu): string {
  const level = PERMISSION_LEVELS.find((p) => p.value === setup.permission)?.label ?? setup.permission;
  const model = setup.model ? (menu.models.find((m) => m.value === setup.model)?.label ?? setup.model) : 'Default model';
  const effort = setup.effort ? `${menu.efforts.find((e) => e.value === setup.effort)?.label ?? setup.effort} effort` : null;
  return [level, model, effort].filter(Boolean).join(' · ');
}

/**
 * A hire's setup, one labelled line each: permission, then the model it will
 * run on with the effort after it ("Opus 5.5 Medium"). A worker on Default
 * reads as the model and effort Default comes to, or what it means until the
 * agent says.
 */
export function setupLines(setup: WorkerSetup, menu: ModelMenu): Array<{ label: string; text: string }> {
  const level = PERMISSION_LEVELS.find((p) => p.value === setup.permission)?.label ?? setup.permission;
  const model = setup.model
    ? (menu.models.find((m) => m.value === setup.model)?.label ?? setup.model)
    : (defaultName(menu.models) ?? "The agent's recommended model");
  const effort = setup.model && NO_EFFORT_MODELS.has(setup.model)
    ? null
    : setup.effort
      ? (menu.efforts.find((e) => e.value === setup.effort)?.label ?? setup.effort)
      : defaultName(menu.efforts);
  return [{ label: 'Permission', text: level }, { label: 'Model', text: effort ? `${model} ${effort}` : model }];
}

/**
 * The office's model and effort lists, named the way this worker's own
 * session names them: "Opus 5.5" rather than "Opus", and "Default (Opus 5.5)"
 * once the session says what Default comes to. Until it has started, the
 * office's own names, and what it says Default comes to, are all there is.
 */
export function workerMenu(office: ModelMenu, own: ModelMenu | null | undefined): ModelMenu {
  // Effort names stay the office's, which already read as words ("Extra high").
  // Its Default only has a hint once the office has asked what it comes to;
  // the office's Default model always has one, which may only describe it.
  const name = (ours: SetupChoice[], theirs: SetupChoice[] = [], renamed: boolean): SetupChoice[] =>
    ours.map((c) => {
      if (c.value === null) {
        const to = defaultName(theirs) ?? (renamed ? null : c.hint);
        return to ? { ...c, label: `Default (${to})` } : c;
      }
      const label = renamed ? theirs.find((t) => t.value === c.value)?.label : null;
      return label ? { ...c, label } : c;
    });
  const menu = { models: name(office.models, own?.models, true), efforts: name(office.efforts, own?.efforts, false) };
  const same = (a: SetupChoice[], b: SetupChoice[]): boolean => a.every((c, i) => c === b[i]);
  return same(menu.models, office.models) && same(menu.efforts, office.efforts) ? office : menu;
}

/** What Default comes to, as the session's own menu says; null when it does not say. */
function defaultName(choices: SetupChoice[] | undefined): string | null {
  return choices?.find((c) => c.value === null)?.hint ?? null;
}

/**
 * "Model: Opus 5.5 (default) · Effort: Medium (default)", for the chat
 * header. What Default comes to is the session's word for it, else, for
 * effort, the office's from before any session started. Effort is left off
 * for a model that has none.
 */
export function setupLine(agent: Pick<Agent, 'chosenModel' | 'effort' | 'modelMenu'>, office: ModelMenu): string {
  const menu = workerMenu(office, agent.modelMenu);
  const pick = (choices: SetupChoice[], own: SetupChoice[] | undefined, ours: SetupChoice[] | undefined, chosen: string | null): string => {
    if (chosen) return choices.find((c) => c.value === chosen)?.label ?? chosen;
    const to = defaultName(own) ?? defaultName(ours);
    return to ? `${to} (default)` : 'Default';
  };
  const model = `Model: ${pick(menu.models, agent.modelMenu?.models, undefined, agent.chosenModel)}`;
  if (agent.chosenModel && NO_EFFORT_MODELS.has(agent.chosenModel)) return model;
  return `${model} · Effort: ${pick(menu.efforts, agent.modelMenu?.efforts, office.efforts, agent.effort)}`;
}

/**
 * Where a worker works, one labelled line each: its worktree, or the repos it
 * reads and the notes folder it writes in until it has one.
 */
export function placeLines(
  agent: Pick<Agent, 'builtInPam' | 'branch' | 'repoPath' | 'worktreePath' | 'kind' | 'extraRepos'>,
): Array<{ label: string; text: string }> {
  if (agent.builtInPam) return [{ label: 'Reception', text: 'never creates a worktree' }];
  if (agent.branch) return [{ label: 'Worktree', text: `${agent.branch} · ${agent.worktreePath}` }];
  const notes = { label: 'Notes', text: agent.worktreePath };
  if (!agent.repoPath) return [notes];
  const repo = `${agent.repoPath} (read only${agent.kind === 'research' ? '' : ', no worktree yet'})`;
  const also = (agent.extraRepos ?? []).map((path) => ({ label: 'Also', text: `${path} (read only)` }));
  return [{ label: 'Repo', text: repo }, ...also, notes];
}

/**
 * Whether a worker's repos can be changed from its panel: hidden once it has
 * a branch, since its worktree and PR come from its repo, and for the assistant and
 * reviewers. `blocked` says why it cannot be changed right now.
 */
export function reposChange(
  agent: Pick<Agent, 'builtInPam' | 'branch' | 'reviewingId' | 'status' | 'workPlan'>,
): { show: boolean; blocked: string | null } {
  if (agent.builtInPam || agent.branch || agent.reviewingId) return { show: false, blocked: null };
  if (agent.status === 'working' || agent.status === 'starting') return { show: true, blocked: 'Stop the turn first.' };
  if (agent.workPlan) return { show: true, blocked: 'Approve or decline the plan first, it was written for this repo.' };
  return { show: true, blocked: null };
}

export function slidersIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M2.5 4.5h11 M2.5 11.5h11 M5.5 2.5v4 M10.5 9.5v4');
  svg.appendChild(path);
  return svg;
}

function select<T extends string | null>(
  label: string,
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  current: T,
): { node: HTMLElement; input: HTMLSelectElement } {
  const node = el('label', 'setup-field');
  node.appendChild(el('span', 'setup-label', label));
  const input = el('select', 'dropdown');
  for (const o of options) {
    const opt = el('option', null, o.label);
    opt.value = o.value ?? '';
    if (o.hint) opt.title = o.hint;
    input.appendChild(opt);
  }
  // A model set by hand in config.json still shows, rather than reading as Default.
  if (current && !options.some((o) => o.value === current)) {
    const opt = el('option', null, current);
    opt.value = current;
    input.appendChild(opt);
  }
  input.value = current ?? '';
  node.appendChild(input);
  return { node, input };
}
