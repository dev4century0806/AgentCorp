import {
  autoWorkerName,
  DEFAULT_LOOK,
  displayKey,
  isRepoPersonaId,
  nearestModel,
  RUNNER_CHOICES,
  runnerLabel,
  splitTicketId,
  type Agent,
  type Health,
  type HireRequest,
  type Persona,
  type RepoPersona,
  type RunnerChoice,
  type SourceId,
  type SourceStatus,
  type Ticket,
  type WorkerLook,
  type WorkerSetup,
  WORKER_NAME_MAX,
} from '@shared';
import { api, toUpload } from '../net/client.js';
import { portrait } from '../scene/portrait.js';
import type { Store } from '../state/store.js';
import { attachTray, wireFileDrop } from './attach.js';
import { mountVoice } from './voice.js';
import { $, ago, attachButton, clear, dropdown, el, searchClear } from './dom.js';
import { hireRunnerChoice, hireRunnerView, openRunnerSettings } from './runners.js';
import { hireKind, repoMultiPicker, type RepoPickerState } from './repo-field.js';
import { setupControls, setupLines } from './setup.js';

export const countsAgainstHireLimit = (agent: Pick<Agent, 'builtInPam' | 'status'>): boolean =>
  !agent.builtInPam && (agent.status === 'starting' || agent.status === 'working' || agent.status === 'needs_you');

/** The hire panel: connected tracker tickets, 8090 work orders, a free-form ask, and done work behind a tab. */
export function mountTicketPanel(store: Store): void {
  const panel = $<HTMLElement>('ticketPanel');
  const list = $<HTMLElement>('ticketList');
  const refreshBtn = $<HTMLButtonElement>('refreshTickets');

  $('openTickets').addEventListener('click', () =>
    store.patch({ ticketPanelOpen: !store.state.ticketPanelOpen, settingsOpen: false, workersOpen: false, ideasOpen: false, messagesOpen: false, memoryOpen: false }),
  );
  $('closeTickets').addEventListener('click', () => store.patch({ ticketPanelOpen: false }));
  const filter = $<HTMLDetailsElement>('ticketFilter');
  document.addEventListener('pointerdown', (e) => {
    if (filter.open && !filter.contains(e.target as Node)) filter.open = false;
  });
  filter.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !filter.open) return;
    e.stopPropagation();
    filter.open = false;
    filter.querySelector('summary')?.focus();
  });
  const ticketSearch = $<HTMLInputElement>('ticketSearch');
  ticketSearch.addEventListener('input', () => store.patch({ ticketSearch: ticketSearch.value }));
  searchClear(ticketSearch);

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('busy');
    try {
      await api.refreshTickets();
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('busy');
    }
  });

  // Built once and kept, so what Tom has typed and picked in it outlives the
  // board being redrawn around it.
  const ask = askCard(store);

  let drawnRunner = '';
  store.subscribe((state) => {
    const key = JSON.stringify(hireRunnerView(state.enabledRunners, state.health.runners, state.runner));
    if (key === drawnRunner) return;
    drawnRunner = key;
    renderRunner(store);
  });

  // A redraw throws away whatever Tom is in the middle of in the list: a
  // dropdown he has open, a click halfway through. A working agent sends
  // several events a second, so the list is redrawn only when something it
  // shows has changed.
  let drawn: unknown[] = [];
  store.subscribe(() => {
    const inputs = boardInputs(store.state);
    if (inputs.length === drawn.length && inputs.every((v, i) => v === drawn[i])) return;
    drawn = inputs;
    render(store, panel, list, ask);
  });
}

/** Everything the panel shows comes from these. */
function boardInputs(s: Store['state']): unknown[] {
  return [
    s.ticketPanelOpen,
    s.assignedToMeOnly,
    s.ticketSearch,
    s.hiddenSources,
    s.hiddenStatuses,
    s.tickets,
    s.repos,
    s.queue,
    s.health,
    s.limits,
    s.workerDefaults,
    s.personas,
    s.repoPersonas,
    // Which tickets have someone on them, not what each one is doing.
    s.agents.map((a) => a.ticketKey).join('\n'),
  ];
}

function render(store: Store, panel: HTMLElement, list: HTMLElement, ask: AskCard): void {
  const { state } = store;
  panel.hidden = !state.ticketPanelOpen;
  if (panel.hidden) {
    $<HTMLDetailsElement>('ticketFilter').open = false;
    return;
  }

  $('ticketSub').textContent = sourceSummary(state.health);

  const connected = connectedSources(store);
  const shown = connected.filter((s) => !state.hiddenSources.includes(s));
  const working = new Set(state.agents.map((a) => a.ticketKey));
  const inSource = state.tickets.filter((t) => !working.has(t.key) && shown.includes(t.source));
  renderSourceFilter(store, connected, inSource);

  // Rebuilt around the ask card rather than through it: taking it out of the
  // page, even to put it straight back, drops its focus and closes its
  // dropdown.
  for (const child of [...list.childNodes]) if (child !== ask.node) child.remove();
  if (ask.node.parentNode !== list) list.appendChild(ask.node);
  const above = (node: HTMLElement): void => void list.insertBefore(node, ask.node);

  const tracker = state.health.tracker;
  if (!connected.includes(tracker.id) && tracker.status === 'unconfigured') {
    above(connectTrackerCard(store, tracker.id));
  }
  for (const failure of sourceFailures(state.health, shown)) above(sourceErrorCard(store, failure));

  const queued = new Set(state.queue.map((q) => q.ticketKey));
  const inAssignment = state.assignedToMeOnly ? inSource.filter((t) => t.assignedToMe !== false) : inSource;
  const inStatus = inAssignment.filter((t) => !t.status || !state.hiddenStatuses.includes(statusKey(t.status)));
  const open = inStatus.filter((t) =>
    matches(state.ticketSearch, [displayKey(t.key), t.summary, t.type, t.status?.replace(/_/g, ' ')]),
  );

  const running = state.agents.filter(countsAgainstHireLimit).length;
  const deskFree = running < state.limits.maxConcurrentAgents;
  ask.update(deskFree);
  renderOpen(store, list, { open, inStatus, inAssignment, inSource, connected, shown, queued, deskFree });
}

function renderOpen(
  store: Store,
  list: HTMLElement,
  { open, inStatus, inAssignment, inSource, connected, shown, queued, deskFree }: {
    open: Ticket[];
    inStatus: Ticket[];
    inAssignment: Ticket[];
    inSource: Ticket[];
    connected: SourceId[];
    shown: SourceId[];
    queued: Set<string>;
    deskFree: boolean;
  },
): void {
  const { state } = store;

  if (!open.length && inStatus.length) {
    list.appendChild(el('div', 'empty', `No ticket matches "${state.ticketSearch.trim()}".`));
    return;
  }

  if (!open.length && inSource.length && !inAssignment.length) {
    list.appendChild(el('div', 'empty', 'No available tickets are assigned to you. Turn off Assigned to me under Filter to see everything.'));
    return;
  }

  if (!open.length && inSource.length) {
    list.appendChild(el('div', 'empty', 'Every status on the board is hidden. Show one under Filter.'));
    return;
  }

  if (!open.length) {
    const names = connected.map((s) => SOURCE_LABEL[s]).join(' and ');
    const shownTickets = state.tickets.filter((t) => shown.includes(t.source));
    list.appendChild(
      el('div', 'empty', connected.length && !shown.length
        ? `${names} ${connected.length === 1 ? 'is' : 'are'} hidden. Show ${connected.length === 1 ? 'it' : 'one'} under Filter.`
        : !shown.length
          ? 'Nothing is connected. Connect a tracker or 8090 in Settings, or ask for anything above.'
          : shownTickets.length
            ? 'Every ticket on the board already has a worker.'
            : `Nothing open is available. New ${shown.map((s) => SOURCE_NOUN[s]).join(' and ')} show up here.`),
    );
    return;
  }

  for (const ticket of open) {
    list.appendChild(ticketCard(store, ticket, { deskFree, queued: queued.has(ticket.key) }));
  }

  if (!deskFree) {
    list.appendChild(
      el(
        'div',
        'empty',
        `${state.limits.maxConcurrentAgents} workers are already running, which is the limit. Answer or finish one to hire again.`,
      ),
    );
  }
}

interface AskCard {
  node: HTMLElement;
  update: (deskFree: boolean) => void;
}

/**
 * Hire a worker for something that has no work order.
 *
 * Sits above the board because plenty of what Tom wants done never becomes an
 * 8090 ticket, and the office was previously unreachable for any of it.
 */
function askCard(store: Store): AskCard {
  const card = el('div', 'ticket ask');
  card.appendChild(el('b', null, 'Ask for anything'));
  card.appendChild(el('span', 'm', 'No work order needed. Pick a repo, or none at all to just research.'));

  const input = el('textarea', 'ask-input');
  input.rows = 2;
  input.placeholder = 'e.g. find out why the column lock test is flaky and fix it';
  // The paperclip sits in the box's corner, beside the mic when there is one.
  const picker = el('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', () => {
    files.add(picker.files ?? []);
    picker.value = '';
  });
  const attachBtn = attachButton('voice-attach');
  attachBtn.addEventListener('click', () => picker.click());
  const field = el('div', 'voice-field');
  field.append(input, attachBtn, picker);
  card.appendChild(field);

  // Files that explain the job go with the hire, so the worker has them from
  // its first turn instead of in a follow-up message.
  const attachList = el('div', 'attach-list');
  card.appendChild(attachList);
  const files = attachTray(attachList, { onError: (message) => store.patch({ lastError: message }) });
  wireFileDrop(card, input, (dropped) => files.add(dropped));

  const repo = repoMultiPicker(store, { onChange: () => setup.refresh() });
  card.appendChild(repo.node);
  const setup = hireSetup(store, ASK_SETUP, () => repo.value().primary);
  card.appendChild(setup.node);

  const btn = el('button', 'btn small primary', 'Hire a worker');
  // Discuss hires the same worker, told to talk the request through and ask
  // its questions first. Its plan waits for Start work, even in full auto.
  const discussBtn = el('button', 'btn small', 'Discuss');
  btn.title = 'Reads your request and comes back with a plan';
  discussBtn.title = 'Talks your request through with you first, and comes up with a plan together';
  const buttons = [btn, discussBtn];
  const setDisabled = (on: boolean) => buttons.forEach((b) => (b.disabled = on));
  const hire = async (clicked: HTMLButtonElement, discuss: boolean) => {
    const task = input.value.trim();
    if (!task) {
      input.focus();
      return;
    }
    // Research is the only job allowed to run with no repo, so ticking "no
    // repo" implies it rather than failing with a rule Tom never agreed to.
    // Ticking nothing at all is not the same, so that asks for a repo.
    const { primary: typed, extras } = repo.value();
    if (!hireKind(repo.pick(), typed)) {
      repo.open();
      return;
    }
    setDisabled(true);
    let path: string | null;
    try {
      path = await localRepo(store, typed, card, row);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
      setDisabled(false);
      return;
    }
    if (typed && !path) {
      setDisabled(false);
      return;
    }
    const kind = path ? 'ask' : 'research';
    // Read only beside a repo of its own; with none it reads anywhere already.
    const extraRepos = path ? extras.filter((p) => p !== path) : [];

    const label = clicked.textContent;
    clicked.textContent = 'Finding a desk…';
    try {
      const attachments = await Promise.all(files.files.map(toUpload));
      const agent = await api.hire({
        task,
        kind,
        ...(path ? { repo: path } : {}),
        ...(extraRepos.length ? { extraRepos } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(discuss ? { discuss: true } : {}),
        ...setup.value(),
        ...hireRunnerChoice(hireRunnerView(store.state.enabledRunners, store.state.health.runners, store.state.runner)),
      });
      setup.forget();
      input.value = '';
      voice.sent();
      files.clear();
      repo.reset(path);
      void store.loadRepos(); // a path typed by hand is now one of his repos
      store.patch({ ticketPanelOpen: false });
      store.selectAgent(agent.id);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    } finally {
      setDisabled(false);
      clicked.textContent = label;
    }
  };

  btn.addEventListener('click', () => void hire(btn, false));
  discussBtn.addEventListener('click', () => void hire(discussBtn, true));
  // Enter sends, so a one-line request does not need a trip to the mouse.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void hire(btn, false);
    }
  });

  const row = el('div', 'row hire-actions');
  row.append(btn, discussBtn);
  card.appendChild(row);
  const voice = mountVoice(store, input, { in: card, before: row });

  const full = el('span', 'why', 'The running-worker limit is reached, so this one would wait at the door.');
  card.appendChild(full);
  return {
    node: card,
    update: (deskFree) => {
      full.hidden = deskFree;
      repo.refresh();
      setup.refresh();
    },
  };
}

/**
 * Choices made on a hire card, by ticket. The board is rebuilt whenever the
 * tickets refresh, and a model picked a minute ago should still be picked.
 */
const chosenSetup = new Map<string, WorkerSetup>();
const chosenPersona = new Map<string, string>();
const chosenName = new Map<string, string>();
const chosenRepos = new Map<string, RepoPickerState>();
/** The random first name a card suggests, kept so it does not change under the reader. */
const suggestedFirst = new Map<string, string>();
const openSetup = new Set<string>();
const ASK_SETUP = '\u0000ask';

/**
 * Who to hire: an agent, which brings its setup, look, instructions and
 * name. Persona selection is explicit in a picker; worker settings remain
 * available separately so one button does not have two unrelated meanings.
 */
function hireSetup(
  store: Store,
  key: string,
  /** The repo picked for the hire, by path; its agents are offered first. */
  repoPath: () => string | null,
): {
  node: HTMLElement;
  value: () => Pick<HireRequest, 'persona' | 'name'> & WorkerSetup;
  forget: () => void;
  refresh: () => void;
} {
  const wrap = el('div', 'hire-setup');

  // The agent summary stays visible, with an explicit picker action.
  const line = el('div', 'row setup-line');
  const lineText = el('div', 'setup-line-text');
  const actions = el('div', 'setup-actions');
  const chooseButton = el('button', 'btn small ghost', 'Choose agent');
  chooseButton.type = 'button';
  chooseButton.setAttribute('aria-haspopup', 'dialog');
  const settingsButton = el('button', 'btn small ghost', 'Worker settings');
  settingsButton.type = 'button';
  actions.append(chooseButton, settingsButton);
  line.append(lineText, actions);
  wrap.appendChild(line);

  const repoAgents = (): RepoPersona[] => {
    const path = repoPath();
    return path ? store.state.repoPersonas.filter((p) => p.repoPath === path) : [];
  };
  const persona = (): Persona | RepoPersona | undefined => {
    const id = chosenPersona.get(key);
    if (!id) return undefined;
    return isRepoPersonaId(id) ? repoAgents().find((p) => p.id === id) : store.state.personas.find((p) => p.id === id);
  };
  const body = el('div', 'hire-setup-body');

  const picker = el('dialog', 'agent-picker');
  picker.setAttribute('aria-label', 'Choose an agent');
  const pickerHead = el('div', 'agent-picker-head');
  pickerHead.append(
    el('div', 'agent-picker-title', 'Choose an agent'),
    el('p', 'm', 'Pick a global agent or one defined by the selected repository.'),
  );
  const closePicker = el('button', 'btn small ghost', 'Close');
  closePicker.type = 'button';
  closePicker.addEventListener('click', () => picker.close());
  pickerHead.appendChild(closePicker);
  picker.appendChild(pickerHead);

  // Empty means the automatic name, which the placeholder shows.
  const nameRow = el('label', 'setup-field');
  nameRow.appendChild(el('span', 'setup-label', 'Name'));
  const nameInput = el('input', 'setup-name');
  nameInput.type = 'text';
  nameInput.maxLength = WORKER_NAME_MAX;
  nameInput.value = chosenName.get(key) ?? '';
  nameInput.addEventListener('input', () => {
    if (nameInput.value.trim()) chosenName.set(key, nameInput.value);
    else chosenName.delete(key);
    describe();
  });
  nameRow.appendChild(nameInput);

  const pickerContent = el('div', 'agent-picker-content');
  const globalSection = el('section', 'agent-picker-section');
  globalSection.appendChild(el('h4', null, 'Global agents'));
  const globalList = el('div', 'agent-list');
  globalList.setAttribute('role', 'radiogroup');
  globalList.setAttribute('aria-label', 'Global agents');
  globalSection.appendChild(globalList);
  pickerContent.appendChild(globalSection);
  const repoSection = el('section', 'agent-picker-section repo-agent-box');
  repoSection.setAttribute('role', 'radiogroup');
  pickerContent.appendChild(repoSection);
  picker.appendChild(pickerContent);
  wrap.appendChild(picker);
  // Outside the picker, since picking an agent changes the name it suggests.
  body.appendChild(nameRow);

  // Filled again when the personas or the repo change: the ask card outlives
  // the first snapshot, which is where the lists come from.
  let listed: unknown[] = [];
  const tiles: Array<{ id: string; node: HTMLButtonElement }> = [];
  const markPicked = (): void => {
    const picked = persona()?.id ?? '';
    for (const t of tiles) t.node.setAttribute('aria-checked', String(t.id === picked));
  };
  const agentRow = (id: string, title: string, description: string, look: WorkerLook, hint: string): HTMLButtonElement => {
    const row = el('button', 'agent-list-row');
    row.type = 'button';
    row.setAttribute('role', 'radio');
    if (hint) row.title = hint;
    const url = portrait(look, id || 'none');
    if (url) {
      const img = el('img');
      img.src = url;
      img.alt = '';
      row.appendChild(img);
    }
    const text = el('span', 'agent-list-text');
    text.append(el('b', null, title), el('span', 'm', description || 'No description'));
    row.appendChild(text);
    row.addEventListener('click', () => choose(id));
    tiles.push({ id, node: row });
    return row;
  };
  const fillRepoAgents = (agents: RepoPersona[]): void => {
    clear(repoSection);
    repoSection.hidden = !agents.length;
    if (!agents.length) return;
    const repo = agents[0]!.repo;
    repoSection.setAttribute('aria-label', `Agents from ${repo}`);
    repoSection.appendChild(el('h4', null, `From ${repo}`));
    for (const p of agents) {
      repoSection.appendChild(agentRow(
        p.id,
        p.title,
        p.description,
        p.look,
        [p.description, `Defined in ${p.repo}'s ${p.file}. Edit it there.`].filter(Boolean).join('\n\n'),
      ));
    }
  };
  const fill = (): void => {
    const agents = repoAgents();
    const inputs = [store.state.personas, store.state.repoPersonas, repoPath()];
    if (inputs.every((v, i) => v === listed[i])) return;
    listed = inputs;
    const own = store.state.personas;
    clear(globalList);
    tiles.length = 0;
    fillRepoAgents(agents);
    const options: Array<{ id: string; name: string; description: string; look: WorkerLook; hint: string }> = [
      { id: '', name: 'No agent', description: 'Use the worker defaults without additional instructions.', look: DEFAULT_LOOK, hint: 'The defaults from Settings, no extra instructions' },
      ...own.map((p) => ({ id: p.id, name: p.name, description: p.description || p.instructions, look: p.look, hint: p.instructions })),
    ];
    for (const o of options) {
      globalList.appendChild(agentRow(o.id, o.name, o.description, o.look, o.hint));
    }
    markPicked();
  };
  fill();

  // A repo agent runs as the defaults do, on the model its file names or the nearest the runner has.
  const current = (): WorkerSetup => {
    const chosen = chosenSetup.get(key);
    if (chosen) return chosen;
    const p = persona();
    if (p && 'agentModel' in p) return { ...store.state.workerDefaults, model: nearestModel(p.agentModel, store.state.health.modelMenu) };
    return p ?? store.state.workerDefaults;
  };
  // Names are random, so the card picks one, shows it and sends it: the
  // worker gets the name the card showed. Picked again only if someone else
  // has taken it since.
  const autoName = (): string => {
    const taken = store.state.agents.map((a) => a.name);
    const used = new Set(taken.map((n) => (n.split(' - ').pop() ?? n).toLowerCase()));
    let first = suggestedFirst.get(key);
    if (!first || used.has(first.toLowerCase())) {
      first = autoWorkerName(null, taken);
      suggestedFirst.set(key, first);
    }
    const p = persona();
    return p ? `${p.name} - ${first}` : first;
  };
  const describe = (): void => {
    const p = persona();
    const typed = chosenName.get(key)?.replace(/\s+/g, ' ').trim();
    nameInput.placeholder = autoName();
    const who = typed ? (p ? `${typed} (${p.name})` : typed) : autoName();
    clear(lineText);
    for (const line of [{ label: 'Agent', text: who }, ...setupLines(current(), store.state.health.modelMenu)]) {
      const row = el('span', 'm setup-line-row');
      row.append(el('span', 'setup-label', `${line.label}:`), el('span', null, line.text));
      lineText.appendChild(row);
    }
  };
  describe();

  let controls: HTMLElement | null = null;
  const show = (): void => {
    controls = setupControls(current(), store.state.health.modelMenu, (setup) => {
      chosenSetup.set(key, setup);
      describe();
    }).node;
    body.appendChild(controls);
    wrap.appendChild(body);
    settingsButton.textContent = 'Done';
    settingsButton.setAttribute('aria-expanded', 'true');
    openSetup.add(key);
  };
  const hide = (): void => {
    controls?.remove();
    controls = null;
    body.remove();
    settingsButton.textContent = 'Worker settings';
    settingsButton.setAttribute('aria-expanded', 'false');
    openSetup.delete(key);
  };
  chooseButton.addEventListener('click', () => {
    if (!picker.open) picker.showModal();
  });
  picker.addEventListener('click', (event) => {
    if (event.target === picker) picker.close();
  });
  settingsButton.addEventListener('click', () => (controls ? hide() : show()));
  if (openSetup.has(key)) show();
  else settingsButton.setAttribute('aria-expanded', 'false');

  // An agent brings its own setup, replacing anything changed by hand.
  function choose(id: string): void {
    if (id) chosenPersona.set(key, id);
    else chosenPersona.delete(key);
    chosenSetup.delete(key);
    if (picker.open) picker.close();
    markPicked();
    describe();
    if (controls) {
      hide();
      show();
    }
  }

  return {
    node: wrap,
    value: () => {
      const p = persona();
      const { permission, model, effort } = current();
      const name = chosenName.get(key)?.trim() || autoName();
      return { ...(p ? { persona: p.id } : {}), name, permission, model, effort };
    },
    forget: () => {
      chosenSetup.delete(key);
      chosenPersona.delete(key);
      chosenName.delete(key);
      suggestedFirst.delete(key);
      nameInput.value = '';
      if (picker.open) picker.close();
      markPicked();
      hide();
      describe();
    },
    refresh: () => {
      fill();
      describe();
    },
  };
}

/**
 * Makes sure the repo typed for a hire is on this Mac. A folder is used as
 * it is; a GitHub name or link is cloned first, once Tom says yes in the card,
 * or used where it was cloned before. Resolves the folder to hire with, the
 * empty value for no repo, or null when he cancels the clone.
 */
async function localRepo(store: Store, typed: string | null, card: HTMLElement, before: HTMLElement): Promise<string | null> {
  if (!typed) return typed;
  const found = await api.lookupRepo(typed);
  if (found.kind === 'path') return typed;
  if (found.alreadyCloned) return found.target;

  const box = el('div', 'clone-ask');
  box.appendChild(el('span', null, `${found.name} is not on this Mac yet. Clone it into ${found.target}?`));
  const actions = el('div', 'actions');
  const yes = el('button', 'btn small primary', 'Clone and hire');
  yes.type = 'button';
  const no = el('button', 'btn small', 'Cancel');
  no.type = 'button';
  actions.append(yes, no);
  box.appendChild(actions);
  card.insertBefore(box, before);

  const go = await new Promise<boolean>((resolve) => {
    yes.addEventListener('click', () => resolve(true));
    no.addEventListener('click', () => resolve(false));
  });
  if (!go) {
    box.remove();
    return null;
  }
  clear(box);
  box.appendChild(el('span', null, `Cloning ${found.name}… A big repo can take a minute or two.`));
  try {
    const { repo, repos } = await api.cloneRepo(typed);
    store.patch({ repos });
    return repo.path;
  } finally {
    box.remove();
  }
}

function ticketCard(
  store: Store,
  ticket: Ticket,
  opts: { deskFree: boolean; queued: boolean },
): HTMLElement {
  const card = el('div', 'ticket');

  const head = el('div', 'row');
  const title = el('div', 'key');
  title.appendChild(sourceBadge(ticket.source));
  title.appendChild(el('b', null, displayKey(ticket.key)));
  if (isStale(store, ticket.source)) title.appendChild(el('span', 'stale', 'stale'));
  head.appendChild(title);
  if (ticket.url) head.appendChild(openInSource(ticket.url, ticket.key));
  card.appendChild(head);

  card.appendChild(el('span', 't', ticket.summary));

  const meta = [ticket.type, ticket.status?.replace(/_/g, ' '), ticket.phase ? `phase ${ticket.phase}` : null]
    .filter(Boolean)
    .join(' · ');
  if (meta) card.appendChild(el('span', 'm', meta));

  // 8090 does not say which repo a work order belongs to, so the office can
  // only guess at the default. Showing the guess, and letting it be changed,
  // beats quietly opening a worktree in the wrong checkout.
  const mustChoose = ticket.source !== '8090' && !ticket.repo;
  const initial = chosenRepos.get(ticket.key);
  const repo = repoMultiPicker(store, {
    allowNone: false,
    selected: ticket.repo,
    mustChoose,
    ...(initial ? { initial } : {}),
    onChange: () => {
      chosenRepos.set(ticket.key, repo.saved());
      setDisabled(Boolean(reason) || opts.queued || !repo.value().primary);
      setup.refresh();
    },
  });
  card.appendChild(repo.node);
  const setup = hireSetup(store, ticket.key, () => repo.value().primary);
  card.appendChild(setup.node);

  const reason = !opts.deskFree ? 'The running-worker limit is reached.' : null;

  const btn = el('button', 'btn small primary', opts.queued ? 'Queued at the door' : 'Hire a worker');
  // Discuss hires the same worker, told to talk the ticket through and ask
  // its questions first. Its plan waits for Start work, even in full auto.
  const discussBtn = el('button', 'btn small', 'Discuss');
  if (!opts.queued) btn.title = 'Reads the ticket and comes back with a plan';
  discussBtn.title = 'Talks the ticket through with you first, and comes up with a plan together';
  const buttons = [btn, discussBtn];
  const setDisabled = (on: boolean) => buttons.forEach((b) => (b.disabled = on));
  setDisabled(Boolean(reason) || opts.queued || !repo.value().primary);
  const hire = async (clicked: HTMLButtonElement, discuss: boolean) => {
    const { primary: typed, extras } = repo.value();
    setDisabled(true);
    let path: string | null;
    try {
      path = await localRepo(store, typed, card, actions);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
      setDisabled(false);
      return;
    }
    if (typed && !path) {
      setDisabled(false);
      return;
    }
    // A clone of a typed repo lands at a new path; it is not also read beside itself.
    const extraRepos = extras.filter((p) => p !== path);
    const label = clicked.textContent;
    clicked.textContent = 'Finding a desk…';
    try {
      const agent = await api.hire({
        ticketKey: ticket.key,
        ...(path ? { repo: path } : {}),
        ...(extraRepos.length ? { extraRepos } : {}),
        ...(discuss ? { discuss: true } : {}),
        ...setup.value(),
        ...hireRunnerChoice(hireRunnerView(store.state.enabledRunners, store.state.health.runners, store.state.runner)),
      });
      setup.forget();
      chosenRepos.delete(ticket.key);
      void store.loadRepos();
      store.patch({ ticketPanelOpen: false });
      store.selectAgent(agent.id);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
      setDisabled(false);
      clicked.textContent = label;
    }
  };
  btn.addEventListener('click', () => void hire(btn, false));
  discussBtn.addEventListener('click', () => void hire(discussBtn, true));
  const actions = el('div', 'row hire-actions');
  actions.append(btn, discussBtn);
  // Queued, the one button says so; a second would only repeat it.
  discussBtn.hidden = opts.queued;
  card.appendChild(actions);

  if (reason) card.appendChild(el('span', 'why', reason));
  return card;
}

/**
 * Opens the work order in 8090. An anchor rather than a button so the usual
 * browser affordances (middle click, copy link) still work.
 */
function openInSource(url: string, key: string): HTMLElement {
  const where = SOURCE_LABEL[splitTicketId(key)?.source ?? '8090'];
  const shown = displayKey(key);
  const link = el('a', 'btn small ghost', 'Open');
  const a = link as HTMLAnchorElement;
  a.href = url;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.title = `Open ${shown} in ${where}`;
  a.setAttribute('aria-label', `Open ${shown} in ${where}`);
  // The card is not itself clickable, but keep clicks from reaching the stage.
  a.addEventListener('click', (e) => e.stopPropagation());
  return link;
}

export const SOURCE_LABEL: Record<SourceId, string> = { github: 'GitHub', '8090': '8090' };
const SOURCE_NOUN: Record<SourceId, string> = {
  github: 'GitHub issues',
  '8090': '8090 work orders',
};

/** How a source's last poll went. Every connected tracker can be polled. */
function sourceStatus(health: Health, source: SourceId): SourceStatus {
  if (source === '8090') return health.factory;
  return health.trackers[source]?.status ?? 'disabled';
}

/** A source Tom can show or hide. Off and signed-out sources are not a filter. */
function connectedSources(store: Store): SourceId[] {
  const { health } = store.state;
  const live = (status: string) => status === 'ok' || status === 'error' || status === 'connecting';
  return (['github', '8090'] as const).filter((s) => live(sourceStatus(health, s)));
}

/** Every coding agent, as a dropdown lists them. */
export const RUNNERS: Array<{ value: RunnerChoice; label: string }> = RUNNER_CHOICES.map((value) => ({ value, label: runnerLabel(value) }));

/** The agent new hires go to: a pick of the ones turned on and ready, or a way to set one up. */
export function renderRunner(store: Store): void {
  const row = $<HTMLElement>('hireRunner');
  clear(row);
  const label = 'Agent for new hires';
  row.appendChild(el('span', 'm', label));
  const { enabledRunners, health, runner } = store.state;
  const view = hireRunnerView(enabledRunners, health.runners, runner);
  if (view.kind === 'checking') {
    row.appendChild(el('span', 'hire-runner-name m', 'Checking coding agents…'));
    return;
  }
  if (view.kind === 'none') {
    const setUp = el('button', 'link-button', 'Set up a coding agent');
    setUp.type = 'button';
    setUp.addEventListener('click', openRunnerSettings);
    row.appendChild(setUp);
    return;
  }
  const options = RUNNERS.filter((r) => view.runners.includes(r.value));
  const select = dropdown(options, view.value, label, async (mode) => {
    select.disabled = true;
    try {
      const saved = await api.saveRunner(mode);
      store.patch({ runner: saved.mode, enabledRunners: saved.enabledRunners });
    } catch (err) {
      select.value = store.state.runner;
      store.patch({ lastError: (err as Error).message });
    } finally {
      select.disabled = false;
    }
  });
  row.appendChild(select);
}

function renderSourceFilter(store: Store, connected: SourceId[], tickets: Ticket[]): void {
  const pop = $<HTMLElement>('sourceFilter');
  const { state } = store;
  const focused = pop.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.filter : undefined;
  clear(pop);

  const box = (key: string, text: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement => {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.dataset.filter = key;
    input.addEventListener('change', () => onChange(input.checked));
    label.appendChild(input);
    label.appendChild(el('span', null, text));
    return label;
  };
  const toggled = (list: string[], key: string, show: boolean): string[] => {
    const hidden = new Set(list);
    if (show) hidden.delete(key);
    else hidden.add(key);
    return [...hidden];
  };

  if (connected.length) {
    pop.appendChild(el('span', 'setup-group', 'Source'));
    for (const source of connected) {
      pop.appendChild(box(`source:${source}`, SOURCE_LABEL[source], !state.hiddenSources.includes(source), (show) =>
        store.patch({ hiddenSources: toggled(store.state.hiddenSources, source, show) as SourceId[] }),
      ));
    }
  }

  pop.appendChild(el('span', 'setup-group', 'Assignment'));
  pop.appendChild(box('assigned-to-me', 'Assigned to me', state.assignedToMeOnly, (checked) =>
    store.patch({ assignedToMeOnly: checked }),
  ));

  const statuses = new Map<string, string>();
  for (const t of tickets) if (t.status) statuses.set(statusKey(t.status), statusLabel(t.status));
  for (const key of state.hiddenStatuses) if (!statuses.has(key)) statuses.set(key, statusLabel(key));

  pop.appendChild(el('span', 'setup-group', 'Status'));
  for (const [key, text] of [...statuses].sort((a, b) => a[1].localeCompare(b[1]))) {
    pop.appendChild(box(`status:${key}`, text, !state.hiddenStatuses.includes(key), (show) =>
      store.patch({ hiddenStatuses: toggled(store.state.hiddenStatuses, key, show) }),
    ));
  }

  if (focused) pop.querySelector<HTMLInputElement>(`input[data-filter="${CSS.escape(focused)}"]`)?.focus();

  const checked = pop.querySelectorAll('input:checked').length;
  const count = $<HTMLElement>('filterCount');
  count.hidden = false;
  count.textContent = String(checked);
  count.title = `${checked} checked`;
}

function statusKey(status: string): string {
  return status.trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

function statusLabel(status: string): string {
  return statusKey(status).replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourceBadge(source: SourceId): HTMLElement {
  return el('span', `src src-${source}`, SOURCE_LABEL[source]);
}

function isStale(store: Store, source: SourceId): boolean {
  const { health } = store.state;
  return sourceStatus(health, source) !== 'ok';
}

export function sourceSummary(health: Health): string {
  const part = (name: string, status: string, lastPoll: string | null) =>
    status === 'ok' ? `${name} polled ${ago(lastPoll)}` : null;
  return [
    ...(['github'] as const).map((source) => {
      const h = health.trackers[source];
      return part(SOURCE_LABEL[source], h.status, h.lastPoll);
    }),
    part('8090', health.factory, health.factoryLastPoll),
  ]
    .filter(Boolean)
    .join(' · ') || 'Anything you ask for';
}

function connectTrackerCard(store: Store, source: SourceId): HTMLElement {
  const card = el('div', 'ticket ask');
  const title = el('div', 'key');
  title.appendChild(sourceBadge(source));
  title.appendChild(el('b', null, `Connect ${SOURCE_LABEL[source]}`));
  card.appendChild(title);
  card.appendChild(el('span', 'm', `Sign in once and your ${SOURCE_NOUN[source]} show up here next to 8090.`));
  const btn = el('button', 'btn small primary', 'Open Settings');
  btn.addEventListener('click', () => store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false }));
  card.appendChild(btn);
  return card;
}

export interface SourceFailure {
  source: SourceId;
  error: string;
  lastPoll: string | null;
}

/** The shown sources whose last check failed, in the order the board lists them. */
export function sourceFailures(health: Health, shown: readonly SourceId[]): SourceFailure[] {
  const failures: SourceFailure[] = [];
  for (const source of ['github'] as const) {
    const h = health.trackers[source];
    if (shown.includes(source) && h.status === 'error') failures.push({ source, error: h.error || 'The last check failed.', lastPoll: h.lastPoll });
  }
  if (shown.includes('8090') && health.factory === 'error') {
    failures.push({ source: '8090', error: health.factoryError || 'The last check failed.', lastPoll: health.factoryLastPoll });
  }
  return failures;
}

/** When Tom last pressed Reconnect on each source, so a retry that failed again says so. */
const retried = new Map<SourceId, string>();

/** A source that is signed in but whose last check failed: what went wrong, and a way to try again. */
export function sourceErrorCard(store: Store, { source, error, lastPoll }: SourceFailure): HTMLElement {
  const card = el('div', 'ticket source-error');
  card.setAttribute('role', 'alert');
  const title = el('div', 'key');
  title.appendChild(sourceBadge(source));
  title.appendChild(el('b', null, `Can't load ${SOURCE_NOUN[source]}`));
  card.appendChild(title);
  const message = el('span', 'error-message', error);
  card.appendChild(message);
  const tried = retried.get(source);
  const when = [lastPoll ? `Last worked ${ago(lastPoll)}.` : 'Has not worked since the office started.'];
  if (tried) when.push(`Tried again ${ago(tried)}.`);
  card.appendChild(el('span', 'm', when.join(' ')));

  const actions = el('div', 'row source-error-actions');
  const reconnect = el('button', 'btn small primary', 'Reconnect');
  reconnect.type = 'button';
  reconnect.addEventListener('click', async () => {
    reconnect.disabled = true;
    reconnect.classList.add('busy');
    reconnect.textContent = 'Reconnecting…';
    retried.set(source, new Date().toISOString());
    try {
      // Redraws the board, and this card with it, from what the checks found.
      const { tickets, health } = await api.refreshTickets();
      store.patch({ tickets, health });
    } catch (err) {
      message.textContent = (err as Error).message;
    } finally {
      reconnect.disabled = false;
      reconnect.classList.remove('busy');
      reconnect.textContent = 'Reconnect';
    }
  });
  const settings = el('button', 'link-button', 'Open Settings');
  settings.type = 'button';
  settings.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-workspace-tickets', { detail: { source } })));
  actions.append(reconnect, settings);
  card.appendChild(actions);
  return card;
}

function matches(query: string, fields: Array<string | null | undefined>): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}
