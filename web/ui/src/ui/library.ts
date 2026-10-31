/**
 * The Skills Library, shown as the Toolkit tab in Settings.
 *
 * The Skills, Agents and MCPs tabs, with the Sync button beside them; under
 * them a row picks the scope (the general ones, or one of the office's repos),
 * then the sync matrix, the agents, the MCP servers, or the open item.
 */

import type {
  GeneralAgentInfo,
  GeneralAgentToolInfo,
  McpServerInfo,
  McpServersInfo,
  McpSyncInfo,
  Persona,
  RepoAgentInfo,
  RepoAgentsInfo,
  RepoAgentsSyncInfo,
  RepoAgentToolInfo,
  SyncMatrixInfo,
  SkillsHealthInfo,
} from '@shared';
import {
  DEFAULT_LOOK,
  PERSONA_DESCRIPTION_MAX,
  PERSONA_NAME_MAX,
  SKILL_NAME_MAX,
  nearestModel,
  skillMatrixKey,
  skillNameProblem,
} from '@shared';
import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { ACTION_ICONS, actionIcon, clear, el, iconText, setRichText, TEXT_ICONS } from './dom.js';
import { personaPicture, showPortrait } from './personas.js';
import { lookControls, setupControls, setupSummary } from './setup.js';
import { openShareDialog, type ShareTarget } from './share.js';

/**
 * A form open in the main pane, holding what has been typed so a redraw
 * keeps it. Electron has no `prompt()`, so every question is asked here.
 */
type LibraryForm =
  | { kind: 'new'; name: string; description: string; instructions: string; error: string | null }
  /** Which of the repos the office found are in the library, by path. */
  | { kind: 'repos'; chosen: string[]; error: string | null }
  /** A persona being made or edited; `id` is empty for a new one. */
  | { kind: 'persona'; draft: Persona; error: string | null }
  | {
      kind: 'edit';
      skillKey: string;
      name: string;
      description: string;
      /** The SKILL.md instructions, null until they load. */
      instructions: string | null;
      error: string | null;
      focusName: boolean;
    };

/** State for the Library window. */
interface LibraryState {
  matrix: SyncMatrixInfo | null;
  health: SkillsHealthInfo | null;
  /** The repo picked in the scope row, or null for General skills. */
  selectedRepo: string | null;
  /** The open skill's sync matrix key, from `skillMatrixKey`. */
  selectedSkillKey: string | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  /** The open skill's SKILL.md instructions, fetched when it opens; `body` is null while loading. */
  instructions: { key: string; body: string | null; error: string | null } | null;
  form: LibraryForm | null;
  tab: LibraryTab;
  /** The picked repo's agents, fetched when the Agents tab shows it; `info` is null while loading. */
  agents: { repo: string; info: RepoAgentsInfo | null; error: string | null } | null;
  /** The agent opened with View. */
  selectedAgentId: string | null;
  /** The personas as general agents, fetched when General agents shows; `info` is null while loading. */
  general: { info: GeneralAgentInfo[] | null; error: string | null } | null;
  /** The persona whose Delete was pressed once, waiting for the second press. */
  confirmDelete: string | null;
  /** The servers of the picked scope, fetched when the MCPs tab shows it; `info` is null while loading. */
  mcp: { repo: string | null; info: McpServersInfo | null; error: string | null } | null;
  /** The server opened with Details, by key. */
  selectedMcpKey: string | null;
  /** What the last Sync found, or what Copy to mine did, until the scope changes. */
  note: string | null;
}

type LibraryTab = 'skills' | 'agents' | 'mcps';

const state: LibraryState = {
  matrix: null,
  health: null,
  selectedRepo: null,
  selectedSkillKey: null,
  loading: false,
  syncing: false,
  error: null,
  instructions: null,
  form: null,
  tab: 'agents',
  agents: null,
  selectedAgentId: null,
  general: null,
  confirmDelete: null,
  mcp: null,
  selectedMcpKey: null,
  note: null,
};

const LIBRARY_TABS: ReadonlyArray<{ id: LibraryTab; label: string; ready: boolean; soon?: string }> = [
  { id: 'agents', label: 'Agents', ready: true },
  { id: 'skills', label: 'Skills', ready: true },
  { id: 'mcps', label: 'MCPs', ready: true },
];

/** The skill, agent or server open in the current tab, if any. */
function openedItem(): string | null {
  return { skills: state.selectedSkillKey, agents: state.selectedAgentId, mcps: state.selectedMcpKey }[state.tab];
}

/** The office's store, set at mount, for the repo list the scope row and forms offer. */
let officeStore: Store | null = null;
/** Where the library is drawn: the Toolkit tab's body in Settings, while that tab is showing. */
let host: HTMLElement | null = null;

export function mountLibrary(store: Store): void {
  officeStore = store;
  let seenRepos = store.state.repos;
  store.subscribe((s) => {
    if (s.repos === seenRepos) return;
    seenRepos = s.repos;
    if (!state.loading) rerender();
  });
}

/** Draws the library into `into` and loads it afresh. Settings calls this when its Toolkit tab shows. */
export function showLibrary(into: HTMLElement): void {
  host = into;
  void load();
  if (officeStore && !officeStore.state.repos.length) void officeStore.loadRepos();
}

async function load(): Promise<void> {
  state.loading = true;
  state.error = null;
  state.general = null;
  state.mcp = null;
  rerender();

  try {
    const [matrix, health] = await Promise.all([
      api.skills(),
      api.skillsHealth(),
    ]);
    state.matrix = matrix;
    state.health = health;
  } catch (err) {
    state.error = (err as Error).message;
  } finally {
    state.loading = false;
    rerender();
  }
}

function render(body: HTMLElement, store: Store): void {
  clear(body);
  if (state.selectedRepo && !libraryRepos(store).some((r) => r.name === state.selectedRepo)) {
    state.selectedRepo = null;
  }

  const repos = libraryRepos(store);
  const main = el('div', 'library-main');
  main.appendChild(toolbar());
  if (!state.form && !openedItem()) main.appendChild(scopeBar(store, repos));

  const content = el('div', 'library-content');
  if (state.loading) {
    content.appendChild(el('div', 'empty', 'Loading…'));
  } else if (state.error) {
    content.appendChild(el('div', 'error-box', state.error));
  } else if (!state.matrix) {
    content.appendChild(el('div', 'empty', 'No data yet.'));
  } else if (state.form) {
    content.appendChild(formView(state.form));
  } else if (state.tab === 'agents') {
    if (state.note) content.appendChild(el('div', 'library-sync-note m', state.note));
    if (state.selectedRepo === null) content.appendChild(generalAgentsView(store));
    else content.appendChild(state.selectedAgentId ? agentDetail() : agentsView());
  } else if (state.tab === 'mcps') {
    if (state.note) content.appendChild(el('div', 'library-sync-note m', state.note));
    content.appendChild(state.selectedMcpKey ? mcpDetail() : mcpView());
  } else {
    if (state.note) content.appendChild(el('div', 'library-sync-note m', state.note));
    const healthBar = healthSection();
    if (healthBar) content.appendChild(healthBar);
    if (state.selectedSkillKey) {
      content.appendChild(skillDetail());
    } else {
      content.appendChild(syncMatrixView());
      if (state.selectedRepo === null && state.matrix.discovered.length) {
        content.appendChild(discoveredList());
      }
    }
  }
  main.appendChild(content);

  body.appendChild(main);
}

/** The repos added to the library, among those the office knows. */
function libraryRepos(store: Store): Store['state']['repos'] {
  const added = state.matrix?.libraryRepos ?? [];
  return store.state.repos.filter((r) => added.includes(r.path));
}

/**
 * The scope row under the tabs: the general ones (skills, or the personas as
 * agents), then the repos added to the library, then a way to add more.
 */
function scopeBar(store: Store, repos: Store['state']['repos']): HTMLElement {
  const bar = el('nav', 'library-scope-bar');
  bar.setAttribute('aria-label', 'Library scope');

  bar.appendChild({
    skills: () => scopeItem('General skills', null, 'Skills for every worker, in any repo or none'),
    agents: () => scopeItem('General agents', null, 'Your agents: hired in any repo, and helpers in every tool on this Mac'),
    mcps: () => scopeItem('General MCPs', null, "Servers from your tools' own settings, for workers in any repo"),
  }[state.tab]());
  if (repos.length) bar.appendChild(el('span', 'library-scope-divider'));
  if (!repos.length) bar.appendChild(el('span', 'library-scope-empty', 'No repos added yet.'));
  for (const repo of repos) bar.appendChild(scopeItem(repo.name, repo.name, repo.path));

  const add = el('button', 'btn small ghost library-add-repo', '+ Add repo');
  add.type = 'button';
  add.addEventListener('click', () => openReposForm(store));
  bar.appendChild(add);

  return bar;
}

function scopeItem(label: string, repo: string | null, title: string): HTMLButtonElement {
  const item = el('button', 'library-scope-item');
  item.type = 'button';
  item.title = title;
  if (state.selectedRepo === repo) item.setAttribute('aria-current', 'true');
  item.appendChild(el('span', 'library-scope-name', label));
  item.addEventListener('click', () => {
    state.selectedRepo = repo;
    state.selectedSkillKey = null;
    state.selectedAgentId = null;
    state.selectedMcpKey = null;
    state.note = null;
    state.form = null;
    rerender();
  });
  return item;
}

/** The names of the skills a worker loads before every task: the general ones marked Always, plus its repo's. */
function alwaysSkillsFor(repo: string | null): string[] {
  const names = new Set([...skillsIn(null), ...(repo ? skillsIn(repo) : [])].filter((s) => s.required).map((s) => s.id));
  return [...names].sort();
}

/** The skills shown for a scope: the general ones, or one repo's. */
function skillsIn(repo: string | null): SyncMatrixInfo['skills'] {
  const skills = state.matrix?.skills ?? [];
  return repo === null
    ? skills.filter((s) => s.scope === 'global')
    : skills.filter((s) => s.scope === 'repo' && s.repo === repo);
}

/** Opens the list of the repos the office found, the ones in the library ticked. */
function openReposForm(store: Store): void {
  state.form = { kind: 'repos', chosen: [...(state.matrix?.libraryRepos ?? [])], error: null };
  state.selectedSkillKey = null;
  rerender();
  // Look again, so a repo cloned since the office started is in the list.
  void store.loadRepos(true);
}

/**
 * The tabs (or Back while a skill or form is open), with Sync on the right for
 * a repo, and for the general MCP servers, which are read from the tools'
 * settings. General skills need no Sync: a skill is linked when it is added
 * or a tool is turned on, and the links follow its edits.
 */
function toolbar(): HTMLElement {
  const bar = el('div', 'library-toolbar');
  bar.appendChild(state.form || openedItem() ? backButton() : tabsRow());
  if (state.selectedRepo || state.tab === 'mcps') bar.appendChild(syncControls());
  return bar;
}

/** Closes the open form, back to the skill or list it was opened from. */
function closeForm(): void {
  state.form = null;
  rerender();
}

function backButton(): HTMLElement {
  const back = iconText(el('button', 'btn small ghost library-back'), TEXT_ICONS.prev, state.form ? 'Cancel' : 'Back to list');
  back.type = 'button';
  back.addEventListener('click', () => {
    if (state.form) {
      closeForm();
      return;
    }
    if (state.tab === 'agents') state.selectedAgentId = null;
    else if (state.tab === 'mcps') state.selectedMcpKey = null;
    else state.selectedSkillKey = null;
    rerender();
  });
  return back;
}

function tabsRow(): HTMLElement {
  const tabs = el('div', 'tabs library-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const tab of LIBRARY_TABS) {
    const button = el('button', 'tab', tab.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.tab));
    if (!tab.ready) {
      button.disabled = true;
      button.title = tab.soon ?? 'Coming soon';
    }
    button.addEventListener('click', () => {
      state.tab = tab.id;
      state.selectedAgentId = null;
      state.selectedMcpKey = null;
      state.note = null;
      rerender();
    });
    tabs.appendChild(button);
  }
  return tabs;
}

function syncControls(): HTMLElement {
  const sync = el('div', 'library-sync');
  if (state.matrix) {
    const info = el('span', 'library-sync-info');
    if (state.matrix.outOfDate) {
      const dot = el('span', 'library-out-of-date-dot');
      dot.title = 'Skills, agent files or MCP settings have changed since last sync';
      info.appendChild(dot);
    }
    info.appendChild(document.createTextNode(
      state.matrix.lastSyncedAt ? `Last synced ${formatTime(new Date(state.matrix.lastSyncedAt))}` : 'Never synced',
    ));
    sync.appendChild(info);
  }

  const syncBtn = el('button', 'btn small primary', state.syncing ? 'Syncing…' : 'Sync');
  syncBtn.type = 'button';
  syncBtn.disabled = state.syncing || state.loading;
  syncBtn.addEventListener('click', async () => {
    state.syncing = true;
    state.instructions = null;
    state.note = null;
    rerender();
    try {
      const { agents, mcp } = await api.skillsSync();
      const [matrix, health] = await Promise.all([
        api.skills(),
        api.skillsHealth(),
      ]);
      state.matrix = matrix;
      state.health = health;
      state.agents = null;
      state.general = null;
      state.mcp = null;
      const repo = agents.find((a) => a.name === state.selectedRepo);
      const servers = mcp.find((m) => m.name === state.selectedRepo);
      if (repo) state.note = syncLine(repo, skillsIn(repo.name).length, servers);
      else if (servers) state.note = `General: ${mcpCount(servers)}.`;
    } catch (err) {
      state.error = (err as Error).message;
    } finally {
      state.syncing = false;
      rerender();
    }
  });
  sync.appendChild(syncBtn);
  return sync;
}

/** "6 agents (1 new, 1 updated)": a count with what the Sync changed. */
function counted(n: { total: number; added: number; updated: number; removed: number }, noun: string): string {
  const changes = [
    n.added && `${n.added} new`,
    n.updated && `${n.updated} updated`,
    n.removed && `${n.removed} removed`,
  ].filter(Boolean);
  return `${n.total} ${noun}${n.total === 1 ? '' : 's'}${changes.length ? ` (${changes.join(', ')})` : ''}`;
}

function mcpCount(servers: McpSyncInfo): string {
  return counted(servers, 'MCP server');
}

/** "engage-commons: 6 agents (1 new, 1 updated), 3 skills, 2 MCP servers (1 new)." */
function syncLine(repo: RepoAgentsSyncInfo, skills: number, servers?: McpSyncInfo): string {
  const parts = [counted(repo, 'agent'), `${skills} skill${skills === 1 ? '' : 's'}`, ...(servers ? [mcpCount(servers)] : [])];
  return `${repo.name}: ${parts.join(', ')}.`;
}

/** The tools an agent is checked for, in the order of the skills table. */
const AGENT_TOOLS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'codex', name: 'Codex' },
  { id: 'copilot', name: 'Copilot' },
];

/** The agents folders Sync reads, in the order it reads them. */
const AGENT_DIRS = '.claude/agents, .cursor/agents, .codex/agents or .github/agents';

async function loadAgents(repo: string): Promise<void> {
  state.agents = { repo, info: null, error: null };
  try {
    const info = await api.repoAgents(repo);
    if (state.agents?.repo === repo) state.agents = { repo, info, error: null };
  } catch (err) {
    if (state.agents?.repo === repo) state.agents = { repo, info: null, error: (err as Error).message };
  }
  rerender();
}

/** The picked repo's agents, loading them the first time; null while they load. */
function agentsOf(repo: string): RepoAgentsInfo | null {
  if (state.agents?.repo !== repo) void loadAgents(repo);
  return state.agents?.repo === repo ? state.agents.info : null;
}

/** A repo's agents, with how each tool gets them and what to do with each. */
function agentsView(): HTMLElement {
  const container = el('div', 'library-matrix-container');
  const repo = state.selectedRepo!;
  const intro = el('div', 'library-intro');
  container.appendChild(intro);
  intro.append(
    el('b', 'library-section-title', `Agents in ${repo}`),
    el('p', 'm', `From ${repo}'s agents folders for Claude Code, Cursor, Codex and Copilot. The Hire panel lists them first for work in ${repo}, on any runner. They are read-only here: edit the files in the repo, then press Sync.`),
  );

  const info = agentsOf(repo);
  if (state.agents?.error) {
    container.appendChild(el('div', 'error-box', state.agents.error));
    return container;
  }
  if (!info) {
    container.appendChild(el('div', 'empty', 'Loading…'));
    return container;
  }
  if (!info.agents.length) {
    container.appendChild(el('div', 'empty library-empty', info.syncedAt
      ? `No agents in ${repo}'s ${AGENT_DIRS}.`
      : `Not synced yet. Press Sync to read ${repo}'s ${AGENT_DIRS}.`));
    return container;
  }

  const table = el('table', 'library-matrix');
  const head = el('tr');
  head.appendChild(el('th', null, 'Agent'));
  for (const tool of AGENT_TOOLS) head.appendChild(el('th', 'library-tool-col', tool.name));
  head.appendChild(el('th', null, ''));
  table.appendChild(el('thead')).appendChild(head);

  const tbody = el('tbody');
  for (const agent of info.agents) {
    const row = el('tr', agent.hidden ? 'library-agent-hidden' : null);
    const nameCell = el('td', 'library-skill-name');
    const link = el('button', 'library-skill-link', agent.title);
    link.type = 'button';
    link.title = agent.description;
    link.addEventListener('click', () => openAgent(agent.id));
    nameCell.appendChild(link);
    if (agent.updated) {
      const dot = el('span', 'library-out-of-date-dot');
      dot.title = 'New or changed in the last Sync';
      nameCell.appendChild(dot);
    }
    if (agent.hidden) nameCell.appendChild(el('span', 'library-badge', 'Hidden'));
    row.appendChild(nameCell);

    for (const tool of AGENT_TOOLS) {
      const cell = el('td', 'library-status-cell');
      const status = agent.tools.find((t) => t.toolId === tool.id);
      if (status) cell.append(...agentToolCell(tool.name, status));
      row.appendChild(cell);
    }

    const actions = el('td', 'library-actions-cell');
    actions.append(agentActions(repo, agent, true));
    row.appendChild(actions);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  const skipped = info.agents.flatMap((a) =>
    a.tools.filter((t) => t.skipped.length).map((t) => `${a.title}, ${AGENT_TOOLS.find((x) => x.id === t.toolId)?.name}: ${t.skipped.join('; ')}`),
  );
  if (skipped.length) {
    const box = el('div', 'library-agent-skipped');
    box.appendChild(el('b', null, 'Left out of the converted copies'));
    const list = el('ul', 'm');
    for (const line of skipped) list.appendChild(el('li', null, line));
    box.appendChild(list);
    container.appendChild(box);
  }

  const legend = el('div', 'library-legend m');
  legend.textContent = `Each tool reads its own folder, and Cursor reads Claude Code's too. An agent from one folder is converted for the tools that do not read it, on this Mac and ignored by git. When two folders have the same agent, the first of ${AGENT_DIRS} is used.`;
  container.appendChild(legend);
  return container;
}

/** A tool's cell for an agent: an icon and a word, with the detail on hover. */
function agentToolCell(toolName: string, status: RepoAgentToolInfo): HTMLElement[] {
  const label = { native: 'native', converted: 'converted', from_repo: 'in repo', not_synced: 'not synced' }[status.status];
  const icon = statusIcon({ native: 'linked', converted: 'copied', from_repo: 'from_repo', not_synced: 'missing' }[status.status]);
  const title = {
    native: `${toolName} reads ${status.file} itself`,
    converted: `Converted to ${status.file} on this Mac, ignored by git`,
    from_repo: `The repo has its own ${status.file}`,
    not_synced: `Press Sync to write ${status.file}`,
  }[status.status];
  const parts = [icon, el('span', 'm library-agent-tool', label)];
  if (status.skipped.length) {
    const warn = statusIcon('conflict');
    warn.title = `Left out: ${status.skipped.join('; ')}`;
    parts.push(warn);
  }
  for (const p of parts) if (!p.title) p.title = title;
  return parts;
}

/** View, Copy to mine, and Hide or Show for one agent. */
function agentActions(repo: string, agent: RepoAgentInfo, withView: boolean): HTMLElement {
  const box = el('div', 'library-agent-actions');
  if (withView) {
    const view = el('button', 'btn small ghost', 'View');
    view.type = 'button';
    view.addEventListener('click', () => openAgent(agent.id));
    box.appendChild(view);
  }
  const copy = el('button', 'btn small ghost', 'Copy to mine');
  copy.type = 'button';
  copy.title = 'Make an editable agent of your own from it, under General agents';
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try {
      const { persona } = await api.repoAgentCopy(repo, agent.id);
      state.general = null;
      state.note = `Copied ${agent.title} to your agents as ${persona.name}. Edit it under General agents.`;
    } catch (err) {
      state.note = (err as Error).message;
    }
    rerender();
  });
  box.appendChild(copy);
  const hide = el('button', 'btn small ghost', agent.hidden ? 'Show' : 'Hide');
  hide.type = 'button';
  hide.title = agent.hidden ? 'List it in the Hire panel again' : 'Leave it out of the Hire panel; the repo is not changed';
  hide.addEventListener('click', async () => {
    hide.disabled = true;
    try {
      await api.repoAgentHide(repo, agent.id, !agent.hidden);
    } catch (err) {
      state.note = (err as Error).message;
    }
    await loadAgents(repo);
  });
  box.appendChild(hide);
  return box;
}

function openAgent(id: string): void {
  state.selectedAgentId = id;
  rerender();
}

/** One agent's file, read-only, with the model it will run on here. */
function agentDetail(): HTMLElement {
  const repo = state.selectedRepo;
  const info = repo ? agentsOf(repo) : null;
  const agent = info?.agents.find((a) => a.id === state.selectedAgentId);
  if (!repo || !agent) {
    if (info) state.selectedAgentId = null;
    return el('div', 'empty', info ? 'That agent is no longer in the repo.' : 'Loading…');
  }
  const container = el('div', 'library-skill-detail');
  const header = el('div', 'library-skill-header');
  header.append(el('h2', null, agent.title), el('span', 'library-badge readonly', 'Read-only (from repo)'));
  container.appendChild(header);
  if (agent.description) container.appendChild(el('p', 'm', agent.description));

  const menu = officeStore?.state.health.modelMenu;
  const runsOn = menu ? nearestModel(agent.model, menu) : null;
  const runsOnLabel = menu?.models.find((m) => m.value === runsOn)?.label ?? 'the default';
  const meta = el('div', 'library-skill-info');
  meta.append(
    el('span', 'm', `File: ${agent.file}`),
    ...(agent.alsoIn.length ? [el('span', 'm', `Also in: ${agent.alsoIn.join(', ')} (not read, since ${agent.file} comes first)`)] : []),
    el('span', 'm', agent.model ? `Model: ${agent.model}, hired here on ${runsOnLabel}` : `Model: not set, hired here on ${runsOnLabel}`),
  );
  container.appendChild(meta);
  container.appendChild(agentActions(repo, agent, false));

  const file = el('div', 'library-skill-instructions');
  file.appendChild(el('b', null, agent.file));
  file.appendChild(el('pre', 'library-agent-file', agent.content));
  container.appendChild(file);
  return container;
}

/* ---------- MCP servers from Tom's tools ---------- */

async function loadMcp(repo: string | null): Promise<void> {
  state.mcp = { repo, info: null, error: null };
  try {
    const info = await api.mcpServers(repo);
    if (state.mcp?.repo === repo) state.mcp = { repo, info, error: null };
  } catch (err) {
    if (state.mcp?.repo === repo) state.mcp = { repo, info: null, error: (err as Error).message };
  }
  rerender();
}

/** The picked scope's servers, loading them the first time; null while they load. */
function mcpOf(repo: string | null): McpServersInfo | null {
  if (!state.mcp || state.mcp.repo !== repo) void loadMcp(repo);
  return state.mcp?.repo === repo ? state.mcp.info : null;
}

const MCP_KINDS: Record<McpServerInfo['kind'], { label: string; title: string }> = {
  local: { label: 'Local', title: 'The office starts it on this Mac from its command' },
  key: { label: 'Key in config', title: 'A remote server whose key is in the config' },
  signin: { label: 'Sign-in', title: 'A remote server signed in inside its tool, which keeps the sign-in' },
};

/** The tool a server's sign-in stays in, from "Claude Code (local)". */
function toolOf(server: McpServerInfo): string {
  return server.from.replace(/\s*\(.*\)$/, '');
}

/** On, and Ask first, for one server; saved at once. */
function mcpToggles(server: McpServerInfo): HTMLElement {
  const box = el('div', 'library-mcp-toggles');
  const toggle = (label: string, checked: boolean, title: string, patch: (on: boolean) => { on?: boolean; askFirst?: boolean }) => {
    const wrap = el('label', 'library-mcp-toggle');
    wrap.title = title;
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', `${label}: ${server.name}`);
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await api.mcpServerSet(server.key, patch(input.checked));
      } catch (err) {
        state.note = (err as Error).message;
      }
      await loadMcp(state.mcp?.repo ?? null);
    });
    wrap.append(input, document.createTextNode(` ${label}`));
    return wrap;
  };
  box.append(
    toggle('On', server.on, server.on ? 'Workers get it in their next session' : 'Give it to workers, from their next session', (on) => ({ on })),
    toggle('Ask first', server.askFirst, 'Every call from it waits for you, even in auto mode', (askFirst) => ({ askFirst })),
  );
  return box;
}

/** The servers of a scope: the general ones, or a repo's followed by the general ones that apply there. */
function mcpView(): HTMLElement {
  const container = el('div', 'library-matrix-container');
  const repo = state.selectedRepo;
  const intro = el('div', 'library-intro');
  intro.append(
    el('b', 'library-section-title', repo ? `MCPs in ${repo}` : 'General MCPs'),
    el('p', 'm', repo
      ? `Servers ${repo}'s own configs set up, for workers in ${repo} only, on every runner. They get the general ones that are on as well; a ${repo} server replaces a general one of the same name.`
      : "Servers set up in Claude Code, Codex, Cursor and Copilot's own settings. Turn one on to give it to every worker, on every runner. New servers start off, and nothing changes until you press Sync."),
  );
  container.appendChild(intro);

  const info = mcpOf(repo);
  if (state.mcp?.error) {
    container.appendChild(el('div', 'error-box', state.mcp.error));
    return container;
  }
  if (!info) {
    container.appendChild(el('div', 'empty', 'Loading…'));
    return container;
  }
  if (!info.servers.length) {
    container.appendChild(el('div', 'empty library-empty', info.syncedAt
      ? repo ? `No MCP servers in ${repo}'s own configs. Its workers get the general ones that are on.` : "No MCP servers in your tools' settings."
      : "Not synced yet. Press Sync to read your tools' MCP settings."));
    return container;
  }

  const table = el('table', 'library-matrix');
  const head = el('tr');
  for (const label of ['Server', 'From', 'Kind', '', '']) head.appendChild(el('th', null, label));
  table.appendChild(el('thead')).appendChild(head);

  const tbody = el('tbody');
  for (const server of info.servers) {
    const row = el('tr');
    const nameCell = el('td', 'library-skill-name');
    const link = el('button', 'library-skill-link', server.name);
    link.type = 'button';
    link.addEventListener('click', () => openMcp(server.key));
    nameCell.appendChild(link);
    if (server.updated) {
      const dot = el('span', 'library-out-of-date-dot');
      dot.title = 'New or changed in the last Sync';
      nameCell.appendChild(dot);
    }
    if (server.replacesGeneral) {
      const badge = el('span', 'library-badge readonly', 'replaces General');
      badge.title = `Workers in ${repo} get this one instead of the general ${server.name}`;
      nameCell.appendChild(badge);
    }
    if (server.note) nameCell.appendChild(el('span', 'library-badge readonly', server.note));
    if (server.error) nameCell.appendChild(el('div', 'library-mcp-error', `Did not start: ${server.error.message}`));
    row.appendChild(nameCell);

    const from = el('td', 'm', server.from);
    if (server.alsoIn.length) from.title = `Also in ${server.alsoIn.join(', ')}`;
    row.appendChild(from);
    const kind = el('td', 'm', MCP_KINDS[server.kind].label);
    kind.title = MCP_KINDS[server.kind].title;
    row.appendChild(kind);

    const toggles = el('td');
    if (server.kind === 'signin') toggles.appendChild(el('span', 'm', `Sign-in stays in ${toolOf(server)}`));
    else toggles.appendChild(mcpToggles(server));
    row.appendChild(toggles);

    const actions = el('td', 'library-actions-cell');
    const details = el('button', 'btn small ghost', 'Details');
    details.type = 'button';
    details.addEventListener('click', () => openMcp(server.key));
    actions.appendChild(details);
    row.appendChild(actions);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  const legend = el('div', 'library-legend m');
  legend.textContent = 'The office starts each server that is on for the workers that get it, on this Mac; settings and keys never leave it. A server that fails to start is left out of that session, and the worker goes on without it. Jira, Linear, GitHub and Figma are connected by the office itself, so they are not listed. Figma is set up under Settings, Workspace.';
  container.appendChild(legend);
  return container;
}

function openMcp(key: string): void {
  state.selectedMcpKey = key;
  rerender();
}

/** One server's config, secrets masked, with its toggles. */
function mcpDetail(): HTMLElement {
  const info = mcpOf(state.selectedRepo);
  const server = info?.servers.find((s) => s.key === state.selectedMcpKey);
  if (!server) {
    if (info) state.selectedMcpKey = null;
    return el('div', 'empty', info ? 'That server is no longer in your configs.' : 'Loading…');
  }
  const container = el('div', 'library-skill-detail');
  const header = el('div', 'library-skill-header');
  header.append(el('h2', null, server.name), el('span', 'library-badge readonly', MCP_KINDS[server.kind].label));
  container.appendChild(header);

  const meta = el('div', 'library-skill-info');
  meta.append(
    el('span', 'm', `From ${server.from}, in ${server.file}`),
    el('span', 'm', server.scope === 'repo' ? `For workers in ${server.repo}` : 'For workers in any repo'),
  );
  if (server.alsoIn.length) meta.appendChild(el('span', 'm', `Also set up in ${server.alsoIn.join(', ')}; this one is used.`));
  if (server.replacesGeneral) meta.appendChild(el('span', 'm', `${server.repo}'s workers get this instead of the general ${server.name}.`));
  if (server.note) meta.appendChild(el('span', 'm', server.note));
  container.appendChild(meta);

  if (server.kind === 'signin') {
    container.appendChild(el('p', 'm', `It signs in inside ${toolOf(server)}, which keeps the sign-in, so workers cannot share it.`));
  } else {
    container.appendChild(mcpToggles(server));
  }
  if (server.error) {
    container.appendChild(el('div', 'error-box', `Did not start ${new Date(server.error.at).toLocaleString()}: ${server.error.message}`));
  }

  const config = el('div', 'library-skill-instructions');
  config.appendChild(el('b', null, server.command ? 'Command' : 'URL'));
  config.appendChild(el('pre', 'library-agent-file', server.command ? [server.command, ...server.args].join(' ') : `${server.url} (${server.transport})`));
  const values = (title: string, list: McpServerInfo['env']) => {
    if (!list.length) return;
    config.appendChild(el('b', null, title));
    config.appendChild(el('pre', 'library-agent-file', list.map((v) => `${v.name}=${v.value}`).join('\n')));
  };
  values('Environment', server.env);
  values('Headers', server.headers);
  config.appendChild(el('span', 'm', 'Secret values are masked. Edit the server in its tool, then press Sync.'));
  container.appendChild(config);
  return container;
}

/* ---------- general agents: the personas ---------- */

async function loadGeneral(): Promise<void> {
  state.general = { info: null, error: null };
  try {
    state.general = { info: (await api.generalAgents()).agents, error: null };
  } catch (err) {
    state.general = { info: null, error: (err as Error).message };
  }
  rerender();
}

/** Saves the whole list of personas, and reads back how each tool now gets them. */
async function savePersonas(store: Store, personas: Persona[]): Promise<Persona[]> {
  const saved = (await api.savePersonas(personas)).personas;
  store.patch({ personas: saved });
  state.general = null;
  return saved;
}

/** The personas, with each tool's file for them and a way to make, edit or delete one. */
function generalAgentsView(store: Store): HTMLElement {
  const container = el('div', 'library-matrix-container');
  const intro = el('div', 'library-intro');
  intro.append(
    el('b', 'library-section-title', 'General agents'),
    el('p', 'm', "Your agents. Hire them for work in any repo, and every tool on this Mac can call them as helpers: each one is written to the tool's agents folder in your home. Untick a tool to leave it out."),
  );
  container.appendChild(intro);

  const personas = store.state.personas;
  if (!personas.length) {
    container.appendChild(el('div', 'empty library-empty', 'No agents yet. Make one, or copy one from a repo.'));
    container.appendChild(newPersonaActions(store));
    return container;
  }
  if (!state.general) void loadGeneral();
  if (state.general?.error) container.appendChild(el('div', 'error-box', state.general.error));
  const info = state.general?.info ?? null;

  const table = el('table', 'library-matrix');
  const head = el('tr');
  head.appendChild(el('th', null, 'Agent'));
  for (const tool of AGENT_TOOLS) head.appendChild(el('th', 'library-tool-col', tool.name));
  head.appendChild(el('th', null, ''));
  table.appendChild(el('thead')).appendChild(head);

  const tbody = el('tbody');
  const menu = store.state.health.modelMenu;
  for (const persona of personas) {
    const agent = info?.find((a) => a.personaId === persona.id);
    const row = el('tr');
    const nameCell = el('td', 'library-skill-name');
    const who = el('div', 'library-persona-cell');
    who.appendChild(personaPicture(persona.look, persona.id));
    const text = el('div', 'library-persona-text');
    const link = el('button', 'library-skill-link', persona.name);
    link.type = 'button';
    link.title = agent?.description ?? '';
    link.addEventListener('click', () => openPersonaForm(persona));
    text.append(link, el('span', 'm', `${setupSummary(persona, menu)}${agent ? ` · ${agent.agentName}` : ''}`));
    who.appendChild(text);
    nameCell.appendChild(who);
    row.appendChild(nameCell);

    for (const tool of AGENT_TOOLS) {
      const cell = el('td', 'library-status-cell');
      const status = agent?.tools.find((t) => t.toolId === tool.id);
      if (status) cell.append(...generalToolCell(persona, tool.name, status));
      else cell.textContent = info ? '—' : '…';
      row.appendChild(cell);
    }

    const actions = el('td', 'library-actions-cell');
    actions.appendChild(personaActions(store, persona));
    row.appendChild(actions);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  const skipped = (info ?? []).flatMap((a) => {
    const name = personas.find((p) => p.id === a.personaId)?.name ?? a.agentName;
    return a.tools.filter((t) => t.skipped.length).map((t) => `${name}, ${AGENT_TOOLS.find((x) => x.id === t.toolId)?.name}: ${t.skipped.join('; ')}`);
  });
  if (skipped.length) {
    const box = el('div', 'library-agent-skipped');
    box.appendChild(el('b', null, 'Left out of the files'));
    const list = el('ul', 'm');
    for (const line of skipped) list.appendChild(el('li', null, line));
    box.appendChild(list);
    container.appendChild(box);
  }

  const legend = el('div', 'library-legend m');
  legend.textContent = "Permission, effort and look only apply to hires in the office. As a helper, Claude Code uses the agent's model; Cursor, Codex and Copilot use their own.";
  container.appendChild(legend);
  container.appendChild(newPersonaActions(store));
  return container;
}

/** A tool's tick box for a persona, with a warning for what its file could not carry. */
function generalToolCell(persona: Persona, toolName: string, status: GeneralAgentToolInfo): HTMLElement[] {
  if (status.status === 'taken') {
    const icon = statusIcon('conflict');
    icon.title = `${status.file} is a file of your own, so it is left alone. Rename the agent to give it another name.`;
    return [icon];
  }
  const box = el('input');
  box.type = 'checkbox';
  box.checked = status.status !== 'off';
  box.title = {
    written: `Written to ${status.file}`,
    off: `Write it to ${status.file}`,
    not_written: `Could not write ${status.file}. Untick and tick it to try again.`,
  }[status.status];
  box.setAttribute('aria-label', `${persona.name} for ${toolName}`);
  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      state.general = { info: (await api.generalAgentTool(persona.id, status.toolId, box.checked)).agents, error: null };
    } catch (err) {
      state.note = (err as Error).message;
    }
    rerender();
  });
  const parts: HTMLElement[] = [box];
  if (status.status === 'not_written') {
    const icon = statusIcon('missing');
    icon.title = box.title;
    parts.push(icon);
  }
  if (status.skipped.length) {
    const warn = statusIcon('conflict');
    warn.title = `Left out: ${status.skipped.join('; ')}`;
    parts.push(warn);
  }
  return parts;
}

/** Edit, Share, and Delete pressed twice. */
function personaActions(store: Store, persona: Persona): HTMLElement {
  const box = el('div', 'library-agent-actions');
  const edit = actionIcon('Edit', ACTION_ICONS.edit);
  edit.addEventListener('click', () => openPersonaForm(persona));

  const share = actionIcon('Share this agent with another user', ACTION_ICONS.share);
  share.addEventListener('click', async () => {
    share.disabled = true;
    try {
      const shared = await openShareDialog({ type: 'agent', persona });
      if (shared) state.note = `Shared ${persona.name}.`;
    } finally {
      share.disabled = false;
      rerender();
    }
  });

  const sure = state.confirmDelete === persona.id;
  const del = actionIcon(sure ? `Press again to delete ${persona.name}` : 'Delete. Workers already hired with it keep their role', ACTION_ICONS.delete);
  del.classList.toggle('danger', sure);
  del.addEventListener('click', async () => {
    if (!sure) {
      state.confirmDelete = persona.id;
      rerender();
      return;
    }
    del.disabled = true;
    state.confirmDelete = null;
    try {
      await savePersonas(store, store.state.personas.filter((p) => p.id !== persona.id));
      state.note = `Deleted ${persona.name}.`;
    } catch (err) {
      state.note = (err as Error).message;
    }
    rerender();
  });
  box.append(edit, share, del);
  return box;
}

function newPersonaActions(store: Store): HTMLElement {
  const actions = el('div', 'library-actions');
  const add = el('button', 'btn primary', 'New agent');
  add.type = 'button';
  add.addEventListener('click', () => openPersonaForm(null, store));
  actions.appendChild(add);
  return actions;
}

/** Opens the persona form on a copy of `persona`, or on a new one starting as the office's new hires do. */
function openPersonaForm(persona: Persona | null, store: Store | null = officeStore): void {
  const draft: Persona = persona
    ? { ...persona, look: { ...persona.look } }
    : { id: '', name: '', ...(store?.state.workerDefaults ?? { permission: 'standard', model: null, effort: null }), look: { ...DEFAULT_LOOK }, instructions: '' };
  state.form = { kind: 'persona', draft, error: null };
  state.confirmDelete = null;
  state.note = null;
  rerender();
}

/** Name, description, setup, look and instructions, each bound to the draft so a redraw keeps them. */
function personaForm(form: Extract<LibraryForm, { kind: 'persona' }>): HTMLElement {
  const { draft } = form;
  const isNew = !draft.id;
  const menu = officeStore?.state.health.modelMenu ?? { models: [], efforts: [] };

  const name = el('input', 'setup-name');
  name.type = 'text';
  name.value = draft.name;
  name.maxLength = PERSONA_NAME_MAX;
  name.placeholder = 'e.g. UI agent';
  name.autocomplete = 'off';
  name.addEventListener('input', () => (draft.name = name.value));

  const description = el('input', 'setup-name');
  description.type = 'text';
  description.value = draft.description ?? '';
  description.maxLength = PERSONA_DESCRIPTION_MAX;
  description.placeholder = 'e.g. Reviews UI changes against the design system';
  description.addEventListener('input', () => (draft.description = description.value));

  const setupBox = el('div', 'library-form-field');
  const setup = setupControls(draft, menu, (next) => Object.assign(draft, next));
  setupBox.append(el('b', null, 'Setup'), setup.node, el('span', 'm', 'What a hire with this agent starts as.'));

  const lookBox = el('div', 'library-form-field');
  const lookRow = el('div', 'persona-look');
  const preview = personaPicture(draft.look, draft.id || 'new');
  lookRow.append(preview, lookControls(draft.look, (patch) => {
    Object.assign(draft.look, patch);
    showPortrait(preview, draft.look, draft.id || 'new');
  }));
  lookBox.append(el('b', null, 'Look'), lookRow);

  const instructions = el('textarea', 'ask-input');
  instructions.rows = 6;
  instructions.value = draft.instructions;
  instructions.placeholder = 'e.g. You are the frontend specialist. Reuse the existing components…';
  instructions.addEventListener('input', () => (draft.instructions = instructions.value));

  const save = el('button', 'btn primary', isNew ? 'Add agent' : 'Save');
  save.type = 'submit';
  const box = formBox(
    isNew ? 'New agent' : `Edit ${draft.name}`,
    'A kind of worker to hire, in any repo. Hires are named after it, e.g. "Frontend Engineer - Ada". Editing one changes new hires only.',
    [
      formField('Name', name, `Up to ${PERSONA_NAME_MAX} characters.`),
      formField('Description', description, 'When the tools should call it as a helper. Leave it empty to use the first sentence of the instructions.'),
      setupBox,
      lookBox,
      formField('Instructions', instructions, "Added to every brief as the worker's role, and the body of each tool's agent file."),
    ],
    form.error,
    [save, cancelButton()],
  );
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const store = officeStore;
    if (!store) return;
    const next: Persona = { ...draft, ...setup.value(), look: { ...draft.look } };
    const list = isNew ? [...store.state.personas, next] : store.state.personas.map((p) => (p.id === draft.id ? next : p));
    void submitForm(form, save, async () => {
      await savePersonas(store, list);
      state.note = `${isNew ? 'Added' : 'Saved'} ${next.name.trim()}.`;
    });
  });
  setTimeout(() => {
    if (isNew && !name.value) name.focus();
  });
  return box;
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function healthSection(): HTMLElement | null {
  const health = state.health;
  if (!health) return null;

  const issues =
    health.brokenLinks.length +
    health.conflicts.length +
    health.invalidFrontmatter.length;

  if (issues === 0) return null;

  const bar = el('div', 'library-health-bar');

  if (health.brokenLinks.length) {
    const item = el('div', 'library-health-item warning');
    item.appendChild(el('span', null, `${health.brokenLinks.length} broken link${health.brokenLinks.length > 1 ? 's' : ''}`));
    const fix = el('button', 'btn small', 'Fix');
    fix.type = 'button';
    fix.addEventListener('click', async () => {
      fix.disabled = true;
      for (const link of health.brokenLinks) {
        await api.skillsHealthFixLink(link.skillId, link.toolId);
      }
      await reloadHealth();
      rerender();
    });
    item.appendChild(fix);
    bar.appendChild(item);
  }

  const clashing = health.conflicts
    .map((c) => state.matrix?.skills.find((s) => s.id === c.skillId && !s.fromRepo))
    .find((s) => s);
  if (health.conflicts.length) {
    const item = el('div', 'library-health-item warning');
    item.appendChild(el('span', null, `${health.conflicts.length} name conflict${health.conflicts.length > 1 ? 's' : ''}`));
    if (clashing) {
      const show = el('button', 'btn small', 'Show');
      show.type = 'button';
      show.title = `Open ${clashing.name}`;
      show.addEventListener('click', () => {
        state.selectedSkillKey = skillMatrixKey(clashing);
        rerender();
      });
      item.appendChild(show);
    }
    bar.appendChild(item);
  }

  if (health.invalidFrontmatter.length) {
    const item = el('div', 'library-health-item error');
    item.appendChild(el('span', null, `${health.invalidFrontmatter.length} invalid frontmatter`));
    bar.appendChild(item);
  }

  if (health.missingTools.length) {
    const item = el('div', 'library-health-item info');
    item.appendChild(el('span', null, `Tools not installed: ${health.missingTools.join(', ')}`));
    bar.appendChild(item);
  }

  return bar;
}

function syncMatrixView(): HTMLElement {
  const matrix = state.matrix;
  if (!matrix) return el('div', 'empty', 'No skills data.');

  const container = el('div', 'library-matrix-container');
  container.appendChild(scopeIntro(state.selectedRepo));

  const skills = skillsIn(state.selectedRepo);

  if (skills.length === 0) {
    container.appendChild(el('div', 'empty library-empty', state.selectedRepo
      ? `No skills in ${state.selectedRepo} yet.`
      : 'No general skills yet. Create one, or adopt one from a tool below.'));
    if (!state.selectedRepo) container.appendChild(newSkillActions());
    return container;
  }

  // Table header
  const table = el('table', 'library-matrix');
  const thead = el('thead');
  const headerRow = el('tr');
  headerRow.appendChild(el('th', null, 'Skill'));

  for (const tool of matrix.tools) {
    const th = el('th', tool.installed ? 'library-tool-col' : 'library-tool-col muted');
    th.textContent = tool.name;
    if (!tool.installed) th.title = 'Not installed';
    headerRow.appendChild(th);
  }

  headerRow.appendChild(el('th', null, '')); // Actions column
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Table body
  const tbody = el('tbody');
  for (const skill of skills) {
    const row = el('tr');
    const key = skillMatrixKey(skill);

    // Skill name cell
    const nameCell = el('td', 'library-skill-name');
    const nameLink = el('button', 'library-skill-link', skill.name);
    nameLink.type = 'button';
    nameLink.addEventListener('click', () => {
      state.selectedSkillKey = key;
      rerender();
    });
    nameCell.appendChild(nameLink);

    if (skill.fromRepo) {
      const badge = el('span', 'library-badge readonly');
      badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATUS_ICONS.from_repo!.paths}</svg>`;
      badge.title = 'From repo (read-only)';
      badge.setAttribute('aria-label', 'From repo (read-only)');
      nameCell.appendChild(badge);
    }

    if (skill.required) {
      const badge = el('span', 'library-badge required', 'Always');
      badge.title = 'Every worker loads it before each task';
      nameCell.appendChild(badge);
    }

    row.appendChild(nameCell);

    // Status cells for each tool
    for (const tool of matrix.tools) {
      const status = matrix.status[key]?.[tool.id];
      const cell = el('td', 'library-status-cell');

      if (!status || !tool.installed) {
        cell.textContent = '—';
        cell.className += ' muted';
      } else if (status.status === 'conflict' && !skill.fromRepo) {
        cell.appendChild(statusIcon(status.status));
        cell.addEventListener('click', () => {
          state.selectedSkillKey = key;
          rerender();
        });
        cell.style.cursor = 'pointer';
        cell.title = `${tool.name} already has its own copy of ${skill.id} at ${status.targetPath}. Click to choose which one to use.`;
      } else {
        cell.appendChild(linkBox(skill, tool, status));
      }

      row.appendChild(cell);
    }

    // Actions cell
    const actionsCell = el('td', 'library-actions-cell');
    const linkable = matrix.tools.filter((tool) => {
      const status = matrix.status[key]?.[tool.id];
      return tool.installed && status?.status === 'missing' && !status.error;
    });
    if (linkable.length) {
      const allBtn = el('button', 'btn small ghost', 'Link all');
      allBtn.type = 'button';
      allBtn.title = `Link for ${linkable.map((t) => t.name).join(', ')}`;
      allBtn.addEventListener('click', async () => {
        allBtn.disabled = true;
        for (const tool of linkable) {
          await api.skillsLink(skill.id, tool.id, skill.repo ?? undefined).catch(() => {});
        }
        await reloadMatrix();
        rerender();
      });
      actionsCell.appendChild(allBtn);
    }
    if (canShareSkill(skill)) actionsCell.appendChild(skillRowActions(skill));
    row.appendChild(actionsCell);

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  container.appendChild(table);

  if (skills.some((s) => s.fromRepo)) {
    const legend = el('div', 'library-legend m');
    legend.appendChild(statusIcon('from_repo'));
    legend.appendChild(document.createTextNode(' committed in the repo · '));
    const box = el('input');
    box.type = 'checkbox';
    box.checked = true;
    box.disabled = true;
    box.setAttribute('aria-hidden', 'true');
    legend.appendChild(box);
    legend.appendChild(document.createTextNode(' greyed: the repo already gives it to that tool · ticking links it for that tool on this Mac, ignored by git'));
    container.appendChild(legend);
  }

  if (!state.selectedRepo) container.appendChild(newSkillActions());

  return container;
}

/** What the skills in a scope are, above their table. */
function scopeIntro(repo: string | null): HTMLElement {
  const intro = el('div', 'library-intro');
  if (repo === null) {
    intro.append(
      el('b', 'library-section-title', 'General skills'),
      el('p', 'm', 'Every worker can use these, in any repo. Tick a tool to give it the skill.'),
    );
  } else {
    intro.append(
      el('b', 'library-section-title', `Skills in ${repo}`),
      el('p', 'm', `Only workers in ${repo} use these, alongside the general skills. Tick a tool to give it the skill.`),
    );
  }
  return intro;
}

/** The New skill button. Only general skills are made here; a repo's come from the repo. */
function newSkillActions(): HTMLElement {
  const actions = el('div', 'library-actions');
  const newBtn = el('button', 'btn primary', 'New skill');
  newBtn.type = 'button';
  newBtn.addEventListener('click', () => openNewSkillForm());
  actions.appendChild(newBtn);
  return actions;
}

const STATUS_ICONS: Record<string, { cls: string; paths: string }> = {
  linked: { cls: 'linked', paths: '<polyline points="20 6 9 17 4 12"/>' },
  copied: { cls: 'copied', paths: '<polyline points="20 6 9 17 4 12"/>' },
  conflict: {
    cls: 'conflict',
    paths: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  },
  missing: { cls: 'missing', paths: '<line x1="6" y1="12" x2="18" y2="12"/>' },
  from_repo: {
    cls: 'from-repo',
    paths: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  },
};

function statusIcon(status: string): HTMLElement {
  const icon = STATUS_ICONS[status];
  const span = el('span', `library-status-icon${icon ? ` ${icon.cls}` : ''}`);
  if (!icon) {
    span.textContent = '?';
    return span;
  }
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.paths}</svg>`;
  return span;
}

/** Skills in the tools' own folders, offered for adoption into General skills. */
function discoveredList(): HTMLElement {
  const matrix = state.matrix;
  const container = el('div', 'library-discovered');
  if (!matrix) return container;

  container.appendChild(el('b', 'library-section-title', 'Found in your tools'));
  container.appendChild(el('p', 'm', 'These skills were found in your tool folders but aren\'t in the library yet. Adopt them to manage them here.'));

  const list = el('div', 'library-discovered-list');

  for (const skill of matrix.discovered) {
    const item = el('div', 'library-discovered-item');

    const info = el('div', 'library-discovered-info');
    info.appendChild(el('b', null, skill.name));
    info.appendChild(el('span', 'm', ` (${skill.id}) — found in ${skill.toolId}`));
    if (skill.description) {
      info.appendChild(el('p', 'm', skill.description));
    }
    item.appendChild(info);

    const adoptBtn = el('button', 'btn small primary', 'Adopt');
    adoptBtn.type = 'button';
    adoptBtn.addEventListener('click', async () => {
      adoptBtn.disabled = true;
      try {
        await api.skillsAdopt(skill.toolId, skill.id, 'global', null);
        await Promise.all([reloadMatrix(), reloadHealth()]);
        rerender();
      } catch (err) {
        alert((err as Error).message);
        adoptBtn.disabled = false;
      }
    });
    item.appendChild(adoptBtn);

    list.appendChild(item);
  }

  container.appendChild(list);
  return container;
}

type MatrixSkill = SyncMatrixInfo['skills'][number];

/** Only the library's own skills are shared; a repo's belong to the repo. */
export function canShareSkill(skill: Pick<MatrixSkill, 'fromRepo'>): boolean {
  return !skill.fromRepo;
}

/** What the share dialog sends for a skill. */
export function skillSharePayload(
  skill: Pick<MatrixSkill, 'id' | 'name' | 'description' | 'files'>,
  instructions: string | null,
): Extract<ShareTarget, { type: 'skill' }> {
  return {
    type: 'skill',
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: instructions ?? '',
      files: skill.files,
    },
  };
}

function skillRowActions(skill: MatrixSkill): HTMLElement {
  const box = el('span', 'library-row-icons');
  const edit = actionIcon('Edit', ACTION_ICONS.edit);
  edit.addEventListener('click', () => openEditForm(skill));

  const share = shareSkillButton(skill, actionIcon('Share this skill with another user', ACTION_ICONS.share));

  const confirmKey = `skill:${skillMatrixKey(skill)}`;
  const sure = state.confirmDelete === confirmKey;
  const del = actionIcon(
    sure ? `Press again to delete ${skill.id}` : 'Delete. It is removed from every tool and its folder is deleted',
    ACTION_ICONS.delete,
  );
  del.classList.toggle('danger', sure);
  del.addEventListener('click', async () => {
    if (!sure) {
      state.confirmDelete = confirmKey;
      rerender();
      return;
    }
    del.disabled = true;
    state.confirmDelete = null;
    try {
      await api.skillsDelete(skill.id, skill.scope === 'repo' ? 'repo' : 'global', skill.repo ?? undefined);
      state.note = `Deleted ${skill.id}.`;
      await Promise.all([reloadMatrix(), reloadHealth()]);
    } catch (err) {
      state.note = (err as Error).message;
    }
    rerender();
  });

  box.append(edit, share, del);
  return box;
}

/** Share, loading the skill's instructions first unless they are already open. */
function shareSkillButton(skill: MatrixSkill, btn: HTMLButtonElement): HTMLButtonElement {
  const key = skillMatrixKey(skill);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const loaded = state.instructions?.key === key ? state.instructions.body : null;
      const instructions = loaded ?? (await api.skillsGet(skill.id, skill.repo ?? undefined)).body;
      const shared = await openShareDialog(skillSharePayload(skill, instructions));
      if (shared) state.note = `Shared ${skill.name}.`;
    } catch (err) {
      state.note = (err as Error).message;
    } finally {
      btn.disabled = false;
      rerender();
    }
  });
  return btn;
}

function skillDetail(): HTMLElement {
  const matrix = state.matrix;
  const key = state.selectedSkillKey;
  if (!matrix || !key) return el('div', 'empty', 'No skill selected.');

  const skill = matrix.skills.find((s) => skillMatrixKey(s) === key);
  if (!skill) {
    state.selectedSkillKey = null;
    return el('div', 'empty', 'Skill not found.');
  }
  const skillId = skill.id;

  const container = el('div', 'library-skill-detail');

  // Header
  const header = el('div', 'library-skill-header');
  header.appendChild(el('h2', null, skill.name));
  if (skill.fromRepo) {
    header.appendChild(el('span', 'library-badge readonly', 'Read-only (from repo)'));
  } else {
    const edit = el('button', 'btn small library-edit', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openEditForm(skill));
    header.appendChild(edit);

    const share = el('button', 'btn small library-share', 'Share');
    share.type = 'button';
    share.title = 'Share this skill with another user';
    header.appendChild(shareSkillButton(skill, share));
  }
  container.appendChild(header);

  // Description
  if (skill.description) {
    container.appendChild(el('p', 'm', skill.description));
  }

  // Info
  const info = el('div', 'library-skill-info');
  info.appendChild(el('span', 'm', `ID: ${skill.id}`));
  info.appendChild(el('span', 'm', skill.scope === 'repo' ? `Repo: ${skill.repo}` : 'General skill: every worker, in any repo or none'));
  info.appendChild(el('span', 'm', `Modified: ${new Date(skill.modifiedAt).toLocaleString()}`));
  if (skill.files.length) {
    info.appendChild(el('span', 'm', `Files: ${skill.files.join(', ')}`));
  }
  container.appendChild(info);

  container.appendChild(instructionsSection(skill.id, key, skill.scope === 'repo' ? skill.repo : null));

  // Settings
  const settings = el('div', 'library-skill-settings');
  const repo = skill.repo ?? undefined;
  const always = el('label', 'settings-check');
  const alwaysBox = el('input');
  alwaysBox.type = 'checkbox';
  alwaysBox.checked = skill.required;
  alwaysBox.addEventListener('change', async () => {
    alwaysBox.disabled = true;
    try {
      await api.skillsSettings(skillId, { required: alwaysBox.checked, repo });
    } catch (err) {
      alert((err as Error).message);
    }
    await reloadMatrix();
    rerender();
  });
  always.append(alwaysBox, el('b', null, ' Always for workers'));
  settings.appendChild(always);
  settings.appendChild(el('span', 'm', skill.required
    ? 'Every worker reads it in full before starting each task, whether the task needs it or not. Keep Always to the few skills every task needs, as each one uses up the worker’s context.'
    : 'Workers already see it, and load it when a task matches its description. Only tick this for the few skills every task needs: each Always skill is read in full before work starts, which uses up the worker’s context.'));
  const alwaysList = alwaysSkillsFor(skill.scope === 'repo' ? skill.repo : null);
  if (skill.required && alwaysList.length > 1) {
    const names = alwaysList.join(', ');
    settings.appendChild(el('span', 'm library-always-count', skill.scope === 'repo'
      ? `Workers in ${skill.repo} load ${alwaysList.length} skills before every task: ${names}.`
      : `Every worker loads these ${alwaysList.length} general skills before every task, plus any marked Always for its repo: ${names}.`));
  }

  if (skill.onlyWhenAsked) {
    const note = el('span', 'm', 'Its SKILL.md says agents use it only when it is named.');
    // The office no longer sets this, but a library skill can still carry it from before; a repo's is the repo's.
    if (!skill.fromRepo) {
      const clearBtn = el('button', 'btn small ghost', 'Let agents pick it up');
      clearBtn.type = 'button';
      clearBtn.addEventListener('click', async () => {
        clearBtn.disabled = true;
        try {
          await api.skillsSettings(skillId, { onlyWhenAsked: false, repo });
        } catch (err) {
          alert((err as Error).message);
        }
        await reloadMatrix();
        rerender();
      });
      note.append(' ', clearBtn);
    }
    settings.appendChild(note);
  }

  container.appendChild(settings);

  const statusSection = el('div', 'library-skill-status');
  statusSection.appendChild(el('b', null, 'Linked to'));
  statusSection.appendChild(el('span', 'm', skill.fromRepo
    ? `Committed in ${skill.repo}. Ticking a tool that can't see it links it into that tool's folder on this Mac; git ignores the link.`
    : skill.scope === 'repo'
      ? `Linked into each tool's skills folder in ${skill.repo}, and in its worktrees.`
      : "Linked into each tool's skills folder in your home folder, so every worker can use it."));
  const clashes = skill.fromRepo
    ? []
    : matrix.tools.filter((tool) => tool.installed && matrix.status[key]?.[tool.id]?.status === 'conflict');
  if (clashes.length) {
    const many = clashes.length > 1;
    const names = clashes.map((t) => t.name).join(' and ');
    // Only a general skill can take the tool's place in its home folder
    const canUse = skill.scope === 'global';
    const error = el('div', 'error-box library-name-clash');
    const head = el('div', 'library-name-clash-head');
    head.appendChild(el('span', null, `${names} already ${many ? 'have their' : 'has its'} own copy of ${skill.id}, so this one can't be linked for ${many ? 'them' : 'it'}. ${canUse ? `Use this one instead (${many ? 'theirs are' : 'its copy is'} kept as ${skill.id}-backup), or rename this skill.` : 'Rename this skill to link it.'}`));
    const rename = el('button', 'btn small', 'Rename');
    rename.type = 'button';
    rename.addEventListener('click', () => openEditForm(skill, true));
    head.appendChild(rename);
    error.appendChild(head);
    for (const tool of clashes) {
      const status = matrix.status[key]![tool.id]!;
      const line = el('div', 'library-name-clash-copy');
      line.append(el('span', null, `${tool.name}: `), el('code', null, status.targetPath));
      if (canUse) {
        const use = el('button', 'btn small', `Use this one for ${tool.name}`);
        use.type = 'button';
        use.title = `Moves ${status.targetPath} to ${skill.id}-backup and links this skill in its place`;
        use.addEventListener('click', async () => {
          use.disabled = true;
          try {
            await api.skillsHealthUseLibrary(skill.id, tool.id);
          } catch (err) {
            alert((err as Error).message);
          }
          await Promise.all([reloadMatrix(), reloadHealth()]);
          rerender();
        });
        line.appendChild(use);
      }
      error.appendChild(line);
    }
    statusSection.appendChild(error);
  }
  const statusList = el('div', 'library-status-list');
  for (const tool of matrix.tools) {
    if (!tool.installed) continue;
    const status = matrix.status[key]?.[tool.id];
    const item = el('label', 'library-status-item');
    const clash = clashes.includes(tool);
    item.append(status && !clash ? linkBox(skill, tool, status) : statusIcon(status?.status ?? 'missing'), el('span', null, tool.name));
    const hint = clash ? 'Has its own copy' : linkHint(skill.fromRepo, status);
    if (hint) item.appendChild(el('span', 'm library-status-hint', hint));
    statusList.appendChild(item);
  }
  statusSection.appendChild(statusList);
  container.appendChild(statusSection);

  return container;
}

type ToolStatus = SyncMatrixInfo['status'][string][string];

/** A tool's tick box for a skill: ticking links it for that tool, unticking removes the link. */
function linkBox(skill: SyncMatrixInfo['skills'][number], tool: SyncMatrixInfo['tools'][number], status: ToolStatus): HTMLInputElement {
  const box = el('input');
  box.type = 'checkbox';
  box.checked = ['linked', 'copied', 'via_repo', 'from_repo'].includes(status.status);
  box.disabled = status.status === 'via_repo' || status.status === 'from_repo' || !!status.error;
  box.title = linkHint(skill.fromRepo, status) ?? (box.checked ? `Linked for ${tool.name}` : `Link for ${tool.name}`);
  box.setAttribute('aria-label', `${skill.name} for ${tool.name}`);
  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      await (box.checked ? api.skillsLink : api.skillsUnlink)(skill.id, tool.id, skill.repo ?? undefined);
    } catch (err) {
      alert((err as Error).message);
    }
    await reloadMatrix();
    rerender();
  });
  return box;
}

/** Why a tool's box is as it is, when that needs saying. */
function linkHint(fromRepo: boolean, status: ToolStatus | undefined): string | null {
  if (status?.error) return status.error;
  switch (status?.status) {
    case 'from_repo': return `Committed in ${status.via ?? 'the repo'}`;
    case 'via_repo': return `Reads it from ${status.via}`;
    case 'linked': return fromRepo && status.via ? `Linked to ${status.via} on this Mac` : null;
    case 'conflict': return `Its own copy is at ${status.targetPath}`;
    case 'copied': return 'Copied, as this tool does not follow links';
    default: return null;
  }
}

/** The skill's SKILL.md body, loaded the first time the skill is opened. */
function instructionsSection(id: string, key: string, repo: string | null): HTMLElement {
  const section = el('div', 'library-skill-instructions');
  section.appendChild(el('b', null, 'Instructions'));

  const loaded = state.instructions?.key === key ? state.instructions : null;
  if (!loaded) {
    state.instructions = { key, body: null, error: null };
    api
      .skillsGet(id, repo ?? undefined)
      .then((skill) => {
        if (state.instructions?.key === key) state.instructions = { key, body: skill.body, error: null };
      })
      .catch((err: Error) => {
        if (state.instructions?.key === key) state.instructions = { key, body: null, error: err.message };
      })
      .finally(() => {
        if (state.selectedSkillKey === key) rerender();
      });
  }

  if (loaded?.error) {
    section.appendChild(el('div', 'error-box', loaded.error));
  } else if (loaded?.body == null) {
    section.appendChild(el('span', 'm', 'Loading…'));
  } else if (!loaded.body.trim()) {
    section.appendChild(el('span', 'm', 'This SKILL.md has no instructions after its frontmatter.'));
  } else {
    const text = el('div', 'library-skill-body');
    setRichText(text, loaded.body.trim());
    section.appendChild(text);
  }
  return section;
}

function openNewSkillForm(): void {
  state.form = { kind: 'new', name: '', description: '', instructions: '', error: null };
  rerender();
}

/** Opens the edit form for a library skill, with its instructions once they load. */
function openEditForm(skill: SyncMatrixInfo['skills'][number], focusName = false): void {
  const key = skillMatrixKey(skill);
  const loaded = state.instructions?.key === key ? state.instructions.body : null;
  const form: LibraryForm = {
    kind: 'edit',
    skillKey: key,
    name: skill.id,
    description: skill.description,
    instructions: loaded,
    error: null,
    focusName,
  };
  state.form = form;
  rerender();
  if (loaded !== null) return;
  api
    .skillsGet(skill.id, skill.repo ?? undefined)
    .then((full) => { form.instructions = full.body.trim(); })
    .catch((err: Error) => { form.error = `Could not load its instructions: ${err.message}`; })
    .finally(() => { if (state.form === form) rerender(); });
}

function formView(form: LibraryForm): HTMLElement {
  switch (form.kind) {
    case 'new': return newSkillForm(form);
    case 'edit': return editSkillForm(form);
    case 'repos': return reposForm(form);
    case 'persona': return personaForm(form);
  }
}

/** Ticks for every repo the office found; the ticked ones are listed under the tabs. */
function reposForm(form: Extract<LibraryForm, { kind: 'repos' }>): HTMLElement {
  const repos = officeStore?.state.repos ?? [];
  const list = el('div', 'library-repo-list');
  if (!repos.length) list.appendChild(el('div', 'm', 'Looking for repos…'));
  for (const repo of repos) {
    const option = el('label', 'library-repo-option');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = form.chosen.includes(repo.path);
    box.addEventListener('change', () => {
      form.chosen = box.checked ? [...form.chosen, repo.path] : form.chosen.filter((p) => p !== repo.path);
    });
    const text = el('span', 'library-repo-text');
    text.append(el('b', null, repo.name), el('span', 'm', repo.path));
    option.append(box, text);
    list.appendChild(option);
  }

  const save = el('button', 'btn primary', 'Save');
  save.type = 'submit';
  const browse = el('button', 'btn', 'Browse for a folder…');
  browse.type = 'button';
  browse.addEventListener('click', async () => {
    browse.disabled = true;
    try {
      const { path } = await api.chooseFolder('Pick a repo to add to the library');
      if (!path) return;
      const { repo, repos: all } = await api.addRepo(path);
      if (!form.chosen.includes(repo.path)) form.chosen = [...form.chosen, repo.path];
      officeStore?.patch({ repos: all });
    } catch (err) {
      form.error = (err as Error).message;
    } finally {
      browse.disabled = false;
      rerender();
    }
  });

  const box = formBox(
    'Repos in the library',
    'Tick the repos to list in the library. These are the repos the office found; browse for one it missed.',
    [list],
    form.error,
    [save, browse, cancelButton()],
  );
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const before = state.matrix?.libraryRepos ?? [];
    const added = repos.find((r) => form.chosen.includes(r.path) && !before.includes(r.path));
    void submitForm(form, save, async () => {
      await api.skillsSetRepos(form.chosen);
      if (added) state.selectedRepo = added.name;
    });
  });
  return box;
}

/** A labelled field: the label, the control, and a line on what to put there. */
function formField(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const field = el('label', 'library-form-field');
  field.append(el('b', null, label), control);
  if (hint) field.appendChild(el('span', 'm', hint));
  return field;
}

/** A form: title, intro, the fields, any error, then the buttons. */
function formBox(title: string, intro: string, fields: HTMLElement[], error: string | null, buttons: HTMLElement[]): HTMLFormElement {
  const box = el('form', 'library-form');
  box.noValidate = true;
  box.append(el('h2', null, title), el('p', 'm', intro), ...fields);
  if (error) box.appendChild(el('div', 'error-box', error));
  const actions = el('div', 'library-form-actions');
  actions.append(...buttons);
  box.appendChild(actions);
  return box;
}

function cancelButton(): HTMLButtonElement {
  const cancel = el('button', 'btn ghost', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeForm);
  return cancel;
}

function nameInput(value: string, placeholder: string, onInput: (value: string) => void): HTMLInputElement {
  const input = el('input', 'setup-name');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = SKILL_NAME_MAX;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.addEventListener('input', () => onInput(input.value.trim()));
  return input;
}

/** Runs a form's save, keeping the form open with the error when it fails. */
async function submitForm(form: LibraryForm, button: HTMLButtonElement, save: () => Promise<void>): Promise<void> {
  button.disabled = true;
  form.error = null;
  try {
    await save();
    if (state.form === form) state.form = null;
    await Promise.all([reloadMatrix(), reloadHealth()]);
  } catch (err) {
    form.error = (err as Error).message;
  }
  rerender();
}

/** The name, description and instructions fields shared by the new and edit forms. */
function skillFields(
  form: { name: string; description: string; instructions: string | null },
  placeholders: boolean,
): { name: HTMLInputElement; fields: HTMLElement[] } {
  const name = nameInput(form.name, placeholders ? 'e.g. draft-ticket' : '', (v) => { form.name = v; });

  const description = el('textarea', 'ask-input');
  description.rows = 2;
  description.value = form.description;
  if (placeholders) description.placeholder = 'Drafts a ticket from a rough idea. Use when asked to write up a ticket or a bug.';
  description.addEventListener('input', () => { form.description = description.value; });

  const instructions = el('textarea', 'ask-input library-form-instructions');
  instructions.rows = placeholders ? 8 : 16;
  instructions.value = form.instructions ?? '';
  instructions.disabled = form.instructions === null;
  instructions.placeholder = form.instructions === null ? 'Loading…' : 'The steps to follow, in Markdown.';
  instructions.addEventListener('input', () => { form.instructions = instructions.value; });

  return {
    name,
    fields: [
      formField('Name', name, 'Lowercase letters, numbers and hyphens. It is also the folder name, and what you type to use it, like /draft-ticket.'),
      formField('Description', description, 'Agents read this to decide when to use the skill, so say what it does and when.'),
      formField('Instructions', instructions, placeholders ? 'Optional for now: you can add them later with Edit.' : 'What agents follow once they pick the skill up, in Markdown.'),
    ],
  };
}

/** Why the name or description will not do, or null. */
function skillFormProblem(form: { name: string; description: string }): string | null {
  return skillNameProblem(form.name) ?? (form.description.trim() ? null : 'Say what the skill does and when to use it.');
}

function newSkillForm(form: Extract<LibraryForm, { kind: 'new' }>): HTMLElement {
  const { name, fields } = skillFields(form, true);
  const create = el('button', 'btn primary', 'Create skill');
  create.type = 'submit';

  const box = formBox(
    'New skill',
    "A general skill, for every worker in any repo or none. It goes into each tool's skills folder in your home folder.",
    fields,
    form.error,
    [create, cancelButton()],
  );
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const problem = skillFormProblem(form);
    if (problem) {
      form.error = problem;
      rerender();
      return;
    }
    void submitForm(form, create, async () => {
      await api.skillsCreate(form.name, form.name, form.description.trim(), 'global', undefined, form.instructions);
      state.selectedSkillKey = skillMatrixKey({ id: form.name, scope: 'global', repo: null });
    });
  });
  queueMicrotask(() => name.focus());
  return box;
}

function editSkillForm(form: Extract<LibraryForm, { kind: 'edit' }>): HTMLElement {
  const skill = state.matrix?.skills.find((s) => skillMatrixKey(s) === form.skillKey);
  if (!skill) return formBox('Edit skill', 'This skill is no longer in the library.', [], null, [cancelButton()]);

  const { name, fields } = skillFields(form, false);
  const save = el('button', 'btn primary', 'Save');
  save.type = 'submit';
  save.disabled = form.instructions === null;

  const remove = el('button', 'btn danger library-form-delete', 'Delete skill');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    if (!confirm(`Delete ${skill.id}? It is removed from every tool and its folder is deleted.`)) return;
    void submitForm(form, remove, async () => {
      await api.skillsDelete(skill.id, skill.scope === 'repo' ? 'repo' : 'global', skill.repo ?? undefined);
      state.selectedSkillKey = null;
    });
  });

  const box = formBox(
    `Edit ${skill.id}`,
    skill.scope === 'repo'
      ? `A skill for workers in ${skill.repo}. Changing the name moves its links to match.`
      : 'A general skill, for every worker in any repo or none. Changing the name moves its links to match.',
    fields,
    form.error,
    [save, cancelButton(), remove],
  );
  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const problem = skillFormProblem(form);
    if (problem) {
      form.error = problem;
      rerender();
      return;
    }
    void submitForm(form, save, async () => {
      await api.skillsEdit(skill.id, {
        id: form.name,
        description: form.description.trim(),
        instructions: form.instructions ?? '',
        repo: skill.repo ?? undefined,
      });
      state.selectedSkillKey = skillMatrixKey({ ...skill, id: form.name });
      state.instructions = null;
    });
  });
  if (form.focusName) {
    form.focusName = false;
    queueMicrotask(() => {
      name.focus();
      name.select();
    });
  }
  return box;
}

async function reloadMatrix(): Promise<void> {
  try {
    state.matrix = await api.skills();
  } catch (err) {
    state.error = (err as Error).message;
  }
}

async function reloadHealth(): Promise<void> {
  try {
    state.health = await api.skillsHealth();
  } catch (err) {
    // Health errors are not critical
  }
}

/** Redraws the library, unless Settings has since moved to another tab or closed. */
function rerender(): void {
  if (host?.isConnected && officeStore) render(host, officeStore);
}
