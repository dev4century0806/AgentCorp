/**
 * General agents: Operator's personas, written into each tool's agents folder in
 * his home so any session on this Mac, in the office or not, can call them as
 * helpers. The persona in the office is the source of truth; the files are
 * rewritten whenever the personas are saved, a tool is turned on or off, or
 * the library syncs. A file of his own with the same name is left alone.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { activeStateDir } from '../config.js';
import { codexCopy, copilotCopy, madeByOffice, markLine } from './agents.js';
/** Each tool's agents folder in the home folder, and the ending of an agent file there. */
const GENERAL_AGENT_DIRS = [
    { toolId: 'claude', dir: '.claude/agents', ext: '.md' },
    { toolId: 'cursor', dir: '.cursor/agents', ext: '.md' },
    { toolId: 'codex', dir: '.codex/agents', ext: '.toml' },
    { toolId: 'copilot', dir: '.copilot/agents', ext: '.agent.md' },
];
/** Claude Code takes these model aliases as they are. */
const CLAUDE_MODELS = /^(fable|opus|sonnet|haiku|claude-)/i;
function stateFile() {
    return join(activeStateDir(), 'general-agents-state.json');
}
function loadState() {
    try {
        const raw = JSON.parse(readFileSync(stateFile(), 'utf8'));
        return { off: raw.off ?? {} };
    }
    catch {
        return { off: {} };
    }
}
function saveState(state) {
    mkdirSync(dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}
/** "You take the hardest problems. Plan…" as "You take the hardest problems." */
export function firstSentence(text) {
    const flat = text.replace(/\s+/g, ' ').trim();
    const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
    return sentence.length > 200 ? `${sentence.slice(0, 199).trimEnd()}…` : sentence;
}
/** What the files tell the tools the persona is for. */
export function personaDescription(persona) {
    return persona.description?.trim() || firstSentence(persona.instructions) || persona.name;
}
function agentSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'persona';
}
/** Each persona with the name its files go by, numbered where two would clash. */
function personaAgents(personas) {
    const taken = new Set();
    return personas.map((persona) => {
        const base = agentSlug(persona.name);
        let name = base;
        for (let n = 2; taken.has(name); n++)
            name = `${base}-${n}`;
        taken.add(name);
        const description = personaDescription(persona);
        return {
            persona,
            agent: {
                id: name,
                name,
                title: persona.name,
                description,
                instructions: persona.instructions || description,
                model: persona.model,
                tools: null,
                disallowedTools: null,
                otherKeys: [],
                file: `your agent "${persona.name}"`,
                content: '',
                mtimeMs: 0,
            },
        };
    });
}
/** A Claude Code or Cursor agent file; only Claude Code takes the office's model names. */
function markdownCopy(agent, toolId, dir, mark) {
    const head = ['---', mark, `name: ${agent.name}`, `description: ${JSON.stringify(agent.description)}`];
    if (agent.model && toolId === 'claude' && CLAUDE_MODELS.test(agent.model))
        head.push(`model: ${agent.model}`);
    head.push('---', '');
    return { toolId, file: `${dir}/${agent.name}.md`, text: `${head.join('\n')}${agent.instructions}\n`, skipped: [] };
}
/**
 * A persona's file for every tool, paths relative to the home folder. A model
 * a tool cannot take is left out without a note: the persona's model is for
 * hires in the office, and as a helper the tool's own is the expected one.
 */
function copiesFor(agent) {
    const mark = markLine(agent.file, "Edit it in AgentCorp's Toolkit");
    const dir = (toolId) => GENERAL_AGENT_DIRS.find((d) => d.toolId === toolId).dir;
    const notModel = (copy) => copy.skipped.filter((s) => !s.startsWith('model '));
    const codex = codexCopy(agent, mark);
    const copilot = copilotCopy(agent, mark);
    return [
        markdownCopy(agent, 'claude', dir('claude'), mark),
        markdownCopy(agent, 'cursor', dir('cursor'), mark),
        { ...codex, file: `${dir('codex')}/${agent.name}.toml`, skipped: notModel(codex) },
        { ...copilot, file: `${dir('copilot')}/${agent.name}.agent.md`, skipped: notModel(copilot) },
    ];
}
/**
 * Writes every persona's files for the tools it is on for, and removes the
 * files the office wrote for personas, names or tools no longer wanted.
 */
export function writeGeneralAgents(personas) {
    const home = homedir();
    const state = loadState();
    const wanted = new Set();
    for (const { persona, agent } of personaAgents(personas)) {
        const off = state.off[persona.id] ?? [];
        for (const copy of copiesFor(agent)) {
            if (off.includes(copy.toolId))
                continue;
            const path = join(home, copy.file);
            wanted.add(path);
            try {
                if (existsSync(path) && (!madeByOffice(path) || readFileSync(path, 'utf8') === copy.text))
                    continue;
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, copy.text, 'utf8');
            }
            catch {
                // A file that cannot be written shows as not written in the Agents tab.
            }
        }
    }
    for (const { dir, ext } of GENERAL_AGENT_DIRS) {
        let names;
        try {
            names = readdirSync(join(home, dir));
        }
        catch {
            continue;
        }
        for (const name of names) {
            const path = join(home, dir, name);
            if (name.endsWith(ext) && !wanted.has(path) && madeByOffice(path))
                rmSync(path, { force: true });
        }
    }
    const ids = new Set(personas.map((p) => p.id));
    const kept = Object.fromEntries(Object.entries(state.off).filter(([id]) => ids.has(id)));
    if (Object.keys(kept).length !== Object.keys(state.off).length)
        saveState({ off: kept });
}
/** Each persona as a general agent, with how each tool gets it. */
export function listGeneralAgents(personas) {
    const home = homedir();
    const state = loadState();
    return personaAgents(personas).map(({ persona, agent }) => ({
        personaId: persona.id,
        agentName: agent.name,
        description: agent.description,
        tools: copiesFor(agent).map((copy) => {
            const path = join(home, copy.file);
            const shown = { toolId: copy.toolId, file: `~/${copy.file}`, skipped: copy.skipped };
            if ((state.off[persona.id] ?? []).includes(copy.toolId))
                return { ...shown, status: 'off', skipped: [] };
            if (!existsSync(path))
                return { ...shown, status: 'not_written' };
            if (!madeByOffice(path))
                return { ...shown, status: 'taken', skipped: [] };
            return { ...shown, status: readFileSync(path, 'utf8') === copy.text ? 'written' : 'not_written' };
        }),
    }));
}
/** Turns a tool on or off for one persona, and rewrites the files to match. */
export function setGeneralAgentTool(personas, personaId, toolId, on) {
    const state = loadState();
    const list = (state.off[personaId] ?? []).filter((t) => t !== toolId);
    if (!on)
        list.push(toolId);
    if (list.length)
        state.off[personaId] = list;
    else
        delete state.off[personaId];
    saveState(state);
    writeGeneralAgents(personas);
}
