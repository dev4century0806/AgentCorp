import { runnerLabel, type Agent } from '@shared';

/** How long a thinking worker may say nothing before the panel mentions it. */
export const QUIET_AFTER_MS = 90_000;

export interface LiveClock {
  /** What the clock counts from. */
  since: number;
  /** Whether the panel should say out loud that nothing is happening. */
  stalled: boolean;
}

/**
 * What the clock on a working worker counts, and whether to raise the alarm.
 *
 * Nothing comes back from the CLI while a command runs, and nothing comes back
 * while the model thinks either, so a moving counter is the only evidence a
 * worker is alive. Which moment it counts from depends on which question is
 * the live one:
 *
 * - A tool is running: how long has this been going. Timed from its start, and
 *   never called stalled however long it takes, because silence there is
 *   expected — a pre-commit hook on a large repo can run for ten minutes.
 * - No tool is running: is this still happening. Timed from when anything was
 *   last heard, and called stalled once that passes ninety seconds. That can
 *   still be healthy: a command the CLI sent to the background reports as
 *   finished, and the wait on it sends nothing, so this only ever informs.
 * - Agents it started are running: how long has it been waiting on them.
 *   Timed from the first to start, and never stalled, since the CLI says
 *   nothing until the last one finishes. Ahead of a running tool, because
 *   their own steps start and stop that one.
 * - The office found commands running behind the silence: how long has it
 *   been waiting on them. Timed from the first to start, and never stalled.
 *
 * A worker that is thinking is heard from about once a second, so it is not
 * called stalled while the thinking goes on. The last thought stays on screen
 * after that, and does not count: a stream that hangs after a thought is the
 * very silence this is looking for.
 */
export function liveClock(agent: Agent, heardAt: number | undefined, now: number): LiveClock {
  const helpers = agent.backgroundAgents ?? [];
  if (helpers.length) {
    return { since: Math.min(...helpers.map((h) => new Date(h.since).getTime())), stalled: false };
  }
  if (agent.runningSince) {
    return { since: new Date(agent.runningSince).getTime(), stalled: false };
  }
  const commands = agent.backgroundCommands ?? [];
  if (commands.length) {
    return { since: Math.min(...commands.map((c) => new Date(c.since).getTime())), stalled: false };
  }
  const since = heardAt ?? now;
  return { since, stalled: now - since >= QUIET_AFTER_MS };
}

/**
 * Whether the panel offers a Nudge yet. Only once the clock has gone a while,
 * whatever the worker is waiting on: before that its answer just repeats the
 * panel, and after it a CLI that died mid-wait looks exactly like a long one.
 */
export function offerNudge(since: number, now: number): boolean {
  return now - since >= QUIET_AFTER_MS;
}

/** A duration a person can read at a glance. */
export function elapsed(since: number, now: number): string {
  const total = Math.max(0, Math.round((now - since) / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/** What the panel says under a worker that has gone quiet, naming its own CLI. */
export function quietNote(agent: Agent, since: number, now: number): string {
  return `Nothing from ${agent.name} for ${elapsed(since, now)}. ${runnerLabel(agent.runnerMode)} says nothing while a worker waits on a command running in the background, so this is often fine. Nudge checks on it, and tells ${agent.name} to carry on if nothing is running; Stop ends the turn and that command.`;
}

/** When a Nudge answer was given, so pressing it again visibly does something. */
export function checkedAgo(at: number, now: number): string {
  return now - at < 5_000 ? 'Checked just now.' : `Checked ${elapsed(at, now)} ago.`;
}

/** What the panel says under a worker waiting on commands running behind its silence. */
export function commandNote(agent: Agent): string {
  return `${runnerLabel(agent.runnerMode)} says nothing while it waits on a command running in the background. Stop ends the turn and that command.`;
}

/** The heading of a worker waiting on commands running behind its silence. */
export function waitingOnCommands(count: number): string {
  return count === 1 ? 'Waiting on a command' : `Waiting on ${count} commands`;
}

/** What the panel says under a worker waiting on agents it started. */
export function helperNote(agent: Agent): string {
  return `${runnerLabel(agent.runnerMode)} says nothing until they all finish. Stop ends them too.`;
}
