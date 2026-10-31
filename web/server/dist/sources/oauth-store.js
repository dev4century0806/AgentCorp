import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authDir } from '../config.js';
/**
 * File-backed OAuth storage for the 8090 MCP server.
 *
 * 8090's MCP endpoint authenticates with OAuth and dynamic client
 * registration, which means this app has to run its own flow rather than
 * borrow Cursor's. Tokens live in the signed-in user's auth folder with 0600
 * permissions, one directory per server URL, and never in SQLite, logs, or
 * the browser.
 *
 * `redirectToAuthorization` is deliberately inert here: the headless server
 * must never try to open a browser mid-poll. The interactive subclass in
 * auth-cli.ts is what actually completes a first-time login.
 */
export class FileOAuthProvider {
    redirectUri;
    slug;
    constructor(serverUrl, redirectUri) {
        this.redirectUri = redirectUri;
        // One directory per server so switching endpoints can't mix credentials.
        this.slug = createHash('sha256').update(serverUrl).digest('hex').slice(0, 16);
    }
    /** Looked up each time, so a provider made before a user switch reads the new user's tokens. */
    get dir() {
        const dir = join(authDir(), this.slug);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        return dir;
    }
    get redirectUrl() {
        return this.redirectUri;
    }
    get clientMetadata() {
        return {
            client_name: 'AgentCorp (local)',
            redirect_uris: [this.redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        };
    }
    state() {
        const state = randomUUID();
        this.write('state.txt', state);
        return state;
    }
    clientInformation() {
        return this.read('client.json');
    }
    saveClientInformation(info) {
        this.write('client.json', JSON.stringify(info));
    }
    tokens() {
        return this.read('tokens.json');
    }
    saveTokens(tokens) {
        this.write('tokens.json', JSON.stringify(tokens));
    }
    saveCodeVerifier(verifier) {
        this.write('verifier.txt', verifier);
    }
    codeVerifier() {
        const v = this.readRaw('verifier.txt');
        if (!v)
            throw new Error('No PKCE code verifier saved. Click Connect in Settings to sign in again.');
        return v;
    }
    redirectToAuthorization(url) {
        // Subclassed by the interactive CLI. Here it only records where a human
        // would have to go, so the UI can tell Operator to run the login command.
        this.write('pending-authorization-url.txt', url.toString());
    }
    invalidateCredentials(scope) {
        const files = {
            all: ['client.json', 'tokens.json', 'verifier.txt', 'discovery.json', 'state.txt'],
            client: ['client.json'],
            tokens: ['tokens.json'],
            verifier: ['verifier.txt'],
            discovery: ['discovery.json'],
        };
        for (const f of files[scope] ?? [])
            rmSync(join(this.dir, f), { force: true });
    }
    /** Cached discovery keeps the 90-second poll from re-walking OAuth metadata. */
    discoveryState() {
        return this.read('discovery.json');
    }
    saveDiscoveryState(state) {
        this.write('discovery.json', JSON.stringify(state));
    }
    /** True once a token has been stored, i.e. a login has happened at least once. */
    hasTokens() {
        return existsSync(join(this.dir, 'tokens.json'));
    }
    savedState() {
        return this.readRaw('state.txt');
    }
    pendingAuthorizationUrl() {
        return this.readRaw('pending-authorization-url.txt');
    }
    write(name, value) {
        writeFileSync(join(this.dir, name), value, { encoding: 'utf8', mode: 0o600 });
    }
    readRaw(name) {
        const p = join(this.dir, name);
        if (!existsSync(p))
            return null;
        return readFileSync(p, 'utf8').trim() || null;
    }
    read(name) {
        const raw = this.readRaw(name);
        if (!raw)
            return undefined;
        try {
            return JSON.parse(raw);
        }
        catch {
            // Corrupt credential file: treat as absent so re-auth can fix it.
            return undefined;
        }
    }
}
