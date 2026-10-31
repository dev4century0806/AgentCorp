import { RunError, run as runCommand } from '../util.js';
/** Each check is a round trip to GitHub, so the answer is held for a few minutes; Check again skips it. */
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;
/** Reads an origin URL: https://host/owner/repo, ssh://user@host/owner/repo, or user@host:owner/repo. */
export function parseRemote(url) {
    const text = url.trim();
    const path = '([\\w.-]+)/([\\w.-]+?)(?:\\.git)?/?$';
    const https = new RegExp(`^https?://(?:[^@/]+@)?([^/:]+)(?::\\d+)?/${path}`, 'i').exec(text);
    if (https)
        return { kind: 'https', host: https[1].toLowerCase(), user: null, repo: `${https[2]}/${https[3]}` };
    const ssh = new RegExp(`^ssh://(?:([^@/]+)@)?([^/:]+)(?::\\d+)?/${path}`, 'i').exec(text);
    if (ssh)
        return { kind: 'ssh', host: ssh[2], user: ssh[1] ?? null, repo: `${ssh[3]}/${ssh[4]}` };
    const scp = new RegExp(`^(?:([^@/:]+)@)?([^/:]+):${path}`).exec(text);
    if (scp)
        return { kind: 'ssh', host: scp[2], user: scp[1] ?? null, repo: `${scp[3]}/${scp[4]}` };
    return null;
}
/** The login in GitHub's SSH greeting, "Hi example-user! You've successfully authenticated…". */
export function sshGreetingLogin(output) {
    return /\bHi ([\w-]+)!/.exec(output)?.[1] ?? null;
}
/**
 * Which GitHub account each repo is worked as, and which one the PR watcher
 * reads its PRs as. Workers push with whatever git on this Mac uses (the gh
 * login, or an SSH key picked by host alias). The watcher reads with the
 * account connected for the repo, or the one gh is signed in as. When it has
 * none that can see a repo, review comments, failing checks and conflicts
 * never reach the worker, and nothing else says so.
 */
export class GitHubAccounts {
    cfg;
    watcher;
    cache = null;
    /** The workers' side alone, which the PR watcher asks for on every poll: held as a promise so polls at once share one look. */
    worked = null;
    run;
    constructor(cfg, watcher, deps = {}) {
        this.cfg = cfg;
        this.watcher = watcher;
        this.run = deps.run ?? runCommand;
    }
    async check(repos, opts = {}) {
        const version = this.watcher.version();
        const c = this.cache;
        if (!opts.refresh && c && Date.now() - c.at < TTL_MS && c.version === version && sameRepos(c.repos, repos))
            return c.repos;
        const worked = await this.workers(repos, opts);
        const checked = await Promise.all(worked.map(async (r) => (r.github ? { ...r, watcher: await this.watcher.check(r.github, r.workers?.login ?? null) } : r)));
        this.cache = { at: Date.now(), version, repos: checked };
        return checked;
    }
    /** The login a repo's workers push as, from its checkout on this Mac; null when there is none. */
    async workersLogin(repo, repos) {
        const worked = await this.workers(repos);
        return worked.find((r) => r.github?.toLowerCase() === repo.toLowerCase())?.workers?.login ?? null;
    }
    workers(repos, opts = {}) {
        const paths = repos.map((r) => r.path).join('\n');
        const w = this.worked;
        if (!opts.refresh && w && Date.now() - w.at < TTL_MS && w.paths === paths)
            return w.repos;
        // One SSH greeting per alias and key, and one gh login per host, however many repos share them.
        const once = new Map();
        const memo = (key, fn) => {
            if (!once.has(key))
                once.set(key, fn());
            return once.get(key);
        };
        const found = Promise.all(repos.map((r) => this.checkRepo(r, memo)));
        this.worked = { at: Date.now(), paths, repos: found };
        return found;
    }
    async checkRepo(r, memo) {
        const none = { name: r.name, path: r.path, github: null, workers: null, watcher: null };
        const url = await this.output('git', ['remote', 'get-url', 'origin'], { cwd: r.path });
        const remote = url ? parseRemote(url) : null;
        if (!remote || !(await this.onGitHub(remote, memo)))
            return none;
        const github = this.cfg.github.host;
        // A repo's own core.sshCommand picks its key, so repos on one alias can still be different accounts.
        const sshCommand = remote.kind === 'ssh' ? await this.output('git', ['config', 'core.sshCommand'], { cwd: r.path }) : null;
        const workers = remote.kind === 'ssh'
            ? await Promise.all([
                memo(`ssh:${sshCommand ?? ''}:${remote.user ?? ''}@${remote.host}`, () => this.sshLogin(remote, sshCommand)),
                this.ok('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], { cwd: r.path, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }),
            ]).then(([login, access]) => ({ login, access, via: 'ssh', alias: remote.host === github ? null : remote.host }))
            : await Promise.all([
                memo(`gh:${remote.host}`, () => this.output('gh', ['api', 'user', '--hostname', remote.host, '--jq', '.login'])),
                this.ok('gh', ['api', `repos/${remote.repo}`, '--hostname', remote.host, '--jq', '.full_name']),
            ]).then(([login, access]) => ({ login, access, via: 'gh', alias: null }));
        return { ...none, github: remote.repo, workers };
    }
    /** An SSH alias counts when ~/.ssh/config points it at the GitHub host; `ssh -G` reads that without connecting. */
    async onGitHub(remote, memo) {
        const github = this.cfg.github.host.toLowerCase();
        if (remote.host.toLowerCase() === github)
            return true;
        if (remote.kind === 'https')
            return false;
        const config = await memo(`ssh-G:${remote.host}`, () => this.output('ssh', ['-G', remote.host]));
        return /^hostname (.+)$/im.exec(config ?? '')?.[1]?.trim().toLowerCase() === github;
    }
    /**
     * GitHub answers `ssh -T` with the key's login and exit code 1, so the
     * greeting is read whether or not the command "failed". A repo's own
     * core.sshCommand is run through sh, as git runs it, so quoted paths in it
     * still work; our arguments follow it as "$@" and are never parsed by sh.
     */
    async sshLogin(remote, sshCommand) {
        const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${remote.user ?? 'git'}@${remote.host}`];
        try {
            const { stdout, stderr } = sshCommand
                ? await this.run('sh', ['-c', `${sshCommand} "$@"`, 'sh', ...args], { timeoutMs: TIMEOUT_MS })
                : await this.run('ssh', args, { timeoutMs: TIMEOUT_MS });
            return sshGreetingLogin(`${stdout}\n${stderr}`);
        }
        catch (err) {
            return err instanceof RunError ? sshGreetingLogin(`${err.result.stdout}\n${err.result.stderr}`) : null;
        }
    }
    async output(cmd, args, opts = {}) {
        try {
            return (await this.run(cmd, args, { ...opts, timeoutMs: TIMEOUT_MS })).stdout.trim() || null;
        }
        catch {
            return null;
        }
    }
    async ok(cmd, args, opts = {}) {
        try {
            await this.run(cmd, args, { ...opts, timeoutMs: TIMEOUT_MS });
            return true;
        }
        catch {
            return false;
        }
    }
}
function sameRepos(cached, repos) {
    return cached.length === repos.length && cached.every((c, i) => c.path === repos[i].path);
}
