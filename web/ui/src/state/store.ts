import type {
  Agent,
  DoneEntry,
  Health,
  Idea,
  MessageStyle,
  Limits,
  MemoryActivity,
  Message,
  RepoChoice,
  ServerEvent,
  SourceId,
  Snapshot,
  Onboarding,
  TicketTarget,
  Ticket,
  Persona,
  RepoPersona,
  RunnerChoice,
  Toast,
  TrackingFact,
  WorkerSetup,
  DesignerLogEntry,
  OfficeGeneration,
  OfficeSummary,
  VoiceSettings,
} from '@shared';
import { CLAUDE_MODEL_MENU, OFFICE_ID, RUNNER_CHOICES, USER_ROOM_PREFIX } from '@shared';
import { api } from '../net/client.js';

export interface UiState {
  tickets: Ticket[];
  agents: Agent[];
  /** Completed and fired workers in the Workers list. */
  previous: Agent[];
  messages: Message[];
  done: DoneEntry[];
  health: Health;
  limits: Limits;
  workerDefaults: WorkerSetup;
  personas: Persona[];
  /** The agents of the repos in the library, offered in the Hire panel for work in their repo. */
  repoPersonas: RepoPersona[];
  runner: RunnerChoice;
  /** The coding agents turned on in Settings. */
  enabledRunners: RunnerChoice[];
  ideas: Idea[];
  /** Inbox unread message count, for the HUD badge. */
  inboxUnreadCount: number;
  ticketTarget: TicketTarget;
  messageStyle: MessageStyle;
  repos: RepoChoice[];
  queue: Array<{ ticketKey: string; summary: string }>;
  /** Reviewers waiting for a slot, in queue order. */
  reviewQueue: Array<{ workerId: string; workerName: string; queuedAt: string }>;
  /** Partial agent text for the turn in flight, keyed by agent id. */
  streaming: Map<string, string>;
  /**
   * When anything was last heard about each agent, as a local clock reading.
   *
   * Kept here rather than on the server because the question it answers is
   * whether the whole chain is alive — agent, server and socket. A worker that
   * is thinking says nothing at all, and so does a dead one.
   */
  heardAt: Map<string, number>;
  selectedAgentId: string | null;
  /** The History list is open in the panel body instead of the chat. */
  showHistory: boolean;
  /** The Fire confirmation is showing above the chat. */
  confirmFire: boolean;
  /** The standing approvals list has taken over the panel body. */
  showApprovals: boolean;
  /** Connected sources Tom has hidden in the hire panel. */
  hiddenSources: SourceId[];
  hiddenStatuses: string[];
  assignedToMeOnly: boolean;
  ticketSearch: string;
  ticketPanelOpen: boolean;
  settingsOpen: boolean;
  messagesOpen: boolean;
  onboarding: Onboarding;
  /** Set once the first snapshot has arrived, so what it holds is not taken for news. */
  loaded: boolean;
  workersOpen: boolean;
  ideasOpen: boolean;
  /** Settings is open on its Memory tab. Only ever true while settingsOpen is. */
  memoryOpen: boolean;
  /**
   * The repo the Memory tab was asked to show, as when the book beside a
   * worker's name is clicked. Null leaves the choice to the tab.
   */
  memoryRepo: string | null;
  view: View;
  /** The office's room: a built-in style, or `user:<id>` for a generated office. */
  room: RoomChoice;
  /** The saved generated offices, as the picker lists them. */
  offices: OfficeSummary[];
  /** Generations in progress or recently finished. */
  generations: OfficeGeneration[];
  /** Whether `offices` has been read from the server, so a missing office can be told from one not yet listed. */
  officesLoaded: boolean;
  connected: boolean;
  /** Non-fatal messages from a failed command, shown in the panel. */
  lastError: string | null;
  /** Voice input's switches and speech model. Kept current without a redraw; see onVoice. */
  voice: VoiceSettings;
}

type Listener = (state: UiState) => void;

const EMPTY_HEALTH: Health = {
  factory: 'connecting', factoryError: null, factoryLastPoll: null,
  tracker: { id: 'github', status: 'connecting', error: null, lastPoll: null },
  trackers: {
    github: { id: 'github', status: 'disabled', error: null, lastPoll: null },
  },
  runners: {
    ollama: { status: 'checking', error: null, version: null },
    claude: { status: 'checking', error: null, version: null },
    acp: { status: 'checking', error: null, version: null },
    copilot: { status: 'checking', error: null, version: null },
    codex: { status: 'checking', error: null, version: null },
  },
  modelMenu: CLAUDE_MODEL_MENU,
};

const FILTERS_KEY = 'agent-corp.ticket-filters';
const VIEW_KEY = 'agent-corp.view';
const ROOM_KEY = 'agent-corp.room';
const TURN_KEY = 'agent-corp.turn';

/** How the workers are shown: in the office room, or as cards. */
export const VIEWS = ['office', 'cards'] as const;
export type View = (typeof VIEWS)[number];

/** The built-in rooms, each with a look of its own. */
export const ROOMS = ['office'] as const;
export type Room = (typeof ROOMS)[number];

/**
 * The office's room style, picked in Settings: only Retro is available.
 */
export const ROOM_PICKS = [...ROOMS] as const;
export type RoomPick = (typeof ROOM_PICKS)[number];

/** A room picked in Settings, or a generated office as `user:<id>`. */
export type RoomChoice = RoomPick | `user:${string}`;

/** The id inside a `user:<id>` choice, or null for a built-in room. */
export function userOfficeId(choice: RoomChoice): string | null {
  return choice.startsWith(USER_ROOM_PREFIX) ? choice.slice(USER_ROOM_PREFIX.length) : null;
}

/** The choice for a generated office. */
export function userRoom(id: string): RoomChoice {
  return `${USER_ROOM_PREFIX}${id}`;
}

/**
 * The built-in room a choice is drawn in: itself, or for a generated office its base.
 */
export function baseRoom(choice: RoomChoice, offices: readonly Pick<OfficeSummary, 'id' | 'base'>[] = []): Room {
  const id = userOfficeId(choice);
  if (id === null) return choice as Room;
  return offices.find((o) => o.id === id)?.base ?? 'office';
}

export const ROOM_NAMES: Record<RoomPick, string> = {
  office: 'Retro',
};

/** The saved view. A room saved as the view, from before rooms moved to Settings, means the office. */
export function loadView(storage?: Pick<Storage, 'getItem'>): View {
  try {
    return (storage ?? localStorage).getItem(VIEW_KEY) === 'cards' ? 'cards' : 'office';
  } catch {
    return 'office';
  }
}

/** Whether `s` is the choice of a generated office: `user:` and an id the server could have made. */
export function isUserRoom(s: unknown): s is `user:${string}` {
  return typeof s === 'string' && s.startsWith(USER_ROOM_PREFIX) && OFFICE_ID.test(s.slice(USER_ROOM_PREFIX.length));
}

/** The saved room, or the room that was saved as the view before rooms had their own setting. */
export function loadRoom(storage?: Pick<Storage, 'getItem'>): RoomChoice {
  try {
    const s = storage ?? localStorage;
    const saved = s.getItem(ROOM_KEY) ?? s.getItem(VIEW_KEY);
    if (isUserRoom(saved)) return saved;
    return ROOM_PICKS.find((r) => r === saved) ?? 'office';
  } catch {
    return 'office';
  }
}

export function saveRoom(room: RoomChoice, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(ROOM_KEY, room);
  } catch {
    // Storage blocked: the pick lasts until the page reloads.
  }
}

/** How many quarter turns the office view is turned round the room, 0…3. Anything else is the first corner. */
export function loadTurn(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const saved = Number((storage ?? localStorage).getItem(TURN_KEY));
    return Number.isInteger(saved) && saved >= 0 && saved < 4 ? saved : 0;
  } catch {
    return 0;
  }
}

export function saveTurn(turn: number, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(TURN_KEY, String(((Math.round(turn) % 4) + 4) % 4));
  } catch {
    // Storage blocked: the turn lasts until the page reloads.
  }
}

export function saveView(view: View, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(VIEW_KEY, view);
  } catch {}
}

type Filters = Pick<UiState, 'hiddenSources' | 'hiddenStatuses' | 'assignedToMeOnly'>;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function loadFilters(storage?: Pick<Storage, 'getItem'>): Filters {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(FILTERS_KEY) ?? '{}') as Record<string, unknown>;
    return {
      hiddenSources: strings(saved.hiddenSources) as SourceId[],
      hiddenStatuses: strings(saved.hiddenStatuses),
      assignedToMeOnly: saved.assignedToMeOnly === true,
    };
  } catch {
    return { hiddenSources: [], hiddenStatuses: [], assignedToMeOnly: false };
  }
}

export function saveFilters(filters: Filters, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {}
}

/**
 * Mirrors server state on the client.
 *
 * The server is the source of truth, so this only ever applies what arrives
 * over the socket; nothing here invents state of its own except the few
 * fields that are purely about what Tom is looking at.
 */
export class Store {
  private listeners: Listener[] = [];
  private toastListeners: Array<(t: Toast) => void> = [];
  private messageListeners: Array<(m: Message) => void> = [];
  private memoryListeners: Array<(agentId: string, memory: MemoryActivity) => void> = [];
  private officeLogListeners = new Set<(id: string, from: number, entries: DesignerLogEntry[]) => void>();
  private voiceListeners = new Set<(voice: VoiceSettings) => void>();

  state: UiState = {
    tickets: [], agents: [], previous: [], messages: [], done: [],
    health: EMPTY_HEALTH,
    limits: { maxConcurrentAgents: 4, deskCount: 16, maxConcurrentReviewers: 2, reviewEnabled: true },
    workerDefaults: { permission: 'standard', model: null, effort: null },
    personas: [],
    repoPersonas: [],
    runner: 'claude',
    enabledRunners: [...RUNNER_CHOICES],
    ideas: [],
    inboxUnreadCount: 0,
    ticketTarget: { project: null, issueType: null },
    messageStyle: 'technical',
    repos: [],
    queue: [],
    reviewQueue: [],
    streaming: new Map(),
    heardAt: new Map(),
    selectedAgentId: null,
    showHistory: false,
    confirmFire: false,
    showApprovals: false,
    ...loadFilters(),
    ticketSearch: '',
    ticketPanelOpen: false,
    settingsOpen: false,
    messagesOpen: false,
    onboarding: { done: [], skipped: [], tourDismissed: false, tourReplay: null, seenHints: [] },
    loaded: false,
    workersOpen: false,
    ideasOpen: false,
    memoryOpen: false,
    memoryRepo: null,
    view: loadView(),
    room: loadRoom(),
    offices: [],
    generations: [],
    officesLoaded: false,
    connected: false,
    lastError: null,
    voice: { enabled: false, rewrite: false, model: { status: 'none', received: 0, total: 0, error: null } },
  };

  constructor() {
    // Keep the room under its own key, so it outlives a room saved as the view
    // before rooms moved to Settings once the view is next changed.
    saveRoom(this.state.room);
  }

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  onToast(fn: (t: Toast) => void): void {
    this.toastListeners.push(fn);
  }

  onMessage(fn: (m: Message) => void): void {
    this.messageListeners.push(fn);
  }

  /**
   * A worker reading or saving memory. Passed straight on rather than kept on
   * the agent, so a recall does not redraw everything that watches the agents.
   */
  onMemory(fn: (agentId: string, memory: MemoryActivity) => void): void {
    this.memoryListeners.push(fn);
  }

  /**
   * An office designer's log grew. Passed straight on, for the build window
   * open on it, rather than kept: only that window shows it. Returns how to stop listening.
   */
  onOfficeLog(fn: (id: string, from: number, entries: DesignerLogEntry[]) => void): () => void {
    this.officeLogListeners.add(fn);
    return () => this.officeLogListeners.delete(fn);
  }

  /**
   * Voice input changed: switched, or the model downloaded a little more.
   * Kept in the state without telling every listener, since a download says
   * how far it has got a few times a second. Returns how to stop listening.
   */
  onVoice(fn: (voice: VoiceSettings) => void): () => void {
    this.voiceListeners.add(fn);
    return () => this.voiceListeners.delete(fn);
  }

  private setVoice(voice: VoiceSettings): void {
    this.state = { ...this.state, voice };
    for (const fn of this.voiceListeners) fn(voice);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  patch(partial: Partial<UiState>): void {
    this.state = { ...this.state, ...partial };
    if ('hiddenSources' in partial || 'hiddenStatuses' in partial || 'assignedToMeOnly' in partial) {
      const { hiddenSources, hiddenStatuses, assignedToMeOnly } = this.state;
      saveFilters({ hiddenSources, hiddenStatuses, assignedToMeOnly });
    }
    if (partial.view) saveView(partial.view);
    if (partial.room) saveRoom(partial.room);
    this.notify();
    if (partial.lastError && !this.state.selectedAgentId) {
      const toast: Toast = { id: `local-${Date.now()}`, text: partial.lastError, kind: 'error', agentId: null };
      for (const fn of this.toastListeners) fn(toast);
    }
  }

  /** Whether the office speaks in Plain mode, set in Settings. */
  plain(): boolean {
    return this.state.messageStyle === 'plain';
  }

  /** What a worker's bubble says, in the office's message style. */
  bubbleOf(agent: Pick<Agent, 'bubble' | 'bubblePlain'>): string {
    return this.plain() && agent.bubblePlain ? agent.bubblePlain : agent.bubble;
  }

  /**
   * Replaces the list of generated offices. If the office the room is set to
   * is no longer in it, the room goes quietly back to the office: a deleted
   * office must not leave the room drawn from nothing.
   */
  setOffices(offices: OfficeSummary[], generations: OfficeGeneration[]): void {
    const id = userOfficeId(this.state.room);
    const gone = id !== null && !offices.some((o) => o.id === id);
    this.patch({ offices, generations, officesLoaded: true, ...(gone ? { room: 'office' as const } : {}) });
  }

  /** Reads the generated offices from the server. Quiet if it cannot: the list stays as it was. */
  async loadOffices(): Promise<void> {
    try {
      const r = await api.offices();
      this.setOffices(r.offices, r.generations);
    } catch {
      // Older server, or offline: the picker shows the built-in rooms.
    }
  }

  applySnapshot(snap: Snapshot): void {
    const stillHere =
      snap.agents.some((a) => a.id === this.state.selectedAgentId) ||
      snap.previous.some((a) => a.id === this.state.selectedAgentId);
    const previousIds = new Set(snap.previous.map((a) => a.id));
    const kept = this.state.messages.filter(
      (m) => previousIds.has(m.agentId) && !snap.messages.some((n) => n.agentId === m.agentId),
    );
    this.state = {
      ...this.state,
      tickets: snap.tickets,
      agents: snap.agents,
      previous: snap.previous,
      messages: [...snap.messages, ...kept],
      done: snap.done,
      health: snap.health,
      limits: snap.limits,
      workerDefaults: snap.workerDefaults,
      personas: snap.personas,
      repoPersonas: snap.repoPersonas ?? [],
      runner: snap.runner,
      enabledRunners: snap.enabledRunners ?? [...RUNNER_CHOICES],
      ideas: snap.ideas,
      ticketTarget: snap.ticketTarget,
      onboarding: snap.onboarding,
      loaded: true,
      messageStyle: snap.messageStyle,
      queue: snap.queue,
      reviewQueue: snap.reviewQueue ?? [],
      streaming: new Map(),
      // A fresh snapshot is itself news of every agent in it, and on a
      // reconnect it is the only reading available.
      heardAt: new Map(snap.agents.map((a) => [a.id, Date.now()])),
      selectedAgentId: stillHere ? this.state.selectedAgentId : null,
      showHistory: stillHere && this.state.showHistory,
      confirmFire: false,
      showApprovals: stillHere && this.state.showApprovals,
    };
    if (snap.voice) this.setVoice(snap.voice);
    this.notify();
  }

  apply(event: ServerEvent): void {
    const s = this.state;

    // Every event about an agent is a sign of life, whatever it says.
    const about = 'agentId' in event ? event.agentId : 'agent' in event ? event.agent.id : null;
    if (about) s.heardAt.set(about, Date.now());

    switch (event.type) {
      case 'snapshot':
        this.applySnapshot(event.snapshot);
        return;

      case 'ticket.list':
        this.patch({ tickets: event.tickets, health: event.health });
        return;

      case 'offices.updated':
        this.setOffices(event.offices, event.generations);
        return;

      case 'offices.log':
        for (const fn of this.officeLogListeners) fn(event.id, event.from, event.entries);
        return;

      case 'voice':
        this.setVoice(event.voice);
        return;

      case 'health':
        this.patch({ health: event.health });
        return;

      case 'runners':
        this.patch({ runner: event.runner, enabledRunners: event.enabledRunners });
        return;

      case 'agent.created':
        this.patch({
          agents: [...s.agents.filter((a) => a.id !== event.agent.id), event.agent],
          previous: s.previous.filter((a) => a.id !== event.agent.id),
        });
        return;

      case 'agent.ended': {
        const already = s.previous.some((a) => a.id === event.agent.id);
        this.patch({
          agents: s.agents.filter((a) => a.id !== event.agent.id),
          previous: already
            ? s.previous.map((a) => (a.id === event.agent.id ? event.agent : a))
            : [event.agent, ...s.previous],
        });
        return;
      }

      case 'agent.updated':
        this.patch({ agents: s.agents.map((a) => (a.id === event.agent.id ? event.agent : a)) });
        return;

      case 'agent.status': {
        // A turn that ended in an error never becomes a message, so what it
        // streamed would stay in the chat above the error box.
        const streaming = event.status === 'error' && s.streaming.has(event.agentId) ? new Map(s.streaming) : s.streaming;
        if (streaming !== s.streaming) streaming.delete(event.agentId);
        this.patch({
          agents: s.agents.map((a) =>
            a.id === event.agentId ? { ...a, status: event.status, lastError: event.lastError, errorType: event.errorType, errorAction: event.errorAction } : a,
          ),
          streaming,
        });
        return;
      }

      case 'agent.bubble':
        this.patch({
          agents: s.agents.map((a) => (a.id === event.agentId ? { ...a, bubble: event.bubble, bubblePlain: event.plain } : a)),
        });
        return;

      case 'agent.activity':
        this.patch({
          agents: s.agents.map((a) => (a.id === event.agentId ? { ...a, activity: event.activity } : a)),
        });
        return;

      case 'agent.memory':
        for (const fn of this.memoryListeners) fn(event.agentId, event.memory);
        return;

      case 'agent.permission':
        this.patch({
          agents: s.agents.map((a) =>
            a.id === event.agentId ? { ...a, pendingPermission: event.request } : a,
          ),
        });
        return;

      case 'agent.question':
        this.patch({
          agents: s.agents.map((a) =>
            a.id === event.agentId ? { ...a, pendingQuestion: event.request } : a,
          ),
        });
        return;

      case 'agent.thought':
        // Mostly the same thought again, sent as a sign of life, which heardAt
        // above has already taken. Only a new one is worth a re-render.
        if ((s.agents.find((a) => a.id === event.agentId)?.thought ?? null) === event.text) return;
        this.patch({ agents: s.agents.map((a) => (a.id === event.agentId ? { ...a, thought: event.text } : a)) });
        return;

      case 'agent.message.delta': {
        const streaming = new Map(s.streaming);
        streaming.set(event.agentId, (streaming.get(event.agentId) ?? '') + event.text);
        this.patch({ streaming });
        return;
      }

      case 'agent.message': {
        // The finished message supersedes whatever was streaming.
        const streaming = new Map(s.streaming);
        streaming.delete(event.message.agentId);
        this.patch({ messages: [...s.messages, event.message], streaming });
        for (const fn of this.messageListeners) fn(event.message);
        return;
      }

      case 'agent.messages': {
        // A different conversation is open, so this agent's messages are
        // replaced rather than added to.
        const streaming = new Map(s.streaming);
        streaming.delete(event.agentId);
        this.patch({
          messages: [...s.messages.filter((m) => m.agentId !== event.agentId), ...event.messages],
          streaming,
        });
        return;
      }

      case 'agent.removed': {
        const streaming = new Map(s.streaming);
        streaming.delete(event.agentId);
        this.patch({
          agents: s.agents.filter((a) => a.id !== event.agentId),
          streaming,
          selectedAgentId: s.selectedAgentId === event.agentId ? null : s.selectedAgentId,
        });
        return;
      }

      case 'idea.updated': {
        // Newest change first, the order the board shows within a lane.
        const others = s.ideas.filter((i) => i.id !== event.idea.id);
        this.patch({ ideas: [event.idea, ...others] });
        return;
      }

      case 'done.update':
        this.patch({ done: event.done });
        return;

      case 'onboarding':
        this.patch({ onboarding: event.onboarding });
        return;

      case 'queue.update':
        this.patch({ queue: event.queue });
        return;

      case 'toast':
        for (const fn of this.toastListeners) fn(event.toast);
        return;

      case 'agent.stream':
        // The raw stream is kept server-side; the chat shows tool chips instead.
        return;

    }
  }

  /** The hired workers in desk order, the order every roster on screen shows them in. */
  agentsByDesk(): Agent[] {
    return [...this.state.agents].sort((a, b) => a.deskIndex - b.deskIndex);
  }

  selectedAgent(): Agent | null {
    const id = this.state.selectedAgentId;
    if (!id) return null;
    return this.state.agents.find((a) => a.id === id) ?? this.state.previous.find((a) => a.id === id) ?? null;
  }

  /** Replaces one worker's transcript, as when a different saved chat is opened. */
  replaceMessages(agentId: string, messages: Message[]): void {
    this.patch({ messages: [...this.state.messages.filter((m) => m.agentId !== agentId), ...messages] });
  }

  /**
   * Opens a worker's panel. Goes through here rather than patching the id
   * directly so that the History list and the Fire confirmation never carry
   * over from the worker that was open before.
   */
  selectAgent(agentId: string | null): void {
    this.patch({
      selectedAgentId: agentId,
      showHistory: false,
      confirmFire: false,
      showApprovals: false,
      lastError: null,
    });
  }

  /** Opens Settings on its Memory tab, in place of the other panels, on a repo if one is given. */
  openMemory(repo: string | null = null): void {
    this.patch({ settingsOpen: true, memoryOpen: true, memoryRepo: repo, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, messagesOpen: false });
  }

  messagesFor(agentId: string): Message[] {
    return this.state.messages.filter((m) => m.agentId === agentId);
  }

  /**
   * Repos are reference data rather than state, so they are pulled rather
   * than pushed. A failure is quietly tolerated: the picker just falls back
   * to whatever the server would have chosen on its own.
   */
  async loadRepos(refresh = false): Promise<void> {
    try {
      this.patch({ repos: (await api.repos(refresh)).repos });
    } catch {
      // Nothing to tell him; the hire still works.
    }
  }
}
