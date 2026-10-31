import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { expandPath } from '../config.js';
import { run } from '../util.js';
/** Discovery shells out to git per repo, so the answer is held briefly. */
const TTL_MS = 60_000;
let cache = null;
/**
 * Every repo Operator could put a worker in: whatever is configured, plus whatever
 * is sitting under the configured roots.
 *
 * Scanning beats maintaining a list by hand. The office should not be able to
 * refuse a repo that is plainly there on disk, and a config file that has to
 * be edited before you can use a checkout you already have is just friction.
 */
export async function listRepos(cfg, opts = {}) {
    if (!opts.refresh && cache && Date.now() - cache.at < TTL_MS)
        return cache.repos;
    const defaultPath = cfg.repos.default ? expandPath(cfg.repos.default.path) : null;
    const configured = new Map();
    const remember = (rule) => configured.set(expandPath(rule.path), rule);
    if (cfg.repos.default)
        remember(cfg.repos.default);
    for (const rule of Object.values(cfg.repos.byProject))
        remember(rule);
    for (const rule of cfg.repos.known)
        remember(rule);
    const paths = new Set(configured.keys());
    for (const root of cfg.repos.roots) {
        const folder = expandPath(root);
        // A folder that is a repo itself counts too: picking the repo is the natural thing to do.
        if (isCheckout(folder))
            paths.add(folder);
        else
            for (const path of findRepos(folder, 1))
                paths.add(path);
    }
    const hidden = new Set(cfg.repos.hidden.map(expandPath));
    const repos = await Promise.all([...paths]
        .filter((path) => !hidden.has(path) && isCheckout(path))
        .map(async (path) => ({
        name: basename(path),
        path,
        // A configured base branch is a deliberate choice and outranks the
        // remote's own default.
        baseBranch: configured.get(path)?.baseBranch ?? (await defaultBranch(path)),
        isDefault: path === defaultPath,
    })));
    // Default first, then alphabetical: the common case stays at the top of the
    // picker without hiding everything else behind a scroll.
    repos.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    cache = { at: Date.now(), repos };
    return repos;
}
/** Folders in the home folder that macOS guards: even looking inside makes it ask permission. */
const GUARDED = new Set(['Desktop', 'Documents', 'Downloads', 'Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public']);
/**
 * Folders right under the home folder that hold git repos, as the office
 * would find them (two levels deep), with how many each holds: what the
 * first-day guide offers to add. Folders already searched are left out.
 */
export function codeFolders(searched) {
    const home = homedir();
    const already = new Set(searched.map((r) => expandPath(r)));
    let names;
    try {
        names = readdirSync(home);
    }
    catch {
        return [];
    }
    const found = [];
    for (const name of names) {
        if (name.startsWith('.') || GUARDED.has(name))
            continue;
        const path = join(home, name);
        if (already.has(path))
            continue;
        try {
            if (!statSync(path).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const repos = isCheckout(path) ? 0 : findRepos(path, 1).length;
        if (repos)
            found.push({ path, label: `~/${name}`, repos });
    }
    return found.sort((a, b) => b.repos - a.repos).slice(0, 4);
}
/** Drops the cache so a repo added from the hire panel shows up at once. */
export function forgetRepoCache() {
    cache = null;
}
/**
 * Directories containing a `.git`, at most two levels under `root`.
 *
 * Deliberately shallow. It reaches both `~/Development/foo` and
 * `~/Development/org/foo` without descending into node_modules, vendored
 * checkouts, or every worktree on the machine.
 */
function isCheckout(path) {
    try {
        return statSync(join(path, '.git')).isDirectory();
    }
    catch {
        return false;
    }
}
function findRepos(root, depth) {
    if (depth < 0 || !existsSync(root))
        return [];
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of entries) {
        if (name.startsWith('.'))
            continue;
        const path = join(root, name);
        try {
            if (!statSync(path).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        if (isCheckout(path))
            out.push(path);
        else
            out.push(...findRepos(path, depth - 1));
    }
    return out;
}
/**
 * What this repo branches from.
 *
 * `origin/HEAD` is the remote's own answer and is what clone writes down, so
 * it is tried first; the fallbacks cover repos cloned before git started
 * setting it. Guessing `main` everywhere would put half of Operator's repos on a
 * branch that does not exist.
 */
async function defaultBranch(repoPath) {
    try {
        const { stdout } = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
            cwd: repoPath,
            timeoutMs: 10_000,
        });
        const name = stdout.trim().replace(/^origin\//, '');
        if (name)
            return name;
    }
    catch {
        // Not set on this clone.
    }
    for (const candidate of ['main', 'master', 'develop']) {
        try {
            await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${candidate}`], {
                cwd: repoPath,
                timeoutMs: 10_000,
            });
            return candidate;
        }
        catch {
            // Try the next one.
        }
    }
    return 'main';
}
/**
 * Checks a path Operator typed before it becomes a worker's home.
 *
 * Returns the repo, so the caller can record the base branch it worked out
 * rather than asking him for one he should not have to know.
 */
export async function describeRepo(rawPath) {
    const path = expandPath(rawPath.trim());
    if (!existsSync(path)) {
        throw new Error(`${path} does not exist on this Mac. For a repo that is only on GitHub, type its name, like owner/repo, and it will be cloned.`);
    }
    if (!existsSync(join(path, '.git')))
        throw new Error(`${path} is not a git repository.`);
    return { name: basename(path), path, baseBranch: await defaultBranch(path), isDefault: false };
}
