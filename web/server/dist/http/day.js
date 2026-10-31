/** The longest stretch GET /api/day answers for: a week, with a day to spare for time zones. */
const MOST = 8 * 24 * 60 * 60 * 1000;
/**
 * GET /api/day?from&to[&titles=1]: the office's moments between two times,
 * for the timelapse. Ticket titles come only when `titles=1` asks for them.
 */
export function officeDay(repos, query) {
    const q = (query ?? {});
    const from = isoTime(q.from);
    const to = isoTime(q.to);
    if (!from || !to || to <= from)
        return { error: 'Give the day as from and to times, from first.' };
    if (Date.parse(to) - Date.parse(from) > MOST)
        return { error: 'A day can cover a week at most.' };
    return { day: repos.getOfficeDay(from, to, q.titles === '1') };
}
/** A time as the database keeps them (UTC, toISOString), or null for anything that isn't one. */
function isoTime(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v))
        return null;
    const at = Date.parse(v);
    return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
