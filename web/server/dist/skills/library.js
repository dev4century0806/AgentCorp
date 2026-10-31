/**
 * Core Skills Library logic.
 *
 * Manages the local skills library at ~/.agent-corp/skills/ and handles
 * symlink creation into each tool's skill folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync, lstatSync, symlinkSync, unlinkSync, rmSync, copyFileSync, statSync, renameSync, realpathSync } from 'node:fs';
import { join, basename, dirname, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { STATE_DIR, activeStateDir, expandPath } from '../config.js';
import { skillMatrixKey } from '../protocol.js';
import { TOOL_PATHS as TOOLS } from './types.js';
const HOME = homedir();
/** Looked up each time, so each signed-in user has their own library. */
const libraryDir = () => join(activeStateDir(), 'skills');
const globalSkillsDir = () => join(libraryDir(), 'global');
const repoSkillsDir = () => join(libraryDir(), 'repos');
const stateFile = () => join(activeStateDir(), 'skills-state.json');
/** Expands ~ in paths. */
function expand(p) {
    if (p === '~')
        return HOME;
    if (p.startsWith('~/'))
        return join(HOME, p.slice(2));
    return p;
}
/** Ensures the skills library directories exist. */
export function ensureSkillsDir() {
    mkdirSync(globalSkillsDir(), { recursive: true });
    mkdirSync(repoSkillsDir(), { recursive: true });
}
/** Loads the persisted skills state. */
export function loadSkillsState() {
    if (!existsSync(stateFile())) {
        return {
            lastSyncedAt: null,
            repoSyncedAt: {},
            fileTimestamps: {},
            globalRequired: [],
            repoRequired: {},
            globalOnlyWhenAsked: [],
            repoOnlyWhenAsked: {},
        };
    }
    try {
        return JSON.parse(readFileSync(stateFile(), 'utf8'));
    }
    catch {
        return {
            lastSyncedAt: null,
            repoSyncedAt: {},
            fileTimestamps: {},
            globalRequired: [],
            repoRequired: {},
            globalOnlyWhenAsked: [],
            repoOnlyWhenAsked: {},
        };
    }
}
/** Saves the skills state. */
export function saveSkillsState(state) {
    mkdirSync(dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}
/** Parses SKILL.md frontmatter (YAML between --- markers). */
export function parseFrontmatter(content) {
    const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(content);
    if (!match) {
        // No frontmatter, try to extract name from first heading
        const heading = /^#\s+(.+)$/m.exec(content);
        return {
            frontmatter: {
                name: heading?.[1]?.trim() || 'Unnamed Skill',
                description: '',
            },
            body: content,
        };
    }
    const yaml = match[1] || '';
    const body = match[2] || '';
    // Simple YAML parsing for frontmatter
    const fm = {};
    const lines = yaml.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const kv = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
        if (kv) {
            const key = kv[1];
            let value = kv[2].trim();
            const block = /^([|>])[-+]?$/.exec(value);
            if (block) {
                const taken = [];
                while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) {
                    taken.push(lines[++i]);
                }
                fm[key] = blockScalar(taken, block[1] === '>');
                continue;
            }
            // Handle quoted strings
            if (value.startsWith('"') && value.endsWith('"')) {
                try {
                    value = JSON.parse(value);
                }
                catch {
                    value = value.slice(1, -1);
                }
            }
            else if (value.startsWith("'") && value.endsWith("'")) {
                value = value.slice(1, -1);
            }
            else if (value === 'true') {
                value = true;
            }
            else if (value === 'false') {
                value = false;
            }
            fm[key] = value;
        }
    }
    return {
        frontmatter: {
            name: typeof fm.name === 'string' ? fm.name : 'Unnamed Skill',
            description: typeof fm.description === 'string' ? fm.description : '',
            ...fm,
        },
        body,
    };
}
/**
 * A YAML block scalar's text (`key: |` keeps line breaks, `key: >` folds them
 * into spaces), from its indented lines. Blank lines stay paragraph breaks.
 */
function blockScalar(lines, folded) {
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
    const text = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).trimEnd());
    if (!folded)
        return text.join('\n').trim();
    return text
        .join('\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\n/g, ' '))
        .join('\n')
        .trim();
}
/** Serializes frontmatter back to YAML. */
export function serializeFrontmatter(fm, body) {
    const lines = [];
    for (const [key, value] of Object.entries(fm)) {
        if (value === undefined || value === null)
            continue;
        if (typeof value === 'boolean') {
            lines.push(`${key}: ${value}`);
        }
        else if (typeof value === 'string') {
            if (value.includes('\n')) {
                lines.push(`${key}: |`, ...value.split('\n').map((line) => (line ? `  ${line}` : '')));
            }
            else if (/[:#\[\]{}|>&*!?,]/.test(value)) {
                // Quote if contains special characters
                lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
            }
            else {
                lines.push(`${key}: ${value}`);
            }
        }
        else {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
    }
    return `---\n${lines.join('\n')}\n---\n${body}`;
}
/** Reads a skill from a directory. */
export function readSkill(skillPath, scope, repo) {
    const skillMdPath = join(skillPath, 'SKILL.md');
    if (!existsSync(skillMdPath))
        return null;
    try {
        const content = readFileSync(skillMdPath, 'utf8');
        const { frontmatter, body } = parseFrontmatter(content);
        const stat = statSync(skillMdPath);
        // List other files in the skill folder
        const files = readdirSync(skillPath)
            .filter((f) => f !== 'SKILL.md' && !f.startsWith('.'))
            .sort();
        const id = basename(skillPath);
        const state = loadSkillsState();
        const required = scope === 'global'
            ? state.globalRequired.includes(id)
            : (state.repoRequired[repo || ''] || []).includes(id);
        const onlyWhenAsked = frontmatter['disable-model-invocation'] === true || (scope === 'global'
            ? state.globalOnlyWhenAsked.includes(id)
            : (state.repoOnlyWhenAsked[repo || ''] || []).includes(id));
        return {
            id,
            name: frontmatter.name,
            description: frontmatter.description,
            scope,
            repo,
            path: skillPath,
            content,
            frontmatter,
            files,
            fromRepo: false,
            required,
            onlyWhenAsked,
            modifiedAt: stat.mtime.toISOString(),
        };
    }
    catch {
        return null;
    }
}
/** Checks if a path is a symlink. */
function isSymlink(path) {
    try {
        return lstatSync(path).isSymbolicLink();
    }
    catch {
        return false;
    }
}
/** Lists all global skills. */
export function listGlobalSkills() {
    ensureSkillsDir();
    if (!existsSync(globalSkillsDir()))
        return [];
    const skills = [];
    for (const name of readdirSync(globalSkillsDir())) {
        const skillPath = join(globalSkillsDir(), name);
        const skill = readSkill(skillPath, 'global', null);
        if (skill)
            skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
}
/** Lists all repo skills for a specific repo. */
export function listRepoSkills(repoName) {
    const repoDir = join(repoSkillsDir(), repoName);
    if (!existsSync(repoDir))
        return [];
    const skills = [];
    for (const name of readdirSync(repoDir)) {
        const skillPath = join(repoDir, name);
        const skill = readSkill(skillPath, 'repo', repoName);
        if (skill)
            skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
}
/** Lists all skills in the library. */
export function listAllSkills() {
    const skills = [...listGlobalSkills()];
    // Add repo skills
    if (existsSync(repoSkillsDir())) {
        for (const repoName of readdirSync(repoSkillsDir())) {
            const repoPath = join(repoSkillsDir(), repoName);
            if (statSync(repoPath).isDirectory()) {
                skills.push(...listRepoSkills(repoName));
            }
        }
    }
    return skills;
}
/** Gets a skill by id, checking global first then repo scopes. */
export function getSkill(id, repo) {
    // Check global first
    const globalPath = join(globalSkillsDir(), id);
    const globalSkill = readSkill(globalPath, 'global', null);
    if (globalSkill)
        return globalSkill;
    // Check repo if specified
    if (repo) {
        const repoPath = join(repoSkillsDir(), repo, id);
        const repoSkill = readSkill(repoPath, 'repo', repo);
        if (repoSkill)
            return repoSkill;
    }
    return null;
}
/** Gets a repo's own library skill, without falling back to global. */
export function getRepoSkill(id, repo) {
    return readSkill(join(repoSkillsDir(), repo, id), 'repo', repo);
}
/** Gets the effective skill for a repo (repo overrides global). */
export function getEffectiveSkill(id, repo) {
    // Repo skill takes precedence
    const repoPath = join(repoSkillsDir(), repo, id);
    const repoSkill = readSkill(repoPath, 'repo', repo);
    if (repoSkill)
        return repoSkill;
    // Fall back to global
    const globalPath = join(globalSkillsDir(), id);
    return readSkill(globalPath, 'global', null);
}
/** Creates a new skill in the library. */
export function createSkill(id, name, description, scope, repo, instructions) {
    ensureSkillsDir();
    const targetDir = scope === 'global'
        ? globalSkillsDir()
        : join(repoSkillsDir(), repo || '');
    mkdirSync(targetDir, { recursive: true });
    const skillPath = join(targetDir, id);
    if (existsSync(skillPath)) {
        throw new Error(`Skill "${id}" already exists.`);
    }
    mkdirSync(skillPath, { recursive: true });
    const frontmatter = { name, description };
    const body = instructions?.trim() || `# ${name}\n\n${description}`;
    const content = serializeFrontmatter(frontmatter, `\n${body}\n`);
    const skillMdPath = join(skillPath, 'SKILL.md');
    writeFileSync(skillMdPath, content, 'utf8');
    return readSkill(skillPath, scope, repo);
}
/** Updates a skill's SKILL.md content. */
export function updateSkill(id, scope, repo, updates) {
    const targetDir = scope === 'global'
        ? globalSkillsDir()
        : join(repoSkillsDir(), repo || '');
    const skillPath = join(targetDir, id);
    const skillMdPath = join(skillPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
        throw new Error(`Skill "${id}" not found.`);
    }
    if (updates.content !== undefined) {
        // Replace entire content
        writeFileSync(skillMdPath, updates.content, 'utf8');
    }
    else {
        // Update frontmatter fields
        const current = readFileSync(skillMdPath, 'utf8');
        const { frontmatter, body } = parseFrontmatter(current);
        if (updates.name !== undefined)
            frontmatter.name = updates.name;
        if (updates.description !== undefined)
            frontmatter.description = updates.description;
        const newContent = serializeFrontmatter(frontmatter, body);
        writeFileSync(skillMdPath, newContent, 'utf8');
    }
    return readSkill(skillPath, scope, repo);
}
/** Deletes a skill from the library. */
export function deleteSkill(id, scope, repo) {
    const targetDir = scope === 'global'
        ? globalSkillsDir()
        : join(repoSkillsDir(), repo || '');
    const skillPath = join(targetDir, id);
    if (existsSync(skillPath)) {
        rmSync(skillPath, { recursive: true, force: true });
    }
}
/** Gets the path where a tool expects to find skills. */
export function getToolSkillsPath(tool, global) {
    return expand(global ? tool.userSkills : tool.repoSkills);
}
/** Links a skill into a tool's skill folder. */
export function linkSkillToTool(skill, tool) {
    const targetDir = expand(tool.userSkills);
    mkdirSync(targetDir, { recursive: true });
    const linkPath = join(targetDir, skill.id);
    // Check if something already exists at the link path
    if (existsSync(linkPath)) {
        if (isSymlink(linkPath)) {
            // Check if it points to our library
            try {
                const target = resolve(dirname(linkPath), readlinkSync(linkPath));
                if (target === skill.path) {
                    return { success: true }; // Already linked correctly
                }
            }
            catch {
                // Can't read symlink, will replace it
            }
            // Remove existing symlink
            unlinkSync(linkPath);
        }
        else {
            // Something else exists, don't overwrite
            return { success: false, error: `${linkPath} already exists and is not a library symlink.` };
        }
    }
    try {
        if (tool.followsSymlinks) {
            symlinkSync(skill.path, linkPath);
        }
        else {
            // Copy instead of symlink
            copySkillFolder(skill.path, linkPath);
        }
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
/** Copies a skill folder for tools that don't follow symlinks. */
function copySkillFolder(src, dest) {
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(src)) {
        const srcPath = join(src, file);
        const destPath = join(dest, file);
        if (statSync(srcPath).isDirectory()) {
            copySkillFolder(srcPath, destPath);
        }
        else {
            copyFileSync(srcPath, destPath);
        }
    }
}
/** Unlinks a skill from a tool (removes only our links, never user's own skills). */
export function unlinkSkillFromTool(skillId, tool) {
    return removeLibraryLink(join(expand(tool.userSkills), skillId));
}
/** Unlinks a repo skill from a tool's folder in a checkout or worktree. */
export function unlinkRepoSkill(skillId, tool, checkoutPath) {
    return removeLibraryLink(join(checkoutPath, tool.repoSkills, skillId));
}
function inAnotherAccountsLibrary(path) {
    if (path === libraryDir() || path.startsWith(libraryDir() + sep))
        return false;
    const [top, , below] = relative(STATE_DIR, path).split(sep);
    return top === 'skills' || (top === 'accounts' && below === 'skills');
}
export function releaseOtherAccountsLinks(dirs) {
    for (const dir of dirs) {
        let names;
        try {
            names = readdirSync(dir);
        }
        catch {
            continue;
        }
        for (const name of names) {
            const path = join(dir, name);
            if (!isSymlink(path))
                continue;
            try {
                if (inAnotherAccountsLibrary(resolve(dir, readlinkSync(path))))
                    unlinkSync(path);
            }
            catch {
                continue;
            }
        }
    }
}
/** Removes a link or copy the office made, leaving anything else where it is. */
function removeLibraryLink(linkPath) {
    if (!existsSync(linkPath) && !isSymlink(linkPath)) {
        return { success: true }; // Nothing to unlink
    }
    // Only remove if it's a symlink pointing to our library, or a copy we made
    if (isSymlink(linkPath)) {
        try {
            const target = resolve(dirname(linkPath), readlinkSync(linkPath));
            if (!target.startsWith(libraryDir())) {
                return { success: false, error: 'This skill is not from the library.' };
            }
            unlinkSync(linkPath);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    else {
        // Check if this looks like a library copy by checking for a marker
        const markerPath = join(linkPath, '.agent-corp-managed');
        if (existsSync(markerPath)) {
            rmSync(linkPath, { recursive: true, force: true });
            return { success: true };
        }
        return { success: false, error: 'This skill is not from the library.' };
    }
}
/** Links a repo skill into a worktree and adds it to .git/info/exclude. */
export function linkRepoSkill(skill, tool, worktreePath) {
    const repoSkillsDir = join(worktreePath, tool.repoSkills);
    mkdirSync(repoSkillsDir, { recursive: true });
    const linkPath = join(repoSkillsDir, skill.id);
    if (existsSync(linkPath) && !isSymlink(linkPath) && !existsSync(join(linkPath, '.agent-corp-managed'))) {
        return { success: false, error: `The repo already has its own ${tool.repoSkills}/${skill.id}.` };
    }
    try {
        if (isSymlink(linkPath)) {
            unlinkSync(linkPath);
        }
        else if (existsSync(linkPath)) {
            rmSync(linkPath, { recursive: true, force: true });
        }
        if (tool.followsSymlinks) {
            symlinkSync(skill.path, linkPath);
        }
        else {
            copySkillFolder(skill.path, linkPath);
            // Mark as managed so we can clean it up
            writeFileSync(join(linkPath, '.agent-corp-managed'), '', 'utf8');
        }
        // Add to .git/info/exclude
        addToGitExclude(worktreePath, `${tool.repoSkills}/${skill.id}`);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
/**
 * Links a skill committed in one tool's folder into another tool's folder,
 * in a checkout or worktree `root`. The link is relative, so it follows the
 * committed skill on whatever branch the root has out, and git ignores it.
 * A root whose branch lacks the skill is left alone.
 */
export function linkCommittedSkill(root, tool, id, fromFolder) {
    const source = join(root, fromFolder, id);
    if (!existsSync(join(source, 'SKILL.md')))
        return { success: true };
    const linkPath = join(root, tool.repoSkills, id);
    try {
        if (isSymlink(linkPath)) {
            unlinkSync(linkPath);
        }
        else if (existsSync(linkPath)) {
            return { success: false, error: `The repo already has its own ${tool.repoSkills}/${id}.` };
        }
        mkdirSync(dirname(linkPath), { recursive: true });
        symlinkSync(relative(dirname(linkPath), source), linkPath);
        addToGitExclude(root, `${tool.repoSkills}/${id}`);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
/** Removes a link `linkCommittedSkill` made; the caller knows it made one there. */
export function unlinkCommittedSkill(root, tool, id) {
    const linkPath = join(root, tool.repoSkills, id);
    try {
        if (isSymlink(linkPath))
            unlinkSync(linkPath);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
/** Adds a path to .git/info/exclude (shared by all worktrees). */
export function addToGitExclude(repoPath, pattern) {
    // Find the git dir (could be a worktree with separate .git file)
    let gitDir = join(repoPath, '.git');
    if (existsSync(gitDir)) {
        const stat = lstatSync(gitDir);
        if (!stat.isDirectory()) {
            // .git is a file pointing to the actual git dir
            const content = readFileSync(gitDir, 'utf8');
            const match = /^gitdir:\s*(.+)$/m.exec(content);
            const gitdir = match?.[1]?.trim();
            if (gitdir) {
                gitDir = resolve(repoPath, gitdir);
            }
        }
    }
    // A linked worktree's own git dir is not where git reads excludes from; the shared one is.
    const commondir = join(gitDir, 'commondir');
    if (existsSync(commondir)) {
        gitDir = resolve(gitDir, readFileSync(commondir, 'utf8').trim());
    }
    const excludePath = join(gitDir, 'info', 'exclude');
    mkdirSync(dirname(excludePath), { recursive: true });
    let content = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (!content.includes(pattern)) {
        content = content.trimEnd() + '\n' + pattern + '\n';
        writeFileSync(excludePath, content, 'utf8');
    }
}
/** Discovers skills from a tool's user skill folder that aren't in the library. */
export function discoverToolSkills(tool) {
    const skillsDir = expand(tool.userSkills);
    if (!existsSync(skillsDir))
        return [];
    const discovered = [];
    const libraryIds = new Set(listAllSkills().map((s) => s.id));
    for (const name of readdirSync(skillsDir)) {
        const skillPath = join(skillsDir, name);
        // Skip symlinks pointing to our library
        if (isSymlink(skillPath)) {
            try {
                const target = resolve(dirname(skillPath), readlinkSync(skillPath));
                if (target.startsWith(libraryDir()))
                    continue;
            }
            catch {
                // Can't read symlink, treat as potential skill
            }
        }
        // Skip if already in library
        if (libraryIds.has(name))
            continue;
        const skillMdPath = join(skillPath, 'SKILL.md');
        if (!existsSync(skillMdPath))
            continue;
        try {
            const content = readFileSync(skillMdPath, 'utf8');
            const { frontmatter } = parseFrontmatter(content);
            const files = readdirSync(skillPath)
                .filter((f) => f !== 'SKILL.md' && !f.startsWith('.'))
                .sort();
            discovered.push({
                id: name,
                name: frontmatter.name,
                description: frontmatter.description,
                toolId: tool.id,
                path: skillPath,
                content,
                frontmatter,
                files,
            });
        }
        catch {
            // Skip skills we can't read
        }
    }
    return discovered;
}
/** Adopts a discovered skill into the library. */
export function adoptSkill(discovered, scope, repo) {
    ensureSkillsDir();
    const targetDir = scope === 'global'
        ? globalSkillsDir()
        : join(repoSkillsDir(), repo || '');
    mkdirSync(targetDir, { recursive: true });
    const skillPath = join(targetDir, discovered.id);
    if (existsSync(skillPath)) {
        throw new Error(`Skill "${discovered.id}" already exists in the library.`);
    }
    // Copy the entire skill folder
    copySkillFolder(discovered.path, skillPath);
    const skill = readSkill(skillPath, scope, repo);
    if (!skill) {
        throw new Error('Failed to read adopted skill.');
    }
    // Other tools' copies of the same skill, found before the original goes
    const sameCopies = scope === 'global' ? copiesOfSameSkill(discovered) : [];
    // Link it back to the tool it came from
    const tool = TOOLS[discovered.toolId];
    if (tool) {
        // Remove the original and replace with link
        rmSync(discovered.path, { recursive: true, force: true });
        linkSkillToTool(skill, tool);
    }
    // The library now holds the same files, so these give way to links. A backup
    // would leave the tool a second skill by the same name, and one more to adopt.
    for (const copy of sameCopies) {
        rmSync(copy.path, { recursive: true, force: true });
        linkSkillToTool(skill, copy.tool);
    }
    return skill;
}
/** The other tools' folders holding this skill: a link to the same folder, or the same files. */
function copiesOfSameSkill(discovered) {
    const original = realpathSync(discovered.path);
    return Object.values(TOOLS).flatMap((tool) => {
        if (tool.id === discovered.toolId)
            return [];
        const path = join(expand(tool.userSkills), discovered.id);
        try {
            const real = realpathSync(path);
            return real === original || sameFiles(real, original) ? [{ tool, path }] : [];
        }
        catch {
            return []; // Nothing there, or a broken link
        }
    });
}
/** Whether two folders hold the same files with the same contents. */
function sameFiles(a, b) {
    const names = (dir) => readdirSync(dir).filter((f) => f !== '.DS_Store' && f !== '.agent-corp-managed').sort();
    const left = names(a);
    const right = names(b);
    if (left.join('\n') !== right.join('\n'))
        return false;
    return left.every((name) => {
        const x = join(a, name);
        const y = join(b, name);
        const xDir = statSync(x).isDirectory();
        if (xDir !== statSync(y).isDirectory())
            return false;
        return xDir ? sameFiles(x, y) : readFileSync(x).equals(readFileSync(y));
    });
}
/** Moves a skill folder aside to `<name>-backup` (or `-backup-N`). */
export function backUpSkillFolder(path) {
    let backup = `${path}-backup`;
    for (let n = 1; existsSync(backup) || isSymlink(backup); n++)
        backup = `${path}-backup-${n}`;
    renameSync(path, backup);
}
/**
 * Renames a library skill's folder and the `name` in its SKILL.md, carrying
 * its settings over. Links to the old folder are the caller's to move.
 */
export function renameSkillFolder(skill, newId) {
    const targetPath = join(dirname(skill.path), newId);
    if (existsSync(targetPath))
        throw new Error(`There is already a skill called ${newId} here.`);
    renameSync(skill.path, targetPath);
    const skillMd = join(targetPath, 'SKILL.md');
    writeFileSync(skillMd, withFrontmatterLine(readFileSync(skillMd, 'utf8'), 'name', newId), 'utf8');
    const state = loadSkillsState();
    const swap = (ids) => ids?.map((id) => (id === skill.id ? newId : id));
    if (skill.repo) {
        state.repoRequired[skill.repo] = swap(state.repoRequired[skill.repo]) ?? [];
        state.repoOnlyWhenAsked[skill.repo] = swap(state.repoOnlyWhenAsked[skill.repo]) ?? [];
    }
    else {
        state.globalRequired = swap(state.globalRequired) ?? [];
        state.globalOnlyWhenAsked = swap(state.globalOnlyWhenAsked) ?? [];
    }
    const oldKey = skillMatrixKey(skill);
    const off = state.toolsOff?.[oldKey];
    if (state.toolsOff && off) {
        delete state.toolsOff[oldKey];
        state.toolsOff[skillMatrixKey({ ...skill, id: newId })] = off;
    }
    saveSkillsState(state);
    return readSkill(targetPath, skill.scope, skill.repo);
}
/** Gets the global skills directory path. */
export function getGlobalSkillsDir() {
    return globalSkillsDir();
}
/** Gets the repo skills directory path. */
export function getRepoSkillsDir() {
    return repoSkillsDir();
}
/** Marks a skill as required. */
export function setSkillRequired(skillId, required, repo) {
    const state = loadSkillsState();
    if (repo) {
        const list = state.repoRequired[repo] || [];
        if (required && !list.includes(skillId)) {
            state.repoRequired[repo] = [...list, skillId];
        }
        else if (!required) {
            state.repoRequired[repo] = list.filter((id) => id !== skillId);
        }
    }
    else {
        if (required && !state.globalRequired.includes(skillId)) {
            state.globalRequired = [...state.globalRequired, skillId];
        }
        else if (!required) {
            state.globalRequired = state.globalRequired.filter((id) => id !== skillId);
        }
    }
    saveSkillsState(state);
}
/**
 * Makes a library skill load only when named, or lets agents pick it up on
 * their own again. Claude Code, Cursor and Copilot read
 * `disable-model-invocation` from SKILL.md; Codex reads
 * `policy.allow_implicit_invocation` from agents/openai.yaml. Both sit in the
 * skill's folder, which every tool's link points at.
 */
export function setInvocationPolicy(skillPath, onlyWhenNamed) {
    const skillMd = join(skillPath, 'SKILL.md');
    const content = readFileSync(skillMd, 'utf8');
    const updated = withFrontmatterLine(content, 'disable-model-invocation', onlyWhenNamed ? 'true' : null);
    if (updated !== content)
        writeFileSync(skillMd, updated, 'utf8');
    setCodexImplicitInvocation(join(skillPath, 'agents', 'openai.yaml'), !onlyWhenNamed);
}
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
/**
 * Sets or removes one top-level frontmatter key, with any indented lines
 * that continue it, leaving every other line as written.
 */
function withFrontmatterLine(content, key, value) {
    const match = FRONTMATTER.exec(content);
    if (!match)
        return value === null ? content : `---\n${key}: ${value}\n---\n${content}`;
    const lines = match[1].split('\n');
    const at = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (at !== -1) {
        let end = at + 1;
        while (end < lines.length && /^(\s|$)/.test(lines[end]))
            end++;
        lines.splice(at, end - at);
    }
    if (value !== null)
        lines.splice(at === -1 ? lines.length : at, 0, `${key}: ${value}`);
    return `---\n${lines.join('\n')}\n---${match[2]}${content.slice(match[0].length)}`;
}
/** A one-line YAML string, quoted when YAML would read it as something else. */
function yamlString(value) {
    return /^[A-Za-z0-9(][^:#"'\n]*$/.test(value) && !/\s$/.test(value) && !/^(true|false|null|~|[\d.]+)$/i.test(value)
        ? value
        : JSON.stringify(value);
}
/** Saves a library skill's description and instructions, leaving the rest of its frontmatter as written. */
export function editSkillText(skill, description, instructions) {
    const skillMd = join(skill.path, 'SKILL.md');
    const withDescription = withFrontmatterLine(readFileSync(skillMd, 'utf8'), 'description', yamlString(description.replace(/\s*\n\s*/g, ' ').trim()));
    const match = FRONTMATTER.exec(withDescription);
    const head = match[2] ? match[0] : `${match[0]}\n`;
    const body = instructions.trim();
    writeFileSync(skillMd, body ? `${head}\n${body}\n` : head, 'utf8');
    return readSkill(skill.path, skill.scope, skill.repo);
}
/** Writes Codex's `policy.allow_implicit_invocation`, keeping the file's other settings. */
function setCodexImplicitInvocation(path, allow) {
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const lines = existing.split('\n').filter((line) => !/^\s+allow_implicit_invocation\s*:/.test(line));
    const policyAt = lines.findIndex((line) => /^policy\s*:\s*$/.test(line));
    if (!allow) {
        if (policyAt === -1) {
            while (lines.length && !lines[lines.length - 1].trim())
                lines.pop();
            lines.push('policy:', '  allow_implicit_invocation: false');
        }
        else {
            const indent = /^(\s+)\S/.exec(lines[policyAt + 1] ?? '')?.[1] ?? '  ';
            lines.splice(policyAt + 1, 0, `${indent}allow_implicit_invocation: false`);
        }
    }
    else if (policyAt !== -1 && !/^\s+\S/.test(lines[policyAt + 1] ?? '')) {
        lines.splice(policyAt, 1);
    }
    const text = lines.join('\n').trim();
    if (!text) {
        if (existsSync(path)) {
            rmSync(path);
            const dir = dirname(path);
            if (!readdirSync(dir).length)
                rmSync(dir, { recursive: true });
        }
        return;
    }
    if (text + '\n' === existing)
        return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text + '\n', 'utf8');
}
/** Whether Operator turned a tool off for a skill, so Sync leaves it unlinked there. */
export function isToolOff(skillKey, toolId) {
    return (loadSkillsState().toolsOff?.[skillKey] ?? []).includes(toolId);
}
/** Records a tool as on or off for a skill; `skillKey` is the skill's sync matrix key. */
export function setToolOff(skillKey, toolId, off) {
    const state = loadSkillsState();
    const toolsOff = { ...(state.toolsOff ?? {}) };
    const list = (toolsOff[skillKey] ?? []).filter((id) => id !== toolId);
    if (off)
        list.push(toolId);
    if (list.length)
        toolsOff[skillKey] = list;
    else
        delete toolsOff[skillKey];
    saveSkillsState({ ...state, toolsOff });
}
/** Forgets the tools a deleted skill was turned off for. */
export function clearToolsOff(skillKey) {
    const state = loadSkillsState();
    if (!state.toolsOff?.[skillKey])
        return;
    const { [skillKey]: _gone, ...rest } = state.toolsOff;
    saveSkillsState({ ...state, toolsOff: rest });
}
/** Sets which repos the library's sidebar lists, by path. */
export function setLibraryRepos(paths) {
    const libraryRepos = [...new Set(paths)];
    saveSkillsState({ ...loadSkillsState(), libraryRepos });
    return libraryRepos;
}
/** Records a tool as linked to a committed repo skill, or not; `skillKey` is the skill's sync matrix key. */
export function setToolOn(skillKey, toolId, on) {
    const state = loadSkillsState();
    const toolsOn = { ...(state.toolsOn ?? {}) };
    const list = (toolsOn[skillKey] ?? []).filter((id) => id !== toolId);
    if (on)
        list.push(toolId);
    if (list.length)
        toolsOn[skillKey] = list;
    else
        delete toolsOn[skillKey];
    saveSkillsState({ ...state, toolsOn });
}
/** Marks a skill as only-when-asked. */
export function setSkillOnlyWhenAsked(skillId, onlyWhenAsked, repo) {
    const state = loadSkillsState();
    if (repo) {
        const list = state.repoOnlyWhenAsked[repo] || [];
        if (onlyWhenAsked && !list.includes(skillId)) {
            state.repoOnlyWhenAsked[repo] = [...list, skillId];
        }
        else if (!onlyWhenAsked) {
            state.repoOnlyWhenAsked[repo] = list.filter((id) => id !== skillId);
        }
    }
    else {
        if (onlyWhenAsked && !state.globalOnlyWhenAsked.includes(skillId)) {
            state.globalOnlyWhenAsked = [...state.globalOnlyWhenAsked, skillId];
        }
        else if (!onlyWhenAsked) {
            state.globalOnlyWhenAsked = state.globalOnlyWhenAsked.filter((id) => id !== skillId);
        }
    }
    saveSkillsState(state);
}
