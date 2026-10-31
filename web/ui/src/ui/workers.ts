import { agentSetup, displayKey, LOOK_CHOICES, type Agent, type WorkerLook } from '@shared';
import type { Store } from '../state/store.js';
import { api } from '../net/client.js';
import { $, clear, el, setRichText } from './dom.js';
import { lookControls, setupControls, setupSummary, slidersIcon, workerMenu } from './setup.js';
import { STATUS_LABELS } from './worker.js';
import { canSwitchRunner, runnerControl } from './runners.js';

export function mountWorkersPanel(store: Store): void {
  const panel = $<HTMLElement>('workersPanel');
  const list = $<HTMLElement>('workersList');

  $('openWorkers').addEventListener('click', () =>
    store.patch({ workersOpen: !store.state.workersOpen, ticketPanelOpen: false, settingsOpen: false, ideasOpen: false, messagesOpen: false, memoryOpen: false }),
  );
  $('closeWorkers').addEventListener('click', () => store.patch({ workersOpen: false }));

  let drawn = '';
  // The worker whose name is being typed. Bubbles change every few seconds,
  // and a redraw then would throw away the half-typed name.
  let editing: string | null = null;
  // Workers whose setup dropdowns are open, kept open across redraws.
  const tuning = new Set<string>();
  let tab: 'here' | 'previous' = 'here';

  $('workersHere').addEventListener('click', () => {
    tab = 'here';
    editing = null;
    drawn = '';
    draw(store.state);
  });
  $('workersPrevious').addEventListener('click', () => {
    tab = 'previous';
    editing = null;
    drawn = '';
    draw(store.state);
  });

  const rename = (agent: Agent, nameEl: HTMLElement, pencil: HTMLButtonElement): void => {
    editing = agent.id;
    const input = el('input', 'rename');
    input.value = agent.name;
    input.maxLength = 24;
    input.setAttribute('aria-label', `New name for ${agent.name}`);
    nameEl.replaceWith(input);
    pencil.hidden = true;
    input.focus();
    input.select();

    let settled = false;
    const finish = async (save: boolean): Promise<void> => {
      if (settled) return;
      settled = true;
      const name = input.value.trim();
      try {
        if (save && name && name !== agent.name) await api.rename(agent.id, name);
      } catch (err) {
        store.patch({ lastError: (err as Error).message });
      } finally {
        editing = null;
        drawn = '';
        draw(store.state);
      }
    };
    // Kept from the row and the window, so typing never selects the worker
    // and Escape cancels the rename rather than closing the list.
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void finish(true);
      else if (e.key === 'Escape') void finish(false);
    });
    input.addEventListener('blur', () => void finish(true));
  };

  const draw = (state: typeof store.state): void => {
    panel.hidden = !state.workersOpen;
    if (panel.hidden) {
      drawn = '';
      editing = null;
      return;
    }
    $<HTMLButtonElement>('workersHere').setAttribute('aria-selected', String(tab === 'here'));
    const previousTab = $<HTMLButtonElement>('workersPrevious');
    previousTab.setAttribute('aria-selected', String(tab === 'previous'));
    previousTab.textContent = state.previous.length ? `Previous (${state.previous.length})` : 'Previous';
    if (tab === 'previous') {
      drawPrevious(state);
      return;
    }
    if (editing) return;
    // A redraw would close a dropdown Tom has open.
    if (document.activeElement instanceof HTMLSelectElement && list.contains(document.activeElement)) return;
    const agents = store.agentsByDesk();
    const key = JSON.stringify([
      state.selectedAgentId,
      agents.map((a) => [a.id, a.name, a.status, a.bubble, a.ticketKey, a.ticketSummary, a.permission, a.chosenModel, a.effort, a.modelMenu, a.look, a.runnerMode, store.bubbleOf(a)]),
      [...tuning],
      // The runner switch lists the agents that are on and ready.
      state.enabledRunners,
      Object.values(state.health.runners).map((r) => r.status),
    ]);
    if (key === drawn) return;
    drawn = key;

    const needs = agents.filter((a) => a.status === 'needs_you').length;
    $('workersSub').textContent =
      `${agents.length} ${agents.length === 1 ? 'worker' : 'workers'}` + (needs ? `, ${needs} need you` : '');

    clear(list);
    if (!agents.length) {
      list.appendChild(el('div', 'empty', 'Nobody hired yet. Hire someone to see them here.'));
      return;
    }
    for (const agent of agents) {
      const status = STATUS_LABELS[agent.status];
      // A div acting as a button, since a real button cannot hold the
      // rename button inside it.
      const row = el('div', `ticket worker-row${agent.id === state.selectedAgentId ? ' selected' : ''}`);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-current', String(agent.id === state.selectedAgentId));

      const head = el('div', 'row');
      const who = el('span', 'who');
      const name = el('b', null, agent.name);
      const pencil = el('button', 'rename-btn');
      pencil.type = 'button';
      pencil.title = `Rename ${agent.name}`;
      pencil.setAttribute('aria-label', `Rename ${agent.name}`);
      pencil.appendChild(pencilIcon());
      pencil.hidden = agent.builtInPam;
      pencil.addEventListener('click', (e) => {
        e.stopPropagation();
        rename(agent, name, pencil);
      });
      const tune = el('button', 'rename-btn tune-btn');
      tune.type = 'button';
      tune.title = `Setup and look for ${agent.name}`;
      tune.setAttribute('aria-label', tune.title);
      tune.setAttribute('aria-expanded', String(tuning.has(agent.id)));
      tune.appendChild(slidersIcon());
      tune.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tuning.has(agent.id)) tuning.delete(agent.id);
        else tuning.add(agent.id);
        drawn = '';
        draw(store.state);
      });
      who.append(name, pencil, tune);
      head.appendChild(who);
      const pill = el('span', 'pill', status.label);
      pill.style.setProperty('--st', status.color);
      pill.dataset.status = agent.status;
      head.appendChild(pill);
      row.appendChild(head);

      row.appendChild(el('span', 't', agent.builtInPam ? 'Built-in secretary · reception and delegation' : `${displayKey(agent.ticketKey)}: ${agent.ticketSummary}`));
      const menu = workerMenu(state.health.modelMenu, agent.modelMenu);
      row.appendChild(el('span', 'm setup-meta', setupSummary(agentSetup(agent), menu)));
      if (tuning.has(agent.id)) {
        // Saved the moment it changes; the server answers with agent.updated.
        const controls = setupControls(agentSetup(agent), menu, (setup) => {
          api.saveSetup(agent.id, setup).catch((err: Error) => store.patch({ lastError: err.message }));
        });
        row.appendChild(el('span', 'setup-group', 'Setup'));
        row.appendChild(controls.node);

        if (canSwitchRunner(agent)) {
          row.appendChild(el('span', 'setup-group', 'Runner'));
          row.appendChild(runnerControl(agent, store));
        }

        row.appendChild(el('span', 'setup-group', 'Look'));
        row.appendChild(
          lookControls(agent.look, (patch) => {
            api.saveLook(agent.id, patch).catch((err: Error) => store.patch({ lastError: err.message }));
          }),
        );
      }
      if (store.bubbleOf(agent)) {
        const bubble = el('span', 'm');
        setRichText(bubble, store.bubbleOf(agent));
        row.appendChild(bubble);
      }

      row.addEventListener('click', () => store.selectAgent(agent.id));
      row.addEventListener('keydown', (e) => {
        if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          store.selectAgent(agent.id);
        }
      });
      list.appendChild(row);
    }
  };

  const drawPrevious = (state: typeof store.state): void => {
    const agents = state.previous;
    const key = JSON.stringify([
      'previous',
      state.selectedAgentId,
      agents.map((a) => [a.id, a.name, a.status, a.look, a.permission, a.chosenModel, a.effort, a.ticketKey, a.ticketSummary, a.conversationId, a.conversations.map((c) => [c.id, c.messageCount])]),
    ]);
    if (key === drawn) return;
    drawn = key;

    const n = agents.length;
    $('workersSub').textContent = n ? `${n} previous ${n === 1 ? 'worker' : 'workers'}` : 'No previous workers';
    clear(list);
    if (!n) {
      list.appendChild(el('div', 'empty', 'Completed and fired workers will appear here.'));
      return;
    }
    for (const agent of agents) {
      const row = el('div', `ticket worker-row fired${agent.id === state.selectedAgentId ? ' selected' : ''}`);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-current', String(agent.id === state.selectedAgentId));
      const head = el('div', 'row');
      head.appendChild(el('b', null, agent.name));
      const outcomeGroup = el('span', 'previous-outcome');
      const chats = agent.conversations.length;
      outcomeGroup.appendChild(el('span', 'm', chats ? `${chats} chat${chats === 1 ? '' : 's'}` : 'No chats yet'));
      const outcome = agent.status === 'done' ? 'Done' : 'Fired';
      const outcomePill = el('span', 'pill', outcome);
      outcomePill.style.setProperty('--st', agent.status === 'done' ? STATUS_LABELS.done.color : '#c8553d');
      outcomePill.dataset.status = agent.status;
      outcomeGroup.appendChild(outcomePill);
      head.appendChild(outcomeGroup);
      row.appendChild(head);
      row.appendChild(el('span', 't', `${displayKey(agent.ticketKey)}: ${agent.ticketSummary}`));
      row.appendChild(el('span', 'm setup-meta', setupSummary(agentSetup(agent), state.health.modelMenu)));
      row.appendChild(el('span', 'm', lookLine(agent.look)));
      const open = () => {
        store.selectAgent(agent.id);
        void api.conversationMessages(agent.id, agent.conversationId).then(
          ({ messages }) => {
            if (store.state.selectedAgentId === agent.id) store.replaceMessages(agent.id, messages);
          },
          (err: Error) => store.patch({ lastError: err.message }),
        );
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => {
        if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      });
      list.appendChild(row);
    }
  };

  store.subscribe(draw);
  // Catches up on whatever was skipped while a dropdown had focus.
  list.addEventListener('focusout', () => setTimeout(() => draw(store.state)));
}

function lookLine(look: WorkerLook): string {
  const label = <K extends keyof WorkerLook>(key: K): string =>
    LOOK_CHOICES[key].find((c) => c.value === look[key])?.label ?? String(look[key]);
  const parts = [label('hair'), label('outfit')];
  if (look.hat !== 'none') parts.push(label('hat'));
  if (look.face !== 'none') parts.push(label('face'));
  return parts.join(' · ');
}

function pencilIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5 2.5 13.5l1-3.1z M9.8 3.7l2.5 2.5');
  svg.appendChild(path);
  return svg;
}
