import { randomUUID } from 'node:crypto';
import { sanitizeTrackingFact, splitTicketId, } from '../protocol.js';
/** Columns copied off a worker. The ticket title and paths are not among them. */
export function factFromAgent(agent) {
    const ticket = splitTicketId(agent.ticketKey);
    return {
        name: 'worker_hired',
        workerId: agent.id,
        runner: agent.runnerMode,
        workerKind: agent.kind,
        source: agent.kind === 'ticket' && ticket ? ticket.source : 'none',
        permission: agent.permission,
        model: agent.chosenModel,
        effort: agent.effort,
        persona: agent.persona,
        hasPr: Boolean(agent.prUrl),
    };
}
/** Publishes one content-free event. A fact that fails the vocabulary is dropped. */
export function emitTracking(bus, repos, input) {
    const fact = sanitizeTrackingFact({
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        workerId: null,
        runner: null,
        workerKind: null,
        source: null,
        permission: null,
        model: null,
        effort: null,
        persona: null,
        result: null,
        choice: null,
        count: 1,
        hasPr: null,
        ...input,
    });
    if (!fact)
        return;
    const moment = MOMENTS[fact.name];
    if (moment)
        recordMoment(repos, moment, fact.workerId);
    bus.emit({ type: 'tracking', fact });
}
/** The tracked events that are moments of the office's day, for its timelapse. */
const MOMENTS = {
    worker_hired: 'hire',
    rehire: 'hire',
    plan_approved: 'approval',
    permission_answered: 'approval',
    pr_opened: 'pr',
    work_completed: 'done',
};
/**
 * Keeps a moment in the office's day record: the kind, the worker and the
 * time, nothing more. the assistant's own moments stay out; she is at reception all
 * day. Never throws: the day record must not get in the way of the work.
 */
export function recordMoment(repos, kind, workerId) {
    try {
        const agent = workerId ? repos.getAgent(workerId) : null;
        if (agent?.builtInPam)
            return;
        repos.addOfficeEvent(kind, workerId, agent?.name ?? '');
    }
    catch (err) {
        console.warn('[day] could not record a moment:', err.message);
    }
}
