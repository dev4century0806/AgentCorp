/**
 * Operator's own MCP servers: the ones set up in Claude Code, Codex, Cursor and
 * Copilot, shared with workers on every runner.
 *
 * Sync reads each tool's config files into a snapshot, and nothing changes
 * between Syncs. A server found for the first time starts off. The office
 * starts the ones that are on itself and serves them to its workers (see
 * agents/user-mcp.ts), so a config and its secrets stay on this Mac.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { activeStateDir } from '../config.js';
import { loadSkillsState } from './library.js';
/* ---------- reading each tool's format ---------- */
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const strMap = (v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter((e) => typeof e[1] === 'string'))
    : {};
/** One server in the JSON shape Claude Code, Cursor and Copilot share; null when it has no command or URL. */
function jsonServer(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const command = str(r.command);
    const url = str(r.url) ?? str(r.serverUrl);
    if (!command && !url)
        return null;
    return {
        transport: command ? 'stdio' : r.type === 'sse' ? 'sse' : 'http',
        command,
        args: strings(r.args),
        env: strMap(r.env),
        cwd: str(r.cwd),
        url: command ? null : url,
        headers: command ? {} : strMap(r.headers),
        note: r.disabled === true || r.enabled === false ? 'Turned off there' : null,
    };
}
function jsonServers(value) {
    const out = {};
    if (!value || typeof value !== 'object')
        return out;
    for (const [name, raw] of Object.entries(value)) {
        const server = jsonServer(raw);
        if (server)
            out[name] = server;
    }
    return out;
}
/** The `mcpServers` of a JSON file; with `bare`, a file of servers at the top level counts too, as Copilot reads it. */
function mcpServersKey(bare = false) {
    return (text) => {
        const doc = JSON.parse(text);
        if (doc.mcpServers)
            return jsonServers(doc.mcpServers);
        return bare ? jsonServers(doc) : {};
    };
}
/** Claude Code's local scope: servers kept in `~/.claude.json` under the repo's path. */
function claudeLocal(text, repoPath) {
    if (!repoPath)
        return {};
    const doc = JSON.parse(text);
    return jsonServers(doc.projects?.[repoPath]?.mcpServers);
}
/** The `.mcp.json` servers Claude Code was told to leave off, in the repo's settings or Operator's. */
function claudeDisabled(repoPath) {
    const off = new Set();
    const read = (path, pick) => {
        try {
            for (const name of strings(pick(JSON.parse(readFileSync(path, 'utf8')))))
                off.add(name);
        }
        catch {
            // No such file, or not JSON: nothing turned off there.
        }
    };
    read(join(repoPath, '.claude/settings.json'), (d) => d.disabledMcpjsonServers);
    read(join(repoPath, '.claude/settings.local.json'), (d) => d.disabledMcpjsonServers);
    read(join(home(), '.claude.json'), (d) => d.projects?.[repoPath]?.disabledMcpjsonServers);
    return off;
}
function claudeProject(text, repoPath) {
    const servers = mcpServersKey()(text);
    if (!repoPath)
        return servers;
    const off = claudeDisabled(repoPath);
    for (const [name, server] of Object.entries(servers))
        if (off.has(name))
            server.note = 'Turned off in Claude Code';
    return servers;
}
/** Codex's `[mcp_servers.<name>]` tables. Values it takes from the environment become `${VAR}`. */
function codexServers(text) {
    const doc = parseToml(text);
    const out = {};
    for (const [name, s] of Object.entries(doc.mcp_servers ?? {})) {
        if (!s || typeof s !== 'object')
            continue;
        const command = str(s.command);
        const url = str(s.url);
        if (!command && !url)
            continue;
        const env = strMap(s.env);
        const passed = Array.isArray(s.env_vars) ? s.env_vars : [];
        for (const v of passed) {
            const varName = typeof v === 'string' ? v : str(v?.name);
            if (varName)
                env[varName] ??= `\${${varName}}`;
        }
        const headers = strMap(s.http_headers);
        for (const [header, varName] of Object.entries(strMap(s.env_http_headers)))
            headers[header] = `\${${varName}}`;
        const bearer = str(s.bearer_token_env_var);
        if (bearer)
            headers['Authorization'] = `Bearer \${${bearer}}`;
        out[name] = {
            transport: command ? 'stdio' : 'http',
            command,
            args: strings(s.args),
            env,
            cwd: str(s.cwd),
            url: command ? null : url,
            headers: command ? {} : headers,
            note: s.enabled === false ? 'Turned off in Codex' : null,
        };
    }
    return out;
}
/**
 * Every file a server can come from, in the order a name is taken in: the
 * first file with a server of that name in a scope gives it, and the rest are
 * listed as also having it. Add a tool here.
 */
export const MCP_SOURCES = [
    { toolId: 'claude', from: 'Claude Code', scope: 'global', file: '~/.claude.json', read: mcpServersKey() },
    { toolId: 'cursor', from: 'Cursor', scope: 'global', file: '~/.cursor/mcp.json', read: mcpServersKey() },
    { toolId: 'codex', from: 'Codex', scope: 'global', file: '~/.codex/config.toml', read: codexServers },
    { toolId: 'copilot', from: 'Copilot', scope: 'global', file: '~/.copilot/mcp-config.json', read: mcpServersKey() },
    { toolId: 'claude', from: 'Claude Code (local)', scope: 'repo', file: '~/.claude.json', read: claudeLocal },
    { toolId: 'claude', from: 'Claude Code (settings.local.json)', scope: 'repo', file: '.claude/settings.local.json', read: mcpServersKey() },
    { toolId: 'claude', from: 'Claude Code (settings.json)', scope: 'repo', file: '.claude/settings.json', read: mcpServersKey() },
    { toolId: 'claude', from: 'Claude Code (.mcp.json)', scope: 'repo', file: '.mcp.json', read: claudeProject },
    { toolId: 'cursor', from: 'Cursor (project)', scope: 'repo', file: '.cursor/mcp.json', read: mcpServersKey() },
    { toolId: 'codex', from: 'Codex (project)', scope: 'repo', file: '.codex/config.toml', read: codexServers },
    { toolId: 'copilot', from: 'Copilot (project)', scope: 'repo', file: '.github/mcp.json', read: mcpServersKey(true) },
];
/** Servers the office connects itself, as ticket sources and the assistant's tools. A tool's own copy of one is left out. */
const OFFICE_NAMES = /^(github|office|8090)$/i;
const OFFICE_HOSTS = /(^|\.)(githubcopilot\.com)$/i;
function connectedByOffice(name, server) {
    if (OFFICE_NAMES.test(name))
        return true;
    if (!server.url)
        return false;
    try {
        return OFFICE_HOSTS.test(new URL(server.url).hostname);
    }
    catch {
        return false;
    }
}
const SECRET_PARAM = /(key|token|secret|password|passwd|auth|sig)/i;
/** Whether a remote server carries its own key, in a header or the URL, rather than a sign-in kept in the tool. */
export function kindOf(server) {
    if (server.command)
        return 'local';
    if (Object.keys(server.headers).length)
        return 'key';
    try {
        if ([...new URL(server.url ?? '').searchParams.keys()].some((k) => SECRET_PARAM.test(k)))
            return 'key';
    }
    catch {
        // Not a URL the office could reach anyway.
    }
    return 'signin';
}
function home() {
    return process.env.HOME || homedir();
}
function sourcePath(source, repoPath) {
    if (source.file.startsWith('~/'))
        return join(home(), source.file.slice(2));
    return repoPath ? join(repoPath, source.file) : null;
}
/** The servers of one scope: Operator's general ones with no checkout, else the repo's. */
export function readMcpScope(checkout) {
    const scope = checkout ? 'repo' : 'global';
    const byName = new Map();
    for (const source of MCP_SOURCES) {
        if (source.scope !== scope)
            continue;
        const path = sourcePath(source, checkout?.path ?? null);
        if (!path)
            continue;
        let found;
        try {
            found = source.read(readFileSync(path, 'utf8'), checkout?.path ?? null);
        }
        catch {
            // Missing or unreadable: the tool would find nothing there either.
            continue;
        }
        for (const [name, server] of Object.entries(found)) {
            if (connectedByOffice(name, server))
                continue;
            const taken = byName.get(name);
            if (taken) {
                if (!taken.alsoIn.includes(source.from))
                    taken.alsoIn.push(source.from);
                continue;
            }
            byName.set(name, {
                ...server,
                key: `${checkout?.name ?? 'global'}/${name}`,
                name,
                scope,
                repo: checkout?.name ?? null,
                repoPath: checkout?.path ?? null,
                toolId: source.toolId,
                from: source.from,
                file: source.file,
                alsoIn: [],
                kind: kindOf(server),
            });
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function stateFile() {
    return join(activeStateDir(), 'mcp-state.json');
}
function loadMcpState() {
    try {
        const raw = JSON.parse(readFileSync(stateFile(), 'utf8'));
        return { syncedAt: raw.syncedAt ?? null, servers: raw.servers ?? [], updated: raw.updated ?? [], settings: raw.settings ?? {}, errors: raw.errors ?? {} };
    }
    catch {
        return { syncedAt: null, servers: [], updated: [], settings: {}, errors: {} };
    }
}
/** Only Operator's account can read it: the configs hold his keys. */
function saveMcpState(state) {
    mkdirSync(dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}
/** What a worker would get from the server: a change to any of it is a change to the server. */
export function mcpFingerprint(s) {
    return JSON.stringify([s.transport, s.command, s.args, s.env, s.cwd, s.url, s.headers]);
}
/** Matched as whole words in a name, command or URL; the longer names anywhere in them. */
const RISKY_WORDS = new Set(['db', 'sql', 'pg', 'prod', 'production', 'fly', 'render', 'deploy', 'aws', 'gcp']);
const RISKY = /(postgres|mysql|maria|mssql|sqlserver|sqlite|oracle|mongo|redis|dynamo|cassandra|supabase|prisma|neon|planetscale|snowflake|bigquery|clickhouse|elastic|neo4j|database|deploy|vercel|netlify|heroku|railway|terraform|pulumi|kubectl|kubernetes|k8s|helm|gcloud|azure|cloudflare)/i;
/** Whether a server looks like a database or deploy tool, which start with Ask first on. */
export function guessAskFirst(s) {
    const text = [s.name, s.command, ...s.args, s.url].filter(Boolean).join(' ');
    return RISKY.test(text) || text.toLowerCase().split(/[^a-z0-9]+/).some((w) => RISKY_WORDS.has(w));
}
/**
 * Reads the servers of Operator's general configs and of each checkout, noting
 * what is new, changed and gone. With `general` false only the checkouts'
 * are read, and the rest of the snapshot is kept.
 */
export function syncMcpServers(checkouts, opts = {}) {
    const general = opts.general ?? true;
    const state = loadMcpState();
    const synced = new Set(checkouts.map((c) => c.name));
    const scopes = [
        ...(general ? [{ name: null, servers: readMcpScope(null) }] : []),
        ...checkouts.map((c) => ({ name: c.name, servers: readMcpScope(c) })),
    ];
    const kept = state.servers.filter((s) => (s.scope === 'global' ? !general : !general && !synced.has(s.repo)));
    const before = new Map(state.servers.map((s) => [s.key, s]));
    const summary = [];
    const updated = [];
    for (const { name, servers } of scopes) {
        const added = servers.filter((s) => !before.has(s.key));
        const changed = servers.filter((s) => before.has(s.key) && mcpFingerprint(before.get(s.key)) !== mcpFingerprint(s));
        const keys = new Set(servers.map((s) => s.key));
        const removed = state.servers.filter((s) => (s.repo ?? null) === name && !keys.has(s.key));
        for (const s of added)
            state.settings[s.key] ??= { on: false, askFirst: guessAskFirst(s) };
        for (const s of changed)
            delete state.errors[s.key];
        updated.push(...[...added, ...changed].map((s) => s.key));
        summary.push({ name, total: servers.length, added: added.length, updated: changed.length, removed: removed.length });
    }
    state.servers = [...kept, ...scopes.flatMap((s) => s.servers)];
    // A server that is gone takes Operator's choices for it along, so one that comes back starts off again.
    const known = new Set(state.servers.map((s) => s.key));
    for (const key of Object.keys(state.settings))
        if (!known.has(key))
            delete state.settings[key];
    for (const key of Object.keys(state.errors))
        if (!known.has(key))
            delete state.errors[key];
    state.updated = updated;
    state.syncedAt = new Date().toISOString();
    saveMcpState(state);
    return summary;
}
/** Whether the configs say something other than the snapshot: a server added, removed or changed. */
export function mcpOutOfDate(checkouts) {
    const state = loadMcpState();
    const now = [readMcpScope(null), ...checkouts.map((c) => readMcpScope(c))].flat();
    const then = new Map(state.servers
        .filter((s) => s.scope === 'global' || checkouts.some((c) => c.name === s.repo))
        .map((s) => [s.key, mcpFingerprint(s)]));
    return now.length !== then.size || now.some((s) => then.get(s.key) !== mcpFingerprint(s));
}
export function setMcpServerSetting(key, patch) {
    const state = loadMcpState();
    const server = state.servers.find((s) => s.key === key);
    if (!server)
        throw new Error('That server is not in the last Sync. Press Sync to read it again.');
    if (patch.on && server.kind === 'signin')
        throw new Error(`${server.name} signs in inside ${server.from}, so it cannot be shared with workers.`);
    const current = state.settings[key] ?? { on: false, askFirst: guessAskFirst(server) };
    state.settings[key] = { on: patch.on ?? current.on, askFirst: patch.askFirst ?? current.askFirst };
    saveMcpState(state);
}
/** Notes why a server failed to start for a worker, or clears it once it starts. */
export function recordMcpError(key, message) {
    const state = loadMcpState();
    if (message === null && !state.errors[key])
        return;
    if (message === null)
        delete state.errors[key];
    else
        state.errors[key] = { message, at: new Date().toISOString() };
    saveMcpState(state);
}
/** A server's name as a runner is given it, and puts in its tool names: `mcp__<name>__<tool>`. */
export function mcpRunnerName(name) {
    return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
/**
 * The servers that are on for a worker in `repoPath`, or in no repo: the
 * general ones, and the repo's own when its repo is in the library. The
 * repo's wins over a general one of the same name.
 */
export function enabledMcpServers(repoPath) {
    const state = loadMcpState();
    const library = new Set(loadSkillsState().libraryRepos ?? []);
    const inRepo = repoPath && library.has(repoPath);
    const on = state.servers.filter((s) => s.kind !== 'signin' && state.settings[s.key]?.on);
    const own = inRepo ? on.filter((s) => s.scope === 'repo' && s.repoPath === repoPath) : [];
    const names = new Set(own.map((s) => s.name));
    return [...own, ...on.filter((s) => s.scope === 'global' && !names.has(s.name))].map((s) => ({
        ...s,
        askFirst: state.settings[s.key].askFirst,
    }));
}
/* ---------- what the MCPs tab may show ---------- */
export const MASK = '••••••';
/** A value written as an environment reference, e.g. `${DB_URL}` or `Bearer ${TOKEN}`, names no secret. */
function isReference(value) {
    return /^(Bearer\s+)?\$\{[^}]+\}$/.test(value.trim());
}
function maskValue(value) {
    return isReference(value) ? value : MASK;
}
/** A URL with its password and secret-looking query values masked. */
export function maskUrl(text) {
    return text
        .replace(/(\w+:\/\/[^:/@\s]+:)[^@\s]+@/g, `$1${MASK}@`)
        .replace(/([?&])([^=&\s]+)=([^&\s]*)/g, (whole, sep, k, v) => (SECRET_PARAM.test(k) && v && !isReference(v) ? `${sep}${k}=${MASK}` : whole));
}
/** Arguments with passwords in URLs, and the values of key, token and password flags, masked. */
export function maskArgs(args) {
    const flag = /^--?[\w-]*(key|token|secret|password|passwd)[\w-]*$/i;
    return args.map((arg, i) => {
        const prev = args[i - 1];
        if (prev && flag.test(prev) && !arg.startsWith('-'))
            return maskValue(arg);
        const inline = /^(--?[\w-]*(?:key|token|secret|password|passwd)[\w-]*=)(.+)$/i.exec(arg);
        if (inline)
            return `${inline[1]}${maskValue(inline[2])}`;
        return maskUrl(arg);
    });
}
/** The literal secrets of a server, to take out of any text that might echo them, such as an error. */
export function secretsOf(s) {
    const values = [...Object.values(s.env), ...Object.values(s.headers)].filter((v) => !isReference(v));
    const masked = maskArgs(s.args);
    s.args.forEach((arg, i) => {
        if (masked[i] !== arg)
            values.push(arg);
    });
    for (const m of [...s.args, s.url ?? ''].join(' ').matchAll(/\w+:\/\/[^:/@\s]+:([^@\s]+)@/g))
        values.push(m[1]);
    return values.filter((v) => v.length >= 4);
}
/** Text with a server's secrets taken out. */
export function scrubSecrets(text, s) {
    let out = text;
    for (const secret of secretsOf(s).sort((a, b) => b.length - a.length))
        out = out.split(secret).join(MASK);
    return maskUrl(out);
}
function toInfo(s, state, replacesGeneral) {
    const setting = state.settings[s.key] ?? { on: false, askFirst: guessAskFirst(s) };
    return {
        key: s.key,
        name: s.name,
        scope: s.scope,
        repo: s.repo,
        from: s.from,
        file: s.file,
        alsoIn: s.alsoIn,
        kind: s.kind,
        transport: s.transport,
        command: s.command,
        args: maskArgs(s.args),
        url: s.url ? maskUrl(s.url) : null,
        env: Object.entries(s.env).map(([name, value]) => ({ name, value: maskValue(value) })),
        headers: Object.entries(s.headers).map(([name, value]) => ({ name, value: maskValue(value) })),
        on: s.kind !== 'signin' && setting.on,
        askFirst: setting.askFirst,
        updated: state.updated.includes(s.key),
        replacesGeneral,
        note: s.note,
        error: state.errors[s.key] ?? null,
    };
}
/** The general servers, or a repo's own. */
export function listMcpServers(repo) {
    const state = loadMcpState();
    const general = state.servers.filter((s) => s.scope === 'global');
    const names = new Set(general.map((s) => s.name));
    const listed = repo ? state.servers.filter((s) => s.scope === 'repo' && s.repo === repo) : general;
    return {
        syncedAt: state.syncedAt,
        servers: listed.map((s) => toInfo(s, state, s.scope === 'repo' && names.has(s.name))),
    };
}
