import { expandPath } from '../../config.js';
import { listRepos } from '../../git/repos.js';
import { run } from '../../util.js';
import { NeedsLoginError } from '../mcp-client.js';
import { hostOf } from '../fetch-error.js';
import { buildGitHubBrief } from './brief.js';
import { githubRepoOf, isRepoName, parseIssueKey } from './keys.js';
import { GitHubWorkerTools } from './worker-tools.js';
import { GITHUB_LOGIN_HINT } from './oauth.js';
/** GitHub has no issue types, so every new ticket is one kind. */
const ISSUE = { id: 'issue', name: 'Issue' };
/** Checkouts are found by reading every repo's remote, so the answer is held a while. */
const CHECKOUTS_TTL_MS = 5 * 60_000;
/**
 * GitHub Issues, over the REST API with the token from the office's own
 * GitHub OAuth app (see oauth.ts).
 *
 * Issue keys are owner/repo#12. Issues are only open or closed, so hire and
 * Mark done set labels, and the PR's `Fixes owner/repo#12` closes the issue.
 */
export class GitHubSource {
    cfg;
    auth;
    id = 'github';
    name = 'GitHub Issues';
    fetchFn;
    findCheckouts;
    token = null;
    me = null;
    /** The repos the last unscoped board read found issues in: where search looks when none are chosen. */
    boardRepos = new Set();
    checkoutCache = null;
    constructor(cfg, auth, deps = {}) {
        this.cfg = cfg;
        this.auth = auth;
        this.fetchFn = deps.fetch ?? fetch;
        this.findCheckouts = deps.checkouts ?? (() => findCheckouts(cfg));
    }
    host() {
        return hostOf(this.cfg.github.apiUrl);
    }
    async healthCheck() {
        await this.login();
    }
    /**
     * Open issues, newest first. Chosen repos are read with the Search API so
     * pull requests never come back. With none chosen, the account's own issue
     * list is paged and pull requests are skipped.
     */
    async list() {
        const chosen = this.cfg.github.repos.map((r) => r.key.trim()).filter(Boolean);
        return chosen.length ? this.listChosen(chosen) : this.listVisible();
    }
    async listChosen(repos) {
        const limit = Math.min(Math.max(this.cfg.github.limit, 1), 500);
        const me = await this.login();
        const open = [];
        const seen = new Set();
        for (const q of githubIssueQueries(repos)) {
            for (let page = 1; open.length < limit && page <= 10; page++) {
                const result = await this.api(`/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=100&page=${page}`);
                const items = result.items ?? [];
                for (const issue of items) {
                    if (issue.pull_request)
                        continue;
                    const key = `${repoOf(issue).toLowerCase()}#${issue.number}`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    open.push(issue);
                    if (open.length >= limit)
                        break;
                }
                if (items.length < 100)
                    break;
            }
        }
        const checkouts = await this.checkouts();
        const fetchedAt = new Date().toISOString();
        return open.map((i) => this.toTicket(i, fetchedAt, checkouts, me));
    }
    /**
     * Open issues matching a key or words, whoever has them, in the repos the
     * board reads: the chosen ones, or the ones its issues came from. The board
     * holds only the newest few hundred, so older ones are found here.
     */
    async searchTickets(search) {
        const text = search.trim().replace(/^#(?=\d+$)/, '');
        if (!text)
            return [];
        const chosen = this.cfg.github.repos.map((r) => r.key.trim()).filter(Boolean);
        const repos = chosen.length ? chosen : [...this.boardRepos];
        if (!repos.length)
            return [];
        const me = await this.login();
        const found = [];
        for (const q of githubIssueQueries(repos)) {
            const result = await this.api(`/search/issues?q=${encodeURIComponent(`${q} ${text}`)}&sort=updated&order=desc&per_page=25`);
            found.push(...(result.items ?? []).filter((issue) => !issue.pull_request));
        }
        const checkouts = await this.checkouts();
        const fetchedAt = new Date().toISOString();
        return found.slice(0, 25).map((i) => this.toTicket(i, fetchedAt, checkouts, me));
    }
    async listVisible() {
        const limit = Math.min(Math.max(this.cfg.github.limit, 1), 500);
        const me = await this.login();
        const open = [];
        for (let page = 1; page <= 30 && open.length < limit; page++) {
            const batch = await this.api(`/issues?filter=all&state=open&sort=updated&direction=desc&per_page=100&page=${page}`);
            for (const issue of batch) {
                if (issue.pull_request)
                    continue;
                open.push(issue);
                if (open.length >= limit)
                    break;
            }
            if (batch.length < 100)
                break;
        }
        this.boardRepos = new Set(open.map(repoOf).filter(Boolean));
        const checkouts = await this.checkouts();
        const fetchedAt = new Date().toISOString();
        return open.map((i) => this.toTicket(i, fetchedAt, checkouts, me));
    }
    async get(key) {
        const base = this.issuePath(key);
        const [issue, comments, timeline] = await Promise.all([
            this.api(base),
            this.api(`${base}/comments?per_page=50`).catch(() => []),
            this.api(`${base}/timeline?per_page=100`).catch(() => []),
        ]);
        const ticket = this.toTicket(issue, new Date().toISOString(), await this.checkouts(), await this.login());
        const said = comments.flatMap((c) => {
            const body = c.body?.trim();
            return body ? [`**${c.user?.login ?? 'someone'}:** ${body}`] : [];
        });
        const body = [
            ticket.description ? `### Description\n\n${ticket.description}` : '',
            said.length ? `### Comments\n\n${said.join('\n\n')}` : '',
        ]
            .filter(Boolean)
            .join('\n\n');
        const pullRequestUrls = [
            ...new Set(timeline
                .filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request && e.source.issue.html_url)
                .map((e) => e.source.issue.html_url)),
        ];
        return { ticket, body, pullRequestUrls };
    }
    async isFinished(key) {
        return (await this.api(this.issuePath(key))).state === 'closed';
    }
    brief(detail, ctx) {
        return buildGitHubBrief(this.cfg, { detail, ...ctx });
    }
    /** Assigns Operator and adds the in-progress label, which GitHub makes if the repo does not have it yet. */
    async markInProgress(key) {
        const base = this.issuePath(key);
        await this.api(`${base}/assignees`, { method: 'POST', body: { assignees: [await this.login()] } });
        const label = this.cfg.github.inProgressStatuses[0];
        if (label)
            await this.api(`${base}/labels`, { method: 'POST', body: { labels: [label] } });
    }
    /** Comments the PR and summary and swaps the in-progress label for the review one. The issue stays open for the PR to close. */
    async markDone(key, opts) {
        const base = this.issuePath(key);
        const lines = [opts.prUrl ? `Pull request: ${opts.prUrl}` : '', opts.summary ?? ''].filter(Boolean);
        if (lines.length)
            await this.api(`${base}/comments`, { method: 'POST', body: { body: lines.join('\n\n') } });
        const issue = await this.api(base);
        const working = labelNames(issue).filter((l) => this.cfg.github.inProgressStatuses.some((s) => same(s, l)));
        for (const label of working)
            await this.api(`${base}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
        const review = this.cfg.github.reviewStatuses[0];
        if (review)
            await this.api(`${base}/labels`, { method: 'POST', body: { labels: [review] } });
    }
    /** GitHub tools for workers to create and read issues without needing `gh` CLI. */
    workerTools() {
        if (!this.cfg.github.enabled || this.cfg.tracker !== 'github')
            return null;
        if (!this.auth.token())
            return null;
        return new GitHubWorkerTools(this);
    }
    /** Repos this account can reach, most recently pushed first. An exact owner/repo is looked up even when it is not among them. */
    async searchProjects(search) {
        const q = search.trim().toLowerCase();
        const repos = [];
        for (let page = 1; page <= 10; page++) {
            const batch = await this.api(`/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`);
            repos.push(...batch);
            if (batch.length < 100)
                break;
        }
        let found = repos.filter((r) => !q || r.full_name.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
        if (isRepoName(q) && !found.some((r) => same(r.full_name, q))) {
            const exact = await this.api(`/repos/${q}`).catch(() => null);
            if (exact)
                found = [exact, ...found];
        }
        return found.map((r) => ({ key: r.full_name, name: r.name }));
    }
    async issueTypes(_repo) {
        return [ISSUE];
    }
    /**
     * Creates an issue in the repo, assigned to Operator. Draft labels the repo does
     * not have are left off rather than made, and GitHub has no priority.
     */
    async createIssue(input) {
        if (!isRepoName(input.project))
            throw new Error(`"${input.project}" is not a repo. Pick one as owner/repo.`);
        const labels = input.labels.length ? await this.knownLabels(input.project, input.labels) : [];
        const made = await this.api(`/repos/${input.project}/issues`, {
            method: 'POST',
            body: {
                title: input.summary,
                body: input.description,
                assignees: [await this.login()],
                ...(labels.length ? { labels } : {}),
            },
        });
        return { key: `${repoOf(made) || input.project}#${made.number}`, url: made.html_url ?? '' };
    }
    /** Who the office is signed in to GitHub as. */
    async login() {
        if (this.me)
            return this.me;
        const user = await this.api('/user');
        this.me = user.login;
        return this.me;
    }
    async reset() {
        this.token = null;
        this.me = null;
        this.checkoutCache = null;
        this.boardRepos = new Set();
    }
    async close() { }
    /**
     * Public API access for the PR watcher. Returns null if not authenticated
     * or the resource is not found.
     */
    async fetchApi(path) {
        try {
            return await this.api(path);
        }
        catch {
            return null;
        }
    }
    /** Patches a GitHub API path for the PR watcher. Unlike `fetchApi`, it throws, so the caller can say why. */
    async patchApi(path, body) {
        return this.api(path, { method: 'PATCH', body });
    }
    issuePath(key) {
        const issue = parseIssueKey(key);
        if (!issue)
            throw new Error(`${key} is not a GitHub issue. Issues look like owner/repo#12.`);
        return `/repos/${issue.repo}/issues/${issue.number}`;
    }
    async knownLabels(repo, wanted) {
        try {
            const labels = await this.api(`/repos/${repo}/labels?per_page=100`);
            const names = new Map(labels.map((l) => [l.name.toLowerCase(), l.name]));
            return wanted.map((w) => names.get(w.toLowerCase())).filter((n) => !!n);
        }
        catch {
            return [];
        }
    }
    isStatusLabel(label) {
        return [...this.cfg.github.inProgressStatuses, ...this.cfg.github.reviewStatuses].some((s) => same(s, label));
    }
    toTicket(issue, fetchedAt, checkouts, me) {
        const repo = repoOf(issue);
        const labels = labelNames(issue);
        const rule = this.cfg.github.repos.find((r) => same(r.key, repo))?.repo ?? null;
        const description = issue.body?.trim() ?? '';
        return {
            key: `${repo}#${issue.number}`,
            source: 'github',
            summary: issue.title || `${repo}#${issue.number}`,
            description: description || null,
            type: labels.find((l) => !this.isStatusLabel(l)) ?? null,
            status: issue.state === 'closed' ? 'Closed' : (labels.find((l) => this.isStatusLabel(l)) ?? 'Open'),
            phase: null,
            points: null,
            url: issue.html_url ?? null,
            assignees: (issue.assignees ?? []).map((a) => a.login),
            assignedToMe: (issue.assignees ?? []).some((a) => same(a.login, me)),
            repo: rule ? expandPath(rule.path) : (checkouts.get(repo.toLowerCase()) ?? null),
            fetchedAt,
        };
    }
    async checkouts() {
        if (this.checkoutCache && Date.now() - this.checkoutCache.at < CHECKOUTS_TTL_MS)
            return this.checkoutCache.map;
        const map = await this.findCheckouts().catch(() => new Map());
        this.checkoutCache = { at: Date.now(), map };
        return map;
    }
    /** One REST call. A token GitHub refuses is read again once, in case Operator connected again since. */
    async api(path, init = {}) {
        const method = init.method ?? 'GET';
        const url = `${this.cfg.github.apiUrl.replace(/\/+$/, '')}${path}`;
        for (const retry of [false, true]) {
            this.token ??= this.auth.token();
            if (!this.token)
                throw new NeedsLoginError(null, GITHUB_LOGIN_HINT);
            const res = await this.fetchFn(url, {
                method,
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${this.token}`,
                    'x-github-api-version': '2022-11-28',
                    ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
                },
                ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
            });
            if (res.status === 401) {
                this.token = null;
                if (!retry)
                    continue;
                throw new NeedsLoginError(null, GITHUB_LOGIN_HINT);
            }
            if (!res.ok)
                throw new Error(await refusal(res, method, path));
            if (res.status === 204)
                return undefined;
            return (await res.json());
        }
        throw new NeedsLoginError(null, GITHUB_LOGIN_HINT);
    }
}
/** Local checkouts of GitHub repos, by lowercased owner/repo, read from each repo's origin remote. */
export async function findCheckouts(cfg) {
    const repos = await listRepos(cfg);
    const found = await Promise.all(repos.map(async (r) => {
        try {
            const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: r.path, timeoutMs: 5_000 });
            const name = githubRepoOf(stdout, cfg.github.host);
            return name ? [name.toLowerCase(), r.path] : null;
        }
        catch {
            return null;
        }
    }));
    const map = new Map();
    for (const pair of found)
        if (pair && !map.has(pair[0]))
            map.set(pair[0], pair[1]);
    return map;
}
function repoOf(issue) {
    return issue.repository?.full_name ?? /\/repos\/([^/]+\/[^/]+)$/.exec(issue.repository_url ?? '')?.[1] ?? '';
}
/** Search queries for open issues in these repos, short enough for GitHub's query limit. */
export function githubIssueQueries(repos) {
    const queries = [];
    let batch = [];
    let length = 'is:issue is:open'.length;
    for (const repo of repos) {
        const piece = ` repo:${repo}`;
        if (batch.length && length + piece.length > 220) {
            queries.push(`is:issue is:open${batch.join('')}`);
            batch = [];
            length = 'is:issue is:open'.length;
        }
        batch.push(piece);
        length += piece.length;
    }
    if (batch.length)
        queries.push(`is:issue is:open${batch.join('')}`);
    return queries;
}
function labelNames(issue) {
    return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);
}
function same(a, b) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}
async function refusal(res, method, path) {
    let message = '';
    try {
        message = (await res.json()).message ?? '';
    }
    catch {
        // No JSON body.
    }
    const what = `${method} ${path.split('?')[0]}`;
    if (res.status === 404)
        return `GitHub could not find ${what}, or this account cannot see it.`;
    if (res.status === 403 && /rate limit/i.test(message))
        return `GitHub's rate limit is used up. It resets within the hour. (${what})`;
    return `GitHub refused ${what} (${res.status})${message ? `: ${message}` : ''}.`;
}
