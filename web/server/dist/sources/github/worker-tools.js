const TOOLS = [
    {
        name: 'github_create_issue',
        description: 'Create a new GitHub issue in a repository.',
        inputSchema: {
            type: 'object',
            properties: {
                repo: { type: 'string', description: 'Repository in owner/repo format (e.g. acme/app)' },
                title: { type: 'string', description: 'Issue title' },
                body: { type: 'string', description: 'Issue description/body' },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Labels to add (only existing labels are applied)',
                },
            },
            required: ['repo', 'title'],
        },
    },
    {
        name: 'github_get_issue',
        description: 'Get details of a GitHub issue including comments and linked pull requests.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Issue key in owner/repo#number format (e.g. acme/app#12)' },
            },
            required: ['key'],
        },
    },
    {
        name: 'github_list_issues',
        description: 'List open GitHub issues assigned to the connected user.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'github_search_repos',
        description: 'Search for GitHub repositories the user has access to.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query to filter repositories' },
            },
        },
    },
];
/**
 * Worker tool provider for GitHub, exposing issue management through MCP tools.
 * This allows workers to create and read GitHub issues without needing the `gh` CLI.
 */
export class GitHubWorkerTools {
    source;
    constructor(source) {
        this.source = source;
    }
    async listTools() {
        return TOOLS;
    }
    async callTool(name, args) {
        try {
            switch (name) {
                case 'github_create_issue':
                    return await this.createIssue(args);
                case 'github_get_issue':
                    return await this.getIssue(args);
                case 'github_list_issues':
                    return await this.listIssues();
                case 'github_search_repos':
                    return await this.searchRepos(args);
                default:
                    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
            }
        }
        catch (err) {
            return { content: [{ type: 'text', text: err.message }], isError: true };
        }
    }
    async createIssue(args) {
        const repo = typeof args.repo === 'string' ? args.repo : '';
        const title = typeof args.title === 'string' ? args.title : '';
        const body = typeof args.body === 'string' ? args.body : '';
        const labels = Array.isArray(args.labels) ? args.labels.filter((l) => typeof l === 'string') : [];
        if (!repo)
            return { content: [{ type: 'text', text: 'repo is required' }], isError: true };
        if (!title)
            return { content: [{ type: 'text', text: 'title is required' }], isError: true };
        const result = await this.source.createIssue({
            project: repo,
            issueType: 'Issue',
            summary: title,
            description: body,
            labels,
            priority: null,
        });
        return {
            content: [{ type: 'text', text: JSON.stringify({ key: result.key, url: result.url }) }],
        };
    }
    async getIssue(args) {
        const key = typeof args.key === 'string' ? args.key : '';
        if (!key)
            return { content: [{ type: 'text', text: 'key is required' }], isError: true };
        const detail = await this.source.get(key);
        const result = {
            key: detail.ticket.key,
            summary: detail.ticket.summary,
            description: detail.ticket.description,
            status: detail.ticket.status,
            url: detail.ticket.url,
            assignees: detail.ticket.assignees,
            body: detail.body,
            pullRequestUrls: detail.pullRequestUrls,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    async listIssues() {
        const tickets = await this.source.list();
        const result = tickets.map((t) => ({
            key: t.key,
            summary: t.summary,
            status: t.status,
            url: t.url,
            assignees: t.assignees,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    async searchRepos(args) {
        const query = typeof args.query === 'string' ? args.query : '';
        const repos = await this.source.searchProjects(query);
        return { content: [{ type: 'text', text: JSON.stringify(repos) }] };
    }
}
