import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { expandPath } from '../config.js';
import { pathKey } from '../protocol.js';
import { fillTemplate, run, slugify, RunError } from '../util.js';
/**
 * Works out where a ticket's worktree and branch will go, without touching disk.
 * Separate from creation so the hire sheet can show Operator the exact paths first.
 */
export function planWorktree(cfg, args) {
    const repoPath = expandPath(args.repoPath);
    const repoName = basename(repoPath);
    const slug = slugify(args.summary);
    const tokens = {
        root: expandPath(cfg.worktrees.root),
        repoName,
        key: pathKey(args.key),
        slug,
    };
    return {
        repoPath,
        repoName,
        worktreePath: fillTemplate(cfg.worktrees.dirTemplate, tokens),
        branch: fillTemplate(cfg.worktrees.branchTemplate, tokens),
        baseBranch: args.baseBranch,
    };
}
export class WorktreeError extends Error {
}
/**
 * Creates the ticket's worktree: fetch, then branch off the remote base.
 *
 * Reuses an existing worktree at the same path rather than failing, because a
 * re-hire after a crash is the common case and the branch is already there.
 */
export async function createWorktree(plan) {
    if (!existsSync(join(plan.repoPath, '.git'))) {
        throw new WorktreeError(`${plan.repoPath} is not a git repository.`);
    }
    if (existsSync(plan.worktreePath)) {
        const known = await listWorktreePaths(plan.repoPath);
        if (known.includes(plan.worktreePath))
            return { reused: true, fetched: false };
        throw new WorktreeError(`${plan.worktreePath} already exists but is not a worktree of ${plan.repoPath}. Move it aside and hire again.`);
    }
    mkdirSync(dirname(plan.worktreePath), { recursive: true });
    // A stale remote ref would branch the agent off week-old code, so the fetch
    // matters. It is not fatal though: a repo whose origin has moved, gone
    // private, or been renamed is still a repo Operator can work in. `resolveBase`
    // falls back to the local branch, and the caller says so out loud.
    let fetched = true;
    try {
        await run('git', ['fetch', '--prune', 'origin'], { cwd: plan.repoPath, timeoutMs: 180_000 });
    }
    catch {
        fetched = false;
    }
    const base = await resolveBase(plan.repoPath, plan.baseBranch);
    try {
        await run('git', ['worktree', 'add', plan.worktreePath, '-b', plan.branch, base], {
            cwd: plan.repoPath,
            timeoutMs: 180_000,
        });
    }
    catch (err) {
        // Most likely the branch already exists from an earlier run; check it out
        // into the new worktree instead of inventing a second name.
        if (err instanceof RunError && /already exists/i.test(err.message)) {
            await run('git', ['worktree', 'add', plan.worktreePath, plan.branch], {
                cwd: plan.repoPath,
                timeoutMs: 180_000,
            });
        }
        else {
            throw err;
        }
    }
    return { reused: false, fetched };
}
/**
 * Puts a removed worktree back at its old path, on its old branch, so a
 * rehired worker picks up where it left off. Never makes a branch: if the
 * branch is gone, so is the work, and a fresh one off the base would hide that.
 */
export async function restoreWorktree(plan) {
    if (!existsSync(join(plan.repoPath, '.git'))) {
        throw new WorktreeError(`${plan.repoPath} is not a git repository.`);
    }
    try {
        await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${plan.branch}`], { cwd: plan.repoPath });
    }
    catch {
        throw new WorktreeError(`the branch ${plan.branch} no longer exists in ${plan.repoPath}.`);
    }
    // A folder deleted by hand is still registered, and git will not add it
    // again, or check its branch out anywhere else, until it is pruned.
    await run('git', ['worktree', 'prune'], { cwd: plan.repoPath });
    mkdirSync(dirname(plan.worktreePath), { recursive: true });
    await run('git', ['worktree', 'add', plan.worktreePath, plan.branch], {
        cwd: plan.repoPath,
        timeoutMs: 180_000,
    });
}
async function resolveBase(repoPath, baseBranch) {
    for (const ref of [`origin/${baseBranch}`, baseBranch]) {
        try {
            await run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoPath });
            return ref;
        }
        catch {
            // Try the next candidate.
        }
    }
    throw new WorktreeError(`Neither origin/${baseBranch} nor ${baseBranch} exists in ${repoPath}.`);
}
/**
 * Parses `git worktree list --porcelain` into entries.
 *
 * Record format is a blank-line-separated block per worktree:
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>     (absent when detached)
 *   bare | detached | locked ...
 */
export async function listWorktrees(repoPath) {
    const { stdout } = await run('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
    const out = [];
    let current = null;
    const flush = () => {
        if (current)
            out.push(current);
        current = null;
    };
    for (const raw of stdout.split('\n')) {
        const line = raw.trimEnd();
        if (!line) {
            flush();
            continue;
        }
        if (line.startsWith('worktree ')) {
            flush();
            current = {
                path: line.slice('worktree '.length).trim(),
                branch: null,
                head: null,
                isMain: out.length === 0,
                locked: false,
            };
        }
        else if (current && line.startsWith('HEAD ')) {
            current.head = line.slice('HEAD '.length).trim();
        }
        else if (current && line.startsWith('branch ')) {
            current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
        }
        else if (current && (line === 'locked' || line.startsWith('locked '))) {
            // `locked <reason>` when one was given, as Claude's own sessions do.
            current.locked = true;
        }
    }
    flush();
    return out;
}
/**
 * The worktree of `repoPath` at one of `paths` or on one of `branches`, or
 * null. Lets a job carry on in a worktree that already exists, wherever it
 * was made, instead of the office making a second one beside it.
 *
 * Never returns the primary checkout: that is Operator's own, even when it is on
 * the branch asked for.
 */
export async function findExistingWorktree(repoPath, want) {
    let all;
    try {
        all = (await listWorktrees(repoPath)).filter((w) => !w.isMain);
    }
    catch {
        return null;
    }
    // Real paths, because macOS reports /var as /private/var and Operator types ~.
    const paths = new Set((want.paths ?? []).map(realPath));
    const branches = new Set(want.branches ?? []);
    return (all.find((w) => paths.has(realPath(w.path))) ??
        all.find((w) => w.branch !== null && branches.has(w.branch)) ??
        null);
}
/** A path as the filesystem resolves it, so two spellings of one folder compare equal. */
export function realPath(path) {
    const full = expandPath(path);
    try {
        return realpathSync(full);
    }
    catch {
        return resolve(full);
    }
}
/**
 * `owner/repo` for a repo whose origin is on GitHub, lower-cased, or null when
 * it has no origin or the origin is somewhere else.
 */
export async function githubRepoOf(repoPath) {
    try {
        const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
        return githubRepoIn(stdout.trim());
    }
    catch {
        return null;
    }
}
/** `owner/repo` from a GitHub https, ssh or PR URL, lower-cased. */
export function githubRepoIn(url) {
    const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url);
    return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
/** The head branch of a GitHub pull request, or null when `gh` cannot say. */
export async function prHeadBranch(url) {
    try {
        const { stdout } = await run('gh', ['pr', 'view', url, '--json', 'headRefName', '-q', '.headRefName'], {
            timeoutMs: 30_000,
        });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
async function listWorktreePaths(repoPath) {
    return (await listWorktrees(repoPath)).map((w) => w.path);
}
/**
 * True once nothing on the branch exists only here. That is the case when
 * its remote counterpart has every commit, when it never left its base, when
 * some remote ref has every commit (a merged branch whose own ref was pruned),
 * or when its PR is merged, which also covers a squash merge.
 */
export async function isBranchPushed(worktreePath, branch, hints = {}) {
    const none = async (range) => {
        try {
            const { stdout } = await run('git', ['rev-list', '--count', ...range], { cwd: worktreePath });
            return Number(stdout.trim()) === 0;
        }
        catch {
            // A missing ref proves nothing either way.
            return false;
        }
    };
    if (await none([`origin/${branch}..${branch}`]))
        return true;
    if (hints.baseBranch && (await none([`origin/${hints.baseBranch}..${branch}`])))
        return true;
    if (await none([branch, '--not', '--remotes']))
        return true;
    return hints.prUrl ? isPrMerged(hints.prUrl) : false;
}
/** Whether `gh` says the pull request is merged; false when it cannot say. */
async function isPrMerged(url) {
    try {
        const { stdout } = await run('gh', ['pr', 'view', url, '--json', 'state', '-q', '.state'], { timeoutMs: 30_000 });
        return stdout.trim() === 'MERGED';
    }
    catch {
        return false;
    }
}
/** `npm install` and friends rewrite these on their own; a change to one alone is not work. */
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
/** The worktree's uncommitted changes that are someone's work, lockfiles left out. */
export async function uncommittedWork(worktreePath) {
    const { stdout } = await run('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
        cwd: worktreePath,
        timeoutMs: 30_000,
    });
    const files = [];
    const entries = stdout.split('\0');
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry)
            continue;
        // A rename is followed by its old path, which is not a second change.
        if (entry[0] === 'R' || entry[0] === 'C')
            i++;
        const file = entry.slice(3);
        if (!LOCKFILES.has(basename(file)))
            files.push(file);
    }
    return files;
}
/**
 * Removes the worktree. Refuses while the branch has unpushed commits or the
 * tree has uncommitted work, so Mark done can never throw away work that
 * exists nowhere else. The branch itself stays, so Rehire can put it back.
 */
export async function removeWorktree(plan, opts = {}) {
    if (!existsSync(plan.worktreePath))
        return;
    if (!opts.force) {
        if (!(await isBranchPushed(plan.worktreePath, plan.branch, plan))) {
            throw new WorktreeError(`${plan.branch} has commits that are not on origin yet. Push them before cleaning up ${plan.worktreePath}.`);
        }
        const dirty = await uncommittedWork(plan.worktreePath);
        if (dirty.length) {
            const shown = dirty.slice(0, 5).join(', ') + (dirty.length > 5 ? ` and ${dirty.length - 5} more` : '');
            throw new WorktreeError(`uncommitted changes to ${shown}.`);
        }
    }
    // Forced either way: what is left is a lockfile, or Operator asked for it.
    await run('git', ['worktree', 'remove', '--force', plan.worktreePath], {
        cwd: plan.repoPath,
        timeoutMs: 60_000,
    });
    await run('git', ['worktree', 'prune'], { cwd: plan.repoPath }).catch(() => { });
}
/**
 * Short `git diff --stat`-style summary of a worktree against its base,
 * including uncommitted work. Used to tell an adopted agent what it is
 * walking into without pasting a whole diff into the prompt.
 */
export async function diffStatAgainstBase(worktreePath, baseBranch) {
    const base = await resolveBase(worktreePath, baseBranch);
    const { stdout: committed } = await run('git', ['diff', '--stat', `${base}...HEAD`], {
        cwd: worktreePath,
        timeoutMs: 30_000,
    });
    const { stdout: dirty } = await run('git', ['status', '--short'], {
        cwd: worktreePath,
        timeoutMs: 30_000,
    });
    const parts = [];
    if (committed.trim())
        parts.push(`Committed on this branch:\n${committed.trim()}`);
    if (dirty.trim())
        parts.push(`Uncommitted right now:\n${dirty.trim()}`);
    return parts.length ? parts.join('\n\n') : 'Nothing yet: the worktree matches ' + baseBranch + '.';
}
/**
 * Guards every path an agent is allowed to touch.
 * Used before launching an editor or running cleanup on a configured path.
 */
export function isInside(parent, child) {
    const rel = relative(expandPath(parent), expandPath(child));
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
/** Drops a .cursor/mcp.json into the worktree so the agent can reach 8090. */
export function writeWorktreeMcpConfig(worktreePath, contents) {
    const dir = join(worktreePath, '.cursor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mcp.json'), contents, 'utf8');
}
/**
 * Builds the .cursor/mcp.json content for a worktree, including:
 * - The office MCP server (for remember/recall tools)
 * - The factory MCP server (if enabled)
 */
export function buildWorktreeMcpConfig(opts) {
    const servers = {
        office: {
            type: 'http',
            url: opts.officeUrl,
            headers: { [opts.sessionHeader.name]: opts.sessionHeader.value },
        },
    };
    if (opts.factoryUrl) {
        servers['software-factory'] = {
            type: 'http',
            url: opts.factoryUrl,
            headers: opts.factoryHeaders ?? {},
        };
    }
    return JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
}
