/**
 * When a chat message was sent, as the divider over it says it: "Today 3:30 PM",
 * "Yesterday 3:45 PM", "10/26 2:45 PM". Not on every message, which would be
 * noise; only where the conversation picks up again after a break, and never
 * between a message and the reply to it. Pure, so it is tested without the
 * page; worker.ts puts the dividers in the chat.
 */

/** A pause this long or longer gets a divider over the message after it. */
export const STAMP_GAP_MS = 30 * 60 * 1000;

const time = (d: Date): string => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** The day said relative to `now`, then the time; the year only once it isn't this one. */
export function chatStamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `Today ${time(d)}`;
  if (days === 1) return `Yesterday ${time(d)}`;
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear() === now.getFullYear() ? date : `${date}/${d.getFullYear()}`} ${time(d)}`;
}

/** Whether `next` gets a divider: always the first message, then after a long enough pause. */
export function needsStamp(prev: string | null, next: string): boolean {
  if (!prev) return true;
  return new Date(next).getTime() - new Date(prev).getTime() >= STAMP_GAP_MS;
}

/**
 * The messages that get a divider over them: the first one shown, then any that
 * comes after a long enough pause, unless it is part of the agent's reply.
 *
 * A turn opens with your message or a brief, and the agent's text is saved once,
 * when the turn ends. Its tool steps, their output and that text belong with the
 * message they answer however long the turn took. A message the agent sends
 * outside a turn, like a note from another worker, still gets one.
 */
export function stamped<M extends { role: string; createdAt: string }>(messages: readonly M[], shown: (m: M) => boolean): Set<M> {
  const out = new Set<M>();
  let last: string | null = null;
  let replying = false;
  for (const m of messages) {
    const opens = m.role === 'you' || m.role === 'brief';
    if (shown(m)) {
      if (last === null || (needsStamp(last, m.createdAt) && (opens || !replying))) out.add(m);
      last = m.createdAt;
    }
    if (opens) replying = true;
    else if (m.role === 'agent') replying = false;
  }
  return out;
}

// Local midnight, so "Yesterday" means the calendar day and not the last 24 hours.
// Rounding the difference absorbs the hour a daylight saving change adds or takes.
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
