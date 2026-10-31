import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authDir } from '../config.js';
import { run as runCommand } from '../util.js';
/** A `gh` token is asked for once in a while, not on every poll; a 401 drops it sooner. */
const GH_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 8_000;
/**
 * The GitHub accounts the PR watcher reads each repo's PRs as. They have
 * nothing to do with GitHub Issues, which is a ticket source: a repo is read
 * as the account it is worked as.
 *
 * For each repo, in order:
 * 1. The account Connect to GitHub was last used with on that repo.
 * 2. A connected account with the workers' login.
 * 3. `gh`'s token for the workers' login, when `gh` is signed in as them.
 * 4. `gh`'s active account.
 *
 * Connected tokens are kept in the user's auth folder, one file per login
 * with 0600 permissions, beside a map of repo to login.
 */
export class RepoGitHub {
    cfg;
    signIn;
    workersLogin;
    fetchFn;
    run;
    fixedDir;
    gh = new Map();
    /** Each repo's workers' login as last found, for when finding it fails, as when GitHub's SSH is down. */
    lastWorkers = new Map();
    /** Bumped on every connect and disconnect, so answers worked out before one are not reused. */
    changes = 0;
    constructor(cfg, signIn, 
    /** The login the workers in a repo push as, or null when there is no checkout of it here. */
    workersLogin, deps = {}) {
        this.cfg = cfg;
        this.signIn = signIn;
        this.workersLogin = workersLogin;
        this.fetchFn = deps.fetch ?? fetch;
        this.run = deps.run ?? runCommand;
        this.fixedDir = deps.dir;
    }
    /** Looked up each time, so a user switch reads the new user's connections. */
    get dir() {
        return this.fixedDir ?? join(authDir(), 'github-repos');
    }
    /** Changes when a connection does or the office user does, for caches of what the watcher can read. */
    version() {
        return `${this.dir}#${this.changes}`;
    }
    /** Forgets the `gh` tokens held in memory, for a user switch. */
    reset() {
        this.gh.clear();
        this.changes++;
    }
    /** GitHub's consent page for connecting a repo, suggesting the account its workers push as. */
    async connect(repo, session, login) {
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
            throw new Error(`"${repo}" is not a GitHub repo. Give it as owner/repo.`);
        return this.signIn.start(session, { repo, ...(login ? { login } : {}) });
    }
    /** Whether a callback from GitHub belongs to a repo connection rather than GitHub Issues. */
    owns(state) {
        return this.signIn.repoOf(state) !== null;
    }
    /** Keeps the token GitHub sent back, as its account's, and reads the repo as that account from now on. */
    async finish(code, state) {
        const { repo, accessToken } = await this.signIn.finishRepo(code, state);
        const user = await this.call(accessToken, '/user');
        const login = user.ok ? user.body?.login : undefined;
        if (!login || !/^[\w-]+$/.test(login))
            throw new Error('GitHub did not say which account signed in. Try Connect to GitHub again.');
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(this.dir, `${login}.json`), JSON.stringify({ login, accessToken }), { encoding: 'utf8', mode: 0o600 });
        this.saveRepos({ ...this.repos(), [repo.toLowerCase()]: login });
        this.changes++;
        return { repo, login };
    }
    /** Forgets a connected account on this Mac, for every repo that used it. The grant stays in GitHub's settings until revoked there. */
    disconnect(login) {
        if (!/^[\w-]+$/.test(login))
            throw new Error(`"${login}" is not a GitHub login.`);
        rmSync(join(this.dir, `${login}.json`), { force: true });
        this.saveRepos(Object.fromEntries(Object.entries(this.repos()).filter(([, l]) => l !== login)));
        this.changes++;
    }
    /** The account the watcher reads a repo as, and whether it can: false when GitHub says no, null when it gave no answer. */
    async check(repo, workersLogin) {
        for (const retry of [false, true]) {
            const token = await this.tokenFor(repo, workersLogin);
            if (!token)
                return null;
            const res = await this.call(token.token, `/repos/${repo}`);
            if (res.status === 401 && !retry) {
                this.dropGh(token);
                continue;
            }
            const access = res.ok ? true : res.status === 401 || res.status === 404 || (res.status === 403 && !res.rateLimited) ? false : null;
            return { login: token.login, via: token.via, access };
        }
        return null;
    }
    /**
     * The PR watcher's GitHub: each request goes out as the account its repo
     * is read as. The watcher stops watching a PR its fetch gets null for, so
     * null is kept for GitHub saying no to the repo's own account. Anything
     * less certain throws, which skips one poll: no answer (offline, 5xx, a
     * used-up rate limit), no account on hand, or a no to a stand-in account
     * because the workers' own could not be found.
     */
    api() {
        const send = async (path, init) => {
            const repo = /^\/repos\/([^/]+\/[^/?]+)/.exec(path)?.[1];
            if (!repo)
                return { ok: false, body: null, refused: true, message: `${path} is not a repo's API path.` };
            const key = repo.toLowerCase();
            const found = await this.workersLogin(repo).catch(() => null);
            if (found)
                this.lastWorkers.set(key, found);
            const workers = found ?? this.lastWorkers.get(key) ?? null;
            for (const retry of [false, true]) {
                const token = await this.tokenFor(repo, workers);
                if (!token)
                    return { ok: false, body: null, refused: false, message: `No GitHub account here can read ${repo}. Connect it in Settings → Repos.` };
                const res = await this.call(token.token, path, init);
                if (res.status === 401 && !retry) {
                    this.dropGh(token);
                    continue;
                }
                const no = res.status === 401 || res.status === 404 || (res.status === 403 && !res.rateLimited);
                const what = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
                return {
                    ok: res.ok,
                    body: res.body,
                    refused: no && token.sure,
                    message: res.ok ? '' : res.status ? `GitHub refused ${what} (${res.status}) as ${token.login ?? 'gh'}.` : `GitHub did not answer ${what}.`,
                };
            }
            return { ok: false, body: null, refused: false, message: `GitHub would not take the token for ${repo}.` };
        };
        return {
            fetch: async (path) => {
                const res = await send(path);
                if (res.ok)
                    return res.body;
                if (res.refused)
                    return null;
                throw new Error(res.message);
            },
            patch: async (path, body) => {
                const res = await send(path, { method: 'PATCH', body });
                if (!res.ok)
                    throw new Error(res.message);
                return res.body;
            },
        };
    }
    async tokenFor(repo, workersLogin) {
        const assigned = this.repos()[repo.toLowerCase()];
        for (const login of [assigned, workersLogin]) {
            const token = login ? this.connected(login) : null;
            if (token)
                return { token, login: login, via: 'connected', sure: true };
        }
        if (workersLogin) {
            const theirs = await this.ghToken(workersLogin);
            if (theirs)
                return { ...theirs, sure: true };
        }
        const active = await this.ghToken(null);
        return active && { ...active, sure: !!workersLogin && active.login === workersLogin };
    }
    connected(login) {
        try {
            const saved = JSON.parse(readFileSync(join(this.dir, `${login}.json`), 'utf8'));
            return typeof saved.accessToken === 'string' && saved.accessToken ? saved.accessToken : null;
        }
        catch {
            return null;
        }
    }
    /** `gh`'s token for a login it is signed in as, or for its active account when `login` is null. */
    async ghToken(login) {
        const key = login ?? '';
        const held = this.gh.get(key);
        if (held && Date.now() - held.at < GH_TTL_MS)
            return held.token;
        const host = this.cfg.github.host;
        let token = null;
        try {
            const { stdout } = await this.run('gh', ['auth', 'token', '--hostname', host, ...(login ? ['--user', login] : [])], { timeoutMs: TIMEOUT_MS });
            const value = stdout.trim();
            if (value) {
                let who = login;
                if (!who) {
                    const user = await this.call(value, '/user');
                    who = user.body?.login ?? null;
                }
                token = { token: value, login: who, via: 'gh' };
            }
        }
        catch {
            // gh is missing, or not signed in as that login.
        }
        this.gh.set(key, { at: Date.now(), token });
        return token;
    }
    dropGh(token) {
        if (token.via !== 'gh')
            return;
        for (const [key, held] of this.gh)
            if (held.token?.token === token.token)
                this.gh.delete(key);
    }
    repos() {
        const path = join(this.dir, 'repos.json');
        if (!existsSync(path))
            return {};
        try {
            const saved = JSON.parse(readFileSync(path, 'utf8'));
            return saved && typeof saved === 'object' ? saved : {};
        }
        catch {
            return {};
        }
    }
    saveRepos(map) {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(this.dir, 'repos.json'), JSON.stringify(map, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
    async call(token, path, init) {
        try {
            const res = await this.fetchFn(`${this.cfg.github.apiUrl.replace(/\/+$/, '')}${path}`, {
                method: init?.method ?? 'GET',
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${token}`,
                    'x-github-api-version': '2022-11-28',
                    ...(init ? { 'content-type': 'application/json' } : {}),
                },
                ...(init ? { body: JSON.stringify(init.body) } : {}),
            });
            const body = res.status === 204 ? null : (await res.json().catch(() => null));
            const rateLimited = res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(body?.message ?? '');
            return { ok: res.ok, status: res.status, rateLimited, body };
        }
        catch {
            // Offline, or GitHub is down: no answer, which is not a no.
            return { ok: false, status: 0, rateLimited: false, body: null };
        }
    }
}
