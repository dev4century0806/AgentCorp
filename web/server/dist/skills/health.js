/**
 * Health checking for the Skills Library.
 *
 * Detects broken links, name conflicts, invalid frontmatter, and missing tools.
 */
import { existsSync, lstatSync, readlinkSync, readdirSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { TOOL_PATHS } from './types.js';
import { listAllSkills, parseFrontmatter, getGlobalSkillsDir, getRepoSkillsDir, linkSkillToTool, adoptSkill, discoverToolSkills, backUpSkillFolder } from './library.js';
import { getInstalledTools, isToolInstalled } from './sync.js';
const HOME = homedir();
function expand(p) {
    if (p === '~')
        return HOME;
    if (p.startsWith('~/'))
        return join(HOME, p.slice(2));
    return p;
}
/** Checks for broken symlinks in a tool's skill folder. */
function findBrokenLinks(tool) {
    const userDir = expand(tool.userSkills);
    if (!existsSync(userDir))
        return [];
    const broken = [];
    try {
        for (const name of readdirSync(userDir)) {
            const linkPath = join(userDir, name);
            try {
                const stat = lstatSync(linkPath);
                if (stat.isSymbolicLink()) {
                    const target = resolve(dirname(linkPath), readlinkSync(linkPath));
                    if (!existsSync(target)) {
                        broken.push({ skillId: name, path: linkPath });
                    }
                }
            }
            catch {
                // Can't stat, consider broken
                broken.push({ skillId: name, path: linkPath });
            }
        }
    }
    catch {
        // Can't read directory
    }
    return broken;
}
/** Checks for name conflicts where a tool has a different skill with the same name. */
function findConflicts(tool, librarySkillIds) {
    const userDir = expand(tool.userSkills);
    if (!existsSync(userDir))
        return [];
    const conflicts = [];
    const skillsDir = getGlobalSkillsDir();
    const repoSkillsDir = getRepoSkillsDir();
    try {
        for (const name of readdirSync(userDir)) {
            if (!librarySkillIds.has(name))
                continue;
            const skillPath = join(userDir, name);
            try {
                const stat = lstatSync(skillPath);
                if (stat.isSymbolicLink()) {
                    const target = resolve(dirname(skillPath), readlinkSync(skillPath));
                    // If it doesn't point to our library, it's a conflict
                    if (!target.startsWith(skillsDir) && !target.startsWith(repoSkillsDir)) {
                        conflicts.push({ skillId: name, existingPath: skillPath });
                    }
                }
                else {
                    // Not a symlink, check if it's our managed copy
                    const markerPath = join(skillPath, '.agent-corp-managed');
                    if (!existsSync(markerPath)) {
                        conflicts.push({ skillId: name, existingPath: skillPath });
                    }
                }
            }
            catch {
                // Can't stat, skip
            }
        }
    }
    catch {
        // Can't read directory
    }
    return conflicts;
}
/** Validates the frontmatter of all skills in the library. */
function validateFrontmatter() {
    const invalid = [];
    const skills = listAllSkills();
    for (const skill of skills) {
        const skillMdPath = join(skill.path, 'SKILL.md');
        try {
            const content = readFileSync(skillMdPath, 'utf8');
            const { frontmatter } = parseFrontmatter(content);
            // Check required fields
            if (!frontmatter.name || typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
                invalid.push({
                    skillId: skill.id,
                    path: skillMdPath,
                    error: 'Missing or empty "name" in frontmatter',
                });
            }
            if (!frontmatter.description || typeof frontmatter.description !== 'string') {
                invalid.push({
                    skillId: skill.id,
                    path: skillMdPath,
                    error: 'Missing "description" in frontmatter',
                });
            }
        }
        catch (err) {
            invalid.push({
                skillId: skill.id,
                path: skillMdPath,
                error: `Cannot read SKILL.md: ${err.message}`,
            });
        }
    }
    return invalid;
}
/** Gets the list of tools that aren't installed. */
function getMissingTools() {
    return Object.values(TOOL_PATHS)
        .filter((tool) => !isToolInstalled(tool))
        .map((tool) => tool.name);
}
/** Performs a full health check of the skills library. */
export function checkSkillsHealth() {
    const tools = getInstalledTools();
    const skills = listAllSkills();
    const librarySkillIds = new Set(skills.map((s) => s.id));
    const brokenLinks = [];
    const conflicts = [];
    for (const tool of tools) {
        // Check for broken links
        const toolBroken = findBrokenLinks(tool);
        for (const broken of toolBroken) {
            brokenLinks.push({
                skillId: broken.skillId,
                toolId: tool.id,
                path: broken.path,
            });
        }
        // Check for conflicts
        const toolConflicts = findConflicts(tool, librarySkillIds);
        for (const conflict of toolConflicts) {
            conflicts.push({
                skillId: conflict.skillId,
                toolId: tool.id,
                existingPath: conflict.existingPath,
            });
        }
    }
    return {
        brokenLinks,
        conflicts,
        invalidFrontmatter: validateFrontmatter(),
        missingTools: getMissingTools(),
    };
}
/** Fixes a broken link by re-linking from the library. */
export function fixBrokenLink(skillId, toolId) {
    const tool = TOOL_PATHS[toolId];
    if (!tool) {
        return { success: false, error: `Unknown tool: ${toolId}` };
    }
    const userDir = expand(tool.userSkills);
    const linkPath = join(userDir, skillId);
    // Remove the broken link
    try {
        const stat = lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
            unlinkSync(linkPath);
        }
    }
    catch {
        // Link might already be gone
    }
    // Find the skill in the library
    const skills = listAllSkills();
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) {
        return { success: true }; // Broken link removed, no skill to link
    }
    // Re-link
    return linkSkillToTool(skill, tool);
}
/** Fixes a conflict by backing up the existing skill and linking from library. */
export function fixConflict(skillId, toolId, action) {
    const tool = TOOL_PATHS[toolId];
    if (!tool) {
        return { success: false, error: `Unknown tool: ${toolId}` };
    }
    const userDir = expand(tool.userSkills);
    const existingPath = join(userDir, skillId);
    if (!existsSync(existingPath)) {
        return { success: true }; // Nothing to fix
    }
    if (action === 'adopt') {
        // Adopt the existing skill into the library
        const discovered = discoverToolSkills(tool).find((d) => d.id === skillId);
        if (!discovered) {
            return { success: false, error: 'Could not read the existing skill.' };
        }
        try {
            adoptSkill(discovered, 'global', null);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    if (action === 'rename') {
        // Rename the existing skill to skill-backup
        try {
            backUpSkillFolder(existingPath);
        }
        catch (err) {
            return { success: false, error: `Could not rename: ${err.message}` };
        }
    }
    else {
        // Replace: remove the existing skill
        try {
            rmSync(existingPath, { recursive: true, force: true });
        }
        catch (err) {
            return { success: false, error: `Could not remove: ${err.message}` };
        }
    }
    // Link from library
    const skills = listAllSkills();
    const skill = skills.find((s) => s.id === skillId && s.scope === 'global');
    if (!skill) {
        return { success: true }; // No library skill to link
    }
    return linkSkillToTool(skill, tool);
}
/** Gets a summary of the health status. */
export function getHealthSummary() {
    const health = checkSkillsHealth();
    return {
        healthy: health.brokenLinks.length === 0 &&
            health.conflicts.length === 0 &&
            health.invalidFrontmatter.length === 0,
        brokenLinkCount: health.brokenLinks.length,
        conflictCount: health.conflicts.length,
        invalidCount: health.invalidFrontmatter.length,
        missingToolCount: health.missingTools.length,
    };
}
