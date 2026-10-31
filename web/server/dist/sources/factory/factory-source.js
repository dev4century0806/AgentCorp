import { resolveRepo } from '../../config.js';
import { buildBrief } from './brief.js';
import { McpClient } from '../mcp-client.js';
import { hostOf } from '../fetch-error.js';
import { factoryRedirectUri } from './connect.js';
import { parseCurrentUser, parseFirstUserEmail, parseWorkOrderDetail, parseWorkOrderList, ticketNumber, workOrderUrl, } from './work-orders.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caps a project-wide read at 1,000 work orders per poll. */
const MAX_PAGES = 10;
/**
 * 8090 Software Factory, reached through its MCP server.
 *
 * Writes only ever happen from an explicit click by Operator, so every mutating
 * method here is called from a REST handler and never from the poller.
 */
export class FactoryWorkSource {
    cfg;
    id = '8090';
    name = '8090 Software Factory';
    mcp;
    cachedUser = null;
    constructor(cfg) {
        this.cfg = cfg;
        this.mcp = new McpClient({
            url: cfg.factory.mcpUrl,
            headers: cfg.factory.headers,
            redirectUri: factoryRedirectUri(cfg),
            bearerToken: process.env.AGENT_CORP_FACTORY_TOKEN,
        });
    }
    /** 8090 scopes every web URL under a project, carried as an MCP header. */
    projectId() {
        const headers = this.cfg.factory.headers;
        const key = Object.keys(headers).find((k) => k.toLowerCase() === 'x-sofa-mcp-project-id');
        return key ? (headers[key] ?? null) : null;
    }
    host() {
        return hostOf(this.cfg.factory.mcpUrl);
    }
    async healthCheck() {
        const tools = await this.mcp.listToolNames();
        for (const required of ['list_items', 'read_item', 'edit_item']) {
            if (!tools.includes(required)) {
                throw new Error(`The 8090 MCP server is missing the ${required} tool; this build needs it.`);
            }
        }
    }
    async currentUser() {
        if (this.cachedUser)
            return this.cachedUser;
        const text = await this.mcp.callText('list_users', {});
        this.cachedUser = parseCurrentUser(text);
        return this.cachedUser;
    }
    /** `list_items` filters by member email or user id, not display name. */
    async resolveAssignee(configured) {
        if (configured.includes('@') || UUID.test(configured))
            return configured;
        const text = await this.mcp.callText('list_users', { name_or_email: configured, page_size: 1 });
        return parseFirstUserEmail(text);
    }
    /**
     * A configured assignee is filtered server-side. Otherwise the list is mine
     * plus unassigned work orders: `list_items` has no "unassigned" filter, so
     * this reads the whole project and drops anything assigned to someone else.
     */
    async list() {
        const { filter } = this.cfg.factory;
        const configured = filter.assignee?.trim();
        const args = { entity_type: 'work_order' };
        if (configured)
            args['assignee'] = await this.resolveAssignee(configured);
        if (filter.statuses.length)
            args['status'] = filter.statuses;
        if (filter.phase)
            args['phase_number'] = [Number(filter.phase)];
        const fetchedAt = new Date().toISOString();
        let tickets;
        if (configured) {
            const pageSize = Math.min(Math.max(filter.limit, 1), 100);
            const text = await this.mcp.callText('list_items', { ...args, page_size: pageSize, page: 1 });
            tickets = parseWorkOrderList(text, fetchedAt).tickets;
        }
        else {
            const me = (await this.currentUser())?.name ?? null;
            const all = await this.listAllPages(args, fetchedAt);
            const mine = all.filter((t) => me !== null && t.assignees.includes(me));
            const unassigned = all.filter((t) => t.assignees.length === 0);
            for (const t of mine)
                t.assignedToMe = true;
            for (const t of unassigned)
                t.assignedToMe = false;
            tickets = [...mine, ...unassigned].slice(0, Math.max(filter.limit, 1));
        }
        const repo = resolveRepo(this.cfg, filter.project);
        for (const t of tickets) {
            t.repo = repo?.path ?? null;
            t.url = workOrderUrl(this.cfg.factory.webBaseUrl, this.projectId(), t.key);
        }
        return tickets;
    }
    async listAllPages(args, fetchedAt) {
        const tickets = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
            const text = await this.mcp.callText('list_items', { ...args, page_size: 100, page });
            const result = parseWorkOrderList(text, fetchedAt);
            tickets.push(...result.tickets);
            if (!result.tickets.length || tickets.length >= result.total)
                break;
        }
        return tickets;
    }
    async get(key) {
        const text = await this.mcp.callText('read_item', { entity_type: 'work_order', id: ticketNumber(key) });
        const detail = parseWorkOrderDetail(text, new Date().toISOString());
        detail.ticket.repo = resolveRepo(this.cfg, this.cfg.factory.filter.project)?.path ?? null;
        detail.ticket.url = workOrderUrl(this.cfg.factory.webBaseUrl, this.projectId(), key);
        return detail;
    }
    brief(detail, ctx) {
        return buildBrief(this.cfg, { detail, ...ctx });
    }
    async markInProgress(key) {
        await this.mcp.callText('edit_item', {
            entity_type: 'work_order',
            id: ticketNumber(key),
            status: 'in_progress',
        });
    }
    /**
     * 8090 rejects `link_pull_request_url` combined with any other field, so the
     * PR link, the summary comment, and the status move are three calls.
     */
    async markDone(key, opts) {
        const id = ticketNumber(key);
        if (opts.prUrl) {
            await this.mcp.callText('edit_item', {
                entity_type: 'work_order',
                id,
                link_pull_request_url: opts.prUrl,
            });
        }
        if (opts.summary) {
            await this.mcp.callText('add_comment', {
                entity_type: 'work_order',
                entity_id: String(id),
                message: opts.summary,
            });
        }
        await this.mcp.callText('edit_item', { entity_type: 'work_order', id, status: 'in_review' });
    }
    workerTools() {
        return this.cfg.factory.enabled ? this.mcp : null;
    }
    async close() {
        await this.mcp.close();
    }
    async reset() {
        this.cachedUser = null;
        await this.mcp.close();
    }
    /** Exposed so the auth CLI and health check can reuse the same connection. */
    get client() {
        return this.mcp;
    }
}
