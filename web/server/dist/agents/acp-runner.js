import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NO_EFFORT_MODELS, } from '../protocol.js';
import { BaseRunner, missingWorktree } from './runner.js';
import { JsonRpcPeer } from './jsonrpc.js';
import { plainStep } from './plain.js';
import { bubbleForTool, isReadOnlyCall, makePermissionRequest, normalizeTool, NO_WORKTREE_YET, ruleForToolCall, toolOutputTail, truncate, truncateLabel, writesOutside, } from './events.js';
const ACP_PROTOCOL_VERSION = 1;
/** How long a step announced without its command or file waits for them before it is shown anyway. */
const ANNOUNCE_WAIT_MS = 1200;
/** Whether a tool call says what it will do: a command, a file, a pattern, anything at all. */
function hasDetail(input) {
    return !!input && typeof input === 'object' && Object.values(input).some((v) => v !== '' && v !== null && v !== undefined);
}
const INLINE_TEXT_LIMIT = 200_000;
export function cursorAgent(opts) {
    return {
        mode: 'acp',
        command: opts.command ?? 'agent',
        args: ['acp', ...(opts.model ? ['--model', opts.model] : [])],
        env: { CURSOR_AGENT_CLIENT: 'agent-corp' },
        passMcpServers: true,
    };
}
/** The folders a session reaches beyond its own: the repos it reads, and the files sent to it. */
function otherFolders(opts) {
    return [...readOnlyRepos(opts), opts.uploadsDir].filter((d) => !!d);
}
/** Every repo the session reads and never changes, the main one first. */
function readOnlyRepos(opts) {
    return opts.readOnlyRepo ? [opts.readOnlyRepo, ...(opts.extraRepos ?? [])] : [];
}
export function claudeAgent(opts) {
    return {
        mode: 'claude',
        command: process.execPath,
        args: [CLAUDE_ACP],
        env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
        passMcpServers: true,
        additionalDirectories: otherFolders(opts),
        sessionMeta: {
            claudeCode: {
                options: {
                    settingSources: ['project'],
                    ...(opts.model ? { model: opts.model } : {}),
                    ...thinkingSummaries(opts.model),
                },
            },
        },
        modeId: claudeModeId(opts),
        effortOption: 'effort',
        formElicitation: true,
        subagents: true,
    };
}
/**
 * Asks Claude Code to show what the model is thinking. Without this it streams
 * no thinking text at all, so a worker thinking for minutes looks exactly like
 * a hang.
 *
 * The setting is enough for Haiku and leaves the thinking itself alone. Opus
 * and the other adaptive models ignore it and show their thinking only when
 * the thinking option asks for a summarized display. That option also sets
 * the mode, so it is left out for Haiku, which has no adaptive thinking, and
 * whenever MAX_THINKING_TOKENS has already chosen a mode or a budget, which
 * it would override. The setting is left out when CLAUDE_MODEL_CONFIG is set,
 * because the adapter puts that config in the same place.
 */
export function thinkingSummaries(model, env = process.env) {
    const adaptive = !/haiku/i.test(model ?? '') && env['MAX_THINKING_TOKENS'] === undefined;
    return {
        ...(env['CLAUDE_MODEL_CONFIG'] ? {} : { settings: { showThinkingSummaries: true } }),
        ...(adaptive ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
    };
}
/**
 * Claude Code's own permission mode. It accepts edits by itself only in the
 * worker's own worktree and only below `ask`; everything else comes to the
 * office, which decides whether Operator is asked.
 */
export function claudeModeId(opts) {
    return opts.readOnlyRepo || opts.permission === 'ask' ? 'default' : 'acceptEdits';
}
export const CLAUDE_ACP = fileURLToPath(import.meta.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'));
export const COPILOT_CLI = fileURLToPath(import.meta.resolve('@github/copilot/npm-loader.js'));
export const CODEX_ACP = fileURLToPath(import.meta.resolve('@agentclientprotocol/codex-acp/dist/index.js'));
export function copilotAgent(opts) {
    const dirs = otherFolders(opts);
    return {
        mode: 'copilot',
        command: process.execPath,
        args: [COPILOT_CLI, '--acp', ...dirs.flatMap((d) => ['--add-dir', d])],
        passMcpServers: true,
        effortOption: 'reasoning_effort',
        ownModel: true,
    };
}
export function codexAgent(opts) {
    return {
        mode: 'codex',
        command: process.execPath,
        args: [CODEX_ACP],
        env: { CODEX_CONFIG: JSON.stringify({ features: { default_mode_request_user_input: true } }) },
        passMcpServers: true,
        additionalDirectories: otherFolders(opts),
        modeId: opts.readOnlyRepo || opts.permission === 'ask' ? 'read-only' : 'workspace-write',
        effortOption: 'reasoning_effort',
        ownModel: true,
        formElicitation: true,
    };
}
/**
 * `agent acp` runs the CLI as an ACP (Agent Client Protocol) server over
 * stdio: one long-lived process per worker, multi-turn chat, and real
 * permission prompts delivered as `session/request_permission` requests we
 * answer with Operator's decision.
 */
export class AcpRunner extends BaseRunner {
    agent;
    mode;
    child = null;
    peer = null;
    sessionId = null;
    turn = null;
    generation = 0;
    promptCaps = {};
    replaying = false;
    configOptions = [];
    startingConfig = new Map();
    /** Set once we have asked the process to exit, so its exit is not an error. */
    stopping = false;
    /** Agents the CLI started and has not reported finished, by their own session id. */
    helpers = new Map();
    /** Permission requests waiting on Operator, keyed by our own request id. */
    waiting = new Map();
    asking = new Map();
    constructor(opts, agent = cursorAgent(opts)) {
        super(opts);
        this.agent = agent;
        this.mode = agent.mode;
        if (agent.ownModel)
            this._model = null;
    }
    get chosenModel() {
        return this.agent.ownModel ? null : (this.opts.model ?? null);
    }
    async start() {
        const gone = missingWorktree(this.opts.worktreePath);
        if (gone)
            throw new Error(gone);
        if (this.opts.uploadsDir)
            mkdirSync(this.opts.uploadsDir, { recursive: true });
        const child = spawn(this.agent.command, this.agent.args, {
            cwd: this.opts.worktreePath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...this.agent.env },
        });
        this.child = child;
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            for (const line of chunk.split('\n')) {
                if (line.trim())
                    this.emit({ kind: 'raw', line: `[stderr] ${line}` });
            }
        });
        child.on('exit', (code, signal) => {
            this.peer?.close();
            // We asked it to go, so its exit is not news. The CLI traps SIGTERM and
            // exits 143 rather than dying by signal, so the code has to be checked
            // too or every Stop would paint the worker red.
            this._started = false;
            const asked = this.stopping || code === 143 || code === 130;
            if (asked) {
                this._busy = false;
                return;
            }
            if (code !== 0 && code !== null) {
                this.emit({ kind: 'error', message: `The agent process exited with code ${code}.` });
            }
            else if (signal && signal !== 'SIGTERM' && signal !== 'SIGINT') {
                this.emit({ kind: 'error', message: `The agent process was killed with ${signal}.` });
            }
            this._busy = false;
        });
        const startError = (err) => new Error(`Could not start \`${[this.agent.command, ...this.agent.args].join(' ')}\`: ${err.message}`);
        let spawned = false;
        child.on('error', (err) => {
            if (spawned)
                this.emit({ kind: 'error', message: startError(err).message });
        });
        await new Promise((resolve, reject) => {
            child.once('spawn', () => {
                spawned = true;
                resolve();
            });
            child.once('error', (err) => {
                if (spawned)
                    return;
                this.child = null;
                reject(startError(err));
            });
        });
        this.peer = new JsonRpcPeer(child.stdin, child.stdout, {
            onRequest: (method, params, id) => this.handleRequest(method, params, id),
            onNotification: (method, params) => this.handleNotification(method, params),
            onParseError: (line) => this.emit({ kind: 'raw', line }),
        });
        const init = await this.peer.request('initialize', {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientCapabilities: {
                // The agent does its own file and terminal work inside the worktree,
                // so the office does not need to proxy either.
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false,
                ...(this.agent.formElicitation ? { elicitation: { form: {} } } : {}),
                // Claude Code holds a turn open until every agent it sent off has
                // finished, and says nothing while it waits. Without this the office
                // cannot tell that wait from a hang.
                ...(this.agent.subagents ? { subagents: {} } : {}),
            },
            clientInfo: { name: 'agent-corp', version: '0.1.0' },
        }, 60_000);
        this.promptCaps = init?.agentCapabilities?.promptCapabilities ?? {};
        await this.openSession(this.opts.chatId ?? null);
        this._started = true;
    }
    async openSession(chatId) {
        if (!this.peer)
            throw new Error('The agent session is not started.');
        const sessionParams = {
            cwd: this.opts.worktreePath,
            mcpServers: this.agent.passMcpServers ? ((await this.opts.mcpServers?.()) ?? []) : [],
            ...(this.agent.additionalDirectories?.length ? { additionalDirectories: this.agent.additionalDirectories } : {}),
            ...(this.agent.sessionMeta ? { _meta: this.agent.sessionMeta } : {}),
        };
        if (chatId) {
            this.replaying = true;
            try {
                const loaded = await this.peer.request('session/load', { ...sessionParams, sessionId: chatId }, 120_000);
                this.sessionId = chatId;
                this.rememberConfig(loaded);
                this.setModel(modelLabel(loaded, this.chosenModel));
            }
            catch (err) {
                this.emit({
                    kind: 'raw',
                    line: `[acp] could not resume ${chatId} (${err.message}); starting a new session`,
                });
            }
            finally {
                this.replaying = false;
            }
        }
        if (!this.sessionId) {
            const result = await this.peer.request('session/new', sessionParams, 120_000);
            if (!result?.sessionId)
                throw new Error('session/new returned no sessionId.');
            this.sessionId = result.sessionId;
            this.rememberConfig(result);
            this.setModel(modelLabel(result, this.chosenModel));
        }
        if (this.agent.modeId) {
            await this.peer
                .request('session/set_mode', { sessionId: this.sessionId, modeId: this.agent.modeId }, 30_000)
                .catch((err) => this.emit({ kind: 'raw', line: `[acp] could not set mode ${this.agent.modeId}: ${err.message}` }));
        }
        // A resumed session keeps the model it was saved with, so the worker's
        // own choice is set again either way.
        if (this.agent.effortOption)
            await this.sendModelAndEffort();
        this._chatId = this.sessionId;
        this.emit({ kind: 'session', chatId: this.sessionId });
    }
    async switchSession(chatId) {
        if (!this.peer || !this._started)
            return false;
        if (this._busy)
            await this.cancel();
        this.generation++;
        this.dropAnnounced();
        this.dropHelpers();
        this._busy = false;
        this.sessionId = null;
        this._chatId = chatId;
        return true;
    }
    async prompt(text, files = []) {
        if (!this.peer || !this._started)
            throw new Error('The agent session is not started.');
        const prompt = promptBlocks(text, files, this.promptCaps);
        this._busy = true;
        const generation = this.generation;
        if (!this.sessionId) {
            try {
                await this.openSession(this._chatId);
            }
            catch (err) {
                this._busy = false;
                throw err;
            }
        }
        const current = () => generation === this.generation;
        this.turn = (async () => {
            try {
                const result = await this.peer.request('session/prompt', { sessionId: this.sessionId, prompt }, 60 * 60_000);
                if (!current())
                    return;
                const stop = result?.stopReason ?? 'end_turn';
                if (stop === 'refusal') {
                    this.emit({ kind: 'error', message: 'The model refused the request.' });
                }
                this.emit({ kind: 'turn_end', text: stop });
            }
            catch (err) {
                if (!this.stopping && current())
                    this.emit({ kind: 'error', message: err.message });
            }
            finally {
                if (current()) {
                    this._busy = false;
                    this.dropAnnounced();
                    this.dropHelpers();
                }
            }
        })();
    }
    async answerPermission(requestId, allow) {
        const pending = this.waiting.get(requestId);
        if (!pending)
            return;
        this.waiting.delete(requestId);
        pending.resolve(allow ? pending.allowOption : pending.denyOption);
        this.emit({ kind: 'permission_resolved', requestId });
    }
    async answerQuestion(requestId, answers) {
        const pending = this.asking.get(requestId);
        if (!pending)
            return;
        this.asking.delete(requestId);
        pending.resolve(answers ? { action: 'accept', content: formContent(pending.request, answers) } : { action: 'decline' });
        this.emit({ kind: 'question_resolved', requestId });
    }
    async cancel() {
        if (!this.peer || !this.sessionId)
            return;
        // Anything still waiting on Operator would otherwise hang the cancelled turn.
        for (const [id, p] of this.waiting) {
            p.resolve(null);
            this.emit({ kind: 'permission_resolved', requestId: id });
        }
        this.waiting.clear();
        for (const [id, q] of this.asking) {
            q.resolve({ action: 'cancel' });
            this.emit({ kind: 'question_resolved', requestId: id });
        }
        this.asking.clear();
        this.dropAnnounced();
        this.dropHelpers();
        this.peer.notify('session/cancel', { sessionId: this.sessionId });
        // A wedged ACP turn may never answer session/cancel. Stop still has to
        // return so the UI can recover and the process can be disposed later.
        await Promise.race([
            this.turn?.catch(() => { }),
            new Promise((resolve) => {
                const timer = setTimeout(resolve, 3000);
                timer.unref();
            }),
        ]);
        this._busy = false;
    }
    /**
     * The CLI answers within milliseconds even in the middle of a turn, so five
     * seconds without a reply means its process is there but no longer reading.
     */
    async applySetup(setup) {
        const was = { ...this.opts };
        await super.applySetup(setup);
        if (!this.agent.effortOption || !this.peer || !this.sessionId)
            return;
        const modeId = claudeModeId(this.opts);
        if (this.agent.mode === 'claude' && modeId !== claudeModeId(was)) {
            this.agent.modeId = modeId;
            await this.peer.request('session/set_mode', { sessionId: this.sessionId, modeId }, 30_000);
        }
        if (setup.model !== was.model || setup.effort !== was.effort)
            await this.sendModelAndEffort();
    }
    /**
     * Model first, since the effort levels on offer depend on it. A model with
     * no effort setting is left on its own; Claude Code would reject one.
     */
    async sendModelAndEffort() {
        const model = this.configValue('model', this.opts.model);
        if (model)
            await this.setConfig('model', model);
        if (model && NO_EFFORT_MODELS.has(model))
            return;
        const effort = this.configValue(this.agent.effortOption, this.opts.effort);
        if (effort)
            await this.setConfig(this.agent.effortOption, effort);
    }
    rememberConfig(result) {
        const options = result?.configOptions ?? [];
        for (const o of options) {
            if (o.id && typeof o.currentValue === 'string' && !this.startingConfig.has(o.id))
                this.startingConfig.set(o.id, o.currentValue);
        }
        this.takeConfig(options);
    }
    /** Keeps the session's latest settings, and the menu built from them for the chat and the Workers list. */
    takeConfig(options) {
        this.configOptions = options;
        this.setMenu(options.length ? this.modelMenu() : null);
    }
    configValue(configId, chosen) {
        if (!this.agent.ownModel)
            return chosen ?? (configId === this.agent.effortOption ? this.defaultEffort() : 'default');
        const offered = this.configOptions.find((o) => o.id === configId)?.options?.some((o) => o.value === chosen);
        return (offered ? chosen : this.startingConfig.get(configId)) ?? null;
    }
    /**
     * The level a worker on Default effort runs on, sent as a real level so
     * the office can say which it is: the one the session started on when the
     * user's settings chose one, otherwise Medium, as Claude Code recommends,
     * or its first level for a model without Medium.
     */
    defaultEffort() {
        const id = this.agent.effortOption;
        const levels = (this.configOptions.find((o) => o.id === id)?.options ?? []).map((o) => o.value).filter((v) => !!v && v !== 'default');
        const started = this.startingConfig.get(id);
        if (started && started !== 'default' && (!levels.length || levels.includes(started)))
            return started;
        return !levels.length || levels.includes('medium') ? 'medium' : levels[0];
    }
    async setConfig(configId, value) {
        const result = await this.peer
            ?.request('session/set_config_option', { sessionId: this.sessionId, configId, value }, 30_000)
            .catch((err) => {
            this.emit({ kind: 'raw', line: `[acp] could not set ${configId} to ${value}: ${err.message}` });
            return null;
        });
        if (result?.configOptions?.length) {
            this.takeConfig(result.configOptions);
            this.setModel(modelLabel(result, this.chosenModel));
        }
    }
    /**
     * The session's models and efforts, with Default's hint saying what it
     * comes to. That is the value the session started on, since the worker's
     * own choice is set over it. Claude Code offers its own "default" entry,
     * whose description names the model, so that one folds into Default. Its
     * Default effort names the level the office sends for it instead.
     */
    modelMenu() {
        const choices = (o, levelFor) => {
            const offered = (o?.options ?? []).filter((x) => !!x.value);
            const started = o && levelFor ? levelFor() : ((o?.id && this.startingConfig.get(o.id)) ?? o?.currentValue);
            const start = offered.find((x) => x.value === started);
            const resolved = start?.value === 'default' ? start.description : (start?.name ?? start?.value);
            return [
                { value: null, label: 'Default', ...(resolved ? { hint: resolved } : {}) },
                ...offered
                    .filter((x) => x.value !== 'default')
                    .map((x) => ({ value: x.value, label: x.name ?? x.value, ...(x.description ? { hint: x.description } : {}) })),
            ];
        };
        return {
            models: choices(this.configOptions.find((o) => o.category === 'model' || o.id === 'model')),
            efforts: choices(this.configOptions.find((o) => o.id === this.agent.effortOption), this.agent.ownModel ? undefined : () => this.defaultEffort()),
        };
    }
    /** Steps announced without their details yet, by tool call id. */
    announcing = new Map();
    /**
     * Titles of steps still running, by tool call id. Codex asks to approve an
     * MCP call with only the id of the step it announced, so the title (such as
     * "mcp.office.office_status") has to come from that announcement.
     */
    callTitles = new Map();
    startTool(callId, tool, title, input) {
        const waiting = this.announcing.get(callId);
        if (waiting) {
            clearTimeout(waiting.timer);
            this.announcing.delete(callId);
        }
        const label = title.trim() ? title : bubbleForTool(tool, input);
        this.emit({
            kind: 'tool_start',
            callId,
            tool,
            label: truncateLabel(label, 60),
            plain: truncateLabel(plainStep(tool, input, title), 90),
            input,
        });
    }
    /**
     * Forgets the steps of a turn that has ended. Claude Code can announce a
     * bare "Terminal" and end the turn before the details come; shown 1.2s
     * later, that step would start after the turn, never end, and keep a
     * worker who is waiting on Operator looking busy.
     */
    dropAnnounced() {
        for (const [, a] of this.announcing)
            clearTimeout(a.timer);
        this.announcing.clear();
        this.callTitles.clear();
    }
    get backgroundAgents() {
        return [...this.helpers.values()];
    }
    /** Forgets the agents of a turn that is over; the CLI stops them with it. */
    dropHelpers() {
        if (!this.helpers.size)
            return;
        this.helpers.clear();
        this.emit({ kind: 'background', agents: [] });
    }
    /**
     * An agent the CLI started. The CLI no longer reports the Agent call itself
     * once it reports agents, so it is shown as a step here instead.
     */
    helperStarted(update) {
        const id = update['subagentSessionId'];
        if (typeof id !== 'string' || this.helpers.has(id))
            return;
        const name = typeof update['name'] === 'string' && update['name'].trim() ? update['name'].trim() : 'Helper agent';
        const task = typeof update['task'] === 'string' ? update['task'].trim().replace(/\s+/g, ' ') : '';
        this.helpers.set(id, { name, task: truncate(task, 200), since: new Date().toISOString() });
        const input = { description: name, prompt: task };
        this.emit({
            kind: 'tool_start',
            callId: id,
            tool: 'agent',
            label: truncateLabel(name, 60),
            plain: truncateLabel(`Handing a task to a helper agent: ${name}`, 90),
            input,
        });
        this.emit({ kind: 'background', agents: this.backgroundAgents });
    }
    helperFinished(update) {
        const id = update['subagentSessionId'];
        if (typeof id !== 'string' || update['state'] === 'running' || !this.helpers.delete(id))
            return;
        this.emit({ kind: 'tool_end', callId: id, tool: 'agent', ok: update['state'] === 'completed' });
        this.emit({ kind: 'background', agents: this.backgroundAgents });
    }
    async probe() {
        const child = this.child;
        // Not spawned yet, or let go of on purpose: there is nothing to look at.
        if (!child)
            return { alive: null, pid: null, answering: null };
        if (child.exitCode !== null || child.signalCode !== null)
            return { alive: false, pid: null, answering: null };
        return { alive: true, pid: child.pid ?? null, answering: this.peer ? await this.peer.answers(5_000) : false };
    }
    async dispose() {
        this.stopping = true;
        this._started = false;
        this.dropAnnounced();
        this.dropHelpers();
        for (const [, p] of this.waiting)
            p.resolve(null);
        this.waiting.clear();
        for (const [, q] of this.asking)
            q.resolve({ action: 'cancel' });
        this.asking.clear();
        this.peer?.close();
        this.peer = null;
        const child = this.child;
        this.child = null;
        if (!child || child.exitCode !== null)
            return;
        child.kill('SIGTERM');
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                // Negative pid signals the whole process group, catching any shell
                // the agent spawned for a long-running command.
                try {
                    if (child.pid)
                        process.kill(-child.pid, 'SIGKILL');
                }
                catch {
                    child.kill('SIGKILL');
                }
                resolve();
            }, 3000);
            timer.unref();
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    /* ---------- incoming ---------- */
    handleRequest(method, params, id) {
        if (method === 'session/request_permission') {
            return this.onPermissionRequest(params);
        }
        if (method === 'elicitation/create') {
            return this.onElicitation(params, id);
        }
        // fs/* and terminal/* should not arrive, since we declared no capability.
        throw new Error(`Unsupported client method ${method}`);
    }
    onPermissionRequest(params) {
        const rawOptions = Array.isArray(params['options']) ? params['options'] : [];
        const asked = (params['toolCall'] ?? {});
        const announced = this.callTitles.get(String(asked['toolCallId'] ?? ''));
        const toolCall = announced && !(typeof asked['title'] === 'string' && asked['title'].trim()) ? { ...asked, title: announced } : asked;
        const allow = rawOptions.find((o) => o.kind === 'allow_once') ??
            rawOptions.find((o) => o.kind?.startsWith('allow')) ??
            rawOptions[0];
        const deny = rawOptions.find((o) => o.kind === 'reject_once') ??
            rawOptions.find((o) => o.kind?.startsWith('reject')) ??
            rawOptions[rawOptions.length - 1];
        if (this.opts.readOnlyRepo &&
            writesOutside({ tool: String(toolCall['kind'] ?? 'tool'), rawInput: toolCall['rawInput'], locations: locationPaths(toolCall) }, this.opts.worktreePath)) {
            this.emit({ kind: 'raw', line: `[acp] ${NO_WORKTREE_YET}` });
            return Promise.resolve({ outcome: { outcome: 'selected', optionId: deny?.optionId ?? 'reject' } });
        }
        const kind = normalizeTool(String(toolCall['kind'] ?? 'tool'));
        if (this.opts.readOnlyRepo && (kind === 'edit' || kind === 'write') && allow) {
            return Promise.resolve({ outcome: { outcome: 'selected', optionId: allow.optionId } });
        }
        const title = typeof toolCall['title'] === 'string' && toolCall['title'].trim()
            ? toolCall['title']
            : 'The agent needs your approval';
        // The CLI's own *_always options are dropped, and the office offers its
        // own standing approval instead. The CLI writes an "allow always" into
        // ~/.cursor/cli-config.json, which grants it to every Cursor session on
        // the machine; a grant held here covers only the office's workers and can
        // be taken back in the panel. Only the one-shot options are ever sent back.
        const offered = rawOptions.filter((o) => !o.kind?.endsWith('_always'));
        const request = makePermissionRequest({
            title: truncateLabel(title, 120),
            detail: describeToolCall(toolCall),
            options: offered.length
                ? offered.map((o) => ({
                    id: o.optionId,
                    label: o.name,
                    kind: o.kind?.startsWith('reject') ? 'deny' : 'allow',
                }))
                : undefined,
            rule: ruleForToolCall({
                tool: String(toolCall['kind'] ?? 'tool'),
                rawInput: toolCall['rawInput'],
                title: typeof toolCall['title'] === 'string' ? toolCall['title'] : undefined,
                locations: locationPaths(toolCall),
                worktreePath: this.opts.worktreePath,
            }),
            plain: plainStep(String(toolCall['kind'] ?? 'tool'), toolCall['rawInput'], title),
            readOnly: isReadOnlyCall({
                tool: String(toolCall['kind'] ?? 'tool'),
                rawInput: toolCall['rawInput'],
                title: typeof toolCall['title'] === 'string' ? toolCall['title'] : undefined,
                locations: locationPaths(toolCall),
            }, [this.opts.worktreePath, ...readOnlyRepos(this.opts)]),
        });
        return new Promise((resolve) => {
            this.waiting.set(request.id, {
                allowOption: allow?.optionId ?? 'allow',
                denyOption: deny?.optionId ?? 'reject',
                resolve: (optionId) => resolve(optionId
                    ? { outcome: { outcome: 'selected', optionId } }
                    : { outcome: { outcome: 'cancelled' } }),
            });
            // Only once it is waiting. A standing approval answers inside this
            // emit, and an answer that finds nothing waiting is dropped, leaving
            // the CLI blocked on a request nobody will ever see.
            this.emit({ kind: 'permission_request', request });
        });
    }
    onElicitation(params, rpcId) {
        const request = questionFromForm(params);
        if (!request)
            return Promise.resolve({ action: 'decline' });
        return new Promise((resolve) => {
            this.asking.set(request.id, { request, rpcId, resolve });
            this.emit({ kind: 'question_request', request });
        });
    }
    withdrawQuestion(rpcId) {
        for (const [id, q] of this.asking) {
            if (q.rpcId !== rpcId)
                continue;
            this.asking.delete(id);
            q.resolve({ action: 'cancel' });
            this.emit({ kind: 'question_resolved', requestId: id });
        }
    }
    handleNotification(method, params) {
        if (method === '$/cancel_request') {
            this.withdrawQuestion(params?.requestId);
            return;
        }
        if (method !== 'session/update' || this.replaying)
            return;
        const p = (params ?? {});
        // An agent the CLI started reports its own steps and words under its own
        // session id. They are shown as the worker's, as they were before the
        // CLI was asked to report agents.
        if (typeof p['sessionId'] === 'string' && p['sessionId'] !== this.sessionId && !this.helpers.has(p['sessionId']))
            return;
        const update = (p['update'] ?? {});
        const kind = update['sessionUpdate'];
        switch (kind) {
            case 'agent_message_chunk': {
                const text = contentText(update['content']);
                if (text)
                    this.emit({ kind: 'text_delta', text });
                break;
            }
            case 'agent_thought_chunk': {
                const text = contentText(update['content']);
                this.emit(text ? { kind: 'thinking', text } : { kind: 'thinking' });
                break;
            }
            case 'tool_call': {
                const callId = String(update['toolCallId'] ?? '');
                const tool = toolName(update);
                const title = typeof update['title'] === 'string' ? update['title'] : '';
                if (title.trim())
                    this.callTitles.set(callId, title);
                // Claude Code announces a step before it has written the command or
                // picked the file, as a bare "Terminal" or "Read File", and sends the
                // details in an update a moment later. Shown at once, the step would
                // say nothing, so it waits briefly for them; a long write still shows
                // up within a second.
                if (hasDetail(update['rawInput'])) {
                    this.startTool(callId, tool, title, update['rawInput']);
                }
                else {
                    const timer = setTimeout(() => {
                        const waiting = this.announcing.get(callId);
                        if (waiting)
                            this.startTool(callId, waiting.tool, waiting.title, undefined);
                    }, ANNOUNCE_WAIT_MS);
                    this.announcing.set(callId, { tool, title, timer });
                }
                break;
            }
            case 'tool_call_update': {
                const status = String(update['status'] ?? '');
                const callId = String(update['toolCallId'] ?? '');
                const waiting = this.announcing.get(callId);
                if (typeof update['title'] === 'string' && update['title'].trim())
                    this.callTitles.set(callId, update['title']);
                if (waiting && (hasDetail(update['rawInput']) || status === 'completed' || status === 'failed')) {
                    const kind = update['kind'];
                    const title = typeof update['title'] === 'string' && update['title'].trim() ? update['title'] : waiting.title;
                    this.startTool(callId, typeof kind === 'string' && kind !== 'other' ? kind : waiting.tool, title, update['rawInput']);
                }
                // 'completed' does not always mean finished. A shell command that
                // outlives the CLI's block window (30s unless the model asks for
                // more) is reported completed, exit 0, with whatever it printed so
                // far, and keeps running in the background. The model then waits on
                // it with AwaitShell, which sends nothing over ACP, often for
                // minutes. A quiet turn after a tool is therefore normal, and nothing
                // here may time it out: cancelling kills the command.
                if (status === 'completed' || status === 'failed') {
                    this.callTitles.delete(callId);
                    const ok = status === 'completed';
                    this.emit({
                        kind: 'tool_end',
                        callId: String(update['toolCallId'] ?? ''),
                        tool: toolName(update),
                        ok,
                        output: toolOutputTail(update['rawOutput'], ok),
                    });
                }
                break;
            }
            case 'config_option_update':
                if (Array.isArray(update['configOptions']))
                    this.takeConfig(update['configOptions']);
                this.setModel(modelLabel(update, this.chosenModel));
                break;
            case 'available_commands_update':
                this.setCommands(slashCommands(update['availableCommands']));
                break;
            case 'subagent_spawned':
                this.helperStarted(update);
                break;
            case 'subagent_state_update':
                this.helperFinished(update);
                break;
            default:
                // plan, current_mode_update and anything newer land in the stream log only.
                this.emit({ kind: 'raw', line: `[acp] ${JSON.stringify(update).slice(0, 500)}` });
        }
    }
}
/** The commands in an ACP `available_commands_update`, dropping any without a name. */
export function slashCommands(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.flatMap((c) => {
        const name = typeof c?.name === 'string' ? c.name.trim().replace(/^\//, '') : '';
        if (!name)
            return [];
        const hint = typeof c.input?.hint === 'string' && c.input.hint.trim() ? c.input.hint.trim() : null;
        return [{ name, description: typeof c.description === 'string' ? c.description.trim() : '', hint }];
    });
}
export function modelLabel(state, chosen) {
    const s = (state ?? {});
    const option = s.configOptions?.find((o) => o.category === 'model' || o.id === 'model');
    if (option && typeof option.currentValue === 'string') {
        const value = chosen || option.currentValue;
        const current = option.options?.find((o) => o.value === value);
        if (value === 'default' && current?.description)
            return current.description;
        return current?.name ?? value;
    }
    const id = chosen || s.models?.currentModelId;
    if (!id)
        return null;
    return s.models?.availableModels?.find((m) => m.modelId === id)?.name ?? id;
}
export function promptBlocks(text, files, caps) {
    const blocks = [];
    for (const f of files) {
        const uri = pathToFileURL(f.path).href;
        const bytes = readFileSync(f.path);
        if (caps.image && f.mimeType.startsWith('image/')) {
            blocks.push({ type: 'image', mimeType: f.mimeType, data: bytes.toString('base64'), uri });
        }
        else if (caps.embeddedContext && bytes.length <= INLINE_TEXT_LIMIT) {
            const content = utf8(bytes);
            if (content !== null) {
                blocks.push({ type: 'resource', resource: { uri, mimeType: f.mimeType || 'text/plain', text: content } });
                continue;
            }
        }
        blocks.push({ type: 'resource_link', uri, name: f.name, size: bytes.length, ...(f.mimeType ? { mimeType: f.mimeType } : {}) });
    }
    if (text.trim())
        blocks.push({ type: 'text', text });
    return blocks;
}
function utf8(bytes) {
    if (bytes.includes(0))
        return null;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return null;
    }
}
function toolName(update) {
    const kind = update['kind'];
    if (typeof kind === 'string' && kind !== 'other')
        return kind;
    return typeof update['title'] === 'string' && update['title'] ? update['title'] : 'tool';
}
function contentText(content) {
    if (!content)
        return '';
    if (typeof content === 'string')
        return content;
    const c = content;
    if (typeof c['text'] === 'string')
        return c['text'];
    if (Array.isArray(content))
        return content.map(contentText).join('');
    return '';
}
let questionSeq = 0;
function questionFromForm(params) {
    if (params['mode'] !== undefined && params['mode'] !== 'form')
        return null;
    const schema = (params['requestedSchema'] ?? {});
    const properties = schema.properties ?? {};
    const questions = Object.entries(properties).flatMap(([key, field]) => {
        const multiple = field.type === 'array';
        const options = formChoices(multiple ? field.items : field);
        if (!options.length)
            return [];
        const codex = !!field._meta?.codex;
        const otherKey = Object.entries(properties).find(([k, f]) => f.type === 'string' && (k === `${key}_custom` || (f._meta?.codex?.role === 'user_note' && f._meta.codex.questionId === key)))?.[0] ?? null;
        return [{
                key,
                header: (codex ? field.description : field.title) ?? null,
                text: (codex ? field.title : field.description) ?? null,
                multiple,
                options,
                otherKey,
            }];
    });
    const answerable = new Set(questions.flatMap((q) => [q.key, q.otherKey]));
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!questions.length || required.some((k) => !answerable.has(k)))
        return null;
    const message = typeof params['message'] === 'string' ? params['message'].trim() : '';
    const [only] = questions;
    const asked = questions.length === 1 && only?.text ? only.text : null;
    return {
        id: `question-${++questionSeq}-${Date.now().toString(36)}`,
        title: asked ?? (message || 'The agent has a question'),
        questions: asked ? [{ ...only, text: null }] : questions,
        createdAt: new Date().toISOString(),
    };
}
function formChoices(field) {
    const titled = field?.oneOf ?? field?.anyOf;
    if (Array.isArray(titled)) {
        return titled
            .filter((o) => typeof o.const === 'string')
            .map((o) => ({ value: o.const, label: o.title ?? o.const, description: o.description ?? null }));
    }
    if (Array.isArray(field?.enum)) {
        return field.enum
            .filter((v) => typeof v === 'string')
            .map((v, i) => ({ value: v, label: field.enumNames?.[i] ?? v, description: null }));
    }
    return [];
}
function formContent(request, answers) {
    const content = {};
    for (const q of request.questions) {
        const answer = answers[q.key];
        if (!answer)
            continue;
        const picks = answer.picks.filter((p) => q.options.some((o) => o.value === p));
        if (q.multiple && picks.length)
            content[q.key] = picks;
        else if (!q.multiple && picks[0] !== undefined)
            content[q.key] = picks[0];
        const other = answer.other?.trim();
        if (other && q.otherKey)
            content[q.otherKey] = other;
    }
    return content;
}
function locationPaths(toolCall) {
    const locations = toolCall['locations'];
    if (!Array.isArray(locations))
        return [];
    return locations
        .map((l) => l.path)
        .filter((p) => typeof p === 'string');
}
function describeToolCall(toolCall) {
    const raw = toolCall['rawInput'];
    if (raw && typeof raw === 'object') {
        const asRecord = raw;
        const command = asRecord['command'] ?? asRecord['cmd'];
        if (typeof command === 'string')
            return truncate(command, 400);
        return truncate(JSON.stringify(raw), 400);
    }
    const locations = toolCall['locations'];
    if (Array.isArray(locations) && locations.length) {
        return locations
            .map((l) => l.path)
            .filter(Boolean)
            .join('\n');
    }
    return null;
}
