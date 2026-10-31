import { SHAPING_BRIEF_OPENING, type Idea, type Message, type TicketDraft } from '@shared';

/** A Planner's reply as the card's thread shows it: its words, the answers Tom can tap, and whether it handed in a draft. */
export interface PlannerReply {
  say: string;
  options: string[];
  drafted: boolean;
}

/**
 * Splits a Planner's reply. The draft after TICKET_DRAFT: belongs in the card's
 * draft area, not the thread. A last line like `Options: yes | no` becomes
 * tap-to-reply buttons, at most three and short, and is not shown as text.
 * Works on a reply still streaming in, so a half-written draft never flashes.
 */
export function splitPlannerReply(text: string): PlannerReply {
  const marker = /^[ \t>*-]*TICKET_DRAFT:/im.exec(text);
  const drafted = !!marker;
  let say = (marker ? text.slice(0, marker.index) : text).trim();
  let options: string[] = [];
  const lines = say.split('\n');
  const last = lines.at(-1) ?? '';
  const found = /^[ \t>*_-]*Options?[ \t*_]*:[ \t*_]*(.+)$/i.exec(last);
  if (found) {
    options = (found[1] ?? '')
      .split('|')
      .map((o) => o.replace(/^[\s*_`"]+|[\s*_`".]+$/g, ''))
      .filter((o) => o && o.length <= 60)
      .slice(0, 3);
    if (options.length) say = lines.slice(0, -1).join('\n').trim();
    else options = [];
  }
  if (drafted && !say) say = 'The ticket draft is updated.';
  return { say, options, drafted };
}

/** One line of the thread. */
export interface ThreadLine {
  /** The message's id, or `live` for a reply still arriving. */
  key: string;
  who: 'you' | 'planner';
  text: string;
  /** Names of files sent with a message from Tom. */
  files: string[];
}

/**
 * The thread for one Planner: what Tom and the Planner said, without the
 * brief the Planner was hired with, its tool steps, or its drafts. A reply
 * still streaming in comes last.
 */
export function threadLines(messages: readonly Message[], streaming: string | undefined): { lines: ThreadLine[]; options: string[] } {
  const lines: ThreadLine[] = [];
  let options: string[] = [];
  for (const m of messages) {
    if (m.role === 'you') {
      if (m.text.startsWith(SHAPING_BRIEF_OPENING)) continue;
      lines.push({ key: String(m.id), who: 'you', text: m.text, files: (m.attachments ?? []).map((a) => a.name) });
      options = [];
    } else if (m.role === 'agent') {
      const reply = splitPlannerReply(m.text);
      if (!reply.say) continue;
      lines.push({ key: String(m.id), who: 'planner', text: reply.say, files: [] });
      options = reply.options;
    }
  }
  if (streaming?.trim()) {
    const reply = splitPlannerReply(streaming);
    if (reply.say) {
      lines.push({ key: 'live', who: 'planner', text: reply.say, files: [] });
      options = [];
    }
  }
  return { lines, options };
}

/**
 * What a draft still lacks before it is a good ticket, in a few words each,
 * for the card's "Missing" line. Plain checks of the draft's own text, so it
 * costs the Planner nothing.
 */
export function draftGaps(draft: TicketDraft, idea: Pick<Idea, 'repos'>): string[] {
  const body = draft.description;
  const gaps: string[] = [];
  if (!body.trim()) return ['a description'];
  if (!/acceptance criteria/i.test(body)) gaps.push('acceptance criteria');
  if (!/^#+\s*scope|\*\*scope/im.test(body)) gaps.push('a scope');
  if (/\n\s*[*-]\s*A statement someone can test\./.test(body) || /<Part>/.test(body)) gaps.push('the template filled in');
  if (!idea.repos.length) gaps.push('a repo for the worker');
  return gaps;
}
