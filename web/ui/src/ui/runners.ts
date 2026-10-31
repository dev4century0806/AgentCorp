import { RUNNER_CHOICES, SIGN_IN, hireableRunners, runnerLabel, type Agent, type Health, type RunnerChoice, type RunnerHealth, type RunnerMode } from '@shared';
import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { clear, el } from './dom.js';
import { settingCard, subSetting } from './setting-card.js';
import { showToast } from './toasts.js';

/** What the hire panel shows for the agent a new hire goes to. */
export type HireRunnerView =
  | { kind: 'pick'; runners: RunnerChoice[]; value: RunnerChoice }
  /** Nothing is ready yet, but an agent that is on has not answered: wait before saying none is. */
  | { kind: 'checking' }
  | { kind: 'none' };

export function hireRunnerView(enabled: readonly RunnerChoice[], runners: Health['runners'], current: RunnerChoice): HireRunnerView {
  const ready = hireableRunners(enabled, runners);
  if (ready.length) return { kind: 'pick', runners: ready, value: ready.includes(current) ? current : ready[0]! };
  return enabled.some((id) => runners[id]?.status === 'checking') ? { kind: 'checking' } : { kind: 'none' };
}

/** The agent the hire panel shows, for the hire request; none when it shows none. */
export function hireRunnerChoice(view: HireRunnerView): { runner?: RunnerChoice } {
  return view.kind === 'pick' ? { runner: view.value } : {};
}

/**
 * The agents a worker can be switched to: the ones a new hire could go to,
 * and always the one it is on, so the dropdown can show it.
 */
export function switchableRunners(enabled: readonly RunnerChoice[], runners: Health['runners'], current: string): string[] {
  const ready: string[] = hireableRunners(enabled, runners);
  return RUNNER_CHOICES.filter((id) => id === current || ready.includes(id));
}

/**
 * What to ask before switching a worker's agent, since the new agent starts a
 * fresh chat that sees only the work order, the worktree and a handoff from
 * the old agent; none when the worker has no chat yet, so there is nothing to lose.
 */
export function switchRunnerWarning(agent: Pick<Agent, 'name' | 'chatId' | 'runnerMode'>, to: RunnerMode): string | null {
  if (!agent.chatId) return null;
  const engine = runnerLabel(to);
  const old = runnerLabel(agent.runnerMode);
  return `Switch ${agent.name} to ${engine}? ${old} writes ${engine} a handoff first, or the office sends a recap of this chat if ${old} cannot answer. ${engine} then starts a new chat with the work order, the current worktree and that handoff. The old chat stays in the history to read.`;
}

/**
 * Whether a worker's agent can be switched now: not the assistant, and not mid-turn,
 * since the switch starts a new chat.
 */
export function canSwitchRunner(agent: Pick<Agent, 'builtInPam' | 'status'>): boolean {
  return !agent.builtInPam && (agent.status === 'idle' || agent.status === 'error' || agent.status === 'review');
}

const RUNNER_OPTIONS: Array<{ value: RunnerMode; label: string; hint: string }> = [
  { value: 'claude', label: 'Claude Code', hint: "Anthropic's Claude Code CLI" },
  { value: 'acp', label: 'Cursor', hint: "Cursor's built-in agent" },
  { value: 'copilot', label: 'Copilot', hint: 'GitHub Copilot CLI' },
  { value: 'codex', label: 'Codex', hint: 'OpenAI Codex CLI' },
  { value: 'ollama', label: 'Local AI (Ollama)', hint: 'Local models on Ollama (Qwen, DeepSeek)' },
];

/**
 * A dropdown to switch a worker's agent, to the agents that are on and ready,
 * and the one it is on. Shown in the Workers list and the chat's setup
 * controls, only when `canSwitchRunner`.
 */
export function runnerControl(agent: Agent, store: Store): HTMLElement {
  const wrap = el('div', 'setup');
  const field = el('label', 'setup-field');
  field.appendChild(el('span', 'setup-label', 'Engine'));

  const select = el('select', 'dropdown');
  const offered = switchableRunners(store.state.enabledRunners, store.state.health.runners, agent.runnerMode);
  for (const o of RUNNER_OPTIONS.filter((r) => offered.includes(r.value))) {
    const opt = el('option', null, o.label);
    opt.value = o.value;
    opt.title = o.hint;
    select.appendChild(opt);
  }
  select.value = agent.runnerMode;

  const doSwitch = async (newRunner: RunnerMode): Promise<void> => {
    select.value = newRunner;
    select.disabled = true;
    try {
      await api.switchRunner(agent.id, newRunner);
    } catch (err) {
      select.value = agent.runnerMode;
      store.patch({ lastError: (err as Error).message });
    } finally {
      select.disabled = false;
    }
  };

  select.addEventListener('change', () => {
    const newRunner = select.value as RunnerMode;
    if (newRunner === agent.runnerMode) return;
    const warning = switchRunnerWarning(agent, newRunner);
    if (!warning) {
      void doSwitch(newRunner);
      return;
    }
    // Ask in a banner: the dropdown stays on the current agent until its button is clicked.
    select.value = agent.runnerMode;
    showToast(warning, 'info', { label: `Switch to ${runnerLabel(newRunner)}`, run: () => void doSwitch(newRunner) });
  });

  // Stop click from selecting the agent
  field.addEventListener('click', (e) => e.stopPropagation());
  field.appendChild(select);
  wrap.appendChild(field);
  return wrap;
}

/** One agent's status in a few words. */
export function runnerStatus(health: RunnerHealth | undefined): { text: string; ok: boolean } {
  if (!health || health.status === 'checking') return { text: 'Checking…', ok: false };
  if (health.status === 'ok') return { text: health.version ? `Ready · ${health.version}` : 'Ready', ok: true };
  // It answered --version, so it is there but signed out.
  return { text: health.version ? 'Not signed in' : 'Not installed', ok: false };
}

/** Opens Settings on the Coding agents card. */
export function openRunnerSettings(): void {
  window.dispatchEvent(new CustomEvent('open-runner-settings'));
}

/** A command to copy into a terminal, with a Copy button. */
export function commandLine(text: string): HTMLElement {
  const code = el('div', 'guide-command');
  code.appendChild(el('code', null, text));
  const copy = el('button', 'btn small', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    const shown = (label: string): void => {
      copy.textContent = label;
      window.setTimeout(() => (copy.textContent = 'Copy'), 2500);
    };
    Promise.resolve(navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('No clipboard')))
      .then(() => shown('Copied'))
      .catch(() => {
        // The clipboard refused: select the command so ⌘C copies it.
        const range = document.createRange();
        range.selectNodeContents(code.firstChild!);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        shown('Press ⌘C');
      });
  });
  code.appendChild(copy);
  return code;
}

/**
 * Settings → Coding agents: each agent's status, whether it is on, which one
 * new hires go to, and how to sign it in. It redraws itself as checks come
 * back; call `redraw` on every store change.
 */
export function runnersCard(store: Store): { node: HTMLElement; redraw: () => void } {
  const card = settingCard(
    'Coding agents',
    'The agents your workers can run on. New hires only go to agents that are on and ready.',
  );
  card.id = 'runnersCard';
  const rows = el('div', 'runner-rows');
  card.appendChild(rows);
  const fail = (err: unknown): void => store.patch({ lastError: (err as Error).message });
  let drawn = '';

  const row = (id: RunnerChoice): HTMLElement => {
    const { runner, enabledRunners, health } = store.state;
    const h = health.runners[id];
    const status = runnerStatus(h);
    const on = enabledRunners.includes(id);
    const isDefault = runner === id;

    const about: Node[] = [el('span', `runner-status ${status.ok ? 'ok' : h?.status === 'checking' ? 'checking' : 'bad'}`, status.text)];
    if (h?.status === 'error') {
      if (h.error) about.push(el('span', 'guide-hint', h.error));
      about.push(commandLine(SIGN_IN[id]));
    }

    const actions: Node[] = [];
    if (h?.status !== 'checking') {
      if (id !== 'ollama' && h?.status === 'error') {
        const connectBtn = el('button', 'btn small primary', 'Connect');
        connectBtn.type = 'button';
        connectBtn.title = `Sign in to ${runnerLabel(id)} via browser`;
        connectBtn.addEventListener('click', async () => {
          connectBtn.disabled = true;
          try {
            const res = (await fetch(`/api/agent-cli/sign-in/${id}`, { method: 'POST' }).then((r) => r.json())) as { url?: string; error?: string };
            if (res.url) {
              window.open(res.url, '_blank', 'noopener');
              showToast(`Opened ${runnerLabel(id)} sign-in page. Complete verification in the tab that opened.`, 'info');
            } else if (res.error) {
              showToast(res.error, 'error');
            } else {
              showToast(`Sign-in initiated for ${runnerLabel(id)}.`, 'info');
            }
          } catch (err) {
            fail(err);
          } finally {
            connectBtn.disabled = false;
          }
        });
        actions.push(connectBtn);
      }
      const again = el('button', 'btn small', 'Check again');
      again.type = 'button';
      again.addEventListener('click', () => {
        again.disabled = true;
        api.checkRunner(id).catch((err) => {
          again.disabled = false;
          fail(err);
        });
      });
      actions.push(again);
    }
    if (isDefault && on) {
      actions.push(el('span', 'pill pill-ok', 'Default for new hires'));
    } else {
      const pick = el('button', 'btn small', 'Make default');
      pick.type = 'button';
      pick.disabled = !on || h?.status !== 'ok';
      pick.title = pick.disabled ? 'Turn it on and sign it in first.' : 'New hires go to this agent.';
      pick.addEventListener('click', () => {
        pick.disabled = true;
        api.saveRunner(id).then((saved) => store.patch({ runner: saved.mode, enabledRunners: saved.enabledRunners })).catch((err) => {
          pick.disabled = false;
          fail(err);
        });
      });
      actions.push(pick);
    }
    actions.push(enableTabs(id, on, (next) =>
      api.setRunnerEnabled(id, next).then((saved) => store.patch(saved)).catch(fail),
    ));

    const line = subSetting(runnerLabel(id), about, actions);
    line.dataset.runner = id;
    return line;
  };

  const redraw = (): void => {
    const { runner, enabledRunners, health } = store.state;
    const key = JSON.stringify([runner, enabledRunners, health.runners]);
    if (key === drawn) return;
    drawn = key;
    clear(rows);
    for (const id of RUNNER_CHOICES) rows.appendChild(row(id));
  };
  redraw();
  return { node: card, redraw };
}

/** An On/Off pair for one agent. */
function enableTabs(id: RunnerChoice, current: boolean, save: (on: boolean) => Promise<void>): HTMLElement {
  const tabs = el('div', 'tabs source-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', `${runnerLabel(id)} on or off`);
  for (const on of [true, false]) {
    const btn = el('button', 'tab', on ? 'On' : 'Off');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(current === on));
    btn.addEventListener('click', () => {
      if (on === current) return;
      const buttons = [...tabs.querySelectorAll('button')];
      for (const tab of buttons) tab.disabled = true;
      // On success the card redraws; on failure it stays as it was, so it has to be usable again.
      void save(on).finally(() => {
        for (const tab of buttons) tab.disabled = false;
      });
    });
    tabs.appendChild(btn);
  }
  return tabs;
}
