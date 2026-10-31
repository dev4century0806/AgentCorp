import { houseRules, nextStep, whereYouAre } from '../work-source.js';
/**
 * Builds the agent's first message.
 *
 * 8090 already renders a work order as markdown with Summary, In Scope, Out of
 * Scope, and a Definition of Done, so the brief passes that through verbatim
 * instead of re-summarising it and losing detail. Around it go the facts the
 * agent cannot see from inside its worktree: which branch it is on, where it
 * is, and the standing instructions.
 */
export function buildBrief(cfg, input) {
    const { detail, note } = input;
    const { ticket } = detail;
    const parts = [];
    parts.push(`You are picking up ${ticket.key}: ${ticket.summary}`, '', '## Where you are', ...whereYouAre(input), `- Work order: ${ticket.key}${ticket.type ? ` (${ticket.type})` : ''}${ticket.phase ? `, phase ${ticket.phase}` : ''}`);
    if (detail.pullRequestUrls.length) {
        parts.push(`- Already linked on this work order: ${detail.pullRequestUrls.join(', ')}`, '  Check whether that PR already covers the work before starting over.');
    }
    if (detail.body) {
        parts.push('', '## The work order, as 8090 has it', '', detail.body);
    }
    else {
        parts.push('', '## The work order', '', 'The description came back empty. Use the 8090 MCP tools to read the work order and its linked blueprint before you start.');
    }
    if (cfg.agents.registerFactoryMcp) {
        parts.push('', '## Pulling more context', 'The 8090 Software Factory MCP server is configured in this worktree. Use it to read the', 'linked blueprint, requirements, and related work orders when you need more than the text above.', `Use read_item with entity_type "work_order" and id ${numberOrKey(ticket.key)} for the live version of this ticket.`);
    }
    if (note?.trim()) {
        parts.push('', '## Note from Operator', note.trim());
    }
    const rules = houseRules(cfg);
    if (rules.length) {
        parts.push('', '## House rules', ...rules.map((s) => `- ${s}`));
    }
    parts.push('', nextStep(input));
    return parts.join('\n');
}
function numberOrKey(key) {
    const m = /(\d+)\s*$/.exec(key);
    return m?.[1] ?? key;
}
/**
 * Written into the worktree so agents can reach 8090 themselves.
 * Mirrors the user-level config, minus any credential.
 */
export function factoryMcpConfig(cfg) {
    return JSON.stringify({
        mcpServers: {
            'software-factory': {
                type: 'http',
                url: cfg.factory.mcpUrl,
                headers: cfg.factory.headers,
            },
        },
    }, null, 2) + '\n';
}
