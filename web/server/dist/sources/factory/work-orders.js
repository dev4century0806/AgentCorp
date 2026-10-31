/**
 * Link to a work order in the 8090 web app.
 *
 * The shape is taken from 8090's own client-side URL builder, which scopes
 * every entity under `/project/{projectId}` and addresses work orders by
 * number rather than by their UUID.
 */
export function workOrderUrl(webBaseUrl, projectId, key) {
    if (!webBaseUrl || !projectId)
        return null;
    try {
        return `${webBaseUrl.replace(/\/+$/, '')}/project/${projectId}/work-orders/${ticketNumber(key)}`;
    }
    catch {
        return null;
    }
}
/** `WO-1622` -> 1622. 8090's write tools take the bare number. */
export function ticketNumber(key) {
    const m = /(\d+)\s*$/.exec(key.trim());
    if (!m?.[1])
        throw new Error(`Cannot read a work order number out of "${key}"`);
    return Number(m[1]);
}
const KEY_LINE = /^(WO-\d+):\s*(.*)$/;
const URL_IN_TEXT = /https?:\/\/\S+/g;
/** Title-case status from 8090's display text back to its filter value. */
export function normalizeStatus(display) {
    return display.trim().toLowerCase().replace(/\s+/g, '_');
}
/**
 * Parses `list_items` output for `entity_type: work_order`.
 *
 * The server wraps a JSON page in plain-text framing, e.g.
 *
 *   Entity type: work_order
 *   { "items": [{ "work_order_number": 18, "title": "...", "status": "In Progress", ... }], ... }
 *   More results: repeat with the same filters and page=2.
 */
export function parseWorkOrderList(text, fetchedAt) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start)
        return { tickets: [], total: 0 };
    let page;
    try {
        page = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        throw new Error('8090 returned a work order list this build cannot read.');
    }
    const tickets = [];
    for (const item of page.items ?? []) {
        if (typeof item.work_order_number !== 'number')
            continue;
        const fields = new Map();
        if (item.status)
            fields.set('status', item.status);
        if (item.type)
            fields.set('type', item.type);
        if (item.phase_number != null)
            fields.set('phase', String(item.phase_number));
        if (item.assignee_name)
            fields.set('assignee', item.assignee_name);
        tickets.push(ticketFromFields(`WO-${item.work_order_number}`, item.title ?? '', fields, fetchedAt));
    }
    return { tickets, total: page.total_items ?? tickets.length };
}
function ticketFromFields(key, title, fields, fetchedAt) {
    const assignee = fields.get('assignee');
    const phaseRaw = fields.get('phase');
    return {
        key,
        source: '8090',
        summary: title,
        description: null,
        type: fields.get('type') ?? null,
        status: fields.get('status') ? normalizeStatus(fields.get('status')) : null,
        phase: phaseRaw && phaseRaw.toLowerCase() !== 'none' ? phaseRaw : null,
        points: null, // 8090 tracks priority and type, not story points
        url: null,
        assignees: assignee ? [assignee] : [],
        assignedToMe: null,
        repo: null, // filled in by the repo mapping
        fetchedAt,
    };
}
/** Parses `read_item` work order output into a ticket plus its markdown body. */
export function parseWorkOrderDetail(text, fetchedAt) {
    const lines = text.split('\n');
    const fields = new Map();
    let key = '';
    let title = '';
    const pullRequestUrls = [];
    let descriptionStart = -1;
    let inPullRequests = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!key) {
            const keyMatch = KEY_LINE.exec(line);
            if (keyMatch?.[1]) {
                key = keyMatch[1];
                title = (keyMatch[2] ?? '').trim();
                continue;
            }
        }
        if (/^Description:\s*$/.test(line)) {
            descriptionStart = i + 1;
            break;
        }
        if (/^Pull requests:\s*$/.test(line)) {
            inPullRequests = true;
            continue;
        }
        if (inPullRequests) {
            if (/^\S/.test(line)) {
                inPullRequests = false;
            }
            else {
                pullRequestUrls.push(...(line.match(URL_IN_TEXT) ?? []));
                continue;
            }
        }
        // Detail lines are unindented and can pack two fields on one line,
        // e.g. "Status: In Progress  Priority: no_priority".
        for (const part of line.split(/\s{2,}/)) {
            const m = /^([A-Za-z][A-Za-z /]*?):\s*(.+)$/.exec(part.trim());
            if (m?.[1] && m[2])
                fields.set(m[1].trim().toLowerCase(), m[2].trim());
        }
    }
    const body = descriptionStart >= 0 ? lines.slice(descriptionStart).join('\n').trim() : '';
    const ticket = ticketFromFields(key, title, fields, fetchedAt);
    ticket.description = body || null;
    return { ticket, body, pullRequestUrls };
}
/**
 * Pulls the current user out of `list_users` output, which marks one line:
 *
 *   Alex Dev (alex.dev@example.com) [user id: ...] (current user)
 */
export function parseCurrentUser(text) {
    for (const line of text.split('\n')) {
        if (!line.includes('(current user)'))
            continue;
        const m = /^\s*(.+?)\s*\(([^)]*@[^)]*)\)/.exec(line);
        if (m?.[1])
            return { name: m[1].trim(), email: m[2]?.trim() ?? null };
        const bare = line.replace('(current user)', '').trim();
        if (bare)
            return { name: bare, email: null };
    }
    return null;
}
/** First email in `list_users` output, for resolving a display name to an assignee filter. */
export function parseFirstUserEmail(text) {
    for (const line of text.split('\n')) {
        const m = /\(([^)\s]+@[^)\s]+)\)/.exec(line);
        if (m?.[1])
            return m[1];
    }
    return null;
}
