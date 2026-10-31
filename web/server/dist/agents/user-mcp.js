/**
 * Starts Operator's own MCP servers for workers and calls them on their behalf.
 *
 * Each worker gets its own connection to each server that is on, started in
 * its folder as the tool that configured it would. A worker's runner reaches
 * it through the office's MCP endpoint, so every runner gets the same servers
 * and none of them sees the config or its secrets. A connection left unused
 * for a while is closed, and opens again on the next call.
 */
import { homedir } from 'node:os';
import { basename, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpFingerprint, scrubSecrets } from '../skills/mcp.js';
const START_TIMEOUT_MS = 45_000;
/** A call can be a long database query; the MCP default of a minute is too short for one. */
const CALL_TIMEOUT_MS = 10 * 60_000;
const IDLE_MS = 10 * 60_000;
/**
 * A value from a config with its references filled in, in the forms the
 * tools write them: `${VAR}` and `${VAR:-default}` (Claude Code),
 * `${env:VAR}`, `${userHome}` and `${workspaceFolder}` (Cursor).
 */
export function expandValue(value, cwd) {
    return value.replace(/\$\{([^}]+)\}/g, (whole, inner) => {
        if (inner === 'userHome')
            return process.env.HOME || homedir();
        if (inner === 'workspaceFolder' || inner === 'CLAUDE_PROJECT_DIR')
            return cwd;
        if (inner === 'workspaceFolderBasename')
            return basename(cwd);
        if (inner === 'pathSeparator' || inner === '/')
            return sep;
        const fromEnv = /^env:(.+)$/.exec(inner)?.[1];
        const [name, fallback] = fromEnv ? [fromEnv, undefined] : inner.split(':-', 2);
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
            return whole;
        return process.env[name] ?? fallback ?? '';
    });
}
const expandAll = (values, cwd) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, expandValue(v, cwd)]));
/** The office's own environment, which a stdio server inherits as it would from the tool. */
function inheritedEnv() {
    const env = {};
    for (const [k, v] of Object.entries(process.env))
        if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE')
            env[k] = v;
    return env;
}
function transportFor(server, cwd, stderr) {
    if (server.transport === 'stdio') {
        const transport = new StdioClientTransport({
            command: expandValue(server.command, cwd),
            args: server.args.map((a) => expandValue(a, cwd)),
            env: { ...inheritedEnv(), ...expandAll(server.env, cwd) },
            cwd: server.cwd ? expandValue(server.cwd, cwd) : cwd,
            stderr: 'pipe',
        });
        transport.stderr?.on('data', (chunk) => {
            stderr.push(chunk.toString('utf8'));
            if (stderr.length > 20)
                stderr.shift();
        });
        return transport;
    }
    const url = new URL(expandValue(server.url, cwd));
    const requestInit = { headers: expandAll(server.headers, cwd) };
    return server.transport === 'sse' ? new SSEClientTransport(url, { requestInit }) : new StreamableHTTPClientTransport(url, { requestInit });
}
async function connect(server, cwd) {
    const stderr = [];
    const client = new Client({ name: 'agent-corp', version: '0.1.0' }, { capabilities: {} });
    let timer;
    try {
        const transport = transportFor(server, cwd, stderr);
        await Promise.race([
            client.connect(transport),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`It did not answer within ${START_TIMEOUT_MS / 1000} seconds.`)), START_TIMEOUT_MS);
            }),
        ]);
    }
    catch (err) {
        await client.close().catch(() => { });
        const said = stderr.join('').trim().split('\n').slice(-3).join(' ').slice(0, 300);
        throw new Error(scrubSecrets(`${err.message}${said ? ` (${said})` : ''}`, server));
    }
    finally {
        clearTimeout(timer);
    }
    return { client, fingerprint: mcpFingerprint(server), idle: null };
}
/** Operator's servers, open per worker. */
export class UserMcpPool {
    idleMs;
    open = new Map();
    constructor(idleMs = IDLE_MS) {
        this.idleMs = idleMs;
    }
    id(agentId, key) {
        return `${agentId}\n${key}`;
    }
    /**
     * The worker's connection to a server, started in `cwd` if it has none or
     * its config changed since. Throws why it could not start, secrets masked.
     */
    async start(agentId, server, cwd) {
        const id = this.id(agentId, server.key);
        const existing = this.open.get(id);
        if (existing) {
            const open = await existing.catch(() => null);
            if (open && open.fingerprint === mcpFingerprint(server) && this.open.get(id) === existing) {
                this.touch(id, open);
                return open.client;
            }
            if (this.open.get(id) === existing)
                await this.close(id);
        }
        const pending = connect(server, cwd);
        this.open.set(id, pending);
        try {
            const open = await pending;
            open.client.onclose = () => {
                if (this.open.get(id) !== pending)
                    return;
                this.open.delete(id);
                if (open.idle)
                    clearTimeout(open.idle);
            };
            this.touch(id, open);
            return open.client;
        }
        catch (err) {
            if (this.open.get(id) === pending)
                this.open.delete(id);
            throw err;
        }
    }
    touch(id, open) {
        if (open.idle)
            clearTimeout(open.idle);
        open.idle = setTimeout(() => void this.close(id), this.idleMs);
        open.idle.unref();
    }
    async listTools(agentId, server, cwd) {
        const client = await this.start(agentId, server, cwd);
        const tools = [];
        let cursor;
        do {
            const page = await client.listTools(cursor ? { cursor } : undefined);
            tools.push(...page.tools);
            cursor = page.nextCursor;
        } while (cursor);
        return tools;
    }
    async callTool(agentId, server, cwd, name, args) {
        const client = await this.start(agentId, server, cwd);
        return (await client.callTool({ name, arguments: args }, undefined, {
            timeout: CALL_TIMEOUT_MS,
            resetTimeoutOnProgress: true,
        }));
    }
    async close(id) {
        const pending = this.open.get(id);
        if (!pending)
            return;
        this.open.delete(id);
        const open = await pending.catch(() => null);
        if (!open)
            return;
        if (open.idle)
            clearTimeout(open.idle);
        await open.client.close().catch(() => { });
    }
    /** Closes a worker's servers, as when it is fired. */
    async release(agentId) {
        await Promise.all([...this.open.keys()].filter((id) => id.startsWith(`${agentId}\n`)).map((id) => this.close(id)));
    }
    async closeAll() {
        await Promise.all([...this.open.keys()].map((id) => this.close(id)));
    }
    /** How many connections are open, for tests. */
    get size() {
        return this.open.size;
    }
}
