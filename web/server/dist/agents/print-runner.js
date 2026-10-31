import { spawn } from 'node:child_process';
import { BaseRunner, missingWorktree } from './runner.js';
import { bubbleForTool, makePermissionRequest, truncate } from './events.js';
import { plainStep } from './plain.js';
export class PrintRunner extends BaseRunner {
    mode = 'print';
    child = null;
    buffer = '';
    turnText = '';
    queue = [];
    /** Set once we have asked the turn to end, so its exit is not an error. */
    stopping = false;
    constructor(opts) {
        super(opts);
    }
    async start() {
        // Nothing to spawn until there is something to say, but the runner is now
        // live as far as the manager is concerned.
        this._started = true;
    }
    async prompt(message, files = []) {
        const text = files.length ? `${message}\n\nAttached files:\n${files.map((f) => `- ${f.path}`).join('\n')}` : message;
        if (this._busy) {
            this.queue.push(text);
            return;
        }
        this.spawnTurn(text);
    }
    spawnTurn(text) {
        const gone = missingWorktree(this.opts.worktreePath);
        if (gone) {
            this.emit({ kind: 'error', message: gone });
            return;
        }
        const args = [
            '-p',
            '--output-format', 'stream-json',
            '--stream-partial-output',
            // Headless runs would otherwise stop to ask about trusting the worktree.
            '--trust',
        ];
        if (this.opts.model)
            args.push('--model', this.opts.model);
        if (this._chatId)
            args.push('--resume', this._chatId);
        args.push(text);
        this._busy = true;
        this.turnText = '';
        this.buffer = '';
        const child = spawn(this.agentCommand, args, {
            cwd: this.opts.worktreePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });
        this.child = child;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => this.consume(chunk));
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            for (const line of chunk.split('\n')) {
                if (line.trim())
                    this.emit({ kind: 'raw', line: `[stderr] ${line}` });
            }
        });
        child.on('error', (err) => {
            this.emit({ kind: 'error', message: `Could not start \`${this.agentCommand} -p\`: ${err.message}` });
            this._busy = false;
        });
        child.on('exit', (code) => {
            // A trailing line without its newline still matters.
            if (this.buffer.trim())
                this.handleLine(this.buffer.trim());
            this.buffer = '';
            this.child = null;
            this._busy = false;
            // 143/130 mean we cancelled it; that is a stopped turn, not a failure.
            const cancelled = this.stopping || code === 143 || code === 130;
            if (code !== 0 && code !== null && !cancelled) {
                this.emit({ kind: 'error', message: `The agent exited with code ${code}.` });
            }
            else {
                this.emit({ kind: 'turn_end', text: this.turnText });
            }
            if (this.stopping)
                return;
            const next = this.queue.shift();
            if (next !== undefined)
                this.spawnTurn(next);
        });
    }
    async answerPermission() {
        // Print mode has no channel for this; the CLI already answered itself.
    }
    async cancel() {
        this.queue = [];
        const child = this.child;
        if (!child)
            return;
        child.kill('SIGINT');
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                resolve();
            }, 3000);
            timer.unref();
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    /** There is a process only while a turn runs, and nothing to ask it. */
    async probe() {
        const child = this.child;
        if (!child)
            return { alive: null, pid: null, answering: null };
        return { alive: child.exitCode === null, pid: child.pid ?? null, answering: null };
    }
    async dispose() {
        this.stopping = true;
        this._started = false;
        this.queue = [];
        const child = this.child;
        this.child = null;
        if (!child || child.exitCode !== null)
            return;
        child.kill('SIGTERM');
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
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
    consume(chunk) {
        this.buffer += chunk;
        let nl = this.buffer.indexOf('\n');
        while (nl >= 0) {
            const line = this.buffer.slice(0, nl).trim();
            this.buffer = this.buffer.slice(nl + 1);
            if (line)
                this.handleLine(line);
            nl = this.buffer.indexOf('\n');
        }
    }
    handleLine(line) {
        this.emit({ kind: 'raw', line });
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            return; // Not NDJSON; the raw line is already logged.
        }
        const type = String(event['type'] ?? '');
        const subtype = event['subtype'] ? String(event['subtype']) : null;
        const sessionId = event['session_id'];
        if (typeof sessionId === 'string' && sessionId && sessionId !== this._chatId) {
            this._chatId = sessionId;
            this.emit({ kind: 'session', chatId: sessionId });
        }
        switch (type) {
            case 'assistant': {
                const text = assistantText(event['message']);
                if (text) {
                    this.turnText += text;
                    this.emit({ kind: 'text_delta', text });
                }
                break;
            }
            case 'thinking':
                if (subtype === 'delta')
                    this.emit({ kind: 'thinking' });
                break;
            case 'tool_call': {
                const callId = String(event['call_id'] ?? '');
                const { tool, args } = readToolCall(event['tool_call']);
                if (subtype === 'started') {
                    this.emit({
                        kind: 'tool_start',
                        callId,
                        tool,
                        label: truncate(bubbleForTool(tool, args), 60),
                        plain: truncate(plainStep(tool, args), 90),
                        input: args,
                    });
                }
                else if (subtype === 'completed') {
                    this.emit({ kind: 'tool_end', callId, tool, ok: event['is_error'] !== true });
                }
                break;
            }
            case 'interaction_query': {
                if (subtype !== 'request')
                    break;
                const queryType = String(event['query_type'] ?? 'question');
                this.emit({
                    kind: 'permission_request',
                    request: makePermissionRequest({
                        title: describeQuery(queryType),
                        detail: 'Print mode cannot wait for an answer: the CLI already resolved this itself. ' +
                            'Reply in chat to steer the next turn, or switch agents.runnerMode to "acp" for real approvals.',
                    }),
                });
                break;
            }
            case 'result': {
                if (event['is_error'] === true) {
                    this.emit({ kind: 'error', message: String(event['result'] ?? 'The turn failed.') });
                }
                else if (typeof event['result'] === 'string' && event['result'].trim()) {
                    this.turnText = event['result'];
                }
                break;
            }
            default:
                break; // system/init and anything newer stay in the raw log.
        }
    }
}
function assistantText(message) {
    const m = (message ?? {});
    if (!Array.isArray(m.content))
        return '';
    return m.content
        .map((c) => {
        const part = c;
        return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
    })
        .join('');
}
/**
 * The CLI serialises a tool call as a one-key object naming the variant, e.g.
 * `{ editToolCall: { args: { path: "src/x.ts" } } }`.
 */
function readToolCall(toolCall) {
    if (!toolCall || typeof toolCall !== 'object')
        return { tool: 'tool', args: null };
    const entries = Object.entries(toolCall);
    const variant = entries.find(([, v]) => v && typeof v === 'object') ?? entries[0];
    if (!variant)
        return { tool: 'tool', args: null };
    const [key, value] = variant;
    const tool = key.replace(/ToolCall$/, '');
    const inner = (value ?? {});
    const args = inner['args'] ?? inner['rawInput'] ?? inner;
    return { tool, args };
}
function describeQuery(queryType) {
    switch (queryType) {
        case 'askQuestion':
            return 'The agent asked a question';
        case 'requestPermission':
            return 'The agent asked for permission';
        case 'approveWebSearch':
            return 'The agent wanted to search the web';
        case 'approveWebFetch':
            return 'The agent wanted to fetch a URL';
        default:
            return `The agent raised ${queryType}`;
    }
}
