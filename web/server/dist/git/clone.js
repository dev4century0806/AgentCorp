import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expandPath, rememberRepo } from '../config.js';
import { run } from '../util.js';
import { describeRepo, forgetRepoCache } from './repos.js';
const SEGMENT = /^[A-Za-z0-9._-]+$/;
/**
 * Reads a repo reference out of what was typed into the hire panel, or null
 * when it is not one — a local path, or nothing recognisable. Anything that
 * looks like a path on disk (starting with /, ~ or .) is left to be a path.
 */
export function parseRepoRef(raw) {
    const input = raw.trim();
    if (!input || /^[/~.]/.test(input) || /\s/.test(input))
        return null;
    const named = (owner, repo, url) => {
        const name = repo.replace(/\.git$/, '');
        if (!SEGMENT.test(owner) || !SEGMENT.test(name) || name === '.' || name === '..')
            return null;
        return { url, name, github: `${owner}/${name}` };
    };
    // owner/name
    let m = /^([^/:@]+)\/([^/:@]+)$/.exec(input);
    if (m)
        return named(m[1], m[2], `https://github.com/${m[1]}/${m[2].replace(/\.git$/, '')}.git`);
    // https://github.com/owner/name, with or without .git or a trailing /tree/... path
    m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i.exec(input);
    if (m)
        return named(m[1], m[2], `https://github.com/${m[1]}/${m[2].replace(/\.git$/, '')}.git`);
    // git@github.com:owner/name.git
    m = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(input);
    if (m)
        return named(m[1], m[2], input);
    // Any other git URL: https://host/.../name(.git) or user@host:.../name(.git)
    m = /^(?:https?:\/\/[^/]+\/|[\w.-]+@[\w.-]+:)(?:[^\s]*\/)?([^/\s]+?)(?:\.git)?\/?$/.exec(input);
    if (m && SEGMENT.test(m[1]))
        return { url: input, name: m[1], github: null };
    return null;
}
/**
 * Where new clones go: the folder set in Settings, else the first repo folder
 * that exists, else the folder the repos already in use live in, else the
 * first repo folder listed (created on the first clone).
 */
export function cloneRoot(cfg) {
    if (cfg.repos.cloneInto?.trim())
        return expandPath(cfg.repos.cloneInto);
    const roots = cfg.repos.roots.map(expandPath);
    const existing = roots.find((r) => existsSync(r));
    if (existing)
        return existing;
    const besideKnown = cfg.repos.known.map((r) => dirname(expandPath(r.path))).find((d) => existsSync(d));
    return besideKnown ?? roots[0] ?? expandPath('~/Develop');
}
/** What the hire panel needs to know before it offers to clone. */
export function lookUpRepo(cfg, raw) {
    const ref = parseRepoRef(raw);
    if (!ref)
        return { kind: 'path' };
    const target = join(cloneRoot(cfg), ref.name);
    return {
        kind: 'remote',
        name: ref.github ?? ref.url,
        target,
        alreadyCloned: existsSync(join(target, '.git')),
    };
}
/** Clones already under way, by target folder, so two clicks share one clone. */
const inFlight = new Map();
/**
 * Clones a repo into the clone folder and remembers it, so it stays in the
 * picker. A repo already cloned there is used as it is. Never waits on a
 * password prompt: without access it fails, and says how to get access.
 */
export function cloneRepo(cfg, raw) {
    const ref = parseRepoRef(raw);
    if (!ref)
        throw new Error(`"${raw.trim()}" is not a repo name or link. Use owner/name, a GitHub link, or a folder on this Mac.`);
    const root = cloneRoot(cfg);
    const target = join(root, ref.name);
    const running = inFlight.get(target);
    if (running)
        return running;
    const job = (async () => {
        if (existsSync(target)) {
            if (!existsSync(join(target, '.git'))) {
                throw new Error(`${target} already exists and is not a git repository. Move it, or pick a different clone folder in Settings.`);
            }
        }
        else {
            mkdirSync(root, { recursive: true });
            const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
            const timeoutMs = 15 * 60_000;
            try {
                if (ref.github && (await hasGitHubCli())) {
                    await run('gh', ['repo', 'clone', ref.github, target], { env, timeoutMs });
                }
                else {
                    await run('git', ['clone', ref.url, target], { env, timeoutMs });
                }
            }
            catch (err) {
                throw new Error(explainCloneFailure(ref, err.message));
            }
        }
        const repo = await describeRepo(target);
        rememberRepo({ path: repo.path, baseBranch: repo.baseBranch });
        forgetRepoCache();
        return repo;
    })();
    inFlight.set(target, job);
    void job.finally(() => inFlight.delete(target)).catch(() => undefined);
    return job;
}
async function hasGitHubCli() {
    try {
        await run('gh', ['--version'], { timeoutMs: 5_000 });
        return true;
    }
    catch {
        return false;
    }
}
/** Turns git's and gh's wording into what to do about it. */
export function explainCloneFailure(ref, message) {
    const what = ref.github ?? ref.url;
    if (/not found|could not read username|authentication failed|terminal prompts disabled|permission denied|could not resolve to a repository/i.test(message)) {
        return ref.github
            ? `Could not clone ${what}: GitHub says it does not exist or you do not have access. Check the name, or sign in with \`gh auth login\` in a terminal.`
            : `Could not clone ${what}: the server refused, or the repo does not exist. Check the link and that you can clone it in a terminal.`;
    }
    if (/could not resolve host|network|timed out|unable to access/i.test(message)) {
        return `Could not reach the server to clone ${what}. Check your connection and try again.`;
    }
    return `Could not clone ${what}: ${message.split('\n')[0]}`;
}
