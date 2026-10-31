/**
 * What a worker's brief says about the skills marked "Always for workers".
 */
import { join, relative } from 'node:path';
import { alwaysSkillsFor } from './sync.js';
import { selfReviewBrief } from './builtin/index.js';
/**
 * The brief's section naming the skills to use on every task, or '' when none
 * are marked. `workdir` is where the worker reads the repo: its worktree once
 * it has one, else the checkout. A skill committed in the repo is pointed at
 * there; a library skill at its folder in the library.
 */
export function alwaysSkillsBrief(repo, workdir) {
    const skills = alwaysSkillsFor(repo);
    const selfReview = selfReviewBrief();
    const parts = [];
    if (skills.length) {
        const lines = skills.map((skill) => {
            const where = skill.fromRepo && repo
                ? join(workdir ?? repo.path, relative(repo.path, skill.path), 'SKILL.md')
                : join(skill.path, 'SKILL.md');
            const about = skill.description.replace(/\s+/g, ' ').trim();
            return `- \`${skill.id}\`${about ? `: ${about}` : ''} (${where})`;
        });
        parts.push([
            '## Skills for every task',
            '',
            'Use these skills on this task. Load each one with your skill tool before you start, or read its SKILL.md at the path shown.',
            '',
            ...lines,
        ].join('\n'));
    }
    // Always include self-review for workers (not for reviewers or the assistant)
    if (selfReview) {
        parts.push(selfReview);
    }
    return parts.join('\n\n');
}
