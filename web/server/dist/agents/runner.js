import { existsSync } from 'node:fs';
import { runnerLabel } from '../protocol.js';
export { runnerLabel };
export function signInHint(mode) {
    switch (mode) {
        case 'claude':
            return 'Claude Code is not logged in. Run `claude auth login` in a terminal and sign in.';
        case 'copilot':
            return 'Copilot is not logged in. Run `npx @github/copilot login` and sign in.';
        case 'codex':
            return 'Codex is not logged in. Run `npx @openai/codex login` and sign in.';
        case 'acp':
        case 'print':
            return 'Cursor is not logged in. Run `agent login` and sign in.';
    }
}
/**
 * Patterns for classifying errors by message content. Each pattern maps to
 * an error type and suggested action. Checked in order; first match wins.
 */
const ERROR_PATTERNS = [
    // Authentication errors
    { pattern: /authentication required/i, type: 'auth', action: 'sign_in', short: 'Sign-in required' },
    { pattern: /not (?:logged|signed) in/i, type: 'auth', action: 'sign_in', short: 'Sign-in required' },
    { pattern: /unauthorized|401/i, type: 'auth', action: 'sign_in', short: 'Sign-in required' },
    { pattern: /invalid.*(?:api[_\s]?key|token|credentials)/i, type: 'auth', action: 'sign_in', short: 'Invalid credentials' },
    // Quota / credits exhausted
    { pattern: /out of (?:usage )?credits?/i, type: 'quota', action: 'switch_model', short: 'Out of credits' },
    { pattern: /quota[_\s]?exhausted/i, type: 'quota', action: 'switch_model', short: 'Quota exhausted' },
    { pattern: /usage[_\s]?limit|billing/i, type: 'quota', action: 'switch_model', short: 'Usage limit reached' },
    { pattern: /insufficient[_\s]?(?:credits?|quota|balance)/i, type: 'quota', action: 'switch_model', short: 'Insufficient credits' },
    { pattern: /payment[_\s]?required|402/i, type: 'quota', action: 'switch_model', short: 'Payment required' },
    // Rate limiting
    { pattern: /rate[_\s]?limit/i, type: 'rate_limit', action: 'wait', short: 'Rate limited' },
    { pattern: /too many requests?|429/i, type: 'rate_limit', action: 'wait', short: 'Too many requests' },
    { pattern: /retry[_\s-]?after/i, type: 'rate_limit', action: 'wait', short: 'Rate limited' },
    { pattern: /throttl/i, type: 'rate_limit', action: 'wait', short: 'Request throttled' },
    // Service overloaded
    { pattern: /overloaded/i, type: 'overloaded', action: 'retry', short: 'Service overloaded' },
    { pattern: /capacity|503|service[_\s]?unavailable/i, type: 'overloaded', action: 'retry', short: 'Service busy' },
    { pattern: /temporary|transient/i, type: 'overloaded', action: 'retry', short: 'Temporary error' },
    { pattern: /try again later/i, type: 'overloaded', action: 'retry', short: 'Try again later' },
    // Model unavailable
    { pattern: /model[_\s]?(?:not[_\s]?(?:found|available)|unavailable|does not exist)/i, type: 'model_unavailable', action: 'switch_model', short: 'Model unavailable' },
    { pattern: /(?:invalid|unknown)[_\s]?model/i, type: 'model_unavailable', action: 'switch_model', short: 'Invalid model' },
    // Connection errors
    { pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH/i, type: 'connection', action: 'retry', short: 'Connection failed' },
    { pattern: /network|connection[_\s]?(?:error|failed|refused)/i, type: 'connection', action: 'retry', short: 'Network error' },
    { pattern: /ECONNRESET|socket (?:hang up|disconnected)|RetriableError/i, type: 'connection', action: 'retry', short: 'Network error' },
    { pattern: /timeout|timed?\s*out/i, type: 'connection', action: 'retry', short: 'Request timed out' },
    { pattern: /500|502|504|internal[_\s]?(?:server[_\s]?)?error/i, type: 'connection', action: 'retry', short: 'Server error' },
    // CLI not installed
    { pattern: /spawn.*ENOENT/i, type: 'cli_missing', action: 'install', short: 'CLI not installed' },
    { pattern: /command not found/i, type: 'cli_missing', action: 'install', short: 'CLI not found' },
    { pattern: /not (?:on|in).*PATH/i, type: 'cli_missing', action: 'install', short: 'CLI not in PATH' },
    // Process errors
    { pattern: /exited? with (?:code|signal)/i, type: 'process', action: 'retry', short: 'Process crashed' },
    { pattern: /process (?:crashed|died|killed|terminated)/i, type: 'process', action: 'retry', short: 'Process crashed' },
    { pattern: /stopped answering/i, type: 'process', action: 'retry', short: 'Process stuck' },
];
const GONE = 'no longer exists.';
/**
 * Why a session cannot start in `worktreePath`, or null when it can. Spawning
 * in a missing folder fails with the same ENOENT as a missing CLI, so this is
 * checked first.
 */
export function missingWorktree(worktreePath) {
    return existsSync(worktreePath) ? null : `\`${worktreePath}\` ${GONE}`;
}
/**
 * Classifies a runner error into a type with suggested recovery action.
 * The short message is suitable for a status bubble; the full message is for
 * detailed display in the error box.
 */
export function classifyRunnerError(mode, message, code) {
    // A deleted worktree, before anything else: the path in it could match any
    // of the patterns below, and its spawn ENOENT is not a missing CLI.
    if (message.endsWith(GONE)) {
        return { type: 'unknown', message, shortMessage: 'Worktree is gone', action: 'retry', code };
    }
    // Check CLI installation first (mode-specific)
    if (/spawn.*ENOENT/.test(message)) {
        const cliName = mode === 'acp' || mode === 'print' ? 'agent' : mode;
        return {
            type: 'cli_missing',
            message: `The ${runnerLabel(mode)} CLI is not installed: \`${cliName}\` is not on your PATH.`,
            shortMessage: `${runnerLabel(mode)} not installed`,
            action: 'install',
            code,
        };
    }
    // Check authentication (mode-specific hint)
    if (/authentication required/i.test(message)) {
        return {
            type: 'auth',
            message: signInHint(mode),
            shortMessage: 'Sign-in required',
            action: 'sign_in',
            code,
        };
    }
    // Try pattern matching
    for (const { pattern, type, action, short } of ERROR_PATTERNS) {
        if (pattern.test(message)) {
            return {
                type,
                message,
                shortMessage: short ?? message.slice(0, 46),
                action,
                code,
            };
        }
    }
    // Unknown error
    return {
        type: 'unknown',
        message,
        shortMessage: message.length > 46 ? `${message.slice(0, 45)}…` : message,
        action: 'retry',
        code,
    };
}
/**
 * Backward-compatible wrapper that returns just the message string.
 * Use `classifyRunnerError` for the full classification.
 */
export function explainRunnerError(mode, message) {
    return classifyRunnerError(mode, message).message;
}
/**
 * Splits a turn's reply that ends with the CLI reporting a failed request,
 * such as `Error: RetriableError: [aborted] …` or `API Error: Connection
 * error.`, into what the agent said before it and the error. Some CLIs end the
 * turn with that as the reply's last paragraph instead of raising an error,
 * after whatever the agent had already said. Null for any other reply,
 * including one that only mentions an error.
 */
export function splitRunnerError(text) {
    const reply = text.trim();
    const error = reply.split(/\n\s*\n/).pop();
    if (error.length > 500 || error.includes('\n') || !/^(?:API )?Error: \S/.test(error))
        return null;
    return { said: reply.slice(0, reply.length - error.length).trim(), error };
}
export class BaseRunner {
    opts;
    listeners = [];
    _chatId = null;
    _model;
    _commands = [];
    _menu = null;
    _busy = false;
    _started = false;
    constructor(opts) {
        this.opts = opts;
        this._chatId = opts.chatId ?? null;
        this._model = opts.model ?? null;
    }
    get chatId() {
        return this._chatId;
    }
    get model() {
        return this._model;
    }
    setModel(model) {
        if (!model || model === this._model)
            return;
        this._model = model;
        this.emit({ kind: 'model', model });
    }
    get commands() {
        return this._commands;
    }
    setCommands(commands) {
        this._commands = commands;
        this.emit({ kind: 'commands', commands });
    }
    get menu() {
        return this._menu;
    }
    setMenu(menu) {
        if (JSON.stringify(menu) === JSON.stringify(this._menu))
            return;
        this._menu = menu;
        this.emit({ kind: 'menu' });
    }
    get backgroundAgents() {
        return [];
    }
    get isBusy() {
        return this._busy;
    }
    onEvent(listener) {
        this.listeners.push(listener);
    }
    emit(event) {
        for (const l of this.listeners) {
            try {
                l(event);
            }
            catch (err) {
                // A listener must never take the runner down with it.
                console.error('[runner] listener threw:', err.message);
            }
        }
    }
    get agentCommand() {
        return this.opts.command ?? 'agent';
    }
    /**
     * Whether there is a session to prompt.
     *
     * False for a worker adopted from an existing worktree or restored after a
     * restart: the record is in memory but no process has ever run for it.
     */
    get isStarted() {
        return this._started;
    }
    async probe() {
        return { alive: null, pid: null, answering: null };
    }
    async switchSession(_chatId) {
        return false;
    }
    async answerQuestion(_requestId, _answers) { }
    async applySetup(setup) {
        this.opts.model = setup.model;
        this.opts.effort = setup.effort;
        this.opts.permission = setup.permission;
    }
}
