/**
 * What a worker's old agent passes on when Operator switches it to another one.
 * The new agent starts a fresh chat, so without this it knows the work order
 * and the worktree but nothing that was said.
 *
 * The old agent is asked to write the handoff itself. When it cannot, being
 * out of credits, signed out or broken, the office falls back to a recap cut
 * from the saved chat, so a switch never waits on the agent it is leaving.
 */
import { HANDOFF_HEADINGS, isHandoffNote, runnerLabel } from '../protocol.js';
/** How long the old agent gets to write it. */
export const HANDOFF_TIMEOUT_MS = 90_000;
/** Errors that mean the old agent cannot answer at all, so it is not asked. */
export const HANDOFF_BLOCKERS = new Set(['quota', 'auth', 'rate_limit', 'overloaded', 'cli_missing']);
/** How much of the chat a recap keeps, newest first. */
const RECAP_BUDGET = 4000;
const RECAP_MESSAGE_MAX = 1500;
const [HANDOFF_HEADING, RECAP_HEADING] = HANDOFF_HEADINGS;
/** What the old agent is asked, on its own chat, before it is shut down. */
export function handoffPrompt(to) {
    const next = runnerLabel(to);
    return [
        `Operator is switching this work to ${next}, another coding agent. It starts a new chat and cannot see this conversation, only the work order and the worktree.`,
        `Write it a handoff: where the work stands, what Operator asked for or agreed with you, what is done, what is left, and any decisions or open questions.`,
        'Do not use any tools or change any files. Reply with the handoff only.',
    ].join('\n\n');
}
/** The note that goes at the top of the new chat: the old agent's own handoff. */
export function handoffNote(from, text) {
    return `${HANDOFF_HEADING}${runnerLabel(from)}:\n\n${text.trim()}`;
}
/**
 * The fallback: Operator's messages and the worker's replies from the old chat,
 * the newest kept when there is too much. Null when nothing was said.
 */
export function recapNote(messages, from, worker, why) {
    const said = messages.filter((m) => (m.role === 'you' || m.role === 'agent') && m.text.trim());
    const lines = [];
    let used = 0;
    for (const m of [...said].reverse()) {
        const text = m.text.trim();
        const cut = text.length > RECAP_MESSAGE_MAX ? `${text.slice(0, RECAP_MESSAGE_MAX)}…` : text;
        const line = `${m.role === 'you' ? 'Operator' : worker}: ${cut}`;
        if (lines.length && used + line.length > RECAP_BUDGET)
            break;
        lines.unshift(line);
        used += line.length;
    }
    if (!lines.length)
        return null;
    const left = said.length > lines.length ? ' Earlier messages are left out.' : '';
    return `${RECAP_HEADING}${runnerLabel(from)}. It could not write a handoff: ${why.replace(/\.$/, '')}.${left}\n\n${lines.join('\n\n')}`;
}
/** The handoff or recap a switch left in a chat, for the new agent's first brief. */
export function findHandoff(messages) {
    return messages.find(isHandoffNote)?.text ?? null;
}
