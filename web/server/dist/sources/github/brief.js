import { houseRules, nextStep, whereYouAre } from '../work-source.js';
import { parseIssueKey } from './keys.js';
export function buildGitHubBrief(cfg, input) {
    const { detail, note } = input;
    const { ticket } = detail;
    const issue = parseIssueKey(ticket.key);
    const facts = [ticket.type, ticket.status && `status ${ticket.status}`].filter(Boolean).join(', ');
    const parts = [
        `You are picking up GitHub issue ${ticket.key}: ${ticket.summary}`,
        '',
        '## Where you are',
        ...whereYouAre(input),
        `- Issue: ${ticket.key}${facts ? ` (${facts})` : ''}${ticket.url ? `, ${ticket.url}` : ''}`,
        ...(issue
            ? [
                `- GitHub: the issue is below; for more, \`gh issue view ${issue.number} --repo ${issue.repo} --comments\` if the \`gh\` CLI is signed in`,
                `- Put \`Fixes ${ticket.key}\` in the PR description, so merging the PR closes the issue`,
            ]
            : []),
        ...(detail.pullRequestUrls.length ? [`- Already linked: ${detail.pullRequestUrls.join(', ')}`] : []),
        '',
        '## The issue, as GitHub has it',
        '',
        detail.body ||
            'The issue has no description or comments. Ask Operator what done looks like before you change anything.',
    ];
    if (note?.trim())
        parts.push('', '## Note from Operator', note.trim());
    const rules = houseRules(cfg);
    if (rules.length) {
        parts.push('', '## House rules', ...rules.map((s) => `- ${s}`));
    }
    parts.push('', nextStep(input));
    return parts.join('\n');
}
