import {
  agentSetup,
  displayKey,
  isHandoffNote,
  splitTicketId,
  waitingOnAgents,
  type Agent,
  type AgentStatus,
  type Attachment,
  type ErrorAction,
  type Message,
  type Nudge,
  type QuestionAnswers,
  type QuestionRequest,
} from '@shared';
import { checkedAgo, commandNote, elapsed, helperNote, liveClock, offerNudge, quietNote, waitingOnCommands } from './live.js';
import { api, toUpload } from '../net/client.js';
import { attachTray, wireFileDrop, type AttachTray } from './attach.js';
import { mountVoice } from './voice.js';
import type { Store } from '../state/store.js';
import { $, clear, el, setRichText } from './dom.js';
import { chatStamp, stamped } from './stamp.js';
import { SOURCE_LABEL } from './tickets.js';
import { mountSlashMenu } from './slash-menu.js';
import { mountAtMenu, type AtChip } from './at-menu.js';
import { CHAT_SIZE, mountPanelResize } from './panel-resize.js';
import { currentKey, inChatWindow, onShortcut, withKey } from './shortcuts.js';
import { placeLines, reposChange, setupControls, setupLine, slidersIcon, workerMenu } from './setup.js';
import { reposControl } from './repo-field.js';
import { canSwitchRunner, runnerControl } from './runners.js';

export const STATUS_LABELS: Record<AgentStatus, { label: string; color: string }> = {
  starting: { label: 'Arriving', color: '#9cc2ff' },
  working: { label: 'Working', color: '#4f7fe0' },
  needs_you: { label: 'Needs you', color: '#f2a93b' },
  idle: { label: 'Idle', color: '#b7a993' },
  review: { label: 'PR ready', color: '#3e9a5c' },
  awaiting_review: { label: 'Awaiting review', color: '#7a5cc4' },
  in_review: { label: 'In review', color: '#7a5cc4' },
  fixing_findings: { label: 'Fixing findings', color: '#d98a3d' },
  reviewing: { label: 'Reviewing', color: '#7a5cc4' },
  done: { label: 'Shipped', color: '#3e9a5c' },
  error: { label: 'Error', color: '#c8553d' },
};

export const canFireWorker = (agent: Pick<Agent, 'builtInPam'>, previous: boolean): boolean =>
  !previous && !agent.builtInPam;

/**
 * A fire request outlives any one rendering of its confirmation buttons.
 * Keeping it here also gives every replacement button the same duplicate-call
 * guard while snapshots and agent events redraw the panel.
 */
export class FireRequests {
  private active = new Map<string, { removeWorktree: boolean }>();

  progress(agentId: string): { removeWorktree: boolean } | undefined {
    return this.active.get(agentId);
  }

  run(agentId: string, removeWorktree: boolean, request: () => Promise<void>): Promise<void> | null {
    if (this.active.has(agentId)) return null;
    this.active.set(agentId, { removeWorktree });
    return Promise.resolve()
      .then(request)
      .finally(() => this.active.delete(agentId));
  }
}

const fireRequests = new FireRequests();

/**
 * An idle worker with no `/` commands to offer has its session started for it
 * when its panel opens, once per worker, so the menu is there before Tom sends
 * anything. Only one with a chat to load: one without still has a brief to read.
 */
export class CommandWarmer {
  private asked = new Set<string>();

  warm(agent: Agent, previous: boolean, request: (id: string) => Promise<unknown>): void {
    if (previous || this.asked.has(agent.id)) return;
    if (agent.sessionLive || agent.commands?.length || !agent.chatId) return;
    if (agent.status === 'starting' || agent.status === 'error') return;
    this.asked.add(agent.id);
    // Quiet either way: the agent.updated it causes is what fills the menu.
    request(agent.id).catch(() => {});
  }
}

const commandWarmer = new CommandWarmer();

/**
 * The worker `step` places along from `currentId`, wrapping at either end.
 * A current worker that is not in the list (a previous one, say) steps from
 * just outside it, so next lands on the first and previous on the last.
 */
export function adjacentAgentId(
  agents: readonly Pick<Agent, 'id'>[],
  currentId: string | null,
  step: 1 | -1,
): string | null {
  if (!agents.length) return null;
  const at = agents.findIndex((a) => a.id === currentId);
  const from = at === -1 ? (step === 1 ? -1 : 0) : at;
  return agents[(from + step + agents.length) % agents.length]!.id;
}

/** The tooltip on a step arrow: who it goes to, once there is someone else. */
export function stepTitle(
  agents: readonly Pick<Agent, 'id' | 'name'>[],
  currentId: string | null,
  step: 1 | -1,
): string {
  const id = adjacentAgentId(agents, currentId, step);
  const to = id === currentId ? undefined : agents.find((a) => a.id === id);
  if (to) return `See ${to.name}`;
  return step === 1 ? 'Next worker' : 'Previous worker';
}

/**
 * The worker panel: chat with one agent, answer it, and open its worktree.
 *
 * Where the mock had a Terminal tab, this has an Open in IDE button. A
 * read-only stream was the weakest part of the mock; the editor pointed at the
 * agent's own worktree is what Tom actually wants when he needs to look.
 */
export function mountWorkerPanel(store: Store): void {
  const panel = $<HTMLElement>('agentPanel');
  const body = $<HTMLElement>('agentBody');
  const foot = $<HTMLElement>('agentFoot');
  const input = $<HTMLTextAreaElement>('chatInput');
  const openIdeBtn = $<HTMLButtonElement>('openIde');
  const openTicketLink = $<HTMLAnchorElement>('openTicket');
  const sendBtn = $<HTMLButtonElement>('sendBtn');
  const newChatBtn = $<HTMLButtonElement>('newChat');
  const historyBtn = $<HTMLButtonElement>('chatHistory');
  const fireBtn = $<HTMLButtonElement>('fireAgent');
  const rehireBtn = $<HTMLButtonElement>('rehireAgent');
  const attachBtn = $<HTMLButtonElement>('attachBtn');
  const attachInput = $<HTMLInputElement>('attachInput');
  const attachList = $<HTMLElement>('attachList');
  const newMsgsBtn = $<HTMLButtonElement>('newMsgs');
  const prevWorkerBtn = $<HTMLButtonElement>('prevWorker');
  const nextWorkerBtn = $<HTMLButtonElement>('nextWorker');

  mountPanelResize(panel, $<HTMLElement>('agentResize'), CHAT_SIZE);

  body.addEventListener('scroll', () => {
    if (isAtBottom(body)) newMsgsBtn.hidden = true;
  });
  newMsgsBtn.addEventListener('click', () => {
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    newMsgsBtn.hidden = true;
  });

  const pending = attachTray(attachList, {
    onChange: () => syncSendButton(store, input, sendBtn),
    onError: (message) => store.patch({ lastError: message }),
  });
  tray = pending;

  const addFiles = (files: Iterable<File>) => {
    const agent = store.selectedAgent();
    if (!agent) return;
    if (pendingFor !== agent.id) {
      pending.clear();
      pendingFor = agent.id;
    }
    pending.add(files);
  };

  // Track @-mentions from the at-menu
  let pendingAtChips: AtChip[] = [];

  const send = async () => {
    const agent = store.selectedAgent();
    const text = input.value.trim();
    const files = pendingFor === agent?.id ? [...pending.files] : [];
    if (!agent || (!text && !files.length)) return;

    // Collect @-mentions before clearing input
    const atMentions = pendingAtChips.map((chip) => ({
      workerId: chip.workerId,
      workerName: chip.workerName,
    }));

    input.value = '';
    voice.sent();
    fitToContent(input);
    pendingFor = null;
    pending.clear();
    pendingAtChips = [];
    syncSendButton(store, input, sendBtn);
    try {
      await api.send(agent.id, text, await Promise.all(files.map(toUpload)), atMentions);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    }
    syncSendButton(store, input, sendBtn);
  };

  attachBtn.addEventListener('click', () => attachInput.click());
  attachInput.addEventListener('change', () => {
    addFiles(attachInput.files ?? []);
    attachInput.value = '';
  });
  wireFileDrop(panel, input, addFiles);
  // The mic sits in the box's corner, and what it's doing on its own line above the disclaimer. The key works anywhere in the chat window.
  const voice = mountVoice(store, input, { in: foot, before: foot.querySelector('.pf-meta') }, { within: inChatWindow });

  const stop = async () => {
    const agent = store.selectedAgent();
    if (!agent) return;
    try {
      await api.stop(agent.id);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    }
  };

  const slash = mountSlashMenu($('slashMenu'), input, () => store.selectedAgent()?.commands ?? [], () => {
    fitToContent(input);
    syncSendButton(store, input, sendBtn);
  });

  const atMenu = mountAtMenu(
    $('atMenu'),
    input,
    () => store.selectedAgent()?.id ?? null,
    () => store.state.agents,
    (chip) => {
      pendingAtChips.push(chip);
      fitToContent(input);
      syncSendButton(store, input, sendBtn);
    },
  );

  sendBtn.addEventListener('click', () => void (isStopping(store, input) ? stop() : send()));
  // Enter always sends. With nothing typed there is nothing to send, so it
  // cannot be the way a turn gets stopped by accident.
  input.addEventListener('keydown', (e) => {
    if (slash.onKey(e)) return;
    if (atMenu.onKey(e)) return;
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    void send();
  });
  // The one button has two jobs, and which one depends on whether anything is
  // typed — so it has to be re-decided on every keystroke, not just when the
  // server says something.
  input.addEventListener('input', () => {
    fitToContent(input);
    syncSendButton(store, input, sendBtn);
    slash.refresh();
    atMenu.refresh();
  });

  $('closeAgent').addEventListener('click', () => store.selectAgent(null));

  const stepWorker = (step: 1 | -1) => {
    const id = adjacentAgentId(store.agentsByDesk(), store.state.selectedAgentId, step);
    if (id) store.selectAgent(id);
  };
  $('aSetupBtn').addEventListener('click', () => {
    const id = store.state.selectedAgentId;
    tuningSetup = tuningSetup === id ? null : id;
    const agent = store.selectedAgent();
    if (agent) renderSetup(store, agent, store.state.previous.some((a) => a.id === agent.id));
  });
  prevWorkerBtn.addEventListener('click', () => stepWorker(-1));
  nextWorkerBtn.addEventListener('click', () => stepWorker(1));
  // Like the arrows, but only while a chat is open: with none, the key does nothing.
  for (const [id, step] of [['prevChat', -1], ['nextChat', 1]] as const) {
    onShortcut(id, () => {
      if (!store.state.selectedAgentId) return false;
      stepWorker(step);
    });
  }

  openIdeBtn.addEventListener('click', async () => {
    const agent = store.selectedAgent();
    if (!agent) return;
    openIdeBtn.disabled = true;
    try {
      await api.open(agent.id);
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    } finally {
      openIdeBtn.disabled = !store.selectedAgent()?.branch;
    }
  });

  newChatBtn.addEventListener('click', async () => {
    const agent = store.selectedAgent();
    if (!agent) return;
    newChatBtn.disabled = true;
    try {
      await api.newConversation(agent.id);
      store.patch({ showHistory: false, confirmFire: false });
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    } finally {
      newChatBtn.disabled = false;
    }
  });

  // Both of these are shown in the body rather than as floating menus, so
  // they close each other: two panels of choices at once would be a mess.
  historyBtn.addEventListener('click', () =>
    store.patch({ showHistory: !store.state.showHistory, confirmFire: false }),
  );
  rehireBtn.addEventListener('click', async () => {
    const id = store.state.selectedAgentId;
    const agent = id ? store.state.previous.find((a) => a.id === id) : null;
    if (!agent) return;
    rehireBtn.disabled = true;
    try {
      const rehired = await api.rehire(agent.id);
      // Immediately update the store so Open IDE appears, regardless of SSE timing
      store.patch({
        agents: [...store.state.agents.filter((a) => a.id !== rehired.id), rehired],
        previous: store.state.previous.filter((a) => a.id !== rehired.id),
      });
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    } finally {
      rehireBtn.disabled = false;
    }
  });

  fireBtn.addEventListener('click', async () => {
    const agent = store.selectedAgent();
    if (!agent) return;
    // With no repo there is no worktree to decide about, and a researcher's
    // notes stay where they are either way, so there is nothing to ask.
    if (!agent.repoPath || !agent.branch) {
      fireBtn.disabled = true;
      await doFire(store, agent, false);
      fireBtn.disabled = false;
      return;
    }
    store.patch({ confirmFire: !store.state.confirmFire, showHistory: false });
  });

  store.subscribe(() => {
    if (pendingFor && pendingFor !== store.selectedAgent()?.id) {
      pendingFor = null;
      pending.clear();
    }
    render(store, { panel, body, foot, input, openIdeBtn, openTicketLink, sendBtn, newChatBtn, historyBtn, fireBtn, rehireBtn, newMsgsBtn, prevWorkerBtn, nextWorkerBtn });
    const shown = store.selectedAgent();
    if (shown) commandWarmer.warm(shown, store.state.previous.some((a) => a.id === shown.id), api.warm);
    // The session reports its commands after it starts, maybe while Tom is already typing one.
    if (document.activeElement === input) slash.refresh();
  });
}

/** The files waiting in the chat box, which belong to the worker they were added for. */
let tray: AttachTray | null = null;
let pendingFor: string | null = null;

function renderAttachments(agentId: string, attachments: Attachment[]): HTMLElement {
  const box = el('div', 'msg-files');
  for (const a of attachments) {
    const link = el('a', a.mimeType.startsWith('image/') ? 'msg-image' : 'msg-file');
    link.href = `/api/agents/${encodeURIComponent(agentId)}/uploads/${encodeURIComponent(a.file)}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = a.name;
    if (a.mimeType.startsWith('image/')) {
      const img = el('img');
      img.src = link.href;
      img.alt = a.name;
      img.loading = 'lazy';
      link.appendChild(img);
    } else {
      link.textContent = `${a.name} · ${fileSize(a.size)}`;
    }
    box.appendChild(link);
  }
  return box;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What a runner switch passed on to the new agent, folded under its heading. */
function handoffFold(text: string): HTMLElement {
  const [heading = '', ...rest] = text.split('\n');
  const fold = el('details', 'out-fold handoff-fold');
  fold.appendChild(el('summary', null, heading.replace(/:$/, '')));
  const msg = el('div', 'msg brief');
  setRichText(msg, rest.join('\n').trim(), { copyFencedCode: true });
  fold.appendChild(msg);
  return fold;
}

function messageBubble(m: Message): HTMLElement {
  const msg = el('div', `msg ${m.role}`);
  if (m.text) {
    const text = el('div');
    setRichText(text, m.text, { copyFencedCode: true });
    msg.appendChild(text);
  }
  if (m.attachments?.length) msg.appendChild(renderAttachments(m.agentId, m.attachments));
  return msg;
}

/**
 * Whether a turn is running, and so whether there is anything to stop.
 *
 * A worker waiting on a permission request counts: the turn is still open on
 * the other side, blocked on an answer. A worker that ended its turn with a
 * QUESTION: does not — that one is waiting to be typed to, and there is no
 * `needs_you` left to distinguish them by except the request itself.
 */
function isRunning(agent: Agent): boolean {
  return agent.status === 'working' || agent.status === 'starting' || agent.pendingPermission !== null || agent.pendingQuestion !== null;
}

/**
 * Whether the one footer button is currently a Stop rather than a Send.
 *
 * Typing turns it back into Send even mid-turn, because a message sent then is
 * queued for the end of the turn, and losing that would be a worse trade than
 * having the button change under you.
 */
function fitToContent(input: HTMLTextAreaElement): void {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
}

function isStopping(store: Store, input: HTMLTextAreaElement): boolean {
  const agent = store.selectedAgent();
  return !!agent && isRunning(agent) && !input.value.trim() && !(pendingFor === agent.id && tray?.files.length);
}

function syncSendButton(store: Store, input: HTMLTextAreaElement, button: HTMLButtonElement): void {
  const agent = store.selectedAgent();
  const stopping = isStopping(store, input);

  button.textContent = stopping ? 'Stop' : 'Send';
  button.title = stopping ? `Stop ${agent?.name ?? 'the worker'} mid-answer` : '';
  // Amber for Send, plain for Stop: stopping is a way out, not the thing the
  // panel is inviting you to do.
  button.className = stopping ? 'btn' : 'btn primary';
  button.disabled = !agent || agent.status === 'done';
}

interface Refs {
  panel: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  input: HTMLTextAreaElement;
  openIdeBtn: HTMLButtonElement;
  openTicketLink: HTMLAnchorElement;
  sendBtn: HTMLButtonElement;
  newChatBtn: HTMLButtonElement;
  historyBtn: HTMLButtonElement;
  fireBtn: HTMLButtonElement;
  rehireBtn: HTMLButtonElement;
  newMsgsBtn: HTMLButtonElement;
  prevWorkerBtn: HTMLButtonElement;
  nextWorkerBtn: HTMLButtonElement;
}

let shownChat: { agentId: string; content: string } | null = null;

/** The worker whose Model and Effort dropdowns are open in the header, and what they were drawn from. */
let tuningSetup: string | null = null;
let drawnSetup = '';

/**
 * The header's "Model: … · Effort: …" line, and the same dropdowns as the
 * Workers list behind its sliders button. Each pick is saved the moment it
 * changes; the server answers with agent.updated, which redraws the line.
 */
function renderSetup(store: Store, agent: Agent, previous: boolean): void {
  const office = store.state.health.modelMenu;
  const line = $('aSetup');
  line.textContent = setupLine(agent, office);
  // The line can be cut short in a narrow chat, so the whole of it is a hover away.
  line.title = line.textContent;
  const button = $<HTMLButtonElement>('aSetupBtn');
  const box = $('aSetupControls');
  // A worker that has left has no session to switch.
  button.hidden = previous;
  const open = !previous && tuningSetup === agent.id;
  const repos = reposChange(agent);
  const what = repos.show ? 'model, effort, runner and repos' : 'model, effort and runner';
  button.setAttribute('aria-expanded', String(open));
  button.title = open ? `Hide ${what}` : `Change ${agent.name}'s ${what}`;
  button.setAttribute('aria-label', button.title);
  if (!button.firstChild) button.appendChild(slidersIcon());
  box.hidden = !open;
  if (!open) {
    drawnSetup = '';
    clear(box);
    return;
  }
  // A redraw would close a dropdown Tom has open.
  if (document.activeElement instanceof HTMLSelectElement && box.contains(document.activeElement)) return;
  const switchable = canSwitchRunner(agent);
  const key = JSON.stringify([
    agent.id, agent.permission, agent.chosenModel, agent.effort, agent.modelMenu, office,
    // The runner switch shows only between turns, and lists the agents that are on and ready.
    agent.runnerMode, switchable, store.state.enabledRunners, Object.values(store.state.health.runners).map((r) => r.status),
    // The repos can change until there is a branch, and not mid-turn or with a plan waiting.
    repos, agent.repoPath, agent.extraRepos, store.state.repos,
  ]);
  if (key === drawnSetup) return;
  drawnSetup = key;
  clear(box);
  const controls = setupControls(
    agentSetup(agent),
    workerMenu(office, agent.modelMenu),
    (setup) => {
      api.saveSetup(agent.id, setup).catch((err: Error) => store.patch({ lastError: err.message }));
    },
    { permission: false },
  );
  box.appendChild(controls.node);
  if (switchable) box.appendChild(runnerControl(agent, store));
  if (repos.show) box.appendChild(reposControl(agent, store, repos.blocked));
}

function isAtBottom(body: HTMLElement): boolean {
  return body.scrollHeight - body.scrollTop - body.clientHeight < 40;
}

let currentWorkerMode: Record<string, 'chat' | 'work'> = {};

function renderModeToggle(agent: Agent): HTMLElement {
  let modeWrap = document.getElementById('aModeToggle');
  if (!modeWrap) {
    modeWrap = el('div', 'mode-toggle tabs source-tabs');
    modeWrap.id = 'aModeToggle';
    const place = $('aPlace');
    place.parentElement?.insertBefore(modeWrap, place);
  }
  const mode = currentWorkerMode[agent.id] || 'work';
  clear(modeWrap);

  const workBtn = el('button', `tab ${mode === 'work' ? 'selected' : ''}`, '🛠️ Work');
  workBtn.type = 'button';
  workBtn.title = 'Work on git repo, create branches and execute tasks';
  workBtn.addEventListener('click', () => {
    currentWorkerMode[agent.id] = 'work';
    renderModeToggle(agent);
  });

  const chatBtn = el('button', `tab ${mode === 'chat' ? 'selected' : ''}`, '💬 Chat');
  chatBtn.type = 'button';
  chatBtn.title = 'Free-form chat and reasoning without touching worktrees';
  chatBtn.addEventListener('click', () => {
    currentWorkerMode[agent.id] = 'chat';
    renderModeToggle(agent);
  });

  modeWrap.append(workBtn, chatBtn);
  return modeWrap;
}

function render(store: Store, refs: Refs): void {
  const agent = store.selectedAgent();
  if (!agent) {
    refs.panel.hidden = true;
    shownChat = null;
    return;
  }
  refs.panel.hidden = false;

  const { state } = store;
  const previous = state.previous.some((a) => a.id === agent.id);
  const fired = previous && agent.status !== 'done';
  refs.fireBtn.hidden = !canFireWorker(agent, previous);
  refs.rehireBtn.hidden = !previous;
  refs.newChatBtn.hidden = previous;
  refs.openIdeBtn.hidden = previous;
  refs.foot.hidden = previous;
  $('aName').textContent = agent.name;
  $('aTicket').textContent = agent.builtInPam ? 'Built-in secretary · delegates work' : `${displayKey(agent.ticketKey)}: ${agent.ticketSummary}`;
  renderModeToggle(agent);
  renderSetup(store, agent, previous);
  const place = $('aPlace');
  clear(place);
  for (const line of placeLines(agent)) {
    const row = el('span', 'sub place-line');
    row.append(el('span', 'place-label', `${line.label}:`), el('span', 'mono', line.text));
    place.appendChild(row);
  }
  refs.openIdeBtn.disabled = !agent.branch;
  refs.openIdeBtn.title = agent.branch
    ? "Open this agent's worktree in the IDE picked in Settings"
    : 'No worktree yet. It is created once you approve the plan.';

  // The address comes from the board, so a ticket that has left it has none.
  // Ad-hoc and research jobs never find one there.
  const ticketUrl = state.tickets.find((t) => t.key === agent.ticketKey)?.url ?? null;
  refs.openTicketLink.hidden = !ticketUrl;
  if (ticketUrl) {
    const where = SOURCE_LABEL[splitTicketId(agent.ticketKey)?.source ?? '8090'];
    refs.openTicketLink.href = ticketUrl;
    refs.openTicketLink.title = `Open ${displayKey(agent.ticketKey)} in ${where}`;
  }

  const status = STATUS_LABELS[agent.status];
  const pill = $<HTMLElement>('aPill');
  // Say so plainly when the worktree predates the office, rather than showing
  // a plain 'Idle' that implies an agent ran there and stopped.
  const untouched = agent.adopted && !agent.chatId;
  pill.textContent = fired ? 'Fired' : previous && agent.status === 'done' ? 'Done' : untouched && agent.status === 'idle' ? 'Already underway' : status.label;
  pill.style.setProperty('--st', fired ? '#c8553d' : untouched && agent.status === 'idle' ? '#8a7fd0' : status.color);
  pill.dataset.status = agent.status;

  // Anything typed mid-turn is held until the turn ends, in either runner
  // mode, and the placeholder is the only thing that says so.
  const mode = currentWorkerMode[agent.id] || 'work';
  refs.input.placeholder = isRunning(agent)
    ? `Queue a note for ${agent.name}`
    : mode === 'chat'
      ? `Chat freely with ${agent.name} (Thinking Effort enabled)...`
      : `Assign task or message ${agent.name}`;
  syncSendButton(store, refs.input, refs.sendBtn);

  // With one worker there is nowhere to step to.
  refs.prevWorkerBtn.disabled = refs.nextWorkerBtn.disabled = state.agents.length < 2;
  const byDesk = store.agentsByDesk();
  for (const [btn, id, step] of [[refs.prevWorkerBtn, 'prevChat', -1], [refs.nextWorkerBtn, 'nextChat', 1]] as const) {
    const key = currentKey(id);
    btn.title = withKey(stepTitle(byDesk, agent.id, step), key);
    if (key) btn.setAttribute('aria-keyshortcuts', key);
    else btn.removeAttribute('aria-keyshortcuts');
  }

  // Only worth offering once there is something to go back to.
  refs.historyBtn.hidden = agent.conversations.length < 2;
  refs.historyBtn.setAttribute('aria-expanded', String(state.showHistory));

  if (liveTick !== null) {
    window.clearInterval(liveTick);
    liveTick = null;
  }
  const wasAtBottom = isAtBottom(refs.body);
  const scrollTop = refs.body.scrollTop;
  const focused = document.activeElement;
  clear(refs.body);

  if (state.lastError) {
    const box = el('div', 'error-box', state.lastError);
    refs.body.appendChild(box);
  }

  if (state.showHistory || state.showApprovals) {
    shownChat = null;
    refs.newMsgsBtn.hidden = true;
    if (state.showHistory) renderHistory(store, refs.body, agent);
    else renderApprovals(store, refs.body, agent);
    return;
  }

  renderChat(store, refs.body, agent, previous);

  const messages = store.messagesFor(agent.id);
  const content = `${messages.length}:${state.streaming.get(agent.id)?.length ?? 0}`;
  const sameChat = shownChat?.agentId === agent.id;
  const grew = sameChat && shownChat?.content !== content;
  const sentByMe = grew && messages.at(-1)?.role === 'you';
  if (!sameChat || wasAtBottom || sentByMe) {
    refs.body.scrollTop = refs.body.scrollHeight;
    refs.newMsgsBtn.hidden = true;
  } else {
    refs.body.scrollTop = scrollTop;
    if (grew) refs.newMsgsBtn.hidden = false;
  }
  shownChat = { agentId: agent.id, content };

  // After the chat, not before it: the chat ends scrolled to the bottom, and a
  // confirm above it was scrolled straight out of sight. The permission box
  // sits at the bottom for the same reason — that is where you are looking.
  if (state.confirmFire) {
    renderFireConfirm(store, refs.body, agent);
    refs.body.scrollTop = refs.body.scrollHeight;
  }

  if (focused instanceof HTMLElement && focused !== document.activeElement && refs.body.contains(focused)) {
    focused.focus({ preventScroll: true });
  }
}

/**
 * The worker's other conversations. Each one is a separate Cursor session, so
 * opening one carries it on from where it stopped rather than replaying it.
 */
function renderHistory(store: Store, body: HTMLElement, agent: Agent): void {
  body.appendChild(el('div', 'grants-head', `Conversations with ${agent.name}`));

  for (const conversation of agent.conversations) {
    const open = conversation.id === agent.conversationId;
    const row = el('button', `convo${open ? ' open' : ''}`);
    row.appendChild(el('span', 'convo-title', conversation.title || 'Nothing said yet'));
    row.appendChild(
      el(
        'span',
        'convo-meta',
        [
          open ? 'open now' : null,
          `${conversation.messageCount} message${conversation.messageCount === 1 ? '' : 's'}`,
          new Date(conversation.createdAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          }),
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );

    if (open) {
      row.disabled = true;
    } else {
      row.addEventListener('click', async () => {
        row.disabled = true;
        try {
          await api.openConversation(agent.id, conversation.id);
          store.patch({ showHistory: false });
        } catch (err) {
          row.disabled = false;
          store.patch({ lastError: (err as Error).message });
        }
      });
    }
    body.appendChild(row);
  }
}

/**
 * Firing asks first when there is a worktree, because that is the part worth
 * a decision: it may hold the only copy of what the worker did.
 */
function renderFireConfirm(store: Store, body: HTMLElement, agent: Agent): void {
  const box = el('div', 'ask fire');
  box.appendChild(el('b', null, `Send ${agent.name} home?`));
  box.appendChild(
    el(
      'div',
      'detail',
      `The desk is freed and nothing is written back to the tracker or 8090 — ${displayKey(agent.ticketKey)} stays exactly as it is on the board. They stay on the Previous tab, and Rehire brings them back with their name, look, setup and chats. Commits that have not been pushed are never deleted, whichever you pick.`,
    ),
  );

  const actions = el('div', 'actions');
  const progress = fireRequests.progress(agent.id);

  if (progress) {
    const busy = el(
      'button',
      'btn small danger filled loading',
      progress.removeWorktree ? 'Firing and deleting…' : 'Firing…',
    );
    busy.disabled = true;
    busy.setAttribute('aria-busy', 'true');
    actions.appendChild(busy);
    box.appendChild(actions);
    body.appendChild(box);
    return;
  }

  // Ordered least to most destructive, so backing out is the first thing read
  // and is never sitting next to the button that deletes a worktree.
  const cancel = el('button', 'btn small', 'Keep them on');
  cancel.addEventListener('click', () => store.patch({ confirmFire: false }));
  actions.appendChild(cancel);

  const keep = el('button', 'btn small', 'Fire, keep the worktree');
  keep.addEventListener('click', () => void doFire(store, agent, false));
  actions.appendChild(keep);

  // An adopted worktree was never the office's to delete, so it does not get
  // the offer.
  if (agent.repoPath && agent.branch && !agent.adopted) {
    const drop = el('button', 'btn small danger filled', 'Fire and delete it');
    drop.addEventListener('click', () => void doFire(store, agent, true));
    actions.appendChild(drop);
  }

  box.appendChild(actions);
  body.appendChild(box);
}

async function doFire(store: Store, agent: Agent, removeWorktree: boolean): Promise<void> {
  const request = fireRequests.run(agent.id, removeWorktree, async () => {
    await api.fire(agent.id, removeWorktree);
  });
  if (!request) return;

  // Rebuild the confirmation immediately. Its replacement reads the request
  // above, so later server events keep showing the same progress state.
  store.patch({});
  try {
    await request;
    store.selectAgent(null);
  } catch (err) {
    // `request` clears its progress marker before this redraw, restoring all
    // confirmation choices alongside the existing error message.
    store.patch({ lastError: (err as Error).message });
  }
}

/** Cleared on every render, so at most one is ever running. */
let liveTick: number | null = null;

/**
 * What the last nudge found, by worker. Kept out here because the chat is
 * redrawn from scratch, and shown until the worker is heard from again.
 */
/** The last Nudge answer for each worker, and which agents it was waiting on when asked. */
const nudged = new Map<string, Nudge & { at: number; helpers: string }>();

/**
 * Which review buttons a worker's panel shows: End review from either side of
 * a review, naming the reviewer on the worker's side, or else Request review
 * on finished work with a branch, PR or not.
 */
export function reviewActions(
  agent: Agent,
  agents: readonly Agent[],
  reviewEnabled: boolean,
): { endReviewerId: string | null; reviewerName: string | null; canRequest: boolean } {
  // A reviewer that already left has nothing left to end.
  const reviewer = agent.reviewerId ? agents.find((a) => a.id === agent.reviewerId) : undefined;
  const endReviewerId = agent.reviewingId ? agent.id : reviewer?.id ?? null;
  const reviewerName = reviewer?.name ?? null;
  const finished = agent.status === 'review' || agent.status === 'idle';
  const canRequest = !endReviewerId && !agent.builtInPam && finished && !!agent.branch && reviewEnabled;
  return { endReviewerId, reviewerName, canRequest };
}

function addReviewActions(store: Store, actions: HTMLElement, agent: Agent): void {
  const button = (label: string, run: () => Promise<unknown>): void => {
    const b = el('button', 'btn small', label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await run();
      } catch (err) {
        b.disabled = false;
        store.patch({ lastError: (err as Error).message });
      }
    });
    actions.appendChild(b);
  };

  const { endReviewerId, reviewerName, canRequest } = reviewActions(agent, store.state.agents, store.state.limits.reviewEnabled);
  if (reviewerName) actions.appendChild(el('span', 'reviewer-info', `Reviewer: ${reviewerName}`));
  if (endReviewerId) button('End review', () => api.dismissReviewer(endReviewerId, 'dismissed'));
  if (canRequest) button('Request review', () => api.requestReview(agent.id));
}

function renderChat(store: Store, body: HTMLElement, agent: Agent, previous = false): void {
  const messages = store.messagesFor(agent.id);
  if (previous && !messages.length) {
    const waiting = agent.conversations.some((c) => c.id === agent.conversationId && c.messageCount > 0);
    if (waiting) body.appendChild(el('div', 'empty', 'Opening the chat…'));
  }

  // A divider with the time over the first message and wherever the chat picks
  // up after a pause, but not inside the agent's reply to a message.
  const shown = (m: Message): boolean => m.role !== 'brief' || isHandoffNote(m);
  const stamps = stamped(messages, shown);
  const now = new Date();
  messages.forEach((m) => {
    if (!shown(m)) return;
    if (stamps.has(m)) body.appendChild(el('div', 'chat-stamp', chatStamp(m.createdAt, now)));
    if (isHandoffNote(m)) {
      body.appendChild(handoffFold(m.text));
      return;
    }
    if (m.role === 'output') {
      // Terminal output, so the line breaks are the content and it is left as
      // plain text — backticks in a stack trace are not markdown.
      const out = el('pre', 'out', m.text);
      if (store.plain()) {
        // In Plain mode what a command printed is there if wanted, folded away.
        const fold = el('details', 'out-fold');
        fold.appendChild(el('summary', null, 'Show what it printed'));
        fold.appendChild(out);
        body.appendChild(fold);
      } else {
        body.appendChild(out);
      }
      return;
    }
    if (m.role === 'tool') {
      const chip = el('div', 'chip-tool');
      const plainWords = store.plain() ? m.plain : undefined;
      if (plainWords) {
        // Plain words, with the exact command one click away.
        chip.classList.add('plain');
        chip.title = 'Click to see the exact command';
        setRichText(chip, plainWords);
        chip.addEventListener('click', () => setRichText(chip, chip.classList.toggle('raw') ? m.text : plainWords));
      } else {
        setRichText(chip, m.text);
      }
      body.appendChild(chip);
      return;
    }
    if (m.attachments?.length) {
      body.appendChild(messageBubble(m));
      return;
    }
    const msg = el('div', `msg ${m.role}`);
    setRichText(msg, m.text, { copyFencedCode: true });
    body.appendChild(msg);
  });

  const partial = store.state.streaming.get(agent.id);
  if (partial) {
    const streaming = el('div', 'msg agent streaming');
    setRichText(streaming, partial, { copyFencedCode: true });
    body.appendChild(streaming);
  }

  // One line, and above everything live. The full list used to sit at the
  // bottom of the chat, and once it had grown to nine entries it filled the
  // panel and pushed the running command out of sight — which looked exactly
  // like a worker that had hung.
  if (!previous && agent.grants.length) {
    const n = agent.grants.length;
    const summary = el(
      'button',
      'grants-summary',
      `Workers no longer ask about ${n} thing${n > 1 ? 's' : ''}`,
    );
    summary.type = 'button';
    summary.title = 'Review what you have let workers stop asking about';
    summary.addEventListener('click', () => store.patch({ showApprovals: true }));
    body.appendChild(summary);
  }

  // What it is doing right now. Tool chips say what it has already done, and
  // between a tool finishing and the next one starting the panel would
  // otherwise sit there looking like nothing was happening.
  const settingUp = agent.status === 'starting' && !!agent.workPlan;
  if (!previous && (agent.status === 'working' || agent.status === 'starting') && !settingUp) {
    // Nothing comes back from the CLI while a command runs, and nothing comes
    // back while the model is thinking either, so a counter that is visibly
    // moving is the whole of the evidence that the worker is alive. Only this
    // one node is rewritten each second; re-rendering would fight the scroll.
    //
    // A running tool is timed from when it started, because that is the
    // question then — how long has this been going. With no tool running the
    // clock is time since anything at all was heard, which is the question
    // the rest of the time: whether this is still happening.

    const live = el('div', 'chip-tool live');
    const label = el('span', 'live-label');
    setRichText(label, store.bubbleOf(agent) || 'Working');
    live.appendChild(label);

    const clock = el('span', 'ticking');
    live.appendChild(clock);
    body.appendChild(live);

    // Agents it sent off, one line each. Claude Code waits on all of them
    // without a word, so this is the only sign of what the wait is for.
    const helpers = agent.backgroundAgents ?? [];
    if (helpers.length) label.textContent = waitingOnAgents(helpers.length);
    const helperClocks: Array<{ clock: HTMLElement; since: number }> = [];
    // A Nudge answer names the agents out when it was asked; once one is
    // back, it is out of date.
    const helperKey = [...helpers.map((h) => `${h.name}@${h.since}`), ...(agent.backgroundCommands ?? []).map((c) => `${c.command}@${c.since}`)].join('\n');
    if (helpers.length) {
      const list = el('ul', 'helper-list');
      for (const h of helpers) {
        const row = el('li');
        const what = el('span', 'helper-what');
        what.append(el('b', '', h.name));
        if (h.task && h.task !== h.name) what.append(` ${h.task}`);
        const ticking = el('span', 'ticking');
        row.append(what, ticking);
        list.appendChild(row);
        helperClocks.push({ clock: ticking, since: new Date(h.since).getTime() });
      }
      body.appendChild(list);
    }

    // Commands the office found running behind the silence, the same way. A
    // command sent to the background reports as done and the CLI then waits
    // on it without a word, so this is the only sign of what the wait is for.
    const commands = helpers.length ? [] : (agent.backgroundCommands ?? []);
    if (commands.length) {
      label.textContent = waitingOnCommands(commands.length);
      const list = el('ul', 'helper-list');
      for (const c of commands) {
        const row = el('li');
        const what = el('span', 'helper-what mono', c.command);
        what.title = c.command;
        const ticking = el('span', 'ticking');
        row.append(what, ticking);
        list.appendChild(row);
        helperClocks.push({ clock: ticking, since: new Date(c.since).getTime() });
      }
      body.appendChild(list);
    }

    // What it is thinking, the latest of it. Thinking can go on for minutes
    // with the bubble saying the same thing throughout.
    if (agent.thought && !helpers.length) {
      const thought = el('div', 'live-thought', agent.thought);
      thought.title = 'What it is thinking';
      body.appendChild(thought);
    }

    // Why the wait is silent, said straight away. The Nudge below waits its
    // turn like any other, so this is not tied to it.
    if (helpers.length || commands.length) {
      body.appendChild(el('div', 'quiet-note', helpers.length ? helperNote(agent) : commandNote(agent)));
    }

    // Silence is expected while a command runs and is not while a worker is
    // only thinking, so only the second kind is ever called out — and in
    // words, rather than leaving Tom to infer it from a number going up.
    // Either kind gets a Nudge once it has gone on a while: a CLI that died
    // in the middle of a command looks exactly like a long command.
    const note = el('div', 'quiet-note');
    const noteText = el('span');
    const nudge = el('button', 'btn small', 'Nudge');
    nudge.type = 'button';
    nudge.title = `Check that ${agent.name} is still working, and tell them to carry on if not`;
    note.append(noteText, nudge);
    body.appendChild(note);

    const paint = (): void => {
      const now = Date.now();
      // Read each time: a sign of life that changes nothing is not re-rendered.
      const { since, stalled } = liveClock(agent, store.state.heardAt.get(agent.id), now);
      clock.textContent = elapsed(since, now);
      for (const h of helperClocks) h.clock.textContent = elapsed(h.since, now);
      live.classList.toggle('quiet', stalled);
      note.hidden = !offerNudge(since, now);
      if (stalled) label.textContent = `${agent.name} has gone quiet`;
      const found = nudged.get(agent.id);
      setRichText(
        noteText,
        found && found.at > since && found.helpers === helperKey
          ? `${checkedAgo(found.at, now)} ${found.text}`
          : helpers.length || commands.length
            ? 'Nudge checks that it is still going.'
            : stalled
              ? quietNote(agent, since, now)
              : 'A command says nothing until it finishes. Nudge checks that it is still going.',
      );
    };

    nudge.addEventListener('click', async () => {
      nudge.disabled = true;
      nudge.textContent = 'Checking…';
      try {
        nudged.set(agent.id, { ...(await api.nudge(agent.id)), at: Date.now(), helpers: helperKey });
      } catch (err) {
        store.patch({ lastError: (err as Error).message });
      } finally {
        nudge.disabled = false;
        nudge.textContent = 'Nudge';
      }
      paint();
    });

    paint();
    liveTick = window.setInterval(paint, 1000);
  }

  if (agent.queuedMessages > 0) {
    body.appendChild(
      el('div', 'chip-tool', `${agent.queuedMessages} message${agent.queuedMessages > 1 ? 's' : ''} queued until this turn ends`),
    );
  }

  const permission = agent.pendingPermission;
  if (permission) {
    const box = el('div', 'ask');
    const what = el('b');
    // In Plain mode the request is said in plain words, and the exact command
    // stays right under it: what is being approved is never hidden.
    const plainWords = store.plain() ? permission.plain : undefined;
    setRichText(what, plainWords ?? permission.title);
    box.appendChild(what);
    if (plainWords) {
      const exact = el('div', 'exact');
      exact.appendChild(el('span', 'setup-label', 'Exactly'));
      const cmd = el('span');
      setRichText(cmd, permission.title);
      exact.appendChild(cmd);
      box.appendChild(exact);
    }
    if (permission.detail) box.appendChild(el('div', 'detail', permission.detail));

    const answer = async (allow: boolean, scope: 'once' | 'always') => {
      try {
        await api.permission(agent.id, permission.id, allow, scope);
      } catch (err) {
        store.patch({ lastError: (err as Error).message });
      }
    };

    const actions = el('div', 'actions');
    for (const option of permission.options) {
      const btn = el('button', `btn small${option.kind === 'allow' ? ' primary' : ''}`, option.label);
      btn.addEventListener('click', () => void answer(option.kind === 'allow', 'once'));
      actions.appendChild(btn);
    }

    // Offered only when the request carries a rule. A push, an install, a
    // network call or anything reaching outside the worktree arrives without
    // one, so there is deliberately no way to stop being asked about those.
    if (permission.rule) {
      const always = el('button', 'btn small', `Always allow ${permission.rule.label}`);
      always.addEventListener('click', () => void answer(true, 'always'));
      actions.appendChild(always);
    }

    box.appendChild(actions);
    body.appendChild(box);
  }

  if (agent.pendingQuestion) body.appendChild(questionCard(store, agent.id, agent.pendingQuestion));

  if (!previous && !agent.builtInPam && agent.workPlan) {
    const box = el('div', 'ask');
    box.appendChild(el('b', null, `${agent.name} wants to start work`));
    // The plan is the agent's prose, so it reads as formatted text; a
    // permission's detail below stays monospace, since that is a command.
    const plan = el('div', 'detail plan');
    setRichText(plan, agent.workPlan);
    box.appendChild(plan);
    box.appendChild(el('span', 'sub', `Start work creates a worktree on a new branch off ${agent.baseBranch ?? 'the base branch'}.`));
    const buttons = el('div', 'actions');
    const start = el('button', 'btn small primary', 'Start work');
    const notYet = el('button', 'btn small', 'Not yet');
    const loading = () => {
      start.disabled = true;
      start.classList.add('loading');
      start.textContent = 'Setting up the worktree';
      notYet.hidden = true;
    };
    const decide = async (approve: boolean, btn: HTMLButtonElement) => {
      if (approve) loading();
      else btn.disabled = true;
      try {
        await api.startWork(agent.id, approve);
      } catch (err) {
        start.disabled = notYet.disabled = false;
        start.classList.remove('loading');
        start.textContent = 'Start work';
        notYet.hidden = false;
        store.patch({ lastError: (err as Error).message });
      }
    };
    start.addEventListener('click', () => void decide(true, start));
    notYet.addEventListener('click', () => void decide(false, notYet));
    if (settingUp) loading();
    buttons.append(start, notYet);
    box.appendChild(buttons);
    body.appendChild(box);
  }

  const actions = el('div', 'actions');

  const reviewStatuses: AgentStatus[] = ['review', 'awaiting_review', 'in_review'];
  if (!agent.builtInPam && reviewStatuses.includes(agent.status)) {
    // Mark done button - only when not waiting for or in review
    if (agent.status === 'review') {
      const done = el('button', 'btn small primary', 'Mark done');
      done.addEventListener('click', async () => {
        done.disabled = true;
        try {
          await api.done(agent.id);
        } catch (err) {
          done.disabled = false;
          store.patch({ lastError: (err as Error).message });
        }
      });
      actions.appendChild(done);
    }

    if (agent.prUrl) {
      const link = el('a', 'btn small', 'View PR');
      (link as HTMLAnchorElement).href = agent.prUrl;
      (link as HTMLAnchorElement).target = '_blank';
      (link as HTMLAnchorElement).rel = 'noreferrer';
      actions.appendChild(link);
    }
  }

  if (!previous && !agent.builtInPam) addReviewActions(store, actions, agent);

  const resumable = !previous && agent.status === 'idle' && !agent.sessionLive && (agent.chatId !== null || agent.adopted || !!agent.needsBrief);
  if (!previous && (agent.status === 'error' || resumable)) {
    // An adopted worker has never been briefed, so "Resume" would undersell
    // what the button does: it hands the ticket to an agent for the first time.
    const label = agent.status === 'error'
      ? 'Retry'
      : agent.adopted && !agent.chatId
        ? 'Pick this up'
        : 'Resume';
    const retry = el('button', `btn small${agent.adopted && !agent.chatId ? ' primary' : ''}`, label);
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try {
        await api.resume(agent.id);
      } catch (err) {
        store.patch({ lastError: (err as Error).message });
      } finally {
        retry.disabled = false;
      }
    });
    actions.appendChild(retry);

    // Show action buttons based on the error type
    if (agent.status === 'error' && agent.errorAction) {
      const actionBtn = errorActionButton(store, agent);
      if (actionBtn) actions.appendChild(actionBtn);
    }
  }

  if (actions.childElementCount) body.appendChild(actions);

  if (agent.lastError) body.appendChild(errorBox(store, agent));
}

/**
 * What workers no longer ask about, as a view of its own. The list is the
 * office's, so it is the same from every worker's panel.
 *
 * Still one click from the chat, because a standing approval Tom has
 * forgotten giving is the whole risk of having them at all — but not in the
 * chat, where a list that only grows competes with what is happening now.
 */
function renderApprovals(store: Store, body: HTMLElement, agent: Agent): void {
  const back = el('button', 'btn small', 'Back to the chat');
  back.addEventListener('click', () => store.patch({ showApprovals: false }));
  body.appendChild(back);

  const box = el('div', 'grants');
  box.appendChild(el('div', 'grants-head', 'Workers no longer ask about'));

  for (const grant of agent.grants) {
    const row = el('div', 'grant');
    row.appendChild(el('span', 'grant-label', grant.label));

    const undo = el('button', 'grant-undo', 'Ask again');
    undo.title = `Have every worker ask before ${grant.label} again`;
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      try {
        await api.revokeGrant(agent.id, grant.id);
      } catch (err) {
        undo.disabled = false;
        store.patch({ lastError: (err as Error).message });
      }
    });
    row.appendChild(undo);
    box.appendChild(row);
  }

  body.appendChild(box);
}

let shownQuestion: { id: string; box: HTMLElement } | null = null;

function questionCard(store: Store, agentId: string, request: QuestionRequest): HTMLElement {
  if (shownQuestion?.id === request.id) return shownQuestion.box;

  const box = el('div', 'ask question');
  const title = el('b');
  setRichText(title, request.title);
  box.appendChild(title);

  const picks = new Map(request.questions.map((q) => [q.key, new Set<string>()]));
  const others = new Map<string, HTMLInputElement>();
  const oneClick = request.questions.length === 1 && !request.questions[0]!.multiple;
  const submit = el('button', 'btn small primary', 'Submit');
  const skip = el('button', 'btn small', 'Skip');

  const answers = (): QuestionAnswers =>
    Object.fromEntries(
      request.questions.map((q) => {
        const other = others.get(q.key)?.value.trim();
        return [q.key, { picks: [...(picks.get(q.key) ?? [])], ...(other ? { other } : {}) }];
      }),
    );
  const answered = () => Object.values(answers()).some((a) => a.picks.length > 0 || !!a.other);
  const sync = () => {
    submit.disabled = !answered();
  };
  const controls = () => box.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input');
  const send = async (value: QuestionAnswers | null) => {
    for (const c of controls()) c.disabled = true;
    try {
      await api.question(agentId, request.id, value);
    } catch (err) {
      for (const c of controls()) c.disabled = false;
      sync();
      store.patch({ lastError: (err as Error).message });
    }
  };

  for (const q of request.questions) {
    const item = el('div', 'question-item');
    if (q.header) item.appendChild(el('span', 'question-head', q.header));
    if (q.text) {
      const text = el('div', 'question-text');
      setRichText(text, q.text);
      item.appendChild(text);
    }
    const chosen = picks.get(q.key)!;
    const list = el('div', 'question-options');
    const buttons: Array<[string, HTMLButtonElement]> = [];
    for (const option of q.options) {
      const btn = el('button', 'question-option');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      // Agents write options in markdown, so code and bold show as they do in the chat.
      const label = el('span', 'question-label');
      setRichText(label, option.label);
      btn.appendChild(label);
      if (option.description) {
        const description = el('span', 'question-desc');
        setRichText(description, option.description);
        btn.appendChild(description);
      }
      btn.addEventListener('click', () => {
        if (!q.multiple) chosen.clear();
        if (q.multiple && chosen.has(option.value)) chosen.delete(option.value);
        else chosen.add(option.value);
        for (const [value, b] of buttons) b.setAttribute('aria-pressed', String(chosen.has(value)));
        if (oneClick) void send(answers());
        else sync();
      });
      buttons.push([option.value, btn]);
      list.appendChild(btn);
    }
    item.appendChild(list);
    if (q.otherKey) {
      const other = el('input', 'ask-input question-other');
      other.placeholder = q.multiple ? 'Add something else' : 'Or type your own answer';
      other.addEventListener('input', sync);
      other.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || !answered()) return;
        e.preventDefault();
        void send(answers());
      });
      others.set(q.key, other);
      item.appendChild(other);
    }
    box.appendChild(item);
  }

  submit.addEventListener('click', () => void send(answers()));
  skip.addEventListener('click', () => void send(null));
  sync();
  const actions = el('div', 'actions');
  actions.append(submit, skip);
  box.appendChild(actions);

  shownQuestion = { id: request.id, box };
  return box;
}

/**
 * Creates an action button based on the error type.
 * "Switch model" for quota/model errors, nothing for errors that just need a retry.
 */
function errorActionButton(store: Store, agent: Agent): HTMLElement | null {
  const action = agent.errorAction;
  if (!action) return null;

  // Actions that should show a button alongside Retry
  const buttonActions: Partial<Record<ErrorAction, { label: string; title: string }>> = {
    switch_model: {
      label: 'Switch model',
      title: 'Try a different model that may have available credits',
    },
    switch_runner: {
      label: 'Switch runner',
      title: 'Try a different coding agent runner',
    },
  };

  const config = buttonActions[action];
  if (!config) return null;

  const btn = el('button', 'btn small', config.label);
  btn.title = config.title;
  btn.addEventListener('click', () => {
    // Open the Workers panel where the model/runner can be changed
    store.patch({ workersOpen: true });
  });
  return btn;
}

/**
 * Renders an error box with the error message and any helpful context.
 */
function errorBox(store: Store, agent: Agent): HTMLElement {
  const box = el('div', 'error-box');

  // Error message
  const message = el('div', 'error-message', agent.lastError ?? 'An error occurred');
  box.appendChild(message);

  // Helpful hint based on error type
  const hints: Partial<Record<ErrorAction, string>> = {
    switch_model: 'Try switching to a different model in the Workers panel.',
    switch_runner: 'Try switching to a different runner with the sliders button above, or in the Workers panel.',
    sign_in: 'Check your sign-in status in the terminal.',
    wait: 'The service is temporarily rate-limited. Wait a moment and retry.',
    install: 'Make sure the CLI is installed and on your PATH.',
  };

  const hint = agent.errorAction ? hints[agent.errorAction] : null;
  if (hint) {
    const hintEl = el('div', 'error-hint', hint);
    box.appendChild(hintEl);
  }

  return box;
}
