import { PR_FOOTER } from '../config.js';
import { splitTicketId } from '../protocol.js';
export const START_WORK = 'START_WORK:';
/** The standing instructions, plus the PR footer rule while it is on. */
export function houseRules(cfg) {
    const rules = [...cfg.agents.standingInstructions];
    if (cfg.agents.prFooter !== false)
        rules.push(`End the PR description with the line \`${PR_FOOTER}\`.`);
    return rules;
}
export function whereYouAre(ctx) {
    if (ctx.branch) {
        return [
            `- Worktree: ${ctx.worktreePath} (this is your working directory)`,
            `- Branch: ${ctx.branch}, based on ${ctx.baseBranch}`,
        ];
    }
    return [
        `- Notes folder: ${ctx.worktreePath} (this is your working directory)`,
        `- Repo: ${ctx.repoPath}, read only. It is Operator's own checkout, on whatever branch he has out,`,
        '  so do not change, commit or check out anything in it.',
        ...alsoReading(ctx.extraRepos ?? []),
        '- No worktree yet. You get one once Operator approves your plan, and the house rules about the',
        '  worktree apply from then on.',
    ];
}
/** A line for each repo read beside the worker's own. */
export function alsoReading(extraRepos) {
    return extraRepos.map((r) => `- Also: ${r}, read only, another of Operator's checkouts.`);
}
export function nextStep(ctx) {
    if (ctx.branch)
        return 'Start by reading the relevant code and telling me your plan in two or three sentences.';
    if (ctx.discuss)
        return discussStep(ctx);
    return [
        'Start by reading the ticket and the code it touches. Change nothing yet.',
        '- If no code change is needed, answer here.',
        `- If code has to change, end your turn with a line starting ${START_WORK} followed by your plan:`,
        '  what you will change, in which files, and how you will verify it. Once Operator approves it you',
        `  get a worktree on a new branch off ${ctx.baseBranch}.`,
        '- If the work belongs in a worktree or branch that already exists, add `WORKTREE: <full path or branch>`',
        "  to your plan and you'll be put there instead of on a new branch.",
    ].join('\n');
}
/**
 * Operator hired this worker to talk the job through first, so the brief holds
 * back the plan: questions now, START_WORK only once he says go.
 */
function discussStep(ctx) {
    const job = ctx.job ?? 'ticket';
    return [
        `Operator wants to discuss this ${job} with you before any work starts.`,
        `Start by reading the ${job} and the code it touches. Change nothing yet.`,
        `- Tell Operator how you read the ${job} in a few sentences: what it asks for, and what it touches.`,
        '- Then ask the questions you would want answered before starting: scope, approach, edge cases,',
        `  anything the ${job} leaves open. Ask them; do not guess the answers. Keep asking while there`,
        '  are things worth settling.',
        `- Do not write ${START_WORK} until Operator tells you to go. Then end your turn with a line starting`,
        `  ${START_WORK} followed by your plan: what you will change, in which files, and how you will`,
        `  verify it. Once Operator approves it you get a worktree on a new branch off ${ctx.baseBranch}.`,
        '- If the work belongs in a worktree or branch that already exists, add `WORKTREE: <full path or branch>`',
        "  to your plan and you'll be put there instead of on a new branch.",
    ].join('\n');
}
/** Finds the first PR URL in a blob of agent output. */
export function findPullRequestUrl(text) {
    const m = text.match(/https?:\/\/(?:www\.)?(?:github|gitlab)\.com\/[^\s"')]+\/(?:pull|merge_requests)\/\d+/);
    return m?.[0] ?? null;
}
export class WorkSources {
    byId = new Map();
    constructor(sources) {
        for (const s of sources)
            this.byId.set(s.id, s);
    }
    all() {
        return [...this.byId.values()];
    }
    workerTools(id) {
        return this.byId.get(id)?.workerTools() ?? null;
    }
    resolve(id) {
        const parts = splitTicketId(id);
        const source = parts ? this.byId.get(parts.source) : undefined;
        if (!parts || !source)
            throw new Error(`${id} does not belong to a connected ticket source.`);
        return { source, key: parts.key };
    }
    async close() {
        await Promise.all(this.all().map((s) => s.close().catch(() => { })));
    }
}
