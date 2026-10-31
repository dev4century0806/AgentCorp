import { trackerName } from '../protocol.js';
import { alsoReading, houseRules, nextStep, whereYouAre } from '../sources/work-source.js';
/**
 * House rules for a worker sent to find something out.
 *
 * A repo-less researcher is deliberately allowed to read outside its own
 * directory, because a survey of Operator's checkouts is exactly the sort of thing
 * he would ask for and it cannot be done from inside an empty folder. Reading
 * is the whole of the licence: writing stays fenced to the notes folder, and
 * every shell command still goes through the permission prompt, so nothing
 * happens off that path without Operator clicking Approve.
 */
function researchRules(cfg, notesPath, repoPath, extraRepos) {
    const rules = [
        repoPath
            ? `Read anything you need in ${andList([repoPath, ...extraRepos])}. Do not change a single file.`
            : 'Read anything you need to answer the question, wherever it lives on this machine.',
        `Write nothing anywhere except ${notesPath} — not even a fix you are certain about.`,
        'Do not commit, push, or open a pull request. Nothing here is meant to ship.',
        'Do not install anything.',
    ];
    // The QUESTION: convention is how the office knows to raise a worker's
    // hand, so it survives whatever else the config says.
    const asking = cfg.agents.standingInstructions.find((s) => s.includes('QUESTION:'));
    if (asking)
        rules.push(asking);
    return rules;
}
/** A researcher hired with Discuss settles the question with Operator before it reads a line. */
const RESEARCH_DISCUSS = [
    'Operator wants to talk this through before you start looking. Read nothing yet.',
    '- Tell Operator how you read the question in a few sentences.',
    '- Then ask what you would want settled first: scope, where to look, and what a useful answer',
    '  looks like. Ask; do not guess. Start digging only once Operator tells you to go.',
].join('\n');
/** "a", "a and b", "a, b and c". */
export function andList(items) {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');
}
/**
 * Builds the first message for a worker hired on a free-form job rather than
 * an 8090 work order.
 *
 * Deliberately does not invent scope. A work order arrives with Summary, In
 * Scope and a Definition of Done; a one-line request from Operator does not, so the
 * agent is told to come back with a plan and to ask when the request is
 * ambiguous instead of guessing.
 *
 * A research job is told the opposite of the usual instinct: find the answer
 * and leave the code alone. Fixing what it trips over would turn a question
 * into an unreviewed change nobody asked for.
 */
export function buildAskBrief(cfg, input) {
    const { task, key, kind, branch, baseBranch, worktreePath, repoPath } = input;
    const research = kind === 'research';
    // A worker with a branch has a worktree of its own, and its runner no longer opens these.
    const extraRepos = repoPath && baseBranch && !branch ? (input.extraRepos ?? []) : [];
    const repo = repoPath && baseBranch
        ? { branch, baseBranch, worktreePath, repoPath, extraRepos, discuss: input.discuss, job: 'request' }
        : null;
    const parts = [];
    parts.push(research ? 'Operator wants you to look into this:' : 'Operator has asked you to do this:', '', task.trim(), '', '## Where you are');
    if (repo && research) {
        parts.push(`- Notes folder: ${worktreePath} (this is your working directory)`, `- Repo: ${repoPath}, read only. It is Operator's own checkout, on whatever branch he has out.`, ...alsoReading(extraRepos));
    }
    else if (repo) {
        parts.push(...whereYouAre(repo));
    }
    else {
        parts.push(`- Working directory: ${worktreePath}`, '- There is no repo and no branch on this job. The directory above is a', '  scratch folder that exists only for your notes.');
    }
    parts.push(`- This is an ad-hoc job (${key}), not a ticket the office hired you for, so`, '  nothing was read for you and no acceptance criteria are written down. If Operator', `  points you at a ${trackerName(cfg.tracker)} issue or 8090 work order, read it with the \`mcp__${cfg.tracker}__*\``, '  or `mcp__8090__*` tools, not a claude.ai connector, which is not signed in.', '', '## How to treat it');
    if (research) {
        parts.push('- This is research. Answer the question; do not change code to fix what you find.', '- Read whatever you need, and quote file paths and line numbers so Operator can check you.', '- Say plainly where you are unsure, and what you would need in order to be sure.', `- Write your findings to NOTES.md in ${worktreePath} as well as telling me here,`, '  so they outlive this conversation.');
    }
    else {
        parts.push('- The request above is all the scope there is. Do not widen it.', '- If it is ambiguous enough that you could do the wrong thing, ask before you start.', 
        // The house rules below talk about opening a PR, because they were
        // written for work orders. Without this an agent asked a question
        // stops to check whether it is also meant to ship something.
        '- Answer here. Only commit and open a PR if the request was for a code change.');
    }
    // The standing instructions are written for someone shipping a change, and
    // half of them contradict a research job: "work only inside this worktree"
    // forbids reading the very code it was sent to look at, and two of them ask
    // for a PR that cannot exist. Research gets rules that match the job.
    const rules = research ? researchRules(cfg, worktreePath, repoPath, extraRepos) : houseRules(cfg);
    if (rules.length) {
        parts.push('', '## House rules', ...rules.map((s) => `- ${s}`));
    }
    parts.push('', research
        ? input.discuss
            ? RESEARCH_DISCUSS
            : 'Start by telling me how you plan to find out, in two or three sentences.'
        : repo
            ? nextStep(repo)
            : 'Start by reading the relevant code and telling me your plan in two or three sentences.');
    return parts.join('\n');
}
