import { sanitizeTrackingFact, TRACKING_PLATFORMS, } from '../protocol.js';
export const TRACKING_BATCH_LIMIT = 100;
const VERSION = /^[0-9A-Za-z._+-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function whole(value, max) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}
/** The latest progress row, or null when the numbers are missing or nonsense. */
export function sanitizeProgress(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const given = raw;
    const xp = whole(given.xp, 100_000_000);
    const level = whole(given.level, 10_000);
    const streak = whole(given.streak, 100_000);
    const workersHired = whole(given.workersHired, 1_000_000);
    const completedWork = whole(given.completedWork, 1_000_000);
    const completedPrs = whole(given.completedPrs, 1_000_000);
    if (xp === null || level === null || streak === null || workersHired === null || completedWork === null || completedPrs === null) {
        return null;
    }
    if (level < 1)
        return null;
    return { xp, level, streak, workersHired, completedWork, completedPrs };
}
/**
 * Turns one hourly upload into rows the database can store.
 * Invalid events are left out. Two copies of the same id count once.
 * Fields that are not part of the vocabulary, such as a message, are ignored.
 */
export function planBatch(raw) {
    if (!raw || typeof raw !== 'object')
        return { error: 'Send a tracking batch.' };
    const body = raw;
    const installationId = typeof body.installationId === 'string' && UUID.test(body.installationId)
        ? body.installationId.toLowerCase()
        : null;
    const appVersion = typeof body.appVersion === 'string' && VERSION.test(body.appVersion) ? body.appVersion : null;
    const platform = TRACKING_PLATFORMS.find((item) => item === body.platform) ?? null;
    if (!installationId || !appVersion || !platform)
        return { error: 'The tracking batch is missing its install, version, or platform.' };
    if (!Array.isArray(body.events) || body.events.length > TRACKING_BATCH_LIMIT) {
        return { error: `Send at most ${TRACKING_BATCH_LIMIT} events.` };
    }
    const seen = new Set();
    const events = [];
    for (const item of body.events) {
        const fact = sanitizeTrackingFact(item);
        if (!fact || seen.has(fact.id))
            continue;
        seen.add(fact.id);
        events.push(fact);
    }
    return {
        installationId,
        appVersion,
        platform,
        events,
        progress: sanitizeProgress(body.progress),
    };
}
