/**
 * Watches worker PRs for failures, conflicts, and review comments.
 * Polls GitHub REST API and emits events when intervention is needed.
 */
import { PR_FOOTER } from '../config.js';
export const DEFAULT_PR_WATCH_CONFIG = {
    enabled: true,
    pollSeconds: 60,
    maxFixAttempts: 3,
    triggers: {
        failedChecks: true,
        conflicts: true,
        reviewComments: true,
    },
};
/**
 * Watches PRs opened by workers and detects problems that need attention.
 * Designed to be polled by the AgentManager.
 *
 * A worker's PR URL can come from its ticket's linked PRs or any link in its
 * reply, so it may be someone else's PR. Only a PR whose head branch is the
 * worker's branch is followed; any other is dropped on its first poll.
 */
export class PrWatcher {
    config;
    api;
    watching = new Map();
    timer = null;
    listeners = [];
    running = false;
    constructor(config, api) {
        this.config = config;
        this.api = api;
    }
    /** Adds a listener for PR events. */
    onEvent(listener) {
        this.listeners.push(listener);
    }
    /** Starts watching a PR for a worker. The first poll drops it unless it is on the worker's branch. */
    watch(agentId, agentName, prUrl, branch) {
        if (this.watching.has(prUrl))
            return;
        const parsed = parsePrUrl(prUrl);
        if (!parsed)
            return;
        this.watching.set(prUrl, {
            agentId,
            agentName,
            prUrl,
            repo: parsed.repo,
            number: parsed.number,
            branch,
            seenCheckRunIds: new Set(),
            seenCommentIds: new Set(),
            seenReviewIds: new Set(),
            reportedConflict: false,
            fixAttempts: 0,
            lastPoll: 0,
        });
    }
    /** Stops watching a PR. With an agent, only while it is that agent's, so another worker's watch of the same URL stays. */
    unwatch(prUrl, agentId) {
        if (agentId && this.watching.get(prUrl)?.agentId !== agentId)
            return;
        this.watching.delete(prUrl);
    }
    /** Returns the current fix attempt count for a PR. */
    getAttempts(prUrl) {
        return this.watching.get(prUrl)?.fixAttempts ?? 0;
    }
    /** Increments the fix attempt count. Called after rehiring/messaging. */
    incrementAttempts(prUrl) {
        const state = this.watching.get(prUrl);
        if (state)
            state.fixAttempts += 1;
    }
    /** Resets conflict-reported state so next conflict triggers again. */
    resetConflictState(prUrl) {
        const state = this.watching.get(prUrl);
        if (state)
            state.reportedConflict = false;
    }
    /**
     * Ends the PR description with PR_FOOTER, unless it already says so. The
     * brief asks the worker for it; this catches the ones who forget.
     *
     * Only the worker's own PR is edited: the URL comes from the worker's reply,
     * which may link someone else's PR, so the PR's head branch has to be the
     * worker's branch. A worker without a branch has no PR of its own.
     *
     * An edit made between the read and the PATCH, such as a `gh pr edit` right
     * after the link was posted, is lost. The window is a few hundred
     * milliseconds, and GitHub offers no conditional PATCH to close it.
     */
    async ensurePrFooter(prUrl, branch) {
        const parsed = parsePrUrl(prUrl);
        if (!parsed || !branch)
            return 'unknown';
        const path = `/repos/${parsed.repo}/pulls/${parsed.number}`;
        const pr = await this.api.fetch(path);
        if (!pr || pr.head?.ref !== branch)
            return 'unknown';
        const body = pr.body ?? '';
        if (hasPrFooter(body))
            return 'present';
        await this.api.patch(path, { body: body.trim() ? `${body.trimEnd()}\n\n${PR_FOOTER}\n` : `${PR_FOOTER}\n` });
        return 'added';
    }
    /** Starts the polling loop. */
    start() {
        if (!this.config.enabled || this.running)
            return;
        this.running = true;
        this.scheduleNext();
    }
    /** Stops the polling loop. */
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    /** The PRs currently being watched. */
    get watchedPrs() {
        return [...this.watching.keys()];
    }
    scheduleNext() {
        if (!this.running)
            return;
        this.timer = setTimeout(() => void this.pollAll(), this.config.pollSeconds * 1000);
        // A background poll should never keep the process alive on its own.
        this.timer.unref();
    }
    async pollAll() {
        if (!this.running)
            return;
        const now = Date.now();
        for (const [prUrl, state] of this.watching) {
            // Stagger polls to avoid rate limits
            if (now - state.lastPoll < this.config.pollSeconds * 1000 * 0.9)
                continue;
            state.lastPoll = now;
            try {
                await this.pollOne(state);
            }
            catch (err) {
                // Log but continue with other PRs
                console.warn(`PR watcher: error polling ${prUrl}:`, err.message);
            }
        }
        this.scheduleNext();
    }
    /**
     * Polls a single PR for problems. Exported for testing.
     *
     * A PR that isn't the worker's own, by the same rule as `ensurePrFooter`, is
     * unwatched without a word: it was only linked from the ticket or the reply.
     */
    async pollOne(state) {
        // 1. Check if PR is still open
        const pr = await this.api.fetch(`/repos/${state.repo}/pulls/${state.number}`);
        if (!pr) {
            // PR not found or no access—stop watching
            this.watching.delete(state.prUrl);
            return;
        }
        if (!state.branch || pr.head?.ref !== state.branch) {
            this.watching.delete(state.prUrl);
            return;
        }
        if (pr.state === 'closed') {
            this.emit({ agentId: state.agentId, prUrl: state.prUrl, merged: pr.merged });
            this.watching.delete(state.prUrl);
            return;
        }
        // Everything new on the PR goes in one event, so one poll costs one fix attempt.
        const problems = [];
        // 2. Check for merge conflicts
        if (this.config.triggers.conflicts && pr.mergeable === false && !state.reportedConflict) {
            state.reportedConflict = true;
            problems.push({ kind: 'conflict', conflictingFiles: [] });
        }
        // 3. Check for failed checks
        if (this.config.triggers.failedChecks) {
            const checks = await this.api.fetch(`/repos/${state.repo}/commits/${pr.head.sha}/check-runs?per_page=100`);
            if (checks) {
                for (const run of checks.check_runs) {
                    if (state.seenCheckRunIds.has(run.id))
                        continue;
                    // Only report completed failures
                    if (run.status !== 'completed')
                        continue;
                    if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'cancelled') {
                        state.seenCheckRunIds.add(run.id);
                        problems.push({
                            kind: 'failed_check',
                            checkName: run.name,
                            checkUrl: run.html_url,
                            conclusion: run.conclusion,
                        });
                    }
                }
            }
        }
        // 4. Check for new review comments (PR review comments, not issue comments)
        // and "changes requested" reviews, reported together as one problem.
        // Anyone's comment counts, the PR author's and the connected login's included.
        if (this.config.triggers.reviewComments) {
            const authors = new Set();
            let commentCount = 0;
            let changesRequested = false;
            // PR review comments (inline on code)
            const comments = await this.api.fetch(`/repos/${state.repo}/pulls/${state.number}/comments?per_page=100&sort=created&direction=desc`);
            for (const comment of comments ?? []) {
                if (state.seenCommentIds.has(comment.id))
                    continue;
                state.seenCommentIds.add(comment.id);
                authors.add(comment.user?.login ?? 'someone');
                commentCount += 1;
            }
            // PR reviews: only "changes requested" ones are reported
            const reviews = await this.api.fetch(`/repos/${state.repo}/pulls/${state.number}/reviews?per_page=100`);
            for (const review of reviews ?? []) {
                if (state.seenReviewIds.has(review.id) || review.state !== 'CHANGES_REQUESTED')
                    continue;
                state.seenReviewIds.add(review.id);
                authors.add(review.user?.login ?? 'someone');
                changesRequested = true;
            }
            if (commentCount || changesRequested) {
                problems.push({
                    kind: 'review',
                    authors: [...authors],
                    comments: commentCount,
                    changesRequested,
                    // The PR's own host, so a GitHub Enterprise PR links to itself.
                    url: `${/^.*?\/pull\/\d+/.exec(state.prUrl)?.[0] ?? state.prUrl}/files`,
                });
            }
        }
        if (!problems.length)
            return;
        // Past the attempt cap the event is still sent, with an attempt number over
        // the cap, so the manager can say a person is needed instead of going quiet.
        this.emit({
            agentId: state.agentId,
            agentName: state.agentName,
            prUrl: state.prUrl,
            repo: state.repo,
            number: state.number,
            branch: state.branch,
            problems,
            attemptNumber: state.fixAttempts + 1,
        });
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (err) {
                console.warn('PR watcher: listener error:', err.message);
            }
        }
    }
}
/** Whether a PR body already carries the footer, linked or not, in any case. */
export function hasPrFooter(body) {
    return /created by \[?agentcorp\b/i.test(body);
}
/** Parses a GitHub PR URL into repo and number. */
export function parsePrUrl(url) {
    // https://github.com/owner/repo/pull/123
    const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
    if (!match)
        return null;
    return { repo: match[1], number: parseInt(match[2], 10) };
}
/** Formats a problem for display to a worker. */
export function describeProblem(problem) {
    switch (problem.kind) {
        case 'failed_check':
            return `CI check "${problem.checkName}" failed (${problem.conclusion})${problem.checkUrl ? `. See: ${problem.checkUrl}` : ''}`;
        case 'conflict':
            return problem.conflictingFiles.length
                ? `The PR has merge conflicts in: ${problem.conflictingFiles.join(', ')}`
                : 'The PR has merge conflicts with the base branch.';
        case 'review':
            return `${reviewSummary(problem)}. Please review ${problem.comments + Number(problem.changesRequested) > 1 ? 'them' : 'it'}: ${problem.url}`;
    }
}
/** "example-user left 3 review comments and requested changes", without the bodies: the worker reads them on GitHub. */
export function reviewSummary(problem) {
    const who = listNames(problem.authors);
    const left = problem.comments
        ? `left ${problem.comments === 1 ? 'a review comment' : `${problem.comments} review comments`}`
        : '';
    const requested = problem.changesRequested ? 'requested changes' : '';
    return `${who} ${[left, requested].filter(Boolean).join(' and ')}`;
}
function listNames(names) {
    if (names.length <= 1)
        return names[0] ?? 'someone';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
