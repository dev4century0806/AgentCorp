/**
 * Memory briefing: builds the "Lessons from this repo" section for a worker's starting prompt.
 *
 * At hire time, the office searches for relevant memories and formats them as a short
 * briefing injected before the ticket. Workers also call `recall` mid-ticket for ad-hoc lookups.
 */
/** Max memories to include in a briefing. */
const BRIEFING_LIMIT = 12;
/** Max memories to return from a recall query. */
const RECALL_LIMIT = 8;
/**
 * How close in meaning (cosine similarity) a lesson must be to the ticket to
 * go in its briefing, unless it's tagged with a file the ticket names. A
 * shared keyword isn't enough here: the worker didn't ask, and with a few
 * dozen lessons nearly every ticket shares a word like "worker" with most of
 * them. `recall` keeps the looser match, since there the worker is asking.
 */
export const BRIEFING_MIN_SIMILARITY = 0.45;
/**
 * Build a briefing for a newly hired worker.
 *
 * Keeps the memories close in meaning to the ticket title and description, and
 * those tagged with files the ticket likely touches.
 *
 * @param store The memory store
 * @param repo The repo path
 * @param ticketSummary The ticket title/summary
 * @param ticketDescription Optional ticket description for better matching
 * @param likelyFiles Files the ticket probably touches (from paths in the description)
 * @returns The briefing section, or empty string if no relevant memories
 */
export async function memoryBriefFor(store, repo, ticketSummary, ticketDescription, likelyFiles = []) {
    const query = ticketDescription
        ? `${ticketSummary}\n${ticketDescription}`
        : ticketSummary;
    const matches = await store.search(repo, query, BRIEFING_LIMIT, likelyFiles, BRIEFING_MIN_SIMILARITY);
    if (matches.length === 0) {
        return { brief: '', memoryIds: [] };
    }
    const lines = formatBriefing(matches);
    return {
        brief: lines,
        memoryIds: matches.map((m) => m.memory.id),
    };
}
/**
 * Search memories for a recall query mid-ticket.
 *
 * Workers call this when they hit unfamiliar code or an error.
 */
export async function recallMemories(store, repo, query, contextFiles = []) {
    const matches = await store.search(repo, query, RECALL_LIMIT, contextFiles);
    if (matches.length === 0) {
        return { memories: [], formatted: 'No relevant lessons found.' };
    }
    return {
        memories: matches,
        formatted: formatRecall(matches),
    };
}
/**
 * The `[id=N] ` a worker can pass to `remember` as `update_id`. Only lessons
 * workers saved get one: review lessons and Operator's own carry someone else's
 * name, so a worker may not rewrite them.
 */
function editableId(m) {
    return m.memory.source === 'worker' ? `[id=${m.memory.id}] ` : '';
}
/**
 * Format memories for the hire-time briefing.
 */
function formatBriefing(matches) {
    const lines = [
        '## Lessons from this repo',
        '',
        'A lesson with an id was saved by a worker. If one is wrong or out of date, fix it with `remember` and its id as `update_id`.',
        '',
    ];
    // Group by kind for readability
    const conventions = matches.filter((m) => m.memory.kind === 'convention');
    const gotchas = matches.filter((m) => m.memory.kind === 'gotcha');
    const corrections = matches.filter((m) => m.memory.kind === 'correction');
    const reviews = matches.filter((m) => m.memory.kind === 'review');
    const approvals = matches.filter((m) => m.memory.kind === 'approval');
    if (conventions.length > 0) {
        lines.push('**Conventions:**');
        for (const m of conventions) {
            lines.push(`- ${editableId(m)}${m.memory.lesson}`);
        }
        lines.push('');
    }
    if (gotchas.length > 0) {
        lines.push('**Watch out for:**');
        for (const m of gotchas) {
            lines.push(`- ${editableId(m)}${m.memory.lesson}`);
        }
        lines.push('');
    }
    if (corrections.length > 0) {
        lines.push('**Past corrections:**');
        for (const m of corrections) {
            lines.push(`- ${editableId(m)}${m.memory.lesson}`);
        }
        lines.push('');
    }
    if (reviews.length > 0) {
        lines.push('**From reviews:**');
        for (const m of reviews) {
            const attribution = m.memory.reviewer ? ` (${m.memory.reviewer})` : '';
            lines.push(`- ${editableId(m)}${m.memory.lesson}${attribution}`);
        }
        lines.push('');
    }
    if (approvals.length > 0) {
        lines.push('**Avoid:**');
        for (const m of approvals) {
            lines.push(`- ${editableId(m)}${m.memory.lesson}`);
        }
        lines.push('');
    }
    return lines.join('\n').trim();
}
/**
 * Format memories for a mid-ticket recall response.
 */
function formatRecall(matches) {
    if (matches.length === 0)
        return 'No relevant lessons found.';
    const lines = ['Found these relevant lessons. To correct one saved by a worker, call `remember` with its id as `update_id`.', ''];
    for (const m of matches) {
        const source = m.memory.source === 'review' && m.memory.reviewer
            ? ` (from ${m.memory.reviewer}'s review)`
            : m.memory.source === 'worker'
                ? ' (learned by a worker)'
                : '';
        lines.push(`- ${editableId(m)}**${kindLabel(m.memory.kind)}:** ${m.memory.lesson}${source}`);
        if (m.memory.files.length > 0) {
            lines.push(`  Related files: ${m.memory.files.slice(0, 3).join(', ')}`);
        }
    }
    return lines.join('\n');
}
function kindLabel(kind) {
    switch (kind) {
        case 'convention': return 'Convention';
        case 'gotcha': return 'Gotcha';
        case 'correction': return 'Correction';
        case 'review': return 'Review';
        case 'approval': return 'Avoid';
        default: return 'Note';
    }
}
/**
 * Extract likely file paths from a ticket description.
 * Used to boost memories related to those files.
 */
export function extractFilePaths(text) {
    const paths = [];
    // Match common file patterns:
    // - paths with extensions: src/foo/bar.ts, ./components/Button.tsx
    // - paths in backticks: `path/to/file.js`
    const patterns = [
        /`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`/g, // backtick paths
        /(?:^|[\s(])([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?:[\s,):]|$)/gm, // path/file.ext
        /(?:^|[\s(])(\.[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+)(?:[\s,):]|$)/gm, // ./relative/path.ext
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const path = match[1];
            if (path && !paths.includes(path)) {
                paths.push(path);
            }
        }
    }
    return paths;
}
