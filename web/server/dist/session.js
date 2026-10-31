import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export const SESSION_COOKIE = 'ac_token';
export const SESSION_HEADER = 'x-agent-corp-token';
/** The state folder for AgentCorp data. */
const STATE_DIR = process.env.AGENT_CORP_HOME
    ? resolve(process.env.AGENT_CORP_HOME.replace(/^~(?=\/|$)/, homedir()))
    : join(homedir(), '.agent-corp');
const TOKEN_FILE = join(STATE_DIR, 'session-token');
/**
 * Reads the local session token, creating it on first launch.
 *
 * Lives in a 0600 file rather than only in memory so the Vite dev server can
 * read it and attach it to proxied requests: that way the token never has to
 * be handed to the browser in dev, and the API stays closed to anything else
 * that can reach the port.
 *
 * Kept free of other imports so `vite.config.ts` can use it directly.
 */
export function ensureSessionToken() {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    if (existsSync(TOKEN_FILE)) {
        const existing = readFileSync(TOKEN_FILE, 'utf8').trim();
        if (existing)
            return existing;
    }
    const token = randomBytes(32).toString('base64url');
    try {
        // `wx` so two processes starting at once cannot clobber each other.
        writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return token;
    }
    catch {
        const raced = readFileSync(TOKEN_FILE, 'utf8').trim();
        if (raced)
            return raced;
        writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 });
        return token;
    }
}
/** Constant-time compare, so a wrong token leaks nothing through timing. */
export function tokenMatches(expected, given) {
    if (!given || given.length !== expected.length)
        return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++)
        diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
    return diff === 0;
}
export function readCookie(header, name) {
    if (!header)
        return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0)
            continue;
        if (part.slice(0, eq).trim() === name)
            return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
}
