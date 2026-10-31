/**
 * Prompts and answers with no desk: a runner started in a scratch folder,
 * asked, read until each turn ends, then thrown away.
 *
 * It never waits on a person. A permission request is refused and a question
 * form is dismissed the moment it arrives, so a model that tries to use a
 * tool just carries on without it. `oneShot` asks once, for small jobs such
 * as suggesting the details of an office from a one-line idea; a session
 * keeps the conversation for jobs that take a few turns, such as designing
 * the office itself.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { resolveRunnerMode } from '../config.js';
import { runnerLabel } from '../protocol.js';
import { runnerFor } from './make-runner.js';
import { explainRunnerError } from './runner.js';
export const ONE_SHOT_TIMEOUT_MS = 90_000;
const SCRATCH_PREFIX = 'agent-corp-one-shot-';
/** Removes a scratch folder a session kept, and only a scratch folder: never anything else a path might point at. */
export function removeScratch(dir) {
    const full = resolve(dir);
    if (dirname(full) !== resolve(tmpdir()) || !basename(full).startsWith(SCRATCH_PREFIX))
        return;
    rmSync(full, { recursive: true, force: true });
}
export async function openSession(cfg, mode, options = {}) {
    const timeoutMs = options.timeoutMs ?? ONE_SHOT_TIMEOUT_MS;
    const make = options.make ?? runnerFor;
    const resume = options.resume ?? null;
    let dir;
    if (resume) {
        dir = resume.workdir;
        mkdirSync(dir, { recursive: true });
    }
    else {
        dir = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
    }
    const configured = mode === resolveRunnerMode(cfg);
    const runner = make(mode, {
        worktreePath: dir,
        chatId: resume?.chatId ?? null,
        model: options.model !== undefined ? options.model : configured ? cfg.agents.model : null,
        effort: options.effort !== undefined ? options.effort : configured ? cfg.agents.effort : null,
        permission: options.permission ?? 'ask',
        readOnlyRepo: null,
        mcpServers: () => [],
    });
    /** The turn in flight: what it has said so far, and how it ends. */
    let turn = null;
    const activity = [];
    const tell = (a) => {
        for (const l of activity)
            l(a);
    };
    let closed = false;
    const finish = (end) => {
        const t = turn;
        turn = null;
        if (t)
            end(t);
    };
    runner.onEvent((event) => {
        switch (event.kind) {
            case 'text_delta':
                if (turn)
                    turn.text += event.text;
                tell({ kind: 'text', text: event.text });
                break;
            case 'tool_start': {
                const line = (event.plain || event.label).trim();
                if (line)
                    tell({ kind: 'tool', line });
                break;
            }
            case 'permission_request':
                tell({ kind: 'refused', line: event.request.title });
                void runner.answerPermission(event.request.id, false).catch(() => undefined);
                break;
            case 'question_request':
                void runner.answerQuestion(event.request.id, null).catch(() => undefined);
                break;
            case 'turn_end':
                finish((t) => t.resolve(t.text || event.text || ''));
                break;
            case 'error':
                finish((t) => t.reject(new Error(explainRunnerError(mode, event.message))));
                break;
        }
    });
    const close = async (opts = {}) => {
        if (closed)
            return;
        closed = true;
        finish((t) => t.reject(new Error('The session was closed.')));
        await runner.dispose().catch(() => undefined);
        // Only ever a scratch folder: a resumed session may be sitting in a worker's worktree.
        if (!opts.keepFolder)
            removeScratch(dir);
    };
    try {
        await runner.start();
    }
    catch (err) {
        // A resumed folder outlives a failed start, so it can be tried again.
        await close({ keepFolder: resume !== null });
        // Said the way a worker's error is, so "authentication required" reads as how to sign in.
        throw new Error(explainRunnerError(mode, err.message));
    }
    return {
        workdir: dir,
        get chatId() {
            return runner.chatId;
        },
        onActivity: (listener) => void activity.push(listener),
        close,
        async ask(prompt) {
            if (closed)
                throw new Error('The session was closed.');
            if (turn)
                throw new Error('A turn is already in flight.');
            let timer = null;
            const answer = new Promise((resolve, reject) => {
                turn = { text: '', resolve, reject };
                timer = setTimeout(() => {
                    finish((t) => t.reject(new Error(`${runnerLabel(mode)} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)));
                    void runner.cancel().catch(() => undefined);
                }, timeoutMs);
            });
            // If prompt() itself throws, the rejection below is never awaited; mark it handled.
            answer.catch(() => undefined);
            try {
                await runner.prompt(prompt);
                return await answer;
            }
            catch (err) {
                finish(() => undefined);
                throw err;
            }
            finally {
                if (timer)
                    clearTimeout(timer);
            }
        },
    };
}
export async function oneShot(cfg, mode, prompt, options = {}) {
    const session = await openSession(cfg, mode, options);
    try {
        return await session.ask(prompt);
    }
    finally {
        await session.close();
    }
}
