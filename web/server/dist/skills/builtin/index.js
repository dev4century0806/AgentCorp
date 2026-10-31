/**
 * Built-in skills that ship with AgentCorp.
 *
 * They live in the server package and never go through the Skills Library:
 * nothing here is synced or linked into ~/.claude. Each is put into a brief
 * by the code that needs it, not by listing them: `self-review` goes into
 * every worker's brief (see `selfReviewBrief`), and `office-designer` only
 * into the brief of a worker generating an office (issue #157).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../library.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
/** IDs of all built-in skills. */
export const BUILTIN_SKILL_IDS = ['self-review', 'office-designer'];
/** The folder a built-in skill's files are read from: beside this module in src, or in dist once built. */
export function builtinSkillDir(id) {
    return join(__dirname, id);
}
/** A built-in skill's SKILL.md without its front matter, for putting straight into a brief. */
export function builtinSkillBody(id) {
    const content = readFileSync(join(builtinSkillDir(id), 'SKILL.md'), 'utf8');
    return parseFrontmatter(content).body.trim();
}
/** Loads a built-in skill by ID. */
export function loadBuiltinSkill(id) {
    const skillPath = builtinSkillDir(id);
    const skillMdPath = join(skillPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
        console.error(`[builtin-skills] Missing ${id}/SKILL.md`);
        return null;
    }
    try {
        const content = readFileSync(skillMdPath, 'utf8');
        const { frontmatter, body } = parseFrontmatter(content);
        return {
            id,
            name: frontmatter.name,
            description: frontmatter.description,
            scope: 'global',
            repo: null,
            path: skillPath,
            content,
            frontmatter,
            files: [],
            fromRepo: false,
            // Built-in skills are always required
            required: true,
            onlyWhenAsked: false,
            modifiedAt: new Date().toISOString(),
        };
    }
    catch (err) {
        console.error(`[builtin-skills] Failed to load ${id}:`, err.message);
        return null;
    }
}
/** Returns all built-in skills. */
export function listBuiltinSkills() {
    return BUILTIN_SKILL_IDS.map(loadBuiltinSkill).filter((s) => s !== null);
}
/** Returns the self-review skill. */
export function getSelfReviewSkill() {
    return loadBuiltinSkill('self-review');
}
/**
 * The self-review brief section, instructing the worker to run the skill
 * before finishing. Returns empty string if the skill can't be loaded.
 */
export function selfReviewBrief() {
    const skill = getSelfReviewSkill();
    if (!skill)
        return '';
    return [
        '## Before you finish',
        '',
        'Run through the self-review checklist:',
        '',
        '1. Re-read your diff and remove any leftover debug code',
        '2. Verify tests were added or updated for your changes',
        '3. Record any repo convention, gotcha, or correction you learned with `remember`',
        '4. Write a summary of what changed, what was tested, and anything you\'re unsure about',
        '',
        'Include the summary in your final message.',
    ].join('\n');
}
