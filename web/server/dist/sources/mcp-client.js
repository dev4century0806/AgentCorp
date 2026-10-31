import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { FileOAuthProvider } from './oauth-store.js';
export class NeedsLoginError extends Error {
    authorizationUrl;
    constructor(authorizationUrl, message = '8090 is not connected. Connect it in Settings.') {
        super(message);
        this.authorizationUrl = authorizationUrl;
        this.name = 'NeedsLoginError';
    }
}
/**
 * Thin MCP client over 8090's streamable HTTP endpoint.
 *
 * Every tool on that server answers with human-readable text rather than
 * structured JSON, so callers get the raw text back and the parsers in
 * work-source.ts turn it into tickets.
 */
export class McpClient {
    opts;
    client = null;
    transport = null;
    connecting = null;
    auth;
    constructor(opts) {
        this.opts = opts;
        this.auth = opts.bearerToken ? null : new FileOAuthProvider(opts.url, opts.redirectUri);
    }
    get isConnected() {
        return this.client !== null;
    }
    async connect() {
        if (this.client)
            return;
        // Collapse concurrent callers (startup check racing the first poll) onto
        // one handshake; a second transport would start a second OAuth flow.
        this.connecting ??= this.doConnect().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }
    async doConnect() {
        // With no tokens yet, a handshake would start a fresh OAuth flow and
        // overwrite the state and verifier of a sign-in the user is midway through.
        if (this.auth && !this.auth.hasTokens())
            throw this.needsLogin();
        const headers = { ...this.opts.headers };
        if (this.opts.bearerToken)
            headers['Authorization'] = `Bearer ${this.opts.bearerToken}`;
        const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), {
            ...(this.auth ? { authProvider: this.auth } : {}),
            requestInit: { headers },
        });
        const client = new Client({ name: 'agent-corp', version: '0.1.0' }, { capabilities: {} });
        try {
            await client.connect(transport);
        }
        catch (err) {
            await transport.close().catch(() => { });
            if (err instanceof UnauthorizedError) {
                throw this.needsLogin();
            }
            throw err;
        }
        this.client = client;
        this.transport = transport;
    }
    async callTool(name, args) {
        await this.connect();
        if (!this.client)
            throw new Error('MCP client is not connected');
        try {
            return (await this.client.callTool({ name, arguments: args }));
        }
        catch (err) {
            if (err instanceof UnauthorizedError) {
                // The session expired. Drop it so the next call re-handshakes.
                await this.close();
                throw this.needsLogin();
            }
            throw err;
        }
    }
    /** Calls a tool and flattens its text content into one string. */
    async callText(name, args) {
        const result = await this.callTool(name, args);
        const content = Array.isArray(result.content) ? result.content : [];
        const text = content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
        if (result.isError) {
            throw new Error(`${this.opts.label ?? '8090'} tool ${name} failed: ${text || 'unknown error'}`);
        }
        return text;
    }
    needsLogin() {
        const url = this.auth?.pendingAuthorizationUrl() ?? null;
        return this.opts.label ? new NeedsLoginError(url, `Not signed in to ${this.opts.label}.`) : new NeedsLoginError(url);
    }
    async listTools() {
        await this.connect();
        if (!this.client)
            throw new Error('MCP client is not connected');
        return (await this.client.listTools()).tools;
    }
    async listToolNames() {
        return (await this.listTools()).map((t) => t.name);
    }
    async close() {
        const t = this.transport;
        this.client = null;
        this.transport = null;
        if (t)
            await t.close().catch(() => { });
    }
}
