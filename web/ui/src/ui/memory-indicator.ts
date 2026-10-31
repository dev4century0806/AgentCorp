/**
 * The brain beside a worker's name in the chat panel: grey while the worker
 * leaves Office Memory alone, amber while it reads (its hire briefing or a
 * `recall`), green while it saves (a `remember`). It took the place of the
 * "learned" toast.
 */

import type { MemoryActivity } from '@shared';
import type { Store } from '../state/store.js';
import { $ } from './dom.js';

/**
 * How long a state stays up at the least. A recall over a handful of lessons
 * comes back in a few milliseconds, which would otherwise be an unseen flash.
 */
export const MIN_ACTIVE_MS = 1200;

export const MEMORY_LABEL: Record<MemoryActivity, string> = {
  idle: 'Memory idle',
  reading: 'Reading memory',
  saving: 'Saving memory',
};

/** The clock, injectable so the tests can run it by hand. */
export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * What one worker's brain shows. An active state is shown at once and held
 * for at least MIN_ACTIVE_MS before idle can replace it; one active state
 * replaces another straight away, without passing through grey.
 */
export class MemoryIndicator {
  private shown: MemoryActivity = 'idle';
  private since = 0;
  private settle: unknown = null;

  constructor(
    private readonly onChange: (state: MemoryActivity) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  get state(): MemoryActivity {
    return this.shown;
  }

  set(next: MemoryActivity): void {
    if (this.settle !== null) {
      this.timers.clearTimeout(this.settle);
      this.settle = null;
    }
    if (next !== 'idle') {
      if (next !== this.shown) {
        this.since = this.timers.now();
        this.show(next);
      }
      return;
    }
    if (this.shown === 'idle') return;
    const left = MIN_ACTIVE_MS - (this.timers.now() - this.since);
    if (left <= 0) {
      this.show('idle');
      return;
    }
    this.settle = this.timers.setTimeout(() => {
      this.settle = null;
      this.show('idle');
    }, left);
  }

  private show(state: MemoryActivity): void {
    this.shown = state;
    this.onChange(state);
  }
}

/** Mounts the brain beside the open worker's name. Clicking it opens that worker's memories. */
export function mountMemoryIndicator(store: Store): void {
  const button = $<HTMLButtonElement>('aBrain');
  const status = $<HTMLElement>('aBrainStatus');
  const workers = new Map<string, MemoryIndicator>();
  let drawn: { agentId: string | null; state: MemoryActivity | null } = { agentId: null, state: null };

  const draw = (): void => {
    const agent = store.selectedAgent();
    const shown = !!agent && !agent.builtInPam;
    button.hidden = !shown;
    if (!shown) {
      drawn = { agentId: null, state: null };
      return;
    }
    const state = workers.get(agent.id)?.state ?? 'idle';
    if (drawn.agentId === agent.id && drawn.state === state) return;
    // Only a change on the same worker is news. Opening a worker is not.
    const announce = drawn.agentId === agent.id;
    drawn = { agentId: agent.id, state };
    const label = MEMORY_LABEL[state];
    button.dataset.memory = state;
    button.setAttribute('aria-label', `${label}. Show ${agent.name}'s memories`);
    button.title = agent.repoPath ? `${label} · show memories for this repo` : label;
    status.textContent = announce ? `${agent.name}: ${label}` : '';
  };

  store.onMemory((agentId, memory) => {
    let indicator = workers.get(agentId);
    if (!indicator) {
      indicator = new MemoryIndicator(() => {
        if (store.state.selectedAgentId === agentId) draw();
      });
      workers.set(agentId, indicator);
    }
    indicator.set(memory);
  });

  store.subscribe((state) => {
    for (const id of workers.keys()) {
      if (!state.agents.some((a) => a.id === id)) workers.delete(id);
    }
    draw();
  });

  button.addEventListener('click', () => {
    const agent = store.selectedAgent();
    if (agent) store.openMemory(agent.repoPath);
  });
}
