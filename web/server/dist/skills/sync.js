/**
 * Sync operations for the Skills Library.
 *
 * Handles scanning tool folders, computing the sync matrix, and applying
 * link changes across all tools.
 */
import { existsSync, mkdirSync, readdirSync, lstatSync, readlinkSync, realpathSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { skillMatrixKey } from '../protocol.js';
import { TOOL_PATHS } from './types.js';
import { listAllSkills, listGlobalSkills, listRepoSkills, discoverToolSkills, linkSkillToTool, unlinkSkillFromTool, linkRepoSkill, unlinkRepoSkill, linkCommittedSkill, unlinkCommittedSkill, setToolOn, loadSkillsState, saveSkillsState, getGlobalSkillsDir, getSkill, getRepoSkill, readSkill, setToolOff, clearToolsOff, isToolOff, renameSkillFolder, releaseOtherAccountsLinks, } from './library.js';
const HOME = homedir();
function expand(p) {
    if (p === '~')
        return HOME;
    if (p.startsWith('~/'))
        return join(HOME, p.slice(2));
    return p;
}
/**
 * Whether skills should be linked for this tool. The office ships a runner for
 * every tool it supports, so each one counts even when it has never been used
 * on its own here and its home folder (such as `~/.codex`) does not exist yet.
 */
export function isToolInstalled(tool) {
    return tool.id in TOOL_PATHS;
}
/** Gets the tools skills are linked for. */
export function getInstalledTools() {
    return Object.values(TOOL_PATHS).filter(isToolInstalled);
}
/**
 * Checks the status of a skill's link to a specific tool. A global skill links
 * into the tool's user folder; a repo skill into the tool's folder in the
 * repo's checkout, so it needs `checkoutPath`.
 */
export function checkSkillLinkStatus(skill, tool, checkoutPath) {
    if (skill.scope === 'repo' && !skill.fromRepo && !checkoutPath) {
        return {
            skillId: skill.id,
            toolId: tool.id,
            status: 'missing',
            targetPath: '',
            error: `Add ${skill.repo} to the office to link its skills.`,
        };
    }
    const targetPath = skill.scope === 'repo' && checkoutPath
        ? join(checkoutPath, tool.repoSkills, skill.id)
        : join(expand(tool.userSkills), skill.id);
    // If the skill is from a committed repo, it's read-only
    if (skill.fromRepo) {
        return {
            skillId: skill.id,
            toolId: tool.id,
            status: 'from_repo',
            targetPath,
            error: null,
        };
    }
    if (!existsSync(targetPath)) {
        return {
            skillId: skill.id,
            toolId: tool.id,
            status: 'missing',
            targetPath,
            error: null,
        };
    }
    // Check if it's a symlink
    try {
        const stat = lstatSync(targetPath);
        if (stat.isSymbolicLink()) {
            const linkTarget = resolve(dirname(targetPath), readlinkSync(targetPath));
            // Check if it points to our library
            if (linkTarget === skill.path) {
                return {
                    skillId: skill.id,
                    toolId: tool.id,
                    status: 'linked',
                    targetPath,
                    error: null,
                };
            }
            // Points somewhere else - conflict
            return {
                skillId: skill.id,
                toolId: tool.id,
                status: 'conflict',
                targetPath,
                error: `Symlink points to ${linkTarget} instead of library`,
            };
        }
        // Not a symlink - check if it's a copy we made or a conflict
        const markerPath = join(targetPath, '.agent-corp-managed');
        if (existsSync(markerPath)) {
            return {
                skillId: skill.id,
                toolId: tool.id,
                status: 'copied',
                targetPath,
                error: null,
            };
        }
        // It's a different skill with the same name
        return {
            skillId: skill.id,
            toolId: tool.id,
            status: 'conflict',
            targetPath,
            error: 'A different skill with this name exists',
        };
    }
    catch (err) {
        return {
            skillId: skill.id,
            toolId: tool.id,
            status: 'missing',
            targetPath,
            error: err.message,
        };
    }
}
/** Computes the full sync matrix for all skills and tools, plus the skills committed in `checkouts`. */
export function computeSyncMatrix(repoFilter, checkouts = []) {
    const tools = getInstalledTools();
    const allSkills = listAllSkills();
    // Filter skills if a specific repo is requested
    const skills = repoFilter
        ? allSkills.filter((s) => s.scope === 'global' || s.repo === repoFilter)
        : allSkills;
    const status = {};
    const checkoutOf = new Map(checkouts.map((c) => [c.name, c.path]));
    for (const skill of skills) {
        const row = {};
        const checkoutPath = skill.repo ? checkoutOf.get(skill.repo) : undefined;
        for (const tool of tools) {
            row[tool.id] = checkSkillLinkStatus(skill, tool, checkoutPath);
        }
        status[skillMatrixKey(skill)] = row;
    }
    const toolsOn = loadSkillsState().toolsOn ?? {};
    for (const checkout of checkouts) {
        if (repoFilter && checkout.name !== repoFilter)
            continue;
        for (const skill of listCommittedRepoSkills(checkout)) {
            const key = skillMatrixKey(skill);
            if (status[key])
                continue;
            skills.push(skill);
            const folders = committedFolders(checkout, skill.id, toolsOn);
            const on = toolsOn[key] ?? [];
            const row = {};
            for (const tool of tools) {
                row[tool.id] = committedStatus(checkout.path, skill, tool, folders, on);
            }
            status[key] = row;
        }
    }
    // Discover skills in tools that aren't in the library
    const discovered = [];
    const seenIds = new Set();
    for (const tool of tools) {
        const toolSkills = discoverToolSkills(tool);
        for (const ds of toolSkills) {
            if (!seenIds.has(ds.id)) {
                seenIds.add(ds.id);
                discovered.push(ds);
            }
        }
    }
    return { skills, tools, status, discovered };
}
/** Links a library skill for one tool: a global one in the tool's user folder, a repo one in its checkout. */
function linkLibrarySkill(skill, tool, checkoutPath) {
    if (skill.fromRepo)
        return { success: false, error: 'A skill committed in the repo is linked by the repo itself.' };
    if (skill.scope === 'repo') {
        if (!checkoutPath)
            return { success: false, error: `Add ${skill.repo} to the office to link its skills.` };
        return linkRepoSkill(skill, tool, checkoutPath);
    }
    return linkSkillToTool(skill, tool);
}
function unlinkLibrarySkill(skill, tool, checkoutPath) {
    if (skill.scope === 'repo')
        return checkoutPath ? unlinkRepoSkill(skill.id, tool, checkoutPath) : { success: true };
    return unlinkSkillFromTool(skill.id, tool);
}
const CLAUDE = TOOL_PATHS.claude;
/** The skill ids a repo has its own skill for, in the library or committed, which a general skill gives way to. */
function repoSkillIds(checkout) {
    return new Set([...listRepoSkills(checkout.name), ...listCommittedRepoSkills(checkout)].map((s) => s.id));
}
/**
 * Links general skills into the worktrees' `.claude/skills`. Claude workers
 * load skills from their worktree alone, not from `~/.claude/skills`. A repo's
 * own skill of the same id, or anything already in the folder, keeps its place.
 */
function linkGeneralForClaude(skills, checkouts) {
    for (const checkout of checkouts) {
        if (!checkout.worktrees?.length)
            continue;
        const taken = repoSkillIds(checkout);
        for (const skill of skills) {
            if (taken.has(skill.id))
                continue;
            for (const worktree of checkout.worktrees) {
                if (!occupied(join(worktree, CLAUDE.repoSkills, skill.id)))
                    linkRepoSkill(skill, CLAUDE, worktree);
            }
        }
    }
}
/** Removes a general skill's links from the worktrees' `.claude/skills`, leaving a repo skill's link of the same id. */
function unlinkGeneralForClaude(skill, checkouts) {
    for (const worktree of checkouts.flatMap((c) => c.worktrees ?? [])) {
        const path = join(worktree, CLAUDE.repoSkills, skill.id);
        try {
            if (resolve(dirname(path), readlinkSync(path)) === skill.path)
                unlinkSync(path);
        }
        catch {
            // Not a link, or none there: nothing of this skill's to remove.
        }
    }
}
/**
 * Turns one tool on or off for a skill: links or unlinks it now, in the
 * checkout and its worktrees for a repo skill, and remembers the choice so
 * Sync and new worktrees keep to it. With a repo and no library skill of that
 * id, it is the skill committed in the repo. A general skill turned on or off
 * for Claude is linked or unlinked in the worktrees of `checkouts` too.
 */
export function setSkillLinked(skillId, toolId, on, repo, checkouts = []) {
    const tool = TOOL_PATHS[toolId];
    if (!tool)
        return { success: false, error: `Unknown tool: ${toolId}` };
    const skill = repo ? getRepoSkill(skillId, repo.name) : getSkill(skillId);
    if (!skill) {
        return repo ? linkCommittedFor(repo, skillId, tool, on) : { success: false, error: `Skill not found: ${skillId}` };
    }
    const result = on ? linkLibrarySkill(skill, tool, repo?.path) : unlinkLibrarySkill(skill, tool, repo?.path);
    if (!result.success)
        return result;
    for (const worktree of repo?.worktrees ?? []) {
        if (on)
            linkRepoSkill(skill, tool, worktree);
        else
            unlinkRepoSkill(skill.id, tool, worktree);
    }
    if (skill.scope === 'global' && tool.id === CLAUDE.id) {
        if (on)
            linkGeneralForClaude([skill], checkouts);
        else
            unlinkGeneralForClaude(skill, checkouts);
    }
    setToolOff(skillMatrixKey(skill), toolId, !on);
    return result;
}
/**
 * Links a skill just added to the library for every tool not turned off for
 * it, as Sync would: a general skill in the tools' home folders and, for
 * Claude, the worktrees of `checkouts`; a repo skill in its checkout and worktrees.
 */
export function linkForAllTools(skill, checkouts = []) {
    const checkout = skill.repo ? checkouts.find((c) => c.name === skill.repo) : undefined;
    if (skill.scope === 'repo' && !checkout)
        return;
    const roots = checkout ? [checkout.path, ...(checkout.worktrees ?? [])] : [undefined];
    const off = loadSkillsState().toolsOff?.[skillMatrixKey(skill)] ?? [];
    for (const tool of getInstalledTools()) {
        if (off.includes(tool.id))
            continue;
        for (const root of roots) {
            if (checkSkillLinkStatus(skill, tool, root).status === 'missing')
                linkLibrarySkill(skill, tool, root);
        }
    }
    if (skill.scope === 'global' && !off.includes(CLAUDE.id))
        linkGeneralForClaude([skill], checkouts);
}
/**
 * Removes every link the office made for a skill, as when it is deleted: for
 * a general skill, its links in the worktrees of `checkouts` too.
 */
export function unlinkSkillEverywhere(skill, repo, checkouts = []) {
    for (const tool of getInstalledTools()) {
        for (const root of repo ? [repo.path, ...(repo.worktrees ?? [])] : [undefined]) {
            unlinkLibrarySkill(skill, tool, root);
        }
    }
    if (skill.scope === 'global')
        unlinkGeneralForClaude(skill, checkouts);
    clearToolsOff(skillMatrixKey(skill));
}
/** Whether anything sits at a path, a broken link included. */
function occupied(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Why a library skill can't be called `id`, or null when the name is free. A
 * general skill needs the name free in every tool's home folder. A repo skill
 * needs it free in the repo's skill folders, and not a general skill's, which
 * Claude Code would use in its place.
 */
export function skillNameTaken(id, repo) {
    const general = listGlobalSkills().some((s) => s.id === id);
    if (!repo) {
        if (general)
            return `There is already a general skill called ${id}.`;
        const tool = getInstalledTools().find((t) => occupied(join(expand(t.userSkills), id)));
        return tool ? `${tool.name} already has its own skill called ${id} in ${tool.userSkills}.` : null;
    }
    if (getRepoSkill(id, repo.name))
        return `${repo.name} already has a skill called ${id}.`;
    const folder = REPO_FOLDERS.find((f) => occupied(join(repo.path, f, id)));
    if (folder)
        return `${repo.name} already has a skill called ${id} in ${folder}.`;
    if (general)
        return `There is a general skill called ${id}, and Claude Code would use that one in ${repo.name}.`;
    return null;
}
/**
 * Renames a library skill and moves its links to the new name, keeping the
 * tools it is off for. A general skill's links in the worktrees of
 * `checkouts` move too.
 */
export function renameSkill(skill, newId, repo, checkouts = []) {
    if (skill.fromRepo)
        throw new Error('This skill is committed in the repo, so it is renamed there.');
    if (newId === skill.id)
        return skill;
    const taken = skillNameTaken(newId, skill.scope === 'repo' ? repo : undefined);
    if (taken)
        throw new Error(taken);
    const general = skill.scope === 'global';
    const roots = general ? [undefined] : repo ? [repo.path, ...(repo.worktrees ?? [])] : [];
    const tools = getInstalledTools();
    for (const tool of tools)
        for (const root of roots)
            unlinkLibrarySkill(skill, tool, root);
    if (general)
        unlinkGeneralForClaude(skill, checkouts);
    const renamed = renameSkillFolder(skill, newId);
    const key = skillMatrixKey(renamed);
    for (const tool of tools) {
        if (isToolOff(key, tool.id))
            continue;
        for (const root of roots)
            linkLibrarySkill(renamed, tool, root);
    }
    if (general && !isToolOff(key, CLAUDE.id))
        linkGeneralForClaude([renamed], checkouts);
    return renamed;
}
/**
 * Links every library skill for each tool not turned off for it: global
 * skills into the tools' user folders, repo skills into their checkouts and
 * worktrees. Puts back the links Operator made for committed skills too. A folder
 * holding something else is left alone.
 */
export function syncAllSkillsToAllTools(checkouts = []) {
    const tools = getInstalledTools();
    const checkoutOf = new Map(checkouts.map((c) => [c.name, c]));
    const skills = listAllSkills();
    const state = loadSkillsState();
    const updated = [];
    releaseOtherAccountsLinks(tools.flatMap((tool) => [
        expand(tool.userSkills),
        ...checkouts.flatMap((c) => [c.path, ...(c.worktrees ?? [])]).map((root) => join(root, tool.repoSkills)),
    ]));
    for (const skill of skills) {
        const checkout = skill.repo ? checkoutOf.get(skill.repo) : undefined;
        if (skill.scope === 'repo' && !checkout)
            continue;
        const roots = checkout ? [checkout.path, ...(checkout.worktrees ?? [])] : [undefined];
        const off = state.toolsOff?.[skillMatrixKey(skill)] ?? [];
        for (const tool of tools) {
            if (off.includes(tool.id))
                continue;
            for (const root of roots) {
                if (checkSkillLinkStatus(skill, tool, root).status !== 'missing')
                    continue;
                const result = linkLibrarySkill(skill, tool, root);
                if (result.success && !updated.some((u) => u.id === skill.id)) {
                    updated.push({ id: skill.id, name: skill.name, action: 'added' });
                }
            }
        }
    }
    for (const checkout of checkouts) {
        restoreCommittedLinks(checkout.name, [checkout.path, ...(checkout.worktrees ?? [])], state.toolsOn ?? {});
    }
    linkGeneralForClaude(generalOnForClaude(skills, state), checkouts);
    state.lastSyncedAt = new Date().toISOString();
    // Record file timestamps for out-of-date detection
    for (const skill of skills) {
        try {
            state.fileTimestamps[skill.path] = statSync(join(skill.path, 'SKILL.md')).mtimeMs;
        }
        catch {
            // Skip if can't stat
        }
    }
    saveSkillsState(state);
    return { updated, repos: [], syncedAt: state.lastSyncedAt };
}
/** The general skills among `skills` not turned off for Claude. */
function generalOnForClaude(skills, state) {
    return skills.filter((s) => s.scope === 'global' && !(state.toolsOff?.[skillMatrixKey(s)] ?? []).includes(CLAUDE.id));
}
/**
 * Links a repo's library skills into a new worktree, for each tool not turned
 * off for them, and the committed skills Operator linked to more tools. General
 * skills on for Claude are linked for it too, since Claude workers don't read
 * `~/.claude/skills`; the other tools read their user folders.
 */
export function syncRepoSkillsToWorktree(repoName, worktreePath) {
    const tools = getInstalledTools();
    const state = loadSkillsState();
    const skills = listRepoSkills(repoName);
    const updated = [];
    for (const skill of skills) {
        const off = state.toolsOff?.[skillMatrixKey(skill)] ?? [];
        for (const tool of tools) {
            if (off.includes(tool.id))
                continue;
            if (linkRepoSkill(skill, tool, worktreePath).success && !updated.some((u) => u.id === skill.id)) {
                updated.push({ id: skill.id, name: skill.name, action: 'added' });
            }
        }
    }
    restoreCommittedLinks(repoName, [worktreePath], state.toolsOn ?? {});
    linkGeneralForClaude(generalOnForClaude(listGlobalSkills(), state), [
        { name: repoName, path: worktreePath, worktrees: [worktreePath] },
    ]);
    return {
        updated,
        repos: [{ name: repoName, total: skills.length, added: updated.length, updated: 0 }],
        syncedAt: new Date().toISOString(),
    };
}
/**
 * The skills marked "Always for workers" for work in a repo, or the global
 * ones alone without a repo. A repo's skill stands in for a global one with
 * the same id, and one committed in the repo for the library's.
 */
export function alwaysSkillsFor(repo) {
    const byId = new Map();
    const layers = repo
        ? [listGlobalSkills(), listRepoSkills(repo.name), listCommittedRepoSkills(repo)]
        : [listGlobalSkills()];
    for (const layer of layers) {
        for (const skill of layer)
            byId.set(skill.id, skill);
    }
    return [...byId.values()].filter((s) => s.required).sort((a, b) => a.name.localeCompare(b.name));
}
/** Checks if any skill files have changed since the last sync. */
export function isOutOfDate() {
    const state = loadSkillsState();
    if (!state.lastSyncedAt)
        return true;
    const skills = listAllSkills();
    for (const skill of skills) {
        try {
            const stat = statSync(join(skill.path, 'SKILL.md'));
            const recorded = state.fileTimestamps[skill.path];
            if (!recorded || stat.mtimeMs > recorded) {
                return true;
            }
        }
        catch {
            // New skill or can't stat, consider out of date
            return true;
        }
    }
    return false;
}
/** Checks if a specific repo's skills have changed since its last sync. */
export function isRepoOutOfDate(repoName) {
    const state = loadSkillsState();
    const lastSync = state.repoSyncedAt[repoName];
    if (!lastSync)
        return true;
    const skills = listRepoSkills(repoName);
    for (const skill of skills) {
        try {
            const stat = statSync(join(skill.path, 'SKILL.md'));
            const recorded = state.fileTimestamps[skill.path];
            if (!recorded || stat.mtimeMs > recorded) {
                return true;
            }
        }
        catch {
            return true;
        }
    }
    return false;
}
/** Whether the path resolves into the library, as the links the office makes do. */
function isInsideLibrary(path) {
    let library = dirname(getGlobalSkillsDir());
    try {
        library = realpathSync(library);
    }
    catch {
        // The library folder not existing yet just means nothing links into it.
    }
    return path === library || path.startsWith(library + sep);
}
/** Every repo folder a skill can be committed in: each tool's own. */
const REPO_FOLDERS = [...new Set(Object.values(TOOL_PATHS).map((t) => t.repoSkills))];
/**
 * Points a notes folder's skill folders at a checkout's, for a worker reading
 * the repo before it has a worktree. Its session runs in the notes folder, and
 * the tools load repo skills only from the folder a session runs in. Each
 * points at the checkout's folder as a whole, so it shows the repo's skills
 * and the links the office made there.
 */
export function linkRepoSkillsIntoNotes(checkoutPath, notesPath) {
    for (const folder of REPO_FOLDERS) {
        const source = join(checkoutPath, folder);
        const link = join(notesPath, folder);
        const there = existsSync(source);
        try {
            if (!lstatSync(link).isSymbolicLink())
                continue;
            if (there && readlinkSync(link) === source)
                continue;
            // Pointing at another repo, one the worker read before this one.
            unlinkSync(link);
        }
        catch {
            // Nothing there yet.
        }
        if (!there)
            continue;
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(source, link);
    }
}
/** The repo folders where the office linked a committed skill for a tool; the repo did not commit it there. */
function officeLinkedFolders(repoName, id, toolsOn) {
    return (toolsOn[`${repoName}/${id}`] ?? [])
        .map((toolId) => TOOL_PATHS[toolId]?.repoSkills)
        .filter((folder) => !!folder);
}
/**
 * Whether a repo folder holds the skill as the repo's own. Links between the
 * repo's own folders count (a repo can point `.cursor/skills` at
 * `.agents/skills`); links into the library do not.
 */
function committedAt(root, folder, id) {
    const skillPath = join(root, folder, id);
    if (!existsSync(join(skillPath, 'SKILL.md')))
        return false;
    try {
        return !isInsideLibrary(realpathSync(skillPath));
    }
    catch {
        return false;
    }
}
/** The repo folders holding a committed skill, leaving out the links the office made. */
function committedFolders(repo, id, toolsOn) {
    const office = officeLinkedFolders(repo.name, id, toolsOn);
    return REPO_FOLDERS.filter((folder) => !office.includes(folder) && committedAt(repo.path, folder, id));
}
/** Every skill committed in a repo, once each however many tool folders hold it. */
export function listCommittedRepoSkills(repo) {
    const toolsOn = loadSkillsState().toolsOn ?? {};
    const byId = new Map();
    for (const folder of REPO_FOLDERS) {
        let names;
        try {
            names = readdirSync(join(repo.path, folder));
        }
        catch {
            continue;
        }
        for (const name of names) {
            if (byId.has(name) || officeLinkedFolders(repo.name, name, toolsOn).includes(folder))
                continue;
            if (!committedAt(repo.path, folder, name))
                continue;
            const skill = readSkill(join(repo.path, folder, name), 'repo', repo.name);
            if (skill)
                byId.set(name, { ...skill, fromRepo: true });
        }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** How a tool gets a committed skill: from its own folder, from another it reads, through the office's link, or not at all. */
function committedStatus(root, skill, tool, folders, toolsOn) {
    const targetPath = join(root, tool.repoSkills, skill.id);
    const base = { skillId: skill.id, toolId: tool.id, targetPath, error: null };
    const present = (folder) => existsSync(join(root, folder, skill.id, 'SKILL.md'));
    if (folders.includes(tool.repoSkills))
        return { ...base, status: 'from_repo', via: tool.repoSkills };
    if (toolsOn.includes(tool.id) && present(tool.repoSkills))
        return { ...base, status: 'linked', via: folders[0] ?? null };
    // Another tool's link counts too: Copilot reads the `.agents/skills` link made for Codex.
    const linkedFolders = toolsOn.map((id) => TOOL_PATHS[id]?.repoSkills);
    const via = tool.reads.find((folder) => folders.includes(folder) || (linkedFolders.includes(folder) && present(folder)));
    if (via)
        return { ...base, status: 'via_repo', via };
    if (existsSync(targetPath)) {
        return { ...base, status: 'conflict', via: null, error: `${tool.repoSkills}/${skill.id} in the repo holds something else.` };
    }
    return { ...base, status: 'missing', via: null };
}
/**
 * Links a committed skill for a tool that does not read any folder it is
 * committed in, or removes that link, in the checkout and its worktrees.
 */
function linkCommittedFor(repo, id, tool, on) {
    const toolsOn = loadSkillsState().toolsOn ?? {};
    const key = `${repo.name}/${id}`;
    const roots = [repo.path, ...(repo.worktrees ?? [])];
    if (!on) {
        // Only a link the office made comes out; a folder the repo committed stays.
        if (!(toolsOn[key] ?? []).includes(tool.id))
            return { success: true };
        for (const root of roots)
            unlinkCommittedSkill(root, tool, id);
        setToolOn(key, tool.id, false);
        return { success: true };
    }
    const folders = committedFolders(repo, id, toolsOn);
    const from = folders[0];
    if (!from)
        return { success: false, error: `${id} is not committed in ${repo.name}.` };
    if (tool.reads.some((folder) => folders.includes(folder))) {
        return { success: false, error: `${tool.name} already reads it from the repo.` };
    }
    const result = linkCommittedSkill(repo.path, tool, id, from);
    if (!result.success)
        return result;
    for (const worktree of repo.worktrees ?? [])
        linkCommittedSkill(worktree, tool, id, from);
    setToolOn(key, tool.id, true);
    return { success: true };
}
/** Puts back the committed-skill links Operator turned on, in each of `roots` (a checkout or its worktrees). */
function restoreCommittedLinks(repoName, roots, toolsOn) {
    let added = 0;
    for (const [key, toolIds] of Object.entries(toolsOn)) {
        if (!key.startsWith(`${repoName}/`))
            continue;
        const id = key.slice(repoName.length + 1);
        for (const root of roots) {
            const from = committedFolders({ name: repoName, path: root }, id, toolsOn)[0];
            if (!from)
                continue;
            for (const toolId of toolIds) {
                const tool = TOOL_PATHS[toolId];
                if (!tool || existsSync(join(root, tool.repoSkills, id, 'SKILL.md')))
                    continue;
                if (linkCommittedSkill(root, tool, id, from).success)
                    added++;
            }
        }
    }
    return added;
}
