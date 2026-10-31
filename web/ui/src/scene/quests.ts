import { QUESTS, displayKey, type Onboarding, type QuestId, type Ticket } from '@shared';

/** Where in the room each first-day step shows: the thing it brings to life. */
export const QUEST_SPOTS: Record<QuestId, { x: number; y: number; z: number }> = {
  // The ceiling lamps, which come on once a coding agent is signed in.
  power: { x: -0.2, y: 1.8, z: -7.4 },
  // The shelves, which fill once there is code to work in.
  code: { x: -4.8, y: 2.45, z: -7.7 },
  // The ticket board, where work is picked and handed out.
  hire: { x: 4.9, y: 2.6, z: -7.6 },
};

export function questFinished(o: Onboarding, id: QuestId): boolean {
  return o.done.includes(id) || o.skipped.includes(id);
}

/** The next quest to do, or null once every one is done or skipped. */
export function nextQuest(o: Onboarding): QuestId | null {
  if (o.tourReplay) return o.tourReplay;
  return QUESTS.find((q) => !questFinished(o, q.id))?.id ?? null;
}

/**
 * Whether the first-day card is up: until a first worker is hired, unless it
 * was sent away, and again whenever Settings restarts it.
 */
export function firstDayShown(o: Pick<Onboarding, 'done' | 'tourDismissed' | 'tourReplay'>): boolean {
  if (o.tourDismissed) return false;
  return o.tourReplay !== null || !o.done.includes('hire');
}

export type StepState = 'done' | 'now' | 'later';

/**
 * Each step's state, read from the office as it is now: a step is done when
 * what it sets up is there, and the first one that is not is the one to do.
 */
export function stepStates(ready: { agent: boolean; code: boolean; hired: boolean }): Record<QuestId, StepState> {
  const order: Array<[QuestId, boolean]> = [['power', ready.agent], ['code', ready.code], ['hire', ready.hired]];
  let current = false;
  const states = {} as Record<QuestId, StepState>;
  for (const [id, done] of order) {
    if (done) states[id] = 'done';
    else if (!current) {
      states[id] = 'now';
      current = true;
    } else states[id] = 'later';
  }
  return states;
}

/**
 * Whether a coding agent is signed in, for the first day: the step is
 * recorded, or the agent answers now. The card's first step and the room's
 * lights both read this, so they never disagree.
 */
export function agentReady(o: Pick<Onboarding, 'done'>, cli: 'ok' | 'error' | 'checking'): boolean {
  return o.done.includes('power') || cli === 'ok';
}

/** Whether a ticket matches what was typed: its key or words in its title. */
export function ticketMatches(ticket: Ticket, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return displayKey(ticket.key).toLowerCase().includes(q) || ticket.summary.toLowerCase().includes(q);
}

/**
 * The tickets to pick a first task from. With nothing typed, the ones
 * assigned to you on the board. With a search, matching tickets from the
 * board and from the trackers' own search, whoever has them, each once.
 */
export function ticketsToShow(board: Ticket[], found: Ticket[], search: string): { heading: string; tickets: Ticket[] } {
  if (!search.trim()) {
    const mine = board.filter((t) => t.assignedToMe !== false);
    return { heading: 'Assigned to you', tickets: mine };
  }
  const seen = new Set<string>();
  const tickets = [...board.filter((t) => ticketMatches(t, search)), ...found].filter((t) => {
    if (seen.has(t.key)) return false;
    seen.add(t.key);
    return true;
  });
  return { heading: 'Matching tickets', tickets };
}
