import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_ACP, CODEX_ACP, COPILOT_CLI } from './acp-runner.js';

/** How long a sign-in may wait for the user before it is given up. */
const WAIT_MS = 15 * 60_000;

export class AgentSignIn {
    runner;
    onFinished;
    command;
    proc = null;
    url = null;
    error = null;
    out = '';
    sentAt = null;
    cancelled = false;

    constructor(runner, onFinished, command = null) {
        this.runner = runner;
        this.onFinished = onFinished;
        this.command = command || defaultCommandFor(runner);
    }

    state() {
        const note = this.sentAt === null ? null : lastLine(this.out.slice(this.sentAt)) || null;
        return {
            runner: this.runner,
            running: this.proc !== null,
            url: this.url,
            error: this.error,
            note,
            command: terminalCommand(this.runner),
        };
    }

    async start() {
        if (this.proc)
            return this.state();
        this.url = null;
        this.error = null;
        this.out = '';
        this.sentAt = null;
        this.cancelled = false;
        const [cmd, ...args] = this.command;
        const isWindows = process.platform === 'win32';
        const proc = spawn(cmd, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_NO_WARNINGS: '1' },
            shell: isWindows && (cmd.endsWith('.cmd') || cmd.endsWith('.bat') || cmd === 'npx'),
        });
        this.proc = proc;
        const read = (chunk) => {
            this.out += chunk.toString();
            this.url ??= /https:\/\/\S+/.exec(this.out)?.[0] ?? null;
        };
        proc.stdout?.on('data', read);
        proc.stderr?.on('data', read);
        const giveUp = setTimeout(() => proc.kill(), WAIT_MS);
        giveUp.unref();

        proc.on('error', (err) => {
            clearTimeout(giveUp);
            if (this.proc === proc)
                this.proc = null;
            this.error = err.message;
            this.onFinished(this.error);
        });

        proc.on('close', (code, signal) => {
            clearTimeout(giveUp);
            if (this.proc === proc)
                this.proc = null;
            this.error = code === 0 || signal || this.cancelled ? null : lastLine(this.out) || `Sign-in stopped (exit ${code}).`;
            this.onFinished(this.error);
        });

        for (let i = 0; i < 40 && !this.url && this.proc === proc; i++)
            await new Promise((r) => setTimeout(r, 100));

        return this.state();
    }

    submitCode(code) {
        const clean = code.trim();
        if (!clean)
            throw new Error('Paste the code from the sign-in page.');
        if (!this.proc?.stdin)
            throw new Error('No sign-in is waiting. Start it again.');
        this.sentAt = this.out.length;
        this.proc.stdin.write(`${clean}\n`);
    }

    cancel() {
        if (!this.proc)
            return;
        this.cancelled = true;
        this.proc.kill();
    }
}

export class ClaudeSignIn extends AgentSignIn {
    constructor(onFinished, command = [process.execPath, CLAUDE_ACP, '--cli', 'auth', 'login']) {
        super('claude', onFinished, command);
    }
}

function defaultCommandFor(runner) {
    switch (runner) {
        case 'claude':
            return [process.execPath, CLAUDE_ACP, '--cli', 'auth', 'login'];
        case 'copilot':
            return [process.execPath, COPILOT_CLI, 'auth', 'login'];
        case 'codex':
            return [process.execPath, CODEX_ACP, 'login'];
        default:
            return ['agent', 'login'];
    }
}

const activeSignIns = new Map();

export function signInForRunner(runner, onFinished) {
    let instance = activeSignIns.get(runner);
    if (!instance) {
        instance = new AgentSignIn(runner, (err) => {
            activeSignIns.delete(runner);
            onFinished(err);
        });
        activeSignIns.set(runner, instance);
    }
    return instance;
}

export function terminalCommand(runner = 'claude') {
    if (runner === 'claude') {
        if (existsSync(join(homedir(), '.local', 'bin', 'claude')))
            return '~/.local/bin/claude auth login';
        return `node "${CLAUDE_ACP}" --cli auth login`;
    }
    if (runner === 'copilot') {
        return 'npx @github/copilot login';
    }
    if (runner === 'codex') {
        return 'npx @openai/codex login';
    }
    return 'agent login';
}

function lastLine(text) {
    return (text
        .split('\n')
        .map((l) => l.replace(/^.*Paste code here if prompted >/, '').trim())
        .filter((l) => l && !/ExperimentalWarning|trace-warnings|Opening browser|If the browser didn't open|https?:\/\//.test(l))
        .at(-1) ?? '');
}
