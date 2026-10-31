/**
 * Wire types shared by the server and the browser.
 *
 * Types-only plus pure constants, no Node imports: the ui package aliases
 * `@shared` straight at this file, so anything with a runtime dependency on
 * Node would break the Vite build.
 */

export const DEFAULT_PORT = 4317;
export const STREAM_LOG_LIMIT = 2000;
export const BUILT_IN_PAM_ID = 'built-in-pam';

/** The office's Supabase project: sign-in, usage, feedback, and the GitHub sign-in exchange. The key is the public one. */
export const SUPABASE_URL = 'http://127.0.0.1:4317/api/supabase';
export const SUPABASE_PUBLISHABLE_KEY = 'ac_local_auth_key';

/**
 * Worker states, driving both the panel and the 3D worker.
 *
 * - `starting`         walking to desk, session not yet open
 * - `working`          actively doing work
 * - `needs_you`        blocked on a permission or question
 * - `idle`             parked, no turn running
 * - `review`           PR ready for review (waiting for human)
 * - `awaiting_review`  finished work, waiting for a reviewer to be assigned
 * - `in_review`        a reviewer is actively checking this worker's work
 * - `fixing_findings`  addressing findings from the reviewer
 * - `reviewing`        this agent is a reviewer, actively reviewing another worker
 * - `done`             work completed and approved
 * - `error`            something went wrong
 */
export type AgentStatus =
  | 'starting'
  | 'working'
  | 'needs_you'
  | 'idle'
  | 'review'
  | 'awaiting_review'
  | 'in_review'
  | 'fixing_findings'
  | 'reviewing'
  | 'done'
  | 'error';

/**
 * 'tool' names what a worker did; 'output' is what the tool printed back.
 * Separate roles because they read differently — one is a line of prose, the
 * other is terminal output and has to keep its line breaks.
 *
 * 'brief' is what the office opens a session with: the ticket, the worktree
 * and the house rules. The agent needs all of it and Tom wrote none of it, so
 * it stays in the transcript but is never drawn in the chat.
 */
export type MessageRole = 'you' | 'agent' | 'tool' | 'output' | 'brief';

/** Which of the two `AgentRunner` implementations a session is using. */
export type RunnerMode = 'claude' | 'acp' | 'copilot' | 'codex' | 'ollama' | 'print';

/**
 * How the note a runner switch leaves at the top of the new chat begins: the
 * old agent's own handoff, or a recap of the old chat when it could not write one.
 */
export const HANDOFF_HEADINGS = ['Handoff from ', 'Recap of the last chat with '] as const;

/** Whether a brief is a switch's handoff, which the chat shows rather than hides. */
export function isHandoffNote(message: Pick<Message, 'role' | 'text'>): boolean {
  return message.role === 'brief' && HANDOFF_HEADINGS.some((h) => message.text.startsWith(h));
}

/** What Tom calls the CLI behind a runner mode. */
export function runnerLabel(mode: RunnerMode): string {
  switch (mode) {
    case 'acp':
      return 'Cursor';
    case 'claude':
      return 'Claude Code';
    case 'copilot':
      return 'Copilot';
    case 'codex':
      return 'Codex';
    case 'ollama':
      return 'Local AI (Ollama)';
    case 'print':
      return 'print mode';
  }
}

/** The runner Tom picks in Settings. Print mode stays a fallback, not a choice. */
export type RunnerChoice = 'claude' | 'acp' | 'copilot' | 'codex' | 'ollama';

/** The coding agents the office can run, in the order they are offered. */
export const RUNNER_CHOICES: readonly RunnerChoice[] = ['claude', 'acp', 'copilot', 'codex', 'ollama'];

/** The terminal command that signs in each coding agent. */
export const SIGN_IN: Record<RunnerChoice, string> = {
  claude: 'claude',
  acp: 'agent login',
  copilot: 'npx @github/copilot login',
  codex: 'npx @openai/codex login',
  ollama: 'ollama serve',
};

/** Whether one coding agent is installed and signed in, from its last check. */
export interface RunnerHealth {
  status: 'ok' | 'error' | 'checking';
  error: string | null;
  /** What its CLI reported for `--version`, once it answered. */
  version: string | null;
}

/** The agents a new hire can go to: turned on in Settings, and ready. In the usual order. */
export function hireableRunners(enabled: readonly RunnerChoice[], runners: Record<RunnerChoice, RunnerHealth>): RunnerChoice[] {
  return RUNNER_CHOICES.filter((id) => enabled.includes(id) && runners[id]?.status === 'ok');
}

/**
 * What an agent is doing right now, from its latest event. The office floor
 * decides where the worker stands from this.
 *
 * - `idle`      no turn is running
 * - `thinking`  reasoning between steps
 * - `typing`    writing its reply, or working in the repo: reading, searching,
 *               editing, running local commands
 * - `git`       git and the git host: commits, pushes, PRs
 * - `cloud`     cloud and infrastructure CLIs and services
 * - `tickets`   reading or updating tracker issues and 8090 work orders
 * - `research`  the web, docs and specs: anything looked up outside the repo
 */
export type Activity = 'idle' | 'thinking' | 'typing' | 'git' | 'cloud' | 'tickets' | 'research';

/**
 * What a worker was hired for. Decides the brief it gets, whether 8090 hears
 * about it, and what finishing looks like.
 *
 * - `ticket`   an 8090 work order; moves to In Progress and In Review
 * - `ask`      something Tom typed; its own worktree, nothing told to 8090
 * - `research` findings rather than a change; may have no repo at all
 */
export type AgentKind = 'ticket' | 'ask' | 'research';

/**
 * How much a worker may do without asking. `ask` raises a hand for every
 * edit and command, standing approvals included; `standard` edits its own
 * worktree freely and asks for the rest; `auto` approves everything itself.
 */
export type PermissionLevel = 'ask' | 'standard' | 'auto';

export const PERMISSION_LEVELS: ReadonlyArray<{ value: PermissionLevel; label: string; hint: string }> = [
  { value: 'ask', label: 'Ask first', hint: 'Asks before every edit and command' },
  { value: 'standard', label: 'Standard', hint: 'Edits its own worktree, asks for commands, installs and pushes' },
  { value: 'auto', label: 'Full auto', hint: 'Approves everything itself' },
];

/** Claude Code model aliases, which always point at the newest of each family. Null is Claude Code's default. */
export const MODEL_CHOICES: ReadonlyArray<{ value: string | null; label: string; hint: string }> = [
  { value: null, label: 'Default', hint: "Claude Code's recommended model" },
  { value: 'fable', label: 'Fable', hint: 'Hardest and longest-running tasks' },
  { value: 'opus', label: 'Opus', hint: 'Everyday complex tasks' },
  { value: 'sonnet', label: 'Sonnet', hint: 'Routine tasks, faster' },
  { value: 'haiku', label: 'Haiku', hint: 'Quick, simple tasks. No effort setting' },
];

export const EFFORT_CHOICES: ReadonlyArray<{ value: string | null; label: string }> = [
  { value: null, label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

export interface SetupChoice {
  value: string | null;
  label: string;
  hint?: string;
}

/** The models and efforts the selected runner offers. Null values are the runner's own default. */
export interface ModelMenu {
  models: SetupChoice[];
  efforts: SetupChoice[];
}

export const CLAUDE_MODEL_MENU: ModelMenu = { models: [...MODEL_CHOICES], efforts: [...EFFORT_CHOICES] };

/** Models with no effort setting; Claude Code rejects one for them. */
export const NO_EFFORT_MODELS: ReadonlySet<string> = new Set(['haiku']);

/**
 * What a worker wears in the office. Colours still come from the worker's
 * id; these are the shapes on top, picked from the Workers list.
 */
export interface WorkerLook {
  hair: 'crop' | 'bun' | 'mohawk' | 'shoulder';
  hat: 'none' | 'cap' | 'headphones' | 'headset' | 'wizard' | 'crown';
  face: 'none' | 'beard';
  outfit: 'tee' | 'hoodie' | 'tie' | 'labcoat' | 'cardigan';
  /** A colour from the office palette, or null to pick one from the worker's id. */
  shirtColor: string | null;
  hairColor: string | null;
}

export const DEFAULT_LOOK: WorkerLook = {
  hair: 'crop',
  hat: 'none',
  face: 'none',
  outfit: 'tee',
  shirtColor: null,
  hairColor: null,
};

export const LOOK_CHOICES: { [K in keyof WorkerLook]: ReadonlyArray<{ value: WorkerLook[K]; label: string }> } = {
  hair: [
    { value: 'crop', label: 'Crop' },
    { value: 'bun', label: 'Top bun' },
    { value: 'mohawk', label: 'Mohawk' },
    { value: 'shoulder', label: 'Shoulder-length' },
  ],
  hat: [
    { value: 'none', label: 'None' },
    { value: 'cap', label: 'Cap' },
    { value: 'headphones', label: 'Headphones' },
    { value: 'headset', label: 'Phone headset' },
    { value: 'wizard', label: 'Wizard hat' },
    { value: 'crown', label: 'Crown' },
  ],
  face: [
    { value: 'none', label: 'None' },
    { value: 'beard', label: 'Beard' },
  ],
  outfit: [
    { value: 'tee', label: 'T-shirt' },
    { value: 'hoodie', label: 'Hoodie' },
    { value: 'tie', label: 'Shirt and tie' },
    { value: 'labcoat', label: 'Lab coat' },
    { value: 'cardigan', label: 'Cardigan and blouse' },
  ],
  // The office's own palette (scene/boxkit.ts), so a chosen colour sits
  // among the automatic ones rather than standing out from them.
  shirtColor: [
    { value: null, label: 'Automatic' },
    { value: '#4f7fe0', label: 'Blue' },
    { value: '#2f8f9a', label: 'Teal' },
    { value: '#3e9a5c', label: 'Green' },
    { value: '#e0c040', label: 'Yellow' },
    { value: '#d98a3d', label: 'Orange' },
    { value: '#c8553d', label: 'Red' },
    { value: '#b8476e', label: 'Pink' },
    { value: '#7a5cc4', label: 'Purple' },
  ],
  hairColor: [
    { value: null, label: 'Automatic' },
    { value: '#1c1c1c', label: 'Black' },
    { value: '#2a1d14', label: 'Dark brown' },
    { value: '#5a3a28', label: 'Chestnut' },
    { value: '#8a5a3b', label: 'Brown' },
    { value: '#b0442a', label: 'Auburn' },
    { value: '#c9a15a', label: 'Blond' },
  ],
};

/** A stored or sent look with anything unknown put back to the default, part by part. */
export function cleanLook(raw: unknown): WorkerLook {
  const given = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof WorkerLook>(key: K): WorkerLook[K] =>
    LOOK_CHOICES[key].find((c) => c.value === given[key])?.value ?? DEFAULT_LOOK[key];
  return {
    hair: pick('hair'),
    hat: pick('hat'),
    face: pick('face'),
    outfit: pick('outfit'),
    shirtColor: pick('shirtColor'),
    hairColor: pick('hairColor'),
  };
}

/**
 * A kind of worker: its setup, its look, its own instructions, and the name
 * its hires go by ("Frontend Engineer - Ada"). Copied onto a worker at hire, so editing a
 * persona later changes only new hires.
 */
export interface Persona extends WorkerSetup {
  id: string;
  /** Workers hired with it are named "<name> - <first name>", e.g. "Frontend Engineer - Ada". */
  name: string;
  look: WorkerLook;
  /** Added to the worker's brief as its role. Empty for none. */
  instructions: string;
  /** When the tools should call it as a helper; the first sentence of the instructions when empty. */
  description?: string;
}

/** The longest a persona's description may be. */
export const PERSONA_DESCRIPTION_MAX = 300;

/** First names for workers, given out in order: the first one nobody at a desk has. */
export const WORKER_NAMES: readonly string[] = [
  'Ada', 'Bo', 'Cy', 'Dee', 'Eve', 'Finn', 'Gus', 'Hana',
  'Ivo', 'Jun', 'Kai', 'Lu', 'Mo', 'Nia', 'Oz', 'Pia',
  'Rex', 'Sol', 'Tov', 'Ula', 'Vik', 'Wren', 'Xan', 'Yan', 'Zia',
];

/** The longest a worker's name may be, typed or given. */
export const WORKER_NAME_MAX = 24;

/**
 * The name a new hire gets when nobody types one: "Frontend Engineer - Ada"
 * with a persona, "Ada" without. The first name is a random one from the pool
 * that nobody at a desk has, whatever their persona, so "Ada" is never
 * ambiguous. Shared so the hire panel can show the name before the hire.
 */
export function autoWorkerName(
  persona: string | null,
  taken: Iterable<string>,
  random: () => number = Math.random,
): string {
  const used = new Set([...taken].map((n) => (n.split(' - ').pop() ?? n).toLowerCase()));
  const free = WORKER_NAMES.filter((n) => !used.has(n.toLowerCase()));
  const first = free[Math.floor(random() * free.length)] ?? `Worker ${used.size + 1}`;
  return persona ? `${persona} - ${first}` : first;
}

/** Room for " - Wren" after it within a worker's 24 characters. */
export const PERSONA_NAME_MAX = 17;

/**
 * Where an idea is on the Idea board. Ideas move left to right: `shaping`
 * while a Planner talks it through and drafts it, `ready` once Tom marks the
 * draft good, `ticket` once it is a ticket in the tracker.
 */
export type IdeaLane = 'inbox' | 'shaping' | 'ready' | 'ticket';

export const IDEA_LANES: ReadonlyArray<{ value: IdeaLane; label: string }> = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'shaping', label: 'Shaping' },
  { value: 'ready', label: 'Ready' },
  { value: 'ticket', label: 'Ticketed' },
];

/** The ticket an idea will become, in the team's template. */
export interface TicketDraft {
  title: string;
  type: string;
  labels: string[];
  priority: string | null;
  description: string;
}

/** How a shaping Planner's first message opens, which the Ideas board's thread leaves out as the brief it is. */
export const SHAPING_BRIEF_OPENING = 'Talk this idea from the Idea board through with the operator';

/** The team rule: every ticket made from the board says it was drafted with AI. */
export const TICKET_FOOTER = '_Drafted with AI assistance (AgentCorp); reviewed by the reporter._';

/**
 * A first draft in the team's template (after RPT-8278: Summary, Scope,
 * Acceptance criteria, the footer), filled from the idea's own words.
 */
export function draftTemplate(title: string, notes: string): TicketDraft {
  return {
    title,
    type: 'User Story',
    labels: [],
    priority: null,
    description: [
      '## Summary',
      '',
      notes.trim() || 'What to build and why, with routes, related tickets and PRs.',
      '',
      '## Scope',
      '',
      '* **<Part>:** what it does.',
      '',
      '## Acceptance criteria',
      '',
      '* A statement someone can test.',
      '',
      TICKET_FOOTER,
    ].join('\n'),
  };
}

/** An issue type a project offers for a new ticket (sub-task types left out). */
export interface IssueType {
  id: string;
  name: string;
}

/** Where the last idea became a ticket, so the next one starts there. */
export interface TicketTarget {
  project: string | null;
  issueType: string | null;
}

/** Something to build, kept on this machine until it becomes a tracker ticket. */
export interface Idea {
  id: number;
  title: string;
  notes: string;
  lane: IdeaLane;
  archived: boolean;
  /**
   * The repos it belongs to, if whoever wrote it knows. A Planner shaping it
   * works in the first and reads the rest, and draws only on these.
   */
  repos: string[];
  /** Files that explain it, such as a PRD or screenshots, handed to its Planner. */
  attachments: Attachment[];
  draft: TicketDraft | null;
  /** The worker shaping it, while one is. It stays after a draft, until the idea is marked Ready. */
  plannerId: string | null;
  /** The worker hired on its ticket, if one was; null until then, and again once that worker is gone. */
  workerId: string | null;
  /** The tracker the ticket was made in, once it is one. */
  ticketSource: TrackerId | null;
  ticketKey: string | null;
  ticketUrl: string | null;
  /** When its ticket was found closed; null while the ticket is open. A closed idea leaves the Ticketed lane. */
  ticketClosedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A new idea for the board. Only the title is needed. */
export interface NewIdea {
  title: string;
  notes?: string;
  repos?: string[];
  attachments?: AttachmentUpload[];
}

/** What Tom can change on an idea by hand. Lanes past Ready are set by the office. */
export interface IdeaUpdate {
  title?: string;
  notes?: string;
  /** Saving a draft is how an idea gets to Ready; send `lane: 'ready'` with it. */
  draft?: TicketDraft | null;
  lane?: 'inbox' | 'ready';
  archived?: boolean;
  /** The whole list, in order: the first is the one a Planner works in. */
  repos?: string[];
  /** Files to add to the ones it has. */
  attachments?: AttachmentUpload[];
  /** Files to take off it, by their saved name (`Attachment.file`). */
  removeAttachments?: string[];
}

/**
 * How the office talks about what workers do. `plain` says each step in
 * everyday words for people who do not read code; the exact commands stay
 * one click away. One choice for the whole office, made in Settings.
 */
export type MessageStyle = 'technical' | 'plain';

/** A worker's own setup, in the shape personas, Settings and the controls use. */
export function agentSetup(a: Pick<Agent, 'permission' | 'chosenModel' | 'effort'>): WorkerSetup {
  return { permission: a.permission, model: a.chosenModel, effort: a.effort };
}

/** A setup in the shape a worker record stores it. */
export function asAgentSetup(s: WorkerSetup): Pick<Agent, 'permission' | 'chosenModel' | 'effort'> {
  return { permission: s.permission, chosenModel: s.model, effort: s.effort };
}

/** What a worker runs as. Chosen at hire, changeable any time after. */
export interface WorkerSetup {
  permission: PermissionLevel;
  /** A Claude Code model alias or id; null for Claude Code's default. */
  model: string | null;
  /** Null for the model's default effort. */
  effort: string | null;
}

/** The issue trackers the office can take tickets from. One is active at a time. */
export type TrackerId = 'github';

export interface TrackerInfo {
  id: TrackerId;
  name: string;
  /** False: shown in the picker, faded, but not pickable yet. */
  available: boolean;
  /** What the tracker calls a group of tickets. */
  projectNoun: string;
  issueTypes: boolean;
  /** Priority names a draft can carry, highest first. */
  priorities: string[];
}

/** Every tracker, in picker order. */
export const TRACKERS: ReadonlyArray<TrackerInfo> = [
  { id: 'github', name: 'GitHub Issues', available: true, projectNoun: 'repo', issueTypes: false, priorities: [] },
];

export function trackerInfo(id: TrackerId): TrackerInfo {
  return TRACKERS.find((t) => t.id === id) ?? (TRACKERS[0] as TrackerInfo);
}

export function trackerName(id: TrackerId): string {
  return TRACKERS.find((t) => t.id === id)?.name ?? id;
}

export type SourceId = TrackerId | '8090';

export function ticketId(source: SourceId, key: string): string {
  return `${source}:${key}`;
}

export function splitTicketId(id: string): { source: SourceId; key: string } | null {
  const m = /^(github|8090):(.+)$/.exec(id);
  return m ? { source: m[1] as SourceId, key: m[2] as string } : null;
}

export function displayKey(id: string): string {
  if (id === 'PAM') return 'Reception';
  return splitTicketId(id)?.key ?? id;
}

/** A ticket key as it can go in a folder or branch name: GitHub's owner/repo#12 becomes owner-repo-12. */
export function pathKey(key: string): string {
  return key.replace(/[/#]/g, '-');
}

/** What a ticket key belongs to: ENG for ENG-12, owner/repo for owner/repo#12. */
export function projectOf(key: string): string {
  const github = /^(.+)#\d+$/.exec(key);
  return github ? github[1]! : (key.split('-')[0] ?? key);
}

export interface Ticket {
  key: string;
  source: SourceId;
  summary: string;
  description: string | null;
  type: string | null;
  status: string | null;
  phase: string | null;
  points: number | null;
  url: string | null;
  assignees: string[];
  /** Whether the signed-in tracker account is among the assignees, when known. */
  assignedToMe: boolean | null;
  /** Resolved from the repo mapping, or null when the hire dialog must ask. */
  repo: string | null;
  fetchedAt: string;
}

export interface PermissionRequest {
  id: string;
  /** Short label for the panel, e.g. "Run npm install zod". */
  title: string;
  detail: string | null;
  options: Array<{ id: string; label: string; kind: 'allow' | 'deny' }>;
  /**
   * What a standing approval for this request would cover, or null when the
   * request must reach Tom however many times it is made. A null rule also
   * means no existing grant can match it, so the two follow from one check.
   */
  rule: { key: string; label: string } | null;
  /** What it asks to do, in plain words; `title` keeps the exact command. */
  plain?: string;
  /**
   * Only reads files or runs a read-only command inside the worker's own
   * folders. A research worker goes ahead with these without asking.
   */
  readOnly?: boolean;
  createdAt: string;
}

export interface QuestionRequest {
  id: string;
  title: string;
  questions: Array<{
    key: string;
    header: string | null;
    text: string | null;
    multiple: boolean;
    options: Array<{ value: string; label: string; description: string | null }>;
    otherKey: string | null;
  }>;
  createdAt: string;
}

export type QuestionAnswers = Record<string, { picks: string[]; other?: string }>;

/**
 * One conversation with a worker. A new one gives the agent a fresh Cursor
 * session, so it remembers nothing of the last — which is the point of
 * starting one — while the old transcript stays here to be reopened.
 */
export interface Conversation {
  id: number;
  /** The Cursor session to resume. Null until the agent has actually run. */
  chatId: string | null;
  /** Taken from the first thing Tom said in it. */
  title: string;
  messageCount: number;
  createdAt: string;
}

/**
 * A standing approval, shared by every worker: one program, or one kind of
 * file work. The office answers a request it covers itself rather than
 * raising a hand again.
 *
 * Deliberately held here and not sent to the CLI as `allow_always`: the CLI
 * writes those into ~/.cursor/cli-config.json, which would also cover every
 * Cursor session on the machine, with nowhere in the office to take it back.
 */
export interface Grant {
  id: number;
  /** One program of a request's rule key, or the whole key for file work. */
  key: string;
  /** What it covers, in Tom's words, e.g. "rg" or "editing files here". */
  label: string;
  createdAt: string;
}

/** A command a worker's session takes typed as `/name`, as its CLI reports it. */
export interface SlashCommand {
  /** Without the slash, e.g. `review`. */
  name: string;
  description: string;
  /** What to type after it, when it takes input. */
  hint: string | null;
}

/** A helper agent a worker's CLI started and is still waiting on. */
export interface BackgroundAgent {
  name: string;
  /** What it was asked to do, as the CLI reports it. */
  task: string;
  /** ISO time it started. */
  since: string;
}

/** A shell command a worker's CLI has running while it says nothing, as `ps` sees it. */
export interface BackgroundCommand {
  /** As it would have been typed, e.g. `sleep 120`. */
  command: string;
  /** ISO time it started. */
  since: string;
  /** Its CPU use with everything under it, in percent. */
  cpu: number;
}

/** "Waiting on 2 background agents": the desk bubble and panel heading of a worker waiting on its helpers. */
export function waitingOnAgents(count: number): string {
  return `Waiting on ${count} background agent${count === 1 ? '' : 's'}`;
}

/* ---------- inter-worker messaging ---------- */

/**
 * A structured finding from a reviewer: a specific issue at a location.
 * Severity helps the worker prioritize.
 */
export interface Finding {
  file: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/**
 * What a reviewer decided:
 * - `approved`           nothing to fix; the review ends and the work moves on
 * - `changes_requested`  the worker fixes the findings and asks for a re-check
 * - `needs_user`         a judgment call; the review ends and Tom decides
 */
export type ReviewOutcome = 'approved' | 'changes_requested' | 'needs_user';

/**
 * A message from one worker to another, delivered through the office.
 * The office labels it with the sender and shows it in both chats.
 */
export interface InterWorkerMessage {
  /** The type of inter-worker message. */
  kind: 'findings' | 'ready_for_recheck' | 'tell_pam' | 'handoff';
  /** The worker who sent it. */
  fromId: string;
  fromName: string;
  /** The worker who receives it. */
  toId: string;
  toName: string;
  /** For findings messages. */
  findings?: Finding[];
  outcome?: ReviewOutcome;
  /** Free-form note or message text. */
  note?: string;
  /** Attached file names, copied into recipient's uploads. */
  files?: string[];
  createdAt: string;
}

/**
 * An @-mention in a message, tied to a specific worker ID.
 * The chip, not plain text, grants the one-time permission.
 */
export interface AtMention {
  /** The worker being mentioned. */
  workerId: string;
  workerName: string;
  /** Position in the message text where the mention starts. */
  start: number;
  /** Position in the message text where the mention ends. */
  end: number;
}

/** Default limits for inter-worker messaging. */
export const INTER_WORKER_LIMITS = {
  /** Max review rounds before handing to the user. */
  maxReviewRounds: 2,
  /** Max messages per worker per minute. */
  rateLimit: 10,
  /** Max file size for handoffs (same as user uploads). */
  maxFileSize: 10 * 1024 * 1024,
} as const;

export interface Agent {
  id: string;
  /** The office's permanent secretary: protected, limit-exempt, and never given a worktree. */
  builtInPam: boolean;
  permission: PermissionLevel;
  /**
   * The model picked for this worker, as a Claude Code alias or id; null for
   * Claude Code's default. `model` further down is what the session reports
   * it is actually running, for display.
   */
  chosenModel: string | null;
  effort: string | null;
  look: WorkerLook;
  /** The persona it was hired as, by name at the time; null for none. */
  persona: string | null;
  /** The repo whose agent it was hired as, shown as a badge on its name tag; null for one of Tom's own personas or none. */
  personaRepo?: string | null;
  /** The persona's instructions, copied at hire; added to every brief. */
  instructions: string | null;
  ticketKey: string;
  ticketSummary: string;
  name: string;
  deskIndex: number;
  status: AgentStatus;
  /** Derived from the latest tool event, e.g. "Editing ReportPanel.tsx". */
  bubble: string;
  /** The bubble in plain words, when it shows a tool step; null when `bubble` already is plain. */
  bubblePlain?: string | null;
  /** In memory only: after a restart nothing is running, so it starts `idle`. */
  activity: Activity;
  /** Null on a research job with no repo behind it. */
  repoPath: string | null;
  /** Other repos the worker reads beside `repoPath`, never changing them. Dropped from its runner once it has a branch. */
  extraRepos?: string[];
  /** Where the agent runs: a worktree, or a notes folder for repo-less research. */
  worktreePath: string;
  branch: string | null;
  baseBranch: string | null;
  chatId: string | null;
  prUrl: string | null;
  runnerMode: RunnerMode;
  model: string | null;
  /**
   * The slash commands its session offers, its skills among them. The last
   * list a session reported is saved, so it stands in until a new one does.
   */
  commands?: SlashCommand[];
  /**
   * The models and efforts its own session offers, with full names such as
   * "Opus 5.5" and what Default comes to as each Default's hint; in memory
   * only, null until a session reports them.
   */
  modelMenu?: ModelMenu | null;
  /**
   * Agents its CLI started and has not heard back from; in memory only. Claude
   * Code holds the turn open until they finish and says nothing meanwhile.
   */
  backgroundAgents?: BackgroundAgent[];
  /**
   * Shell commands its CLI has running while it has been silent a while, with
   * no step of its own running; in memory only. Commands sent to the
   * background report as finished, and the wait on them sends nothing.
   */
  backgroundCommands?: BackgroundCommand[];
  /** The tail of what it is thinking, while it thinks; in memory only, null when there is none. */
  thought?: string | null;
  /**
   * Seated from a worktree that already existed, rather than from a hire.
   * No agent process has ever run in it, so its worktree is never cleaned up
   * automatically: it is probably Tom's own work in progress.
   */
  adopted: boolean;
  /**
   * Switched to another agent, whose new chat has not been given the work
   * order yet. Its first turn gets the brief, as an adopted worker's does.
   */
  needsBrief?: boolean;
  /** Hired with Discuss, and its plan not yet approved. Auto mode never starts it. */
  discuss?: boolean;
  kind: AgentKind;
  workPlan: string | null;
  pendingPermission: PermissionRequest | null;
  pendingQuestion: QuestionRequest | null;
  /** The office's standing approvals, listed in the panel so they can be taken back. */
  grants: Grant[];
  /** Which conversation the panel is showing, and which the agent is in. */
  conversationId: number;
  /** Newest first, for the History menu. */
  conversations: Conversation[];
  /** Messages typed while the agent was mid-turn, sent when the turn ends. */
  queuedMessages: number;
  sessionLive: boolean;
  /**
   * When the tool now running started, or null if none is.
   *
   * The CLI reports a long command as one 'in progress' and then nothing at
   * all until it finishes, so without a clock on it the panel is
   * indistinguishable from a dead one.
   */
  runningSince: string | null;
  /** Set when status is 'error', shown next to the Retry button. */
  lastError: string | null;
  /** The classified error type, for showing appropriate recovery actions. */
  errorType?: ErrorType | null;
  /** The suggested recovery action for the error. */
  errorAction?: ErrorAction | null;
  createdAt: string;
  endedAt: string | null;
  /** Worker IDs this worker has one-time permission to message (from @-mentions). */
  atPermissions?: string[];
  /** The reviewer assigned to review this worker's work, if any. */
  reviewerId?: string | null;
  /** The worker this reviewer is reviewing, if this is a reviewer. */
  reviewingId?: string | null;
  /** How many review rounds have happened (for the cap). */
  reviewRounds?: number;
}

/**
 * Error types that can occur during agent execution.
 * Used to show appropriate recovery actions in the UI.
 */
export type ErrorType =
  | 'auth'           // Authentication required
  | 'quota'          // Out of usage credits / quota exhausted
  | 'rate_limit'     // Rate limited, retry later
  | 'overloaded'     // Service temporarily overloaded
  | 'model_unavailable' // The selected model is not available
  | 'connection'     // Network or connection error
  | 'cli_missing'    // CLI not installed
  | 'process'        // Process exited unexpectedly
  | 'unknown';       // Unclassified error

/**
 * Suggested recovery actions for an error.
 */
export type ErrorAction =
  | 'sign_in'        // User needs to sign in
  | 'switch_model'   // Try a different model
  | 'switch_runner'  // Try a different runner
  | 'retry'          // Retry the operation
  | 'wait'           // Wait and retry later
  | 'install';       // Install the CLI

export interface Attachment {
  name: string;
  mimeType: string;
  size: number;
  file: string;
}

export interface AttachmentUpload {
  name: string;
  mimeType: string;
  data: string;
}

export interface Message {
  id: number;
  agentId: string;
  conversationId: number;
  role: MessageRole;
  text: string;
  /** A tool step said in plain words, for Plain mode; `text` keeps the exact command. */
  plain?: string;
  attachments?: Attachment[];
  createdAt: string;
}

export interface DoneEntry {
  ticketKey: string;
  title: string;
  points: number;
  prUrl: string | null;
  doneAt: string;
}

/**
 * Product and progress events. Every value worth grouping by is its own
 * field. Message text, ticket titles, paths, prompts and logs never get a field.
 */
export const TRACKING_EVENTS = [
  'app_installed',
  'app_opened',
  'sign_in_completed',
  'tracker_connected',
  'worker_hired',
  'plan_approved',
  'plan_declined',
  'worker_started',
  'message_sent',
  'permission_answered',
  'work_completed',
  'xp_awarded',
  'worker_fired',
  'worker_errored',
  'resume',
  'limit_reached',
  'quit_with_workers_running',
  'idea_created',
  'idea_shaped',
  'idea_ticketed',
  'office_style_changed',
  'message_style_changed',
  'attachment_sent',
  'ide_opened',
  'rehire',
  'update_checked',
  'update_installed',
  'feedback_sent',
  'pr_opened',
] as const;

export type TrackingName = (typeof TRACKING_EVENTS)[number];

export const TRACKING_RUNNERS = ['claude', 'acp', 'copilot', 'codex', 'print'] as const;
export type TrackingRunner = (typeof TRACKING_RUNNERS)[number];

export const TRACKING_KINDS = ['ticket', 'ask', 'research'] as const;
export type TrackingKind = (typeof TRACKING_KINDS)[number];

export const TRACKING_SOURCES = ['github', '8090', 'none'] as const;
export type TrackingSource = (typeof TRACKING_SOURCES)[number];

export const TRACKING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
/** Runner-provided effort ids are vocabulary values, not user-authored text. */
export type TrackingEffort = string;

export const TRACKING_RESULTS = [
  'in_progress', 'plan_declined', 'fired', 'error', 'done',
  'allowed', 'denied', 'always', 'success', 'failure',
] as const;
export type TrackingResult = (typeof TRACKING_RESULTS)[number];

/** Short labels for feature choices. Custom persona names stay off this list. */
export const TRACKING_CHOICES = [
  'office', 'future', 'garage', 'scranton', 'imperial', 'mono', 'cards',
  'technical', 'plain',
  'current', 'available', 'installed', 'error',
  'with_logs', 'without_logs',
  'cursor', 'vscode',
] as const;
export type TrackingChoice = (typeof TRACKING_CHOICES)[number];

export const BUILTIN_PERSONAS = ['frontend-engineer', 'backend-engineer', 'hacker', 'planner', 'qa'] as const;

export const TRACKING_PLATFORMS = ['mac', 'windows', 'linux', 'other'] as const;
export type TrackingPlatform = (typeof TRACKING_PLATFORMS)[number];

/** One stored row. Null means this event has nothing to say for that column. */
export interface TrackingFact {
  id: string;
  workerId: string | null;
  name: TrackingName;
  occurredAt: string;
  runner: TrackingRunner | null;
  workerKind: TrackingKind | null;
  source: TrackingSource | null;
  permission: PermissionLevel | null;
  model: string | null;
  effort: TrackingEffort | null;
  persona: string | null;
  result: TrackingResult | null;
  choice: TrackingChoice | null;
  count: number;
  hasPr: boolean | null;
}

const TRACKING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING_SETUP_VALUE = /^[a-z0-9][a-z0-9._:/+-]{0,79}$/i;
const TRACKING_WORKER = /^[a-z0-9-]{1,40}$/;

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : null;
}

/**
 * Keeps an event that matches the vocabulary and drops everything else,
 * including any message, title, path or log a caller tried to attach.
 */
export function sanitizeTrackingFact(raw: unknown): TrackingFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const given = raw as Record<string, unknown>;
  const name = oneOf(TRACKING_EVENTS, given.name);
  const id = typeof given.id === 'string' && TRACKING_UUID.test(given.id) ? given.id.toLowerCase() : null;
  const occurredAt = typeof given.occurredAt === 'string' ? new Date(given.occurredAt) : null;
  if (!name || !id || !occurredAt || Number.isNaN(occurredAt.getTime())) return null;
  const count = typeof given.count === 'number' && Number.isInteger(given.count) && given.count >= 1 && given.count <= 1000
    ? given.count
    : 1;
  const persona = oneOf(BUILTIN_PERSONAS, given.persona) ?? (given.persona ? 'custom' : null);
  return {
    id,
    workerId: typeof given.workerId === 'string' && TRACKING_WORKER.test(given.workerId) ? given.workerId : null,
    name,
    occurredAt: occurredAt.toISOString(),
    runner: oneOf(TRACKING_RUNNERS, given.runner),
    workerKind: oneOf(TRACKING_KINDS, given.workerKind),
    source: oneOf(TRACKING_SOURCES, given.source),
    permission: oneOf(['ask', 'standard', 'auto'] as const, given.permission),
    model: typeof given.model === 'string' && TRACKING_SETUP_VALUE.test(given.model) ? given.model.toLowerCase() : null,
    effort: typeof given.effort === 'string' && TRACKING_SETUP_VALUE.test(given.effort)
      ? given.effort.toLowerCase() as TrackingEffort
      : null,
    persona: persona === 'custom' || persona ? persona : null,
    result: oneOf(TRACKING_RESULTS, given.result),
    choice: oneOf(TRACKING_CHOICES, given.choice),
    count,
    hasPr: typeof given.hasPr === 'boolean' ? given.hasPr : null,
  };
}

export interface Health {
  /** Whether the last 8090 poll succeeded. */
  factory: 'ok' | 'error' | 'unconfigured' | 'connecting' | 'disabled';
  factoryError: string | null;
  factoryLastPoll: string | null;
  /** The selected tracker and whether its last poll succeeded. */
  tracker: TrackerHealth;
  /** Health for every supported tracker; connected trackers can all feed the board. */
  trackers: Record<TrackerId, TrackerHealth>;
  /** Whether each coding agent's CLI is installed and signed in. */
  runners: Record<RunnerChoice, RunnerHealth>;
  /** The models of the default agent for new hires. */
  modelMenu: ModelMenu;
}

export type SourceStatus = 'ok' | 'error' | 'unconfigured' | 'connecting' | 'disabled';

export interface TrackerHealth {
  id: TrackerId;
  status: SourceStatus;
  error: string | null;
  lastPoll: string | null;
}

export interface Limits {
  maxConcurrentAgents: number;
  deskCount: number;
  /** Max concurrent reviewers (don't take desks, but still use usage). */
  maxConcurrentReviewers: number;
  /** Whether automatic review is enabled. */
  reviewEnabled: boolean;
}

/** A reviewer waiting in line for a slot. */
export interface QueuedReviewer {
  /** The worker being reviewed. */
  workerId: string;
  workerName: string;
  /** When the review was requested. */
  queuedAt: string;
}

/** A repo the office knows how to open a worktree in. */
/**
 * What was typed as "another repo": a path on disk, or a repo elsewhere that
 * can be cloned — with where the clone would land, and whether it already has.
 */
export type RepoLookup =
  | { kind: 'path' }
  | { kind: 'remote'; name: string; target: string; alreadyCloned: boolean };

export interface RepoChoice {
  /** The directory name, which is how Tom refers to it. */
  name: string;
  path: string;
  baseBranch: string;
  isDefault: boolean;
}

/** One GitHub account's hold on a repo: who it is and whether it can read the repo. */
export interface GitHubAccountCheck {
  /** Null when the login could not be read. */
  login: string | null;
  /** Null when GitHub could not be asked, as in an outage or a used-up rate limit: unknown, not refused. */
  access: boolean | null;
}

/** Who touches a repo on GitHub, for Settings → Repos. GitHub Issues, a ticket source, has no part in it. */
export interface RepoGitHubAccounts {
  name: string;
  path: string;
  /** owner/repo, or null when origin is not on GitHub. */
  github: string | null;
  /** The account workers push and open PRs as, with how git picks it; null without a GitHub remote. */
  workers: (GitHubAccountCheck & { access: boolean; via: 'gh' | 'ssh'; alias: string | null }) | null;
  /**
   * The account the PR watcher reads PR comments, checks and conflicts as:
   * one connected with Connect to GitHub, or one `gh` is signed in as. Null
   * when there is none here, or without a GitHub remote.
   */
  watcher: (GitHubAccountCheck & { via: 'connected' | 'gh' }) | null;
}

export interface Snapshot {
  seq: number;
  tickets: Ticket[];
  agents: Agent[];
  messages: Message[];
  done: DoneEntry[];
  health: Health;
  limits: Limits;
  /** Hires waiting for a free desk, in queue order. */
  queue: Array<{ ticketKey: string; summary: string }>;
  /** Reviewers waiting for a slot, in queue order. */
  reviewQueue: QueuedReviewer[];
  /** What a new hire starts as, so the hire cards can show it. */
  workerDefaults: WorkerSetup;
  personas: Persona[];
  /** The agents of the repos in the library, as of their last Sync, less the hidden ones. */
  repoPersonas: RepoPersona[];
  runner: RunnerChoice;
  /** The coding agents turned on in Settings; new hires only go to these. */
  enabledRunners: RunnerChoice[];
  /** Every idea, archived ones included. */
  ideas: Idea[];
  /** Completed and fired workers, newest first. No longer on the floor. */
  previous: Agent[];
  messageStyle: MessageStyle;
  ticketTarget: TicketTarget;
  onboarding: Onboarding;
  /** Voice input: whether it's on, and the speech model. */
  voice: VoiceSettings;
}

/* ---------- voice input (issue #329) ---------- */

/** The speech model voice input transcribes with. It is downloaded once per Mac and shared by every account. */
export interface VoiceModel {
  status: 'none' | 'downloading' | 'ready';
  /** While it downloads: the bytes so far, and of the whole model, 0 until that is known. */
  received: number;
  total: number;
  /** Why the last download failed, until the next one starts. */
  error: string | null;
}

/** Voice input: the account's switches, and the Mac's model. */
export interface VoiceSettings {
  /** Hold the dictation key, or click the mic, to dictate into a composer. */
  enabled: boolean;
  /** Clean the transcript up with the coding agent's cheapest model. */
  rewrite: boolean;
  model: VoiceModel;
}

/** `PUT /api/settings/voice`: the switches to change. */
export type VoiceSettingsUpdate = Partial<Pick<VoiceSettings, 'enabled' | 'rewrite'>>;

/** `POST /api/voice/transcribe?clip=<id>`, with 16 kHz mono float32 samples as the body. */
export interface VoiceTranscript {
  raw: string;
}

/** `POST /api/voice/rewrite`: the transcript cleaned up, or null to keep the raw one. */
export interface VoiceRewrite {
  cleaned: string | null;
}

/** What the transcriber takes: mono samples at this rate. */
export const VOICE_SAMPLE_RATE = 16_000;
/** A held clip shorter than this was an accident, and is dropped. */
export const VOICE_MIN_SECONDS = 0.5;
/** Recording stops by itself after this long. */
export const VOICE_MAX_SECONDS = 120;

/* ---------- generated offices (issue #157) ---------- */

export * from './office-contract.js';
import type { DesignerLogEntry, OfficeBrief, OfficeDetails, OfficeGeneration, OfficeManifest, OfficeSummary } from './office-contract.js';

/** `GET /api/offices/:id`. */
export interface OfficeRecord {
  summary: OfficeSummary;
  manifest: OfficeManifest;
  /** The answers it was made from; null for an installed office. */
  brief: OfficeBrief | null;
}

/** `POST /api/offices/details`: suggest every field from the prompt, or just `field`, keeping the rest of `current`. */
export interface SuggestDetailsRequest {
  prompt: string;
  style?: OfficeDetails['style'];
  runner?: RunnerChoice;
  current?: OfficeDetails;
  field?: 'theme' | 'scene' | 'people' | 'decor' | 'notes';
}

/**
 * `POST /api/offices/generate`: build an office from a brief on a worker. With
 * `officeId` and `instruction`, it edits that office ("make it night") instead.
 */
export interface GenerateOfficeRequest {
  brief: OfficeBrief;
  runner?: RunnerChoice;
  officeId?: string;
  instruction?: string;
  /** The designer's model and effort; omitted for the defaults in Settings. */
  model?: string | null;
  effort?: string | null;
}

/** `POST /api/offices/install`: save a published office downloaded from the showcase. */
export interface InstallOfficeRequest {
  listingId: string;
  creator: string;
  manifest: unknown;
}

/* ---------- server -> browser ---------- */

export type ServerEvent =
  | { type: 'snapshot'; seq: number; snapshot: Snapshot }
  | { type: 'ticket.list'; seq: number; tickets: Ticket[]; health: Health }
  | { type: 'agent.created'; seq: number; agent: Agent }
  | { type: 'agent.status'; seq: number; agentId: string; status: AgentStatus; lastError: string | null; errorType?: ErrorType | null; errorAction?: ErrorAction | null }
  | { type: 'agent.bubble'; seq: number; agentId: string; bubble: string; plain: string | null }
  /** Its own event because it changes with nearly every tool call. */
  | { type: 'agent.activity'; seq: number; agentId: string; activity: Activity }
  /** A worker started or finished reading or saving Office Memory, for the brain by its name. */
  | { type: 'agent.memory'; seq: number; agentId: string; memory: MemoryActivity }
  | { type: 'agent.message.delta'; seq: number; agentId: string; text: string }
  /** What a worker is thinking, at most about once a second while it thinks; null once the thought is over. */
  | { type: 'agent.thought'; seq: number; agentId: string; text: string | null }
  | { type: 'agent.message'; seq: number; message: Message }
  /**
   * The whole transcript for one agent, replacing whatever the browser holds.
   * Sent when the open conversation changes, since the panel then has to show
   * a different set of messages rather than one more.
   */
  | { type: 'agent.messages'; seq: number; agentId: string; conversationId: number; messages: Message[] }
  | { type: 'agent.stream'; seq: number; agentId: string; lines: string[] }
  | { type: 'agent.permission'; seq: number; agentId: string; request: PermissionRequest | null }
  | { type: 'agent.question'; seq: number; agentId: string; request: QuestionRequest | null }
  | { type: 'agent.removed'; seq: number; agentId: string }
  /** A worker who left the floor, kept in the Previous tab with their chats. */
  | { type: 'agent.ended'; seq: number; agent: Agent }
  | { type: 'idea.updated'; seq: number; idea: Idea }
  | { type: 'agent.updated'; seq: number; agent: Agent }
  | { type: 'done.update'; seq: number; done: DoneEntry[] }
  | { type: 'onboarding'; seq: number; onboarding: Onboarding }
  | { type: 'tracking'; seq: number; fact: TrackingFact }
  | { type: 'queue.update'; seq: number; queue: Array<{ ticketKey: string; summary: string }> }
  | { type: 'health'; seq: number; health: Health }
  /** A coding agent was turned on or off, or the default for new hires changed. */
  | { type: 'runners'; seq: number; runner: RunnerChoice; enabledRunners: RunnerChoice[] }
  | { type: 'toast'; seq: number; toast: Toast }
  /** The saved generated offices or a generation changed: the whole lists, replacing what the browser holds. */
  | { type: 'offices.updated'; seq: number; offices: OfficeSummary[]; generations: OfficeGeneration[] }
  /** A designer's log grew: the entries from `from` on, replacing what the browser holds from there. */
  | { type: 'offices.log'; seq: number; id: string; from: number; entries: DesignerLogEntry[] }
  /** Voice input was switched, or the speech model moved on: downloaded a little more, finished, failed or was deleted. */
  | { type: 'voice'; seq: number; voice: VoiceSettings };

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'needs_you' | 'done' | 'error';
  agentId: string | null;
}

/**
 * `Omit` collapses a union into its common keys, which would erase every
 * event's payload. This distributes over the union instead.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A ServerEvent before the bus stamps it with a sequence number. */
export type UnstampedServerEvent = DistributiveOmit<ServerEvent, 'seq'>;

/* ---------- browser -> server ---------- */

export interface HireRequest {
  /** An 8090 work order key. Omitted for an ad-hoc job. */
  ticketKey?: string;
  /**
   * A free-form job, for work that has no work order behind it. Mutually
   * exclusive with `ticketKey`; the server assigns the worker an `ASK-n` key.
   */
  task?: string;
  /** Defaults to 'ticket' with a key, 'ask' with a task. */
  kind?: AgentKind;
  /**
   * Any git repo on disk, not only a configured one. Omit it on a research
   * job to work with no repo at all; omit it anywhere else to get the default.
   */
  repo?: string;
  /**
   * More repos the worker may read, but never change, beside `repo`, which it
   * needs. A shaping Planner gets an idea's other repos this way. Any kind of
   * job can have them; they are read only until it has a branch.
   */
  extraRepos?: string[];
  baseBranch?: string;
  note?: string;
  /**
   * A persona id, or a repo agent's from `repoPersonaId`, which needs its repo
   * as the hire's. Its setup and look apply unless the fields below say otherwise.
   */
  persona?: string;
  /** What to call the worker. Omitted or blank for the automatic name. */
  name?: string;
  /** Each falls back to the persona, then to the defaults in Settings. */
  permission?: PermissionLevel;
  model?: string | null;
  effort?: string | null;
  /** Files for the job, which the worker gets with its first prompt. */
  attachments?: AttachmentUpload[];
  /** The engine for this one worker; omitted for the runner in Settings. */
  runner?: RunnerChoice;
  /**
   * Talk the job through before any work: the worker asks its questions
   * first, and its plan waits for Start work even in auto mode.
   */
  discuss?: boolean;
}

export interface PermissionAnswer {
  requestId: string;
  allow: boolean;
  /**
   * 'always' also records the request's rule, so the office answers the next
   * matching request itself. Ignored on a request with no rule.
   */
  scope?: 'once' | 'always';
}

export interface QuestionAnswer {
  requestId: string;
  answers: QuestionAnswers | null;
}

/**
 * What checking on a quiet worker found. 'dead' and 'stuck' have already
 * failed the worker by the time this comes back, so the panel shows Retry.
 */
export interface Nudge {
  verdict: 'working' | 'waiting' | 'stuck' | 'dead' | 'idle' | 'unknown';
  /** Written to be shown to Tom as is. */
  text: string;
}

export type Editor = 'cursor' | 'vscode';

/**
 * The first day: the three things a worker needs before it can start, in the
 * order they are needed. A coding agent signed in, code to work in, and a
 * first task (a ticket, or one described by hand) handed to a worker. Each is
 *
 * Steps from earlier versions of the first day stay in the database under
 * their old ids; they are no longer read.
 */
export type QuestId = 'power' | 'code' | 'hire';

export const QUESTS: ReadonlyArray<{ id: QuestId; title: string }> = [
  { id: 'power', title: 'Sign in to your coding agent' },
  { id: 'code', title: 'Add your code' },
  { id: 'hire', title: 'Pick your first task' },
];

/** One-time hints shown where a feature is first relevant. */
export type HintId = 'at_mention' | 'repo_agents' | 'first_reviewer' | 'recovery_action' | 'empty_toolkit';

export interface Onboarding {
  done: QuestId[];
  skipped: QuestId[];
  /** The guide was sent away; the quests carry on in the quest log. */
  tourDismissed: boolean;
  tourReplay: QuestId | null;
  /** One-time hints the user has seen, never shown again. */
  seenHints: HintId[];
}

export interface TrackerProjectSetting {
  key: string;
  /** Repo path for this project's tickets, or null to pick one at hire time. */
  repo: string | null;
}

/** One tracker's settings, in the shape every tracker shares. */
export interface TrackerSettings {
  id: TrackerId;
  enabled: boolean;
  connected: boolean;
  /** Who the browser sign-in goes through, e.g. Atlassian. */
  signInWith: string;
  /** Shown under the site once connected, e.g. why some issues may be missing. */
  connectedNote?: string;
  /** True when hire and Mark done set labels rather than move the issue between statuses. */
  statusesAreLabels?: boolean;
  projectNoun: string;
  /** e.g. https://acme.atlassian.net, once a connection has resolved it. */
  site: string | null;
  projects: TrackerProjectSetting[];
  /** The name of the tracker's own query language, or null if it has none. */
  queryLanguage: string | null;
  /** Null means the query is built from the projects. */
  query: string | null;
  defaultQuery: string | null;
  inProgressStatuses: string[];
  reviewStatuses: string[];
}

export type TrackerSettingsUpdate = Partial<
  Pick<TrackerSettings, 'enabled' | 'projects' | 'query' | 'inProgressStatuses' | 'reviewStatuses'>
>;

export interface TrackerProject {
  key: string;
  name: string;
}

export interface Settings {
  /** Who a worker runs as. `auto` in config is reported as the runner it resolves to. */
  /** The IDE the worker panel's Open in IDE button launches. */
  editor: Editor;
  /** The coding agents turned on, and the default for new hires among them. */
  runner: RunnerChoice;
  enabledRunners: RunnerChoice[];
  /** Auto mode: every request is approved without asking. */
  autoApprove: boolean;
  /** A reviewer is hired by itself when a worker's PR looks risky. */
  autoReview: boolean;
  /** Every PR a worker opens ends with "Created by AgentCorp". */
  prFooter: boolean;
  /** What a new hire starts as, unless the hire says otherwise. */
  workerDefaults: WorkerSetup;
  personas: Persona[];
  messageStyle: MessageStyle;
  /** The tracker tickets come from, and its settings when it is one the office supports. */
  tracker: { active: TrackerId; settings: TrackerSettings | null };
  factory: { enabled: boolean; connected: boolean };
  /** `cloneInto` is the folder new clones go to, as it resolves now. */
  repos: { roots: string[]; cloneInto: string };
  voice: VoiceSettings;
}

/* ---------- user messages (inbox) ---------- */

export type MessageSenderType = 'system' | 'admin' | 'user';

/** A message in the user's inbox. */
export interface UserMessage {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  senderType: MessageSenderType;
  /** For user-to-user messages, the sender's user ID. */
  senderId: string | null;
  /** For user-to-user messages, the sender's username. */
  senderUsername: string | null;
  /** For share messages, the share ID. */
  shareId: string | null;
  createdAt: string;
}

/* ---------- sharing agents and skills ---------- */

/** What can be shared between users. */
export type SharePackageType = 'agent' | 'skill';

/** A shared package's data, as stored in shared_packages.package_data. */
export interface SharePackageData {
  /** The persona or skill name. */
  name: string;
  /** For agents: the persona's full definition. */
  persona?: Persona;
  /** For skills: the skill's ID, description and instructions. */
  skill?: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    /** File names included (for "contains code" warning). */
    files: string[];
  };
}

/** Preview of a shared package before downloading. */
export interface SharePreview {
  shareId: string;
  packageType: SharePackageType;
  packageData: SharePackageData;
  /** Secrets that were stripped before sharing. */
  strippedSecrets: string[];
  /** The sender's username. */
  senderUsername: string;
  expiresAt: string;
  /** When the recipient downloaded it, if they have. */
  downloadedAt: string | null;
}

/** A user the recipient has blocked from sharing. */
export interface BlockedSender {
  userId: string;
  username: string;
  blockedAt: string;
}

/** Result of looking up a user by username. */
export interface UserLookup {
  userId: string;
  username: string;
}

/**
 * Secret patterns for stripping from shared content.
 * Used by both server (strip-secrets.ts) and client (share.ts preview).
 * Pattern is a string that will be used to create a RegExp with 'gi' flags.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ pattern: string; kind: string }> = [
  // API keys (various formats)
  { pattern: '\\b(sk|pk|api|key|token)[-_]?[a-z0-9]{20,}', kind: 'API key' },
  { pattern: '\\b[a-zA-Z0-9]{32,64}\\b', kind: 'API key or token' },

  // Bearer/Auth tokens
  { pattern: 'bearer\\s+[a-zA-Z0-9._~+/=-]+', kind: 'Bearer token' },
  { pattern: 'authorization:\\s*[^\\s\\n]+', kind: 'Authorization header' },

  // Common service keys
  { pattern: 'ghp_[a-zA-Z0-9]{36}', kind: 'GitHub PAT' },
  { pattern: 'gho_[a-zA-Z0-9]{36}', kind: 'GitHub OAuth token' },
  { pattern: 'github_pat_[a-zA-Z0-9_]{22,}', kind: 'GitHub PAT' },
  { pattern: 'sk-[a-zA-Z0-9]{32,}', kind: 'OpenAI/Anthropic key' },
  { pattern: 'xox[baprs]-[a-zA-Z0-9-]+', kind: 'Slack token' },
  { pattern: 'AKIA[A-Z0-9]{16}', kind: 'AWS access key' },
  { pattern: '[a-zA-Z0-9/+=]{40}(?=\\s|$|")', kind: 'AWS secret key' },
  { pattern: 'SG\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+', kind: 'SendGrid key' },
  { pattern: 'sq0csp-[a-zA-Z0-9_-]+', kind: 'Square OAuth secret' },
  { pattern: 'AIza[a-zA-Z0-9_-]{35}', kind: 'Google API key' },

  // Connection strings
  { pattern: 'postgres(ql)?:\\/\\/[^\\s"\']+', kind: 'PostgreSQL connection string' },
  { pattern: 'mysql:\\/\\/[^\\s"\']+', kind: 'MySQL connection string' },
  { pattern: 'mongodb(\\+srv)?:\\/\\/[^\\s"\']+', kind: 'MongoDB connection string' },
  { pattern: 'redis:\\/\\/[^\\s"\']+', kind: 'Redis connection string' },

  // Environment variable assignments with secrets
  { pattern: '\\b(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)s?=\\S+', kind: 'Environment variable' },

  // Private keys
  { pattern: '-----BEGIN\\s+(RSA\\s+)?PRIVATE\\s+KEY-----[\\s\\S]*?-----END\\s+(RSA\\s+)?PRIVATE\\s+KEY-----', kind: 'Private key' },

  // JWT tokens (three base64 segments)
  { pattern: 'eyJ[a-zA-Z0-9_-]*\\.eyJ[a-zA-Z0-9_-]*\\.[a-zA-Z0-9_-]*', kind: 'JWT token' },
];

/* ---------- perks ---------- */

/**
 * A category for perks: skins change the office look, items are furniture, and
 * dates, and then takes itself off again.
 */
export type PerkCategory = 'skin' | 'item' | 'seasonal';

/** Which perks a user has enabled. Maps perk id to whether it's on. */
export interface UserPerkState {
  enabledPerks: string[];
}

/* ---------- Skills Library ---------- */

/** Where a skill lives: in the library (global or repo) or in a tool. */
export type SkillScope = 'global' | 'repo' | 'tool';

/** Status of a skill's link to a specific tool. */
export type SkillLinkStatus =
  | 'linked'      // ✓ properly linked
  | 'conflict'    // ⚠ tool has a different skill with the same name
  | 'missing'     // – not linked
  | 'from_repo'   // 🔒 committed in repo, read-only
  | 'via_repo'    // committed in another tool's folder that this tool also reads
  | 'copied';     // Tool doesn't follow symlinks, so copied instead

/** A skill in the library (wire format). */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  repo: string | null;
  files: string[];
  fromRepo: boolean;
  required: boolean;
  onlyWhenAsked: boolean;
  modifiedAt: string;
}

/**
 * A skill's name, which is also its folder: lowercase letters, numbers and
 * single hyphens. Cursor and Copilot skip a skill whose name breaks this.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;

/** Why a skill name will not do, or null when it is fine. */
export function skillNameProblem(name: string): string | null {
  if (!name) return 'Give the skill a name.';
  if (name.length > SKILL_NAME_MAX) return `Keep the name to ${SKILL_NAME_MAX} characters.`;
  if (!SKILL_NAME_PATTERN.test(name)) return 'Use lowercase letters, numbers and single hyphens, like draft-ticket.';
  return null;
}

/** A skill's row in the sync matrix: a repo skill can share its id with a global one, or one in another repo. */
export function skillMatrixKey(skill: Pick<SkillInfo, 'id' | 'scope' | 'repo'>): string {
  return skill.scope === 'repo' && skill.repo ? `${skill.repo}/${skill.id}` : skill.id;
}

/** Status of a skill in the sync matrix: one cell per skill × tool. */
export interface SkillToolStatusInfo {
  skillId: string;
  toolId: string;
  status: SkillLinkStatus;
  error: string | null;
  /** For a committed skill, the repo folder the tool gets it from, e.g. `.agents/skills`. */
  via: string | null;
  /** Where the tool's link or copy is, or would be, e.g. `~/.agents/skills/create-pr`. */
  targetPath: string;
}

/** Tool info for the sync matrix. */
export interface ToolInfo {
  id: string;
  name: string;
  installed: boolean;
}

/** The full sync matrix sent to the browser. */
export interface SyncMatrixInfo {
  skills: SkillInfo[];
  tools: ToolInfo[];
  status: Record<string, Record<string, SkillToolStatusInfo>>;
  discovered: DiscoveredSkillInfo[];
  lastSyncedAt: string | null;
  outOfDate: boolean;
  /** Paths of the repos added to the library's sidebar. */
  libraryRepos: string[];
}

/** A skill found in a tool but not in the library. */
export interface DiscoveredSkillInfo {
  id: string;
  name: string;
  description: string;
  toolId: string;
}

/** Summary of a sync operation. */
export interface SyncSummaryInfo {
  updated: Array<{ id: string; name: string; action: 'added' | 'updated' | 'removed' }>;
  repos: Array<{ name: string; total: number; added: number; updated: number }>;
  syncedAt: string;
}

/** Health issues with the skills library. */
export interface SkillsHealthInfo {
  brokenLinks: Array<{ skillId: string; toolId: string }>;
  conflicts: Array<{ skillId: string; toolId: string }>;
  invalidFrontmatter: Array<{ skillId: string; error: string }>;
  missingTools: string[];
}

/* ---------- Repo agents ---------- */

/**
 * How a tool gets a repo agent: it reads the agent's file itself, the office
 * wrote its own format on Sync, the repo has another file for it, or Sync has
 * not written it yet.
 */
export type RepoAgentToolStatus = 'native' | 'converted' | 'from_repo' | 'not_synced';

export interface RepoAgentToolInfo {
  toolId: string;
  status: RepoAgentToolStatus;
  /** The file the tool reads, relative to the repo. */
  file: string;
  /** What the agent file sets that this tool's copy could not carry. */
  skipped: string[];
}

/**
 * How a tool gets one of Tom's personas as a general agent, from its own
 * agents folder in his home: written there, turned off, not written yet, or
 * left out because a file of his own already has that name.
 */
export type GeneralAgentToolStatus = 'written' | 'off' | 'not_written' | 'taken';

export interface GeneralAgentToolInfo {
  toolId: string;
  status: GeneralAgentToolStatus;
  /** The file the tool reads, e.g. `~/.claude/agents/planner.md`. */
  file: string;
  /** What the persona sets that this tool's file could not carry. */
  skipped: string[];
}

/** A persona as a general agent: the name the tools call it by, and each tool's file. */
export interface GeneralAgentInfo {
  personaId: string;
  /** The name in the files, e.g. `backend-engineer`. */
  agentName: string;
  /** The description the files carry: the persona's own, or the first sentence of its instructions. */
  description: string;
  tools: GeneralAgentToolInfo[];
}

/**
 * An agent defined in one of a repo's agents folders (`.claude/agents`,
 * `.cursor/agents`, `.codex/agents`, `.github/agents`), as of its last Sync.
 */
export interface RepoAgentInfo {
  /** The file's name less its ending, e.g. `.md` or `.toml`. */
  id: string;
  repo: string;
  /** Its name in words, e.g. "Terraform Reviewer". */
  title: string;
  description: string;
  /** The model the file names, as written; null for none. */
  model: string | null;
  /** The file it was read from, relative to the repo, e.g. `.claude/agents/terraform-reviewer.md`. */
  file: string;
  /** The repo's files for the same agent in later folders, which Sync did not read. */
  alsoIn: string[];
  /** The whole file, as of the last Sync. */
  content: string;
  /** Hidden from the Hire panel; the repo is left alone. */
  hidden: boolean;
  /** New or changed by the last Sync. */
  updated: boolean;
  tools: RepoAgentToolInfo[];
}

export interface RepoAgentsInfo {
  agents: RepoAgentInfo[];
  /** When the repo's agents were last read, or null if never. */
  syncedAt: string | null;
  /** Whether its agent files have changed since. */
  outOfDate: boolean;
}

/** One repo's agents after a Sync, for the summary line. */
export interface RepoAgentsSyncInfo {
  name: string;
  total: number;
  added: number;
  updated: number;
  removed: number;
}

/**
 * A repo agent offered in the Hire panel for work in its repo. `name` is
 * short enough to name a worker by; `title` is the agent's own name in full.
 */
export interface RepoPersona extends Persona {
  repo: string;
  repoPath: string;
  title: string;
  description: string;
  /** The model its file names, as written; the hire maps it to the nearest the runner offers. */
  agentModel: string | null;
  /** Its file, relative to the repo. */
  file: string;
}

/** A repo agent's persona id: `repo:<repo>/<agent>`. */
export function repoPersonaId(repo: string, agentId: string): string {
  return `repo:${repo}/${agentId}`;
}

export function isRepoPersonaId(id: string | undefined): boolean {
  return !!id?.startsWith('repo:');
}

const MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const;

/**
 * The model in `menu` nearest to one an agent file names: the same one, else
 * one of the same family (`claude-opus-4-5` finds `opus`), else one whose id
 * starts the same way. Null, the runner's default, when nothing is close or
 * the file says `inherit`.
 */
export function nearestModel(wanted: string | null, menu: ModelMenu): string | null {
  const w = wanted?.trim().toLowerCase();
  if (!w || w === 'inherit') return null;
  const offered = menu.models.filter((m): m is SetupChoice & { value: string } => !!m.value);
  const exact = offered.find((m) => m.value.toLowerCase() === w);
  if (exact) return exact.value;
  const family = MODEL_FAMILIES.find((f) => w.includes(f));
  if (family) return offered.find((m) => `${m.value} ${m.label}`.toLowerCase().includes(family))?.value ?? null;
  return offered.find((m) => m.value.toLowerCase().startsWith(w) || w.startsWith(m.value.toLowerCase()))?.value ?? null;
}

/* ---------- MCP servers from Tom's tools ---------- */

/**
 * What kind of server it is, which decides whether workers can share it: one
 * the office starts from its command, a remote one whose key is in the
 * config, or a remote one signed in inside the tool, which stays there.
 */
export type McpServerKind = 'local' | 'key' | 'signin';

/** One of Tom's MCP servers, as of the last Sync, for the MCPs tab. Secret values are masked. */
export interface McpServerInfo {
  /** `global/<name>` or `<repo>/<name>`. */
  key: string;
  name: string;
  scope: 'global' | 'repo';
  repo: string | null;
  /** Where it was found, e.g. "Claude Code (local)". */
  from: string;
  /** The config file, e.g. `~/.claude.json`. */
  file: string;
  /** Other tools with a server of the same name in the same scope. */
  alsoIn: string[];
  kind: McpServerKind;
  transport: 'stdio' | 'http' | 'sse';
  command: string | null;
  args: string[];
  url: string | null;
  env: Array<{ name: string; value: string }>;
  headers: Array<{ name: string; value: string }>;
  /** Workers get it. New servers start off. */
  on: boolean;
  /** Every call from it waits for Tom, even in auto mode. */
  askFirst: boolean;
  /** New or changed by the last Sync. */
  updated: boolean;
  /** A repo's server with the same name as a general one, which the repo's workers get instead. */
  replacesGeneral: boolean;
  /** Something about it in its tool, e.g. turned off there. */
  note: string | null;
  /** Why it last failed to start for a worker, cleared when it starts again. */
  error: { message: string; at: string } | null;
}

export interface McpServersInfo {
  servers: McpServerInfo[];
  syncedAt: string | null;
  outOfDate: boolean;
}

/* ---------- Standup ---------- */

/** A done entry for the standup report, with a link to its PR when it has one. */
export interface StandupDoneItem {
  ticketKey: string;
  title: string;
  prUrl: string | null;
  doneAt: string;
}

/** A blocked or stuck worker for the standup report. */
export interface StandupBlockedItem {
  agentId: string;
  name: string;
  ticketKey: string;
  bubble: string;
  status: AgentStatus;
  stuckSince: string;
}

/** An in-progress item for the standup report. */
export interface StandupInProgressItem {
  agentId: string;
  name: string;
  ticketKey: string;
  summary: string;
  status: AgentStatus;
}

/** the assistant's morning standup summary. */
export interface StandupSummary {
  /** When the summary covers from. */
  since: string;
  /** Work completed since the last visit. */
  done: StandupDoneItem[];
  /** Workers that are blocked or need attention, oldest first. */
  blocked: StandupBlockedItem[];
  /** What's queued or in progress now. */
  inProgress: StandupInProgressItem[];
  /** Shout-outs: top worker by completed items, any streaks. */
  shoutouts: {
    topWorker: { name: string; count: number } | null;
    };
  /** True when nothing happened since the last visit. */
  quiet: boolean;
}

/* ---------- The office's day (timelapse) ---------- */

/**
 * The moments the office keeps a record of, each worth a beat in the
 * timelapse of a day. The record says who and when, never what: no ticket
 * titles, paths or repo names.
 */
export const OFFICE_EVENT_KINDS = ['hire', 'question', 'approval', 'pr', 'done'] as const;
export type OfficeEventKind = (typeof OFFICE_EVENT_KINDS)[number];

/** One moment of the day, as GET /api/day answers. */
export interface OfficeEvent {
  kind: OfficeEventKind;
  workerId: string | null;
  workerName: string;
  at: string;
  /** A finished ticket's title, only when the request asked for titles. */
  title?: string;
}

/** A worker who had a moment in the day: the name and look the timelapse draws them with. */
export interface DayWorker {
  id: string;
  name: string;
  look: WorkerLook | null;
}

/** GET /api/day: the moments between `from` and `to`, oldest first, and the workers in them. */
export interface OfficeDay {
  from: string;
  to: string;
  events: OfficeEvent[];
  workers: DayWorker[];
}

/**
 * A moment as the timelapse's stage reads it, from its `ev` key: the kind,
 * the worker's place in the template's crew (0 is the top worker; null is
 * someone the frame has no desk for), and seconds since the day's midnight.
 */
export interface DayMoment {
  kind: OfficeEventKind;
  worker: number | null;
  at: number;
}

/** The most moments and workers the `ev` key carries: as many workers as the office has desks. */
export const DAY_MOMENTS_MAX = 600;
export const DAY_WORKERS_MAX = 16;
/** Two days of seconds, so a day that runs past midnight still fits. */
const DAY_SECONDS_MAX = 2 * 86_400;

const MOMENT_LETTER: Record<OfficeEventKind, string> = { hire: 'h', question: 'q', approval: 'a', pr: 'p', done: 'd' };
const MOMENT_KIND = new Map(Object.entries(MOMENT_LETTER).map(([kind, letter]) => [letter, kind as OfficeEventKind]));

/**
 * Moments as the `ev` key writes them: a letter for the kind, a hex digit for
 * the worker (`_` for none) and the seconds in base 36, joined by dots, as in
 * `h0rs0.p0s3k`. Short, and safe in an address as it is.
 */
export function encodeDayMoments(moments: readonly DayMoment[]): string {
  return [...moments]
    .sort((a, b) => a.at - b.at)
    .slice(0, DAY_MOMENTS_MAX)
    .map((m) => `${MOMENT_LETTER[m.kind]}${m.worker === null ? '_' : m.worker.toString(16)}${Math.round(m.at).toString(36)}`)
    .join('.');
}

/** The `ev` key read back, oldest first. Anything malformed is left out, so a bad address shows a quieter day rather than failing. */
export function decodeDayMoments(value: string | null): DayMoment[] {
  const out: DayMoment[] = [];
  for (const part of (value ?? '').split('.')) {
    const m = /^([a-z])([0-9a-f_])([0-9a-z]{1,4})$/.exec(part);
    const kind = m ? MOMENT_KIND.get(m[1] as string) : undefined;
    if (!m || !kind) continue;
    const at = parseInt(m[3] as string, 36);
    if (at > DAY_SECONDS_MAX) continue;
    out.push({ kind, worker: m[2] === '_' ? null : parseInt(m[2] as string, 16), at });
    if (out.length === DAY_MOMENTS_MAX) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The servers of one scope after a Sync, for the summary line; `name` is null for the general ones. */
export interface McpSyncInfo {
  name: string | null;
  total: number;
  added: number;
  updated: number;
  removed: number;
}

/* ---------- Office Memory ---------- */

/**
 * Where the memory came from:
 * - `worker`  saved by a worker mid-ticket via the `remember` tool
 * - `user`    saved by Tom via "Remember this" or chat command
 * - `review`  learned from a PR review thread
 */
export type MemorySource = 'worker' | 'user' | 'review';

/**
 * What kind of lesson the memory captures:
 * - `convention`  how this repo does things (test style, naming, config)
 * - `gotcha`      flaky tests, fragile modules, commands that don't work here
 * - `correction`  what the user told a worker mid-ticket
 * - `review`      why a PR was rejected or needed changes
 * - `approval`    actions the user always denies
 */
export type MemoryKind = 'convention' | 'gotcha' | 'correction' | 'review' | 'approval';

/**
 * A lesson stored in the office's memory. Workers learn these and are
 * briefed with them on new tickets.
 */
export interface Memory {
  id: number;
  /** The repo this memory belongs to (absolute path). */
  repo: string;
  /** The lesson text. */
  lesson: string;
  /** What kind of lesson it is. */
  kind: MemoryKind;
  /** Where it came from. */
  source: MemorySource;
  /** The worker who saved it, if any. */
  workerId: string | null;
  workerName: string | null;
  /** The ticket it was learned on, if any. */
  ticketKey: string | null;
  /** For review-sourced memories: the reviewer's name. */
  reviewer: string | null;
  /** For review-sourced memories: link to the thread. */
  threadUrl: string | null;
  /** Files this memory relates to (for boosting in search). */
  files: string[];
  /** When it was created. */
  createdAt: string;
  /** When it was last updated. */
  updatedAt: string;
  /** When it was last used in a briefing or recall. */
  lastUsedAt: string | null;
  /** How many times it has been used. */
  useCount: number;
  /** The embedding model used for this memory's vector. */
  embeddingModel: string | null;
  /** Whether this memory is flagged as stale (long unused). */
  stale: boolean;
  /** Whether this was saved by a worker and not yet seen by the user. */
  unseenByUser: boolean;
}

/** What gets sent when creating or updating a memory. */
export interface MemoryInput {
  lesson: string;
  kind?: MemoryKind;
  files?: string[];
  /** For review-sourced memories. */
  reviewer?: string;
  threadUrl?: string;
}

/**
 * What a worker is doing with Office Memory right now:
 * - `reading`  its hire briefing is being built, or it called `recall`
 * - `saving`   it called `remember`
 */
export type MemoryActivity = 'idle' | 'reading' | 'saving';

/** A memory with its similarity score from search. */
export interface MemoryMatch {
  memory: Memory;
  score: number;
}
