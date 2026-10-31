/**
 * Repo agents: the agents a repo defines in any tool's agents folder
 * (`.claude/agents`, `.cursor/agents`, `.codex/agents`, `.github/agents`),
 * hired in the office as personas on any runner.
 *
 * The repo's file is the source of truth. Sync reads it into a snapshot,
 * which is what the Hire panel offers, and writes a copy in the format of
 * each tool that does not read it already into the checkout and its
 * worktrees, kept out of git. Nothing changes between Syncs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { activeStateDir } from '../config.js';
import { LOOK_CHOICES, PERSONA_NAME_MAX, nearestModel, repoPersonaId, } from '../protocol.js';
import { addToGitExclude, loadSkillsState, parseFrontmatter } from './library.js';
/**
 * Each tool's agents folder in a repo, in the order Sync reads them: when two
 * define the same agent, the first is the one hired and the other is noted.
 */
export const AGENT_FOLDERS = [
    { toolId: 'claude', dir: '.claude/agents', exts: ['.md'], nested: true },
    { toolId: 'cursor', dir: '.cursor/agents', exts: ['.md'], nested: false },
    { toolId: 'codex', dir: '.codex/agents', exts: ['.toml'], nested: false },
    { toolId: 'copilot', dir: '.github/agents', exts: ['.agent.md', '.md'], nested: false },
];
/** The folders each tool finds agents in. Cursor reads Claude Code's as well as its own. */
const TOOL_READS = {
    claude: ['claude'],
    cursor: ['cursor', 'claude'],
    codex: ['codex'],
    copilot: ['copilot'],
};
/** The tools the office writes copies for. Cursor gets Claude Code's. */
const COPY_TOOLS = ['claude', 'codex', 'copilot'];
function folder(toolId) {
    return AGENT_FOLDERS.find((f) => f.toolId === toolId);
}
/** The folder a repo-relative agent file is in. */
function folderOf(file) {
    return AGENT_FOLDERS.find((f) => file.startsWith(`${f.dir}/`));
}
/** Claude Code takes these model aliases as they are. */
export const CLAUDE_MODELS = /^(fable|opus|sonnet|haiku|inherit|claude-)/i;
/** Starts every copy the office writes, so it knows its own files from the repo's. */
const MARK = 'Made by AgentCorp from';
function stateFile() {
    return join(activeStateDir(), 'repo-agents-state.json');
}
export function loadAgentsState() {
    try {
        const raw = JSON.parse(readFileSync(stateFile(), 'utf8'));
        return { repos: raw.repos ?? {}, hidden: raw.hidden ?? {} };
    }
    catch {
        return { repos: {}, hidden: {} };
    }
}
function saveAgentsState(state) {
    mkdirSync(dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}
/** The frontmatter keys a copy can carry, or that only matter to Claude Code's own display. */
const KNOWN_KEYS = new Set(['name', 'description', 'tools', 'disallowedTools', 'model', 'color']);
/** "terraform-reviewer" as "Terraform Reviewer"; a name already in words stays as written. */
export function agentTitle(name) {
    if (!/^[a-z0-9_-]+$/.test(name))
        return name.trim();
    return name
        .split(/[-_]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
}
/** A title cut to fit a persona name, at a word where it can be. */
export function shortPersonaName(title) {
    if (title.length <= PERSONA_NAME_MAX)
        return title;
    const cut = title.slice(0, PERSONA_NAME_MAX + 1).replace(/\s+\S*$/, '');
    return (cut && cut.length <= PERSONA_NAME_MAX ? cut : title.slice(0, PERSONA_NAME_MAX)).trim();
}
/** A frontmatter list written inline (`a, b` or `[a, b]`) or as `- a` lines; null when the key is absent. */
function listField(yaml, key) {
    const lines = yaml.split('\n');
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at === -1)
        return null;
    const inline = lines[at].slice(key.length + 1).trim().replace(/^\[|\]$/g, '');
    const items = inline ? inline.split(',') : [];
    for (let i = at + 1; !inline && i < lines.length && /^\s+-\s/.test(lines[i]); i++) {
        items.push(lines[i].replace(/^\s+-\s*/, ''));
    }
    return items.map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
/** The keys of a Cursor agent file the office reads. */
const CURSOR_KEYS = new Set(['name', 'description', 'model', 'readonly']);
/** The keys of a Copilot agent file the office reads. */
const COPILOT_KEYS = new Set(['name', 'description', 'tools', 'model']);
/** The keys of a Codex agent file the office reads. */
const CODEX_KEYS = new Set(['name', 'description', 'developer_instructions', 'model', 'sandbox_mode']);
/** Copilot's tool aliases as Claude Code's tools, the names agents are kept in. */
const FROM_COPILOT = {
    read: ['Read'],
    edit: ['Edit', 'Write'],
    search: ['Grep', 'Glob'],
    execute: ['Bash'],
    shell: ['Bash'],
    web: ['WebFetch', 'WebSearch'],
    agent: ['Task'],
    todo: ['TodoWrite'],
};
/**
 * Reads one agent file in its tool's format, found from the folder it is in
 * (Claude Code's when it is in none); null when it has nothing to go on.
 */
export function parseAgentFile(content, id, file, mtimeMs = 0) {
    const toolId = folderOf(file)?.toolId ?? 'claude';
    if (toolId === 'codex')
        return parseCodexAgent(content, id, file, mtimeMs);
    const yaml = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? '';
    const { frontmatter, body } = parseFrontmatter(content);
    const named = yaml && typeof frontmatter.name === 'string' && frontmatter.name !== 'Unnamed Skill' ? frontmatter.name.trim() : '';
    const name = named || id;
    const instructions = body.trim();
    if (!instructions && !frontmatter.description)
        return null;
    const model = typeof frontmatter.model === 'string' && frontmatter.model.trim() ? frontmatter.model.trim() : null;
    const known = { claude: KNOWN_KEYS, cursor: CURSOR_KEYS, copilot: COPILOT_KEYS }[toolId] ?? KNOWN_KEYS;
    const otherKeys = [...yaml.matchAll(/^(\w[\w-]*):/gm)].map((m) => m[1]).filter((k) => !known.has(k));
    let tools = listField(yaml, 'tools');
    let disallowedTools = listField(yaml, 'disallowedTools');
    if (toolId === 'cursor') {
        tools = null;
        disallowedTools = String(frontmatter.readonly) === 'true' ? [...WRITE_TOOLS] : null;
    }
    else if (toolId === 'copilot') {
        disallowedTools = null;
        if (tools) {
            const mapped = new Set();
            for (const alias of tools) {
                const mcp = /^([^/]+)\/(.+)$/.exec(alias);
                const as = FROM_COPILOT[alias] ?? (mcp ? [mcp[2] === '*' ? `mcp__${mcp[1]}` : `mcp__${mcp[1]}__${mcp[2]}`] : null);
                if (as)
                    for (const t of as)
                        mapped.add(t);
                else
                    otherKeys.push(`tool ${alias}`);
            }
            tools = [...mapped];
        }
    }
    return {
        id,
        name,
        title: agentTitle(name),
        description: typeof frontmatter.description === 'string' ? frontmatter.description.replace(/\\n/g, '\n').trim() : '',
        instructions,
        model,
        tools,
        disallowedTools,
        otherKeys,
        file,
        content,
        mtimeMs,
    };
}
/** A Codex custom agent. Its sandbox stands for tool limits: read-only denies the tools that write. */
function parseCodexAgent(content, id, file, mtimeMs) {
    let table;
    try {
        table = parseToml(content);
    }
    catch {
        return null;
    }
    const text = (key) => (typeof table[key] === 'string' ? table[key].trim() : '');
    const name = text('name') || id;
    const instructions = text('developer_instructions');
    const description = text('description');
    if (!instructions && !description)
        return null;
    return {
        id,
        name,
        title: agentTitle(name),
        description,
        instructions,
        model: text('model') || null,
        tools: null,
        disallowedTools: table.sandbox_mode === 'read-only' ? [...WRITE_TOOLS] : null,
        otherKeys: Object.keys(table).filter((k) => !CODEX_KEYS.has(k)),
        file,
        content,
        mtimeMs,
    };
}
/**
 * Every agent file in a checkout's agents folders, in the order of
 * `AGENT_FOLDERS`, less the copies the office wrote there.
 */
function agentFiles(root) {
    const found = [];
    for (const f of AGENT_FOLDERS) {
        const walk = (at) => {
            let names;
            try {
                names = readdirSync(at);
            }
            catch {
                return;
            }
            for (const name of names.sort()) {
                const path = join(at, name);
                if (name.startsWith('.') || /^readme\.md$/i.test(name))
                    continue;
                if (statSync(path).isDirectory()) {
                    if (f.nested)
                        walk(path);
                    continue;
                }
                const ext = f.exts.find((e) => name.endsWith(e));
                if (ext && !madeByOffice(path))
                    found.push({ folder: f, id: name.slice(0, -ext.length), path });
            }
        };
        walk(join(root, f.dir));
    }
    return found;
}
/**
 * The agents a checkout defines, once each by id, sorted by title. The first
 * folder to define an id wins; the others are noted in its `alsoIn`.
 */
export function readRepoAgents(root) {
    return readAgentsWithFiles(root).agents;
}
function readAgentsWithFiles(root) {
    const byId = new Map();
    const files = {};
    for (const { id, path } of agentFiles(root)) {
        const file = relative(root, path);
        try {
            const mtimeMs = statSync(path).mtimeMs;
            files[file] = mtimeMs;
            const first = byId.get(id);
            if (first) {
                first.alsoIn = [...(first.alsoIn ?? []), file];
                continue;
            }
            const agent = parseAgentFile(readFileSync(path, 'utf8'), id, file, mtimeMs);
            if (agent)
                byId.set(id, { ...agent, alsoIn: [] });
        }
        catch {
            // An unreadable file is left out, as its tool would.
        }
    }
    return { agents: [...byId.values()].sort((a, b) => a.title.localeCompare(b.title)), files };
}
/* ---------- copies for the tools that have their own format ---------- */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);
/** Claude Code tool names as Copilot's tool aliases. */
const COPILOT_TOOLS = {
    Read: 'read',
    Write: 'edit',
    Edit: 'edit',
    MultiEdit: 'edit',
    NotebookEdit: 'edit',
    Glob: 'search',
    Grep: 'search',
    LS: 'search',
    Bash: 'execute',
    BashOutput: 'execute',
    KillShell: 'execute',
    WebFetch: 'web',
    WebSearch: 'web',
    Task: 'agent',
    Agent: 'agent',
    TodoWrite: 'todo',
};
/** A model name another vendor's tool could take as it is; Claude's aliases and ids are not. */
function portableModel(model) {
    return !!model && /^(gpt|o\d|codex)/i.test(model);
}
/** A TOML string: a literal block for the instructions where it can be, else a basic string. */
function tomlString(value, block = false) {
    if (block && !value.includes("'''"))
        return `'''\n${value}\n'''`;
    return JSON.stringify(value);
}
/** The comment that marks a file as the office's, saying where to edit it instead. */
export function markLine(from, edit = 'Edit that file and press Sync') {
    return `# ${MARK} ${from}. ${edit}; changes here are replaced.`;
}
/** Whether an agent may only read: every tool it lists only reads, or every tool that writes is denied. */
function readOnly(agent) {
    const allowed = agent.tools?.filter((t) => t !== '*');
    const denied = agent.disallowedTools ?? [];
    return !!(allowed?.length && !allowed.some((t) => WRITE_TOOLS.has(t))) || [...WRITE_TOOLS].every((t) => denied.includes(t));
}
/** The agent as a Claude Code agent, which Cursor reads too. */
export function claudeCopy(agent, mark = markLine(agent.file)) {
    const skipped = [];
    const head = ['---', mark, `name: ${JSON.stringify(agent.name)}`, `description: ${JSON.stringify(agent.description || agent.title)}`];
    if (agent.tools?.length)
        head.push(`tools: ${agent.tools.join(', ')}`);
    if (agent.disallowedTools?.length)
        head.push(`disallowedTools: ${agent.disallowedTools.join(', ')}`);
    if (agent.model && CLAUDE_MODELS.test(agent.model))
        head.push(`model: ${agent.model}`);
    else if (agent.model)
        skipped.push(`model "${agent.model}" (uses Claude Code's model)`);
    skipped.push(...agent.otherKeys);
    head.push('---', '');
    return {
        toolId: 'claude',
        file: `${folder('claude').dir}/${agent.id}.md`,
        text: `${head.join('\n')}${agent.instructions || agent.description}\n`,
        skipped,
    };
}
/** The agent as a Codex custom agent. Codex limits an agent by sandbox, not by tool. */
export function codexCopy(agent, mark = markLine(agent.file)) {
    const skipped = [];
    const lines = [mark, `name = ${tomlString(agent.name)}`, `description = ${tomlString(agent.description || agent.title)}`];
    if (portableModel(agent.model))
        lines.push(`model = ${tomlString(agent.model)}`);
    else if (agent.model && agent.model !== 'inherit')
        skipped.push(`model "${agent.model}" (uses Codex's model)`);
    if (readOnly(agent))
        lines.push('sandbox_mode = "read-only"');
    else if (agent.tools?.some((t) => t !== '*') || agent.disallowedTools?.length)
        skipped.push('tool limits (Codex limits by sandbox, not by tool)');
    skipped.push(...agent.otherKeys);
    lines.push(`developer_instructions = ${tomlString(agent.instructions || agent.description, true)}`);
    return { toolId: 'codex', file: `${folder('codex').dir}/${agent.id}.toml`, text: lines.join('\n') + '\n', skipped };
}
/** The agent as a Copilot custom agent, its tools as Copilot's aliases. */
export function copilotCopy(agent, mark = markLine(agent.file)) {
    const skipped = [];
    const head = ['---', mark, `name: ${JSON.stringify(agent.name)}`, `description: ${JSON.stringify(agent.description || agent.title)}`];
    const allowed = agent.tools?.filter((t) => t !== '*');
    if (allowed?.length) {
        const aliases = new Set();
        for (const tool of allowed) {
            const mcp = /^mcp__([^_]+(?:_[^_]+)*?)(?:__(.+))?$/.exec(tool);
            const alias = COPILOT_TOOLS[tool] ?? (mcp ? `${mcp[1]}/${mcp[2] ?? '*'}` : null);
            if (alias)
                aliases.add(alias);
            else
                skipped.push(`tool ${tool}`);
        }
        head.push(`tools: ${JSON.stringify([...aliases])}`);
    }
    else if (agent.disallowedTools?.length && readOnly(agent)) {
        head.push(`tools: ${JSON.stringify(['read', 'search', 'web'])}`);
    }
    if (agent.disallowedTools?.length && !readOnly(agent))
        skipped.push('disallowed tools');
    if (portableModel(agent.model))
        head.push(`model: ${JSON.stringify(agent.model)}`);
    else if (agent.model && agent.model !== 'inherit')
        skipped.push(`model "${agent.model}" (uses Copilot's model)`);
    skipped.push(...agent.otherKeys);
    head.push('---', '');
    return {
        toolId: 'copilot',
        file: `${folder('copilot').dir}/${agent.id}.agent.md`,
        text: `${head.join('\n')}${agent.instructions || agent.description}\n`,
        skipped,
    };
}
function copyFor(agent, toolId) {
    return toolId === 'claude' ? claudeCopy(agent) : toolId === 'codex' ? codexCopy(agent) : copilotCopy(agent);
}
/** The repo's own file a tool reads an agent from: the one Sync read, or one of its `alsoIn`. */
function ownFileFor(agent, toolId) {
    const reads = TOOL_READS[toolId] ?? [];
    return [agent.file, ...(agent.alsoIn ?? [])].find((f) => reads.includes(folderOf(f)?.toolId ?? 'claude')) ?? null;
}
/** The copies an agent needs: one for each tool that has no file of the repo's for it. */
function copiesOf(agent) {
    return COPY_TOOLS.filter((t) => !ownFileFor(agent, t)).map((t) => copyFor(agent, t));
}
/** Whether the office wrote the file at `path`; a file the repo has there is the repo's own. */
export function madeByOffice(path) {
    try {
        return readFileSync(path, 'utf8').includes(MARK);
    }
    catch {
        return false;
    }
}
/** A file of the repo's where a copy would go, which Sync could not read as an agent. */
function takenByRepo(root, copy) {
    const path = join(root, copy.file);
    return existsSync(path) && !madeByOffice(path);
}
/**
 * Writes the copies of `agents` into a checkout or worktree and removes the
 * ones the office wrote for agents no longer there. A tool the repo already
 * gives its own file is left to it.
 */
export function writeAgentCopies(root, agents) {
    const wanted = new Set();
    for (const agent of agents) {
        for (const copy of copiesOf(agent)) {
            wanted.add(copy.file);
            if (takenByRepo(root, copy))
                continue;
            const path = join(root, copy.file);
            try {
                if (existsSync(path) && readFileSync(path, 'utf8') === copy.text)
                    continue;
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, copy.text, 'utf8');
                addToGitExclude(root, copy.file);
            }
            catch {
                // A copy that cannot be written shows as not synced in the Agents tab.
            }
        }
    }
    for (const { dir, exts } of COPY_TOOLS.map(folder)) {
        let names;
        try {
            names = readdirSync(join(root, dir));
        }
        catch {
            continue;
        }
        for (const name of names) {
            const file = `${dir}/${name}`;
            if (!name.endsWith(exts[0]) || wanted.has(file))
                continue;
            if (madeByOffice(join(root, file)))
                rmSync(join(root, file), { force: true });
        }
    }
}
/** How each tool gets an agent in a checkout. Cursor reads Claude Code's copy when it needs one. */
export function agentToolStatus(root, agent) {
    return AGENT_FOLDERS.map(({ toolId }) => {
        const own = ownFileFor(agent, toolId);
        if (own)
            return { toolId, status: own === agent.file ? 'native' : 'from_repo', file: own, skipped: [] };
        const copy = copyFor(agent, toolId === 'cursor' ? 'claude' : toolId);
        if (takenByRepo(root, copy))
            return { toolId, status: 'from_repo', file: copy.file, skipped: [] };
        const path = join(root, copy.file);
        const current = existsSync(path) && readFileSync(path, 'utf8') === copy.text;
        return { toolId, status: current ? 'converted' : 'not_synced', file: copy.file, skipped: copy.skipped };
    });
}
/* ---------- Sync ---------- */
/**
 * Reads each checkout's agents into the snapshot, noting what is new, changed
 * and gone, and writes the copies into the checkout and its worktrees.
 */
export function syncRepoAgents(checkouts) {
    const state = loadAgentsState();
    const now = new Date().toISOString();
    const summary = [];
    for (const checkout of checkouts) {
        const { agents, files } = readAgentsWithFiles(checkout.path);
        const before = new Map((state.repos[checkout.name]?.agents ?? []).map((a) => [a.id, a]));
        const added = agents.filter((a) => !before.has(a.id));
        const changed = agents.filter((a) => before.has(a.id) && before.get(a.id).content !== a.content);
        const removed = [...before.keys()].filter((id) => !agents.some((a) => a.id === id));
        for (const root of [checkout.path, ...(checkout.worktrees ?? [])])
            writeAgentCopies(root, agents);
        state.repos[checkout.name] = {
            path: checkout.path,
            syncedAt: now,
            agents,
            updated: [...added, ...changed].map((a) => a.id),
            files,
        };
        if (state.hidden[checkout.name]) {
            state.hidden[checkout.name] = state.hidden[checkout.name].filter((id) => agents.some((a) => a.id === id));
        }
        summary.push({ name: checkout.name, total: agents.length, added: added.length, updated: changed.length, removed: removed.length });
    }
    saveAgentsState(state);
    return summary;
}
/** Writes a repo's synced agents' copies into a new worktree, so its worker's tools find them too. */
export function writeAgentCopiesToWorktree(repoName, worktreePath) {
    const synced = loadAgentsState().repos[repoName];
    if (synced?.agents.length)
        writeAgentCopies(worktreePath, synced.agents);
}
/** Whether a checkout's agent files differ from its last Sync: added, removed or edited. */
export function repoAgentsOutOfDate(checkout) {
    const synced = loadAgentsState().repos[checkout.name];
    const files = agentFiles(checkout.path);
    if (!synced)
        return files.length > 0;
    // A snapshot from before Sync read every tool's folder.
    if (!synced.files)
        return true;
    const seen = synced.files;
    if (files.length !== Object.keys(seen).length)
        return true;
    return files.some(({ path }) => {
        const at = seen[relative(checkout.path, path)];
        return at === undefined || statSync(path).mtimeMs !== at;
    });
}
/** A repo's agents for the Agents tab. */
export function listRepoAgents(checkout) {
    const state = loadAgentsState();
    const synced = state.repos[checkout.name];
    const hidden = state.hidden[checkout.name] ?? [];
    return {
        syncedAt: synced?.syncedAt ?? null,
        agents: (synced?.agents ?? []).map((a) => ({
            id: a.id,
            repo: checkout.name,
            title: a.title,
            description: a.description,
            model: a.model,
            file: a.file,
            alsoIn: a.alsoIn ?? [],
            content: a.content,
            hidden: hidden.includes(a.id),
            updated: synced.updated.includes(a.id),
            tools: agentToolStatus(checkout.path, a),
        })),
    };
}
export function setRepoAgentHidden(repo, id, hidden) {
    const state = loadAgentsState();
    const list = (state.hidden[repo] ?? []).filter((x) => x !== id);
    if (hidden)
        list.push(id);
    if (list.length)
        state.hidden[repo] = list;
    else
        delete state.hidden[repo];
    saveAgentsState(state);
}
/* ---------- personas ---------- */
/** A look picked from the name, so an agent looks the same every time. */
export function lookFromName(name) {
    let h = 2166136261;
    for (const ch of name)
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const pick = (key) => {
        const choices = LOOK_CHOICES[key];
        h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
        return choices[h % choices.length].value;
    };
    return {
        hair: pick('hair'),
        hat: pick('hat'),
        face: pick('face'),
        outfit: pick('outfit'),
        shirtColor: pick('shirtColor'),
        hairColor: pick('hairColor'),
    };
}
function toPersona(repo, repoPath, agent, defaults, menu) {
    return {
        id: repoPersonaId(repo, agent.id),
        name: shortPersonaName(agent.title),
        permission: defaults.permission,
        model: nearestModel(agent.model, menu),
        effort: defaults.effort,
        look: lookFromName(agent.name),
        instructions: agent.instructions,
        repo,
        repoPath,
        title: agent.title,
        description: agent.description,
        agentModel: agent.model,
        file: agent.file,
    };
}
/** The repos added to the library, the only ones whose agents are offered. */
function libraryRepoPaths() {
    return new Set(loadSkillsState().libraryRepos ?? []);
}
/**
 * The synced agents of the repos in the library, less the hidden ones, as
 * personas. Setup comes from the office defaults and the model from `menu`.
 */
export function repoPersonas(defaults, menu) {
    const state = loadAgentsState();
    const library = libraryRepoPaths();
    const out = [];
    for (const [repo, synced] of Object.entries(state.repos)) {
        if (!library.has(synced.path))
            continue;
        const hidden = state.hidden[repo] ?? [];
        for (const agent of synced.agents) {
            if (!hidden.includes(agent.id))
                out.push(toPersona(repo, synced.path, agent, defaults, menu));
        }
    }
    return out;
}
/** One repo agent as a persona, hidden or not; null when its repo's last Sync did not find it. */
export function findRepoPersona(id, defaults, menu) {
    const match = /^repo:(.+)\/([^/]+)$/.exec(id);
    if (!match)
        return null;
    const [, repo, agentId] = match;
    const synced = loadAgentsState().repos[repo];
    const agent = synced?.agents.find((a) => a.id === agentId);
    return synced && agent ? toPersona(repo, synced.path, agent, defaults, menu) : null;
}
/** A repo agent as one of Operator's own personas, named so it does not clash with one he has. */
export function personaFromRepoAgent(found, existing) {
    const taken = new Set(existing.map((p) => p.name.toLowerCase()));
    let name = found.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
        const suffix = ` ${n}`;
        name = `${found.name.slice(0, PERSONA_NAME_MAX - suffix.length).trim()}${suffix}`;
    }
    return {
        id: '',
        name,
        permission: found.permission,
        model: found.model,
        effort: found.effort,
        look: found.look,
        instructions: found.instructions,
    };
}
