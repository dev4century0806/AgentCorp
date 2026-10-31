import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authDir } from '../../config.js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../protocol.js';
export const GITHUB_LOGIN_HINT = 'GitHub is not connected. Connect it in Settings.';
/** Private repos' issues need `repo`: GitHub has no narrower OAuth scope for issues. */
const SCOPES = 'repo';
/** How long a sign-in started in Settings may wait for GitHub to send the browser back. */
const PENDING_MS = 15 * 60_000;
export function githubRedirectUri(cfg) {
    return `http://127.0.0.1:${cfg.port}/auth/github/callback`;
}
/**
 * AgentCorp's own GitHub OAuth app. Connect opens GitHub's consent
 * page; GitHub sends the browser back to the local server, which turns the
 * code into a token through the `github-oauth` Edge Function, where the
 * client secret lives. The token is kept in the user's auth folder with 0600
 * permissions, like Jira's, and OAuth app tokens do not expire.
 */
export class GitHubAuth {
    cfg;
    /**
     * Sign-ins waiting on GitHub, by state. Several at once: a second tab or a
     * second click must not make the first one's return stale.
     */
    pending = new Map();
    fetchFn;
    fixedDir;
    constructor(cfg, deps = {}) {
        this.cfg = cfg;
        this.fetchFn = deps.fetch ?? fetch;
        this.fixedDir = deps.dir;
    }
    /** Looked up each time, so a user switch reads the new user's token. */
    get dir() {
        return this.fixedDir ?? join(authDir(), 'github');
    }
    token() {
        const path = join(this.dir, 'token.json');
        if (!existsSync(path))
            return null;
        try {
            const saved = JSON.parse(readFileSync(path, 'utf8'));
            return typeof saved.accessToken === 'string' && saved.accessToken ? saved.accessToken : null;
        }
        catch {
            return null;
        }
    }
    hasToken() {
        return this.token() !== null;
    }
    /**
     * GitHub's consent page for this sign-in, with a fresh state and PKCE
     * verifier. `repo` makes it a repo connection, which `finish` leaves alone:
     * its token is the repo's, not GitHub Issues'. `login` suggests the account.
     */
    async start(session, opts = {}) {
        if (!session)
            throw new Error('Sign in to AgentCorp before connecting GitHub.');
        const { clientId } = await this.call(session, { action: 'client' });
        const state = randomBytes(16).toString('hex');
        const verifier = randomBytes(32).toString('base64url');
        const now = Date.now();
        for (const [key, p] of this.pending)
            if (now - p.at > PENDING_MS)
                this.pending.delete(key);
        this.pending.set(state, { state, verifier, session, at: now, ...(opts.repo ? { repo: opts.repo } : {}) });
        const url = new URL(`https://${this.cfg.github.host}/login/oauth/authorize`);
        url.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: githubRedirectUri(this.cfg),
            scope: SCOPES,
            state,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            ...(opts.login ? { login: opts.login } : {}),
        }).toString();
        return url.toString();
    }
    /** The repo a sign-in waiting on GitHub was started for, or null for a GitHub Issues one or a state not started here. */
    repoOf(state) {
        return (state && this.pending.get(state)?.repo) || null;
    }
    /** Takes the code GitHub sent back for a repo connection started here, and gives back its token. */
    async finishRepo(code, state) {
        const repo = this.repoOf(state);
        if (!repo)
            throw new Error('This sign-in link is stale or was not started here. Click Connect to GitHub again.');
        return { repo, ...(await this.exchange(code, state)) };
    }
    /** Takes the code GitHub sent back, if it belongs to the sign-in started here, and keeps the token. */
    async finish(code, state) {
        if (this.repoOf(state))
            throw new Error('This sign-in was for a repo, not GitHub Issues.');
        const { accessToken, scope } = await this.exchange(code, state);
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(this.dir, 'token.json'), JSON.stringify({ accessToken, scope }), { encoding: 'utf8', mode: 0o600 });
    }
    /** Forgets the token on this Mac. The grant stays listed in GitHub's settings until revoked there. */
    forget() {
        this.pending.clear();
        rmSync(join(this.dir, 'token.json'), { force: true });
    }
    async exchange(code, state) {
        const pending = state ? this.pending.get(state) : undefined;
        if (!pending || Date.now() - pending.at > PENDING_MS) {
            throw new Error(`This sign-in link is stale or was not started here. Click ${pending?.repo ? 'Connect to GitHub' : 'Connect GitHub Issues'} again.`);
        }
        this.pending.delete(pending.state);
        return this.call(pending.session, {
            action: 'exchange',
            code,
            redirectUri: githubRedirectUri(this.cfg),
            codeVerifier: pending.verifier,
        });
    }
    async call(session, body) {
        const res = await this.fetchFn(`${SUPABASE_URL}/functions/v1/github-oauth`, {
            method: 'POST',
            headers: { authorization: `Bearer ${session}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const answer = (await res.json().catch(() => null));
        if (!res.ok || !answer)
            throw new Error(answer?.error || `The GitHub sign-in service answered ${res.status}.`);
        return answer;
    }
}
