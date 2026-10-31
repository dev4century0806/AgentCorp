import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { FileOAuthProvider } from './oauth-store.js';
function transportFor(target, auth) {
    return new StreamableHTTPClientTransport(new URL(target.mcpUrl), {
        authProvider: auth,
        requestInit: { headers: target.headers ?? {} },
    });
}
export function oauthProvider(target) {
    return new FileOAuthProvider(target.mcpUrl, target.redirectUri);
}
export async function startConnect(target) {
    const auth = oauthProvider(target);
    auth.invalidateCredentials('all');
    const transport = transportFor(target, auth);
    const client = new Client({ name: 'agent-corp', version: '0.1.0' }, { capabilities: {} });
    try {
        await client.connect(transport);
        return { url: null };
    }
    catch (err) {
        if (!(err instanceof UnauthorizedError))
            throw err;
        const url = auth.pendingAuthorizationUrl();
        if (!url)
            throw new Error(`${target.service} did not return a sign-in page.`);
        return { url };
    }
    finally {
        await transport.close().catch(() => { });
    }
}
export async function finishConnect(target, code, state) {
    const auth = oauthProvider(target);
    if (!state || state !== auth.savedState()) {
        throw new Error(`This sign-in link is stale or was not started here. Click Connect ${target.service} again.`);
    }
    const transport = transportFor(target, auth);
    await transport.finishAuth(code);
    await transport.close().catch(() => { });
}
