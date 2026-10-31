import { basename } from 'node:path';
import { displayKey, pathKey } from '../protocol.js';
import { resolveRepo } from '../config.js';
import { listWorktrees, realPath } from '../git/worktree.js';
/**
 * Matches a ticket key against a branch or directory name.
 *
 * Bounded on both sides so WO-162 cannot match WO-1622, and tolerant of the
 * two conventions in use here: `impl-WO-1584` as a directory and
 * `feat/WO-1622-table-column-lock-visibility` as a branch.
 */
function mentionsKey(text, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^0-9A-Za-z])${escaped}(?![0-9A-Za-z])`, 'i').test(text);
}
/**
 * Finds work already underway: a ticket on the board that has a worktree
 * sitting on disk but no worker in the office.
 *
 * Operator often starts a ticket himself before thinking to hire anyone, so an
 * empty office next to two live worktrees is just wrong. Seating these keeps
 * the office honest about what is actually in flight.
 *
 * Never matches the repo's primary checkout, even when it is on a ticket
 * branch: that is Operator's own workspace and an agent must not be pointed at it.
 * Nor a worktree in `occupied`, the real paths other workers are already in:
 * an Ask carrying on in RPT-8259's worktree has the ticket's tree, not its key.
 */
export async function findAdoptableWorktrees(cfg, tickets, alreadySeated, occupied = new Set()) {
    if (!cfg.agents.adoptExistingWorktrees)
        return [];
    const wanted = new Set(cfg.agents.adoptStatuses.map((s) => s.toLowerCase()));
    const eligible = tickets.filter((t) => !alreadySeated.has(t.key) && t.status && wanted.has(t.status.toLowerCase()));
    if (!eligible.length)
        return [];
    // One `git worktree list` per repo, not per ticket.
    const byRepo = new Map();
    for (const ticket of eligible) {
        const repo = ticket.repo ?? (ticket.source === '8090' ? resolveRepo(cfg, cfg.factory.filter.project)?.path : undefined);
        if (!repo)
            continue;
        const list = byRepo.get(repo);
        if (list)
            list.push(ticket);
        else
            byRepo.set(repo, [ticket]);
    }
    const candidates = [];
    const baseBranch = resolveRepo(cfg, cfg.factory.filter.project)?.baseBranch ?? 'main';
    for (const [repoPath, repoTickets] of byRepo) {
        let worktrees;
        try {
            worktrees = await listWorktrees(repoPath);
        }
        catch {
            // A repo that has moved or is mid-rebase should not stop the poll.
            continue;
        }
        const usable = worktrees.filter((w) => !w.isMain && !w.locked && !occupied.has(realPath(w.path)));
        const claimed = new Set();
        for (const ticket of repoTickets) {
            const key = pathKey(displayKey(ticket.key));
            const match = usable.find((w) => !claimed.has(w.path) && (mentionsKey(basename(w.path), key) || (w.branch ? mentionsKey(w.branch, key) : false)));
            if (!match)
                continue;
            claimed.add(match.path);
            candidates.push({ ticket, worktree: match, repoPath, baseBranch });
        }
    }
    return candidates;
}
