import { displayKey, type Activity, type Agent } from '@shared';
import { lastSaid } from '../scene/office.js';
import { portrait } from '../scene/portrait.js';
import { VIEWS, baseRoom, type Store, type View } from '../state/store.js';
import { $, clear, el, setRichText } from './dom.js';
import { STATUS_LABELS } from './worker.js';
import { onShortcut } from './shortcuts.js';

const VIEW_LABELS: Record<View, string> = { office: 'Office', cards: 'Cards' };

/** Where a worker sits, for its card. A reviewer has no desk of its own. */
export function deskLabel(agent: Pick<Agent, 'builtInPam' | 'deskIndex'>): string {
  if (agent.builtInPam) return 'Reception';
  return agent.deskIndex < 0 ? 'Reviewer' : `Desk ${agent.deskIndex + 1}`;
}

/** The room the chat panel takes on the right: its width plus its 12px inset, or none while it's closed. */
export function chatSpace(width: number, hidden: boolean): string {
  return hidden ? '0px' : `${width + 12}px`;
}

const ACTIVITY_LABELS: Record<Activity, string | null> = {
  idle: null,
  thinking: 'Thinking',
  typing: 'Writing code',
  git: 'Git',
  cloud: 'Cloud',
  tickets: 'Tickets',
  research: 'Researching',
};

/**
 * The view switcher, and the Cards view: every worker as a still card in
 * desk order, with no room behind them. A card opens its worker the way
 * clicking the figure in the office does.
 */
export function mountViews(store: Store): void {
  const app = $<HTMLElement>('app');
  const switcher = $<HTMLElement>('views');
  const grid = $<HTMLElement>('cards');

  const hud = document.querySelector<HTMLElement>('.hud');
  if (hud && 'ResizeObserver' in window) {
    new ResizeObserver(() => app.style.setProperty('--hud-bottom', `${hud.offsetTop + hud.offsetHeight}px`)).observe(hud);
  }
  // Cards stop short of the chat panel, so none sit under it.
  const chat = document.getElementById('agentPanel');
  if (chat && 'ResizeObserver' in window) {
    new ResizeObserver(() => app.style.setProperty('--chat-space', chatSpace(chat.offsetWidth, chat.hidden))).observe(chat);
  }

  const buttons = VIEWS.map((view) => {
    const b = el('button', 'btn small', VIEW_LABELS[view]);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      store.patch({ view });
      ;
    });
    switcher.appendChild(b);
    return b;
  });

  onShortcut('view', () => {
    const next = VIEWS[(VIEWS.indexOf(store.state.view) + 1) % VIEWS.length] as View;
    store.patch({ view: next });
    ;
  });

  let drawn = '';
  store.subscribe((state) => {
    app.dataset.view = state.view;
    app.dataset.room = baseRoom(state.room, state.offices);
    buttons.forEach((b, i) => {
      const on = VIEWS[i] === state.view;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('primary', on);
    });

    const cards = state.view === 'cards';
    grid.hidden = !cards;
    if (!cards) {
      drawn = '';
      return;
    }

    const said = lastSaid(state.messages);
    const agents = store.agentsByDesk();
    const key = JSON.stringify([
      state.selectedAgentId,
      agents.map((a) => [a.id, a.name, a.status, a.activity, store.bubbleOf(a), a.model, a.ticketKey, a.ticketSummary, a.look, said.get(a.id)]),
    ]);
    if (key === drawn) return;
    drawn = key;

    clear(grid);
    if (!agents.length) {
      const empty = el('div', 'cards-empty');
      empty.appendChild(el('b', '', 'Nobody is hired yet'));
      empty.appendChild(el('span', '', 'Pick a ticket, or ask for anything, and a worker takes a desk.'));
      const hire = el('button', 'btn primary', 'Hire');
      hire.type = 'button';
      hire.addEventListener('click', () => store.patch({ ticketPanelOpen: true, settingsOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false }));
      empty.appendChild(hire);
      grid.appendChild(empty);
      return;
    }
    for (const agent of agents) grid.appendChild(card(store, agent, said.get(agent.id) ?? '', state.selectedAgentId === agent.id));
  });
}

function card(store: Store, agent: Agent, said: string, selected: boolean): HTMLElement {
  const status = STATUS_LABELS[agent.status];
  const b = el(
    'button',
    `wcard st-${agent.status}${selected ? ' sel' : ''}${agent.adopted ? ' adopted' : ''}`,
  );
  b.type = 'button';
  b.style.setProperty('--st', status.color);
  b.dataset.status = agent.status;
  b.addEventListener('click', () => store.selectAgent(agent.id));

  const head = el('div', 'wc-head');
  const url = portrait(agent.look, agent.id);
  if (url) {
    const img = el('img', 'wc-face');
    img.src = url;
    img.alt = '';
    head.appendChild(img);
  }
  const who = el('div', 'wc-who');
  const name = el('b', 'wc-name', agent.name);
  if (agent.personaRepo) {
    const badge = el('span', 'repo-badge', agent.personaRepo);
    badge.title = `An agent from ${agent.personaRepo}`;
    name.appendChild(badge);
  }
  who.appendChild(name);
  who.appendChild(el('span', 'wc-key', displayKey(agent.ticketKey)));
  head.appendChild(who);
  head.appendChild(el('span', 'wc-pill', status.label));
  b.appendChild(head);

  if (agent.ticketSummary) b.appendChild(el('p', 'wc-summary', agent.ticketSummary));

  const text = (agent.status === 'idle' && said) || store.bubbleOf(agent) || '';
  if (text) {
    const line = el('p', 'wc-text');
    setRichText(line, text);
    b.appendChild(line);
  }

  const foot = el('div', 'wc-foot');
  const activity = agent.status === 'working' ? ACTIVITY_LABELS[agent.activity] : null;
  if (activity) foot.appendChild(el('span', 'wc-tag', activity));
  if (agent.model) foot.appendChild(el('span', 'wc-tag', agent.model));
  foot.appendChild(el('span', 'wc-desk', deskLabel(agent)));
  b.appendChild(foot);

  b.setAttribute(
    'aria-label',
    `${agent.name}, ${displayKey(agent.ticketKey)}, ${status.label}${agent.model ? `, ${agent.model}` : ''}${text ? `: ${text}` : ''}`,
  );
  return b;
}
