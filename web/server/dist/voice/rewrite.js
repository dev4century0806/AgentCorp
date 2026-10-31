/**
 * Cleans a voice transcript up into the message the user meant (issue #329):
 * rewritten, not summarized, by the coding agent's cheapest model.
 *
 * One headless session per clip. It opens when the dictation key goes down,
 * so the CLI boots while the user speaks, and closes once the rewrite is in,
 * or straight away when the clip is dropped. Anything that goes wrong comes
 * back as null, and the composer keeps the raw transcript.
 */
import { NO_EFFORT_MODELS } from '../protocol.js';
import { openSession } from '../agents/one-shot.js';
/** How long the model may take to answer, once its session is up. */
export const REWRITE_TIMEOUT_MS = 15_000;
/**
 * How long a session still booting at release may take to come up. The CLI
 * takes 4–5 s to start, so a short clip, or a slow Mac, can outlast the
 * speech; that time doesn't count against the answer's.
 */
export const BOOT_TIMEOUT_MS = 30_000;
/** A warmed session nobody came back for, such as a window closed mid-clip, is closed after this. */
const UNCLAIMED_MS = 4 * 60 * 1000;
export function rewritePrompt(raw) {
    return [
        'Rewrite this dictated speech as a clear written message from me. Rewrite it; do not summarize it.',
        '- Remove filler words, false starts, repetitions and self-corrections, keeping what I settled on.',
        '- Keep every instruction, question and specific: file names, paths, numbers, names, code and constraints, exactly as said.',
        '- Add nothing: no new ideas, no greeting or sign-off, no answer to what it asks.',
        '- Keep my language and point of view. Use short paragraphs or a list only where the speech clearly had steps.',
        'Do not use any tools. Reply with the rewritten message only, with nothing before or after it.',
        '',
        '<speech>',
        raw,
        '</speech>',
    ].join('\n');
}
/**
 * The model and effort a rewrite runs on: Haiku on Claude Code, the smallest
 * model Codex offers, and the runner's default at low effort otherwise.
 */
export function cheapSetup(mode, menu) {
    const low = menu.efforts.some((e) => e.value === 'low') ? 'low' : null;
    if (mode === 'claude')
        return { model: 'haiku', effort: NO_EFFORT_MODELS.has('haiku') ? null : low };
    if (mode === 'codex') {
        const ids = menu.models.map((m) => m.value).filter((v) => !!v);
        const model = ids.find((id) => /nano/i.test(id)) ?? ids.find((id) => /mini/i.test(id)) ?? null;
        return { model, effort: low };
    }
    return { model: null, effort: low };
}
/** A read-only session on the cheap model, for one clip's rewrite. `make` is the test seam. */
export function openRewriteSession(cfg, mode, menu, make) {
    return openSession(cfg, mode, { permission: 'ask', ...cheapSetup(mode, menu), timeoutMs: REWRITE_TIMEOUT_MS, ...(make ? { make } : {}) });
}
/** What a model may wrap its answer in despite being asked not to. */
function unwrap(text) {
    let out = text.trim();
    const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(out);
    if (fenced)
        out = fenced[1].trim();
    out = out.replace(/^<speech>\s*|\s*<\/speech>$/g, '');
    if (/^".*"$/s.test(out) && !out.slice(1, -1).includes('"'))
        out = out.slice(1, -1);
    return out.trim();
}
export class Rewriter {
    open;
    bootTimeoutMs;
    log;
    sessions = new Map();
    /** `open` starts a session on the cheap model, with the rewrite's timeout. */
    /**
     * `open` starts a session on the cheap model, whose own timeout limits the
     * answer. A rewrite that falls back to the transcript says why in `log`,
     * the desktop log, since the composer says nothing.
     */
    constructor(open, bootTimeoutMs = BOOT_TIMEOUT_MS, log = (line) => console.warn(`[voice] ${line}`)) {
        this.open = open;
        this.bootTimeoutMs = bootTimeoutMs;
        this.log = log;
    }
    start() {
        return this.open().catch((err) => {
            this.log(`the clean-up's session didn't start, so the transcript is kept: ${err.message}`);
            return null;
        });
    }
    /** Starts the clip's session, so the rewrite can begin the moment the transcript is in. */
    warm(clip) {
        if (this.sessions.has(clip))
            return;
        const open = this.start();
        const timer = setTimeout(() => this.cancel(clip), UNCLAIMED_MS);
        timer.unref();
        this.sessions.set(clip, { open, timer });
    }
    /** Closes the clip's session, for a clip that was dropped. */
    cancel(clip) {
        const held = this.take(clip);
        if (held)
            void held.then((s) => s?.close());
    }
    take(clip) {
        const held = this.sessions.get(clip);
        if (!held)
            return null;
        clearTimeout(held.timer);
        this.sessions.delete(clip);
        return held.open;
    }
    /** The transcript rewritten, or null when the model failed, took too long, or said nothing. */
    async rewrite(clip, raw) {
        if (!raw.trim()) {
            this.cancel(clip);
            return null;
        }
        const opening = this.take(clip) ?? this.start();
        let timer = null;
        const booted = new Promise((resolve) => {
            timer = setTimeout(() => resolve('late'), this.bootTimeoutMs);
        });
        try {
            const session = await Promise.race([opening, booted]);
            if (timer)
                clearTimeout(timer);
            if (session === 'late') {
                this.log(`the clean-up's session took over ${Math.round(this.bootTimeoutMs / 1000)} s to start, so the transcript is kept.`);
                return null;
            }
            if (!session)
                return null;
            // The session's own timeout limits the answer.
            const text = unwrap(await session.ask(rewritePrompt(raw)));
            if (!text)
                this.log('the clean-up came back empty, so the transcript is kept.');
            return text || null;
        }
        catch (err) {
            this.log(`the clean-up failed, so the transcript is kept: ${err.message}`);
            return null;
        }
        finally {
            if (timer)
                clearTimeout(timer);
            void opening.then((s) => s?.close());
        }
    }
    /** Closes every warmed session, when the server stops. */
    closeAll() {
        for (const clip of [...this.sessions.keys()])
            this.cancel(clip);
    }
}
