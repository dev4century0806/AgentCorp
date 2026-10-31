/**
 * Generated offices (issue #157): the saved offices, and the designers
 * drawing new ones.
 *
 * A generation opens a headless designer session with the designer brief,
 * in a scratch folder with no repo in reach. It is not a worker: it takes no
 * desk, and nobody can talk to it, so it can never stop to wait on the user.
 * When its turn ends with OFFICE_READY, the office.json it wrote is
 * validated: a pass is saved and the session closed; a failure is sent back
 * to it, up to OFFICE_ATTEMPTS times in all. What it says and does is kept as
 * a log the build window shows, read only. A build cut off mid-turn (a
 * timeout, a crash, a lost connection) keeps its folder and chat, so it can
 * be resumed where it stopped. Generations live in memory only: they belong
 * to this process, and an account switch ends them.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeScratch } from '../agents/one-shot.js';
import { OFFICE_ATTEMPTS, OFFICE_ID, validateOfficeBrief, validateOfficeManifest, runnerLabel, } from '../protocol.js';
import { designerBrief, fixBrief, hasOfficeReady, lostSessionBrief, nudgeBrief, OFFICE_FILE, resumeBrief } from './brief.js';
import { checkRunner } from './details.js';
import { OfficeError, OfficeStore } from './store.js';
/** How many offices can be built at once. Designers take no desk, so this is what keeps their token spend in sight. */
export const DESIGNERS_AT_ONCE = 2;
/** How long one designer turn may take. A strong model at high effort can spend many minutes on one. */
export const DESIGNER_TURN_TIMEOUT_MS = 30 * 60_000;
/** How many times a designer that stops without handing in is told to carry on. */
export const DESIGNER_NUDGES = 2;
/** How much of a designer's log is kept: entries, and characters in each. */
export const LOG_LIMIT = 400;
export const LOG_TEXT_LIMIT = 4000;
/** Log changes are sent at most this often, as the text streams in. */
const LOG_FLUSH_MS = 250;
const INSTRUCTION_LIMIT = 600;
const CREATOR_LIMIT = 40;
const view = ({ id, officeId, startedAt, started, line, attempt, state, errors, resultId, resumable }) => ({
    id,
    officeId,
    startedAt,
    started,
    line,
    attempt,
    state,
    errors,
    resultId,
    resumable,
});
const clip = (text) => (text.length > LOG_TEXT_LIMIT ? `${text.slice(0, LOG_TEXT_LIMIT - 1)}…` : text);
export class OfficeService {
    bus;
    openDesigner;
    defaultRunner;
    store;
    generations = new Map();
    constructor(bus, openDesigner, defaultRunner, store = new OfficeStore()) {
        this.bus = bus;
        this.openDesigner = openDesigner;
        this.defaultRunner = defaultRunner;
        this.store = store;
    }
    /* ---------- the saved offices ---------- */
    list() {
        return { offices: this.store.list(), generations: this.listGenerations() };
    }
    listGenerations() {
        return [...this.generations.values()].map(view);
    }
    get(id) {
        return this.store.need(id);
    }
    delete(id) {
        const running = [...this.generations.values()].find((g) => g.officeId === id && g.state === 'running');
        if (running)
            throw new OfficeError('A designer is changing this office. Cancel that first.', 409);
        if (!this.store.delete(id))
            throw new OfficeError('No such office.', 404);
        this.publish();
    }
    setThumbnail(id, dataUrl) {
        const summary = this.store.setThumbnail(id, dataUrl);
        this.publish();
        return summary;
    }
    setListing(id, listingId) {
        const summary = this.store.setListing(id, listingId);
        this.publish();
        return summary;
    }
    /** Saves an office downloaded from the showcase. Installing the same listing again replaces the earlier install. */
    install(req) {
        const r = (req && typeof req === 'object' ? req : {});
        if (typeof r.listingId !== 'string' || !OFFICE_ID.test(r.listingId))
            throw new OfficeError('listingId must be a listing id.');
        const creator = cleanCreator(r.creator);
        const checked = validateOfficeManifest(r.manifest);
        if (!checked.ok)
            throw new OfficeError('That office does not follow the contract.', 400, checked.errors);
        const existing = this.store.findInstalled(r.listingId);
        const summary = this.store.save({
            manifest: checked.value,
            brief: null,
            source: { kind: 'installed', listingId: r.listingId, creator, installedAt: new Date().toISOString() },
            ...(existing ? { id: existing.id } : {}),
        });
        this.publish();
        return summary;
    }
    /* ---------- generating ---------- */
    async generate(req) {
        if (!this.openDesigner)
            throw new OfficeError('Generating offices is not available here.');
        const r = (req && typeof req === 'object' ? req : {});
        const checked = validateOfficeBrief(r.brief);
        if (!checked.ok)
            throw new OfficeError('Fill the brief in first.', 400, checked.errors);
        const brief = checked.value;
        const runner = checkRunner(r.runner, this.defaultRunner());
        const setup = { ...setupField('model', r.model), ...setupField('effort', r.effort) };
        let current = null;
        let instruction = null;
        if (r.officeId !== undefined && r.officeId !== null) {
            current = this.store.need(r.officeId);
            if (typeof r.instruction !== 'string' || !r.instruction.trim())
                throw new OfficeError('Say what to change about the office.');
            if (r.instruction.length > INSTRUCTION_LIMIT)
                throw new OfficeError(`Keep the change to ${INSTRUCTION_LIMIT} characters or fewer.`);
            const plain = validateOfficeBrief({ prompt: r.instruction, details: brief.details });
            if (!plain.ok)
                throw new OfficeError('The change must be plain words, with no markup, links or code.');
            instruction = r.instruction.trim();
            if ([...this.generations.values()].some((g) => g.officeId === current.summary.id && g.state === 'running')) {
                throw new OfficeError('A designer is already changing this office.', 409);
            }
        }
        this.needDesk();
        const g = {
            id: `g-${randomUUID().slice(0, 8)}`,
            officeId: current?.summary.id ?? null,
            startedAt: new Date().toISOString(),
            started: false,
            line: null,
            attempt: 1,
            state: 'running',
            errors: [],
            resultId: null,
            resumable: false,
            session: null,
            brief,
            runner,
            setup,
            briefFor: (workdir) => designerBrief({ brief, workdir, current: current?.manifest ?? null, instruction }),
            nudges: 0,
            workdir: null,
            chatId: null,
            lastAsk: null,
            log: [],
            saying: false,
            logFrom: null,
            logTimer: null,
        };
        this.generations.set(g.id, g);
        this.note(g, `Starting the designer on ${runnerLabel(runner)}.`);
        this.publish();
        void this.run(g, this.openDesigner(runner, setup), (session) => g.briefFor(session.workdir), false);
        return view(g);
    }
    /** Carries a build cut off mid-turn on where it stopped, in the same folder and chat. */
    async resume(id) {
        if (!this.openDesigner)
            throw new OfficeError('Generating offices is not available here.');
        const g = this.generations.get(id);
        if (!g)
            throw new OfficeError('No such generation.', 404);
        if (g.state !== 'failed' || !g.resumable || !g.workdir || !g.chatId) {
            throw new OfficeError('This build cannot be resumed. Start it again instead.', 409);
        }
        if (g.officeId && [...this.generations.values()].some((x) => x !== g && x.officeId === g.officeId && x.state === 'running')) {
            throw new OfficeError('A designer is already changing this office.', 409);
        }
        this.needDesk();
        const { workdir, chatId } = g;
        Object.assign(g, { state: 'running', resumable: false, errors: [], line: null, started: false, nudges: 0 });
        this.note(g, 'Resuming where it stopped.');
        this.publish();
        const asked = g.lastAsk;
        void this.run(g, this.openDesigner(g.runner, g.setup, { workdir, chatId }), (session) => {
            if (session.chatId !== null && session.chatId !== chatId) {
                this.note(g, 'Its earlier session could not be reopened, so it starts again in the same folder.');
                return lostSessionBrief(g.briefFor(session.workdir));
            }
            // The brief itself is already in the chat; a fix or a nudge it was cut off on is asked again.
            return resumeBrief(asked && asked !== g.briefFor(session.workdir) ? asked : null);
        }, true);
        return view(g);
    }
    /** The designer's log so far, for a build window opening on it. */
    log(id) {
        const g = this.generations.get(id);
        if (!g)
            throw new OfficeError('No such generation.', 404);
        return g.log;
    }
    /** Starts the designer, then talks with it turn by turn until the office passes, it gives up, or the build is cancelled. */
    async run(g, opening, firstPrompt, resuming) {
        let session;
        try {
            session = await opening;
        }
        catch (err) {
            if (g.state === 'running' && this.generations.get(g.id) === g) {
                // A resume that could not start keeps its folder and chat, to try again once the problem is fixed.
                await this.settle(g, 'failed', [`Could not start the designer: ${err.message}`], { resumable: resuming });
                this.publish();
            }
            return;
        }
        // Cancelled, or the account changed, while the runner was starting.
        if (g.state !== 'running' || this.generations.get(g.id) !== g) {
            await session.close();
            return;
        }
        g.session = session;
        g.started = true;
        g.workdir = session.workdir;
        session.onActivity((a) => this.heard(g, a));
        if (!resuming)
            this.note(g, 'The designer is reading the brief.');
        this.publish();
        let prompt = firstPrompt(session);
        while (prompt !== null) {
            g.lastAsk = prompt;
            let text;
            try {
                text = await session.ask(prompt);
            }
            catch (err) {
                if (g.state !== 'running')
                    return;
                g.chatId = session.chatId ?? g.chatId;
                // Cut off mid-turn: the folder and chat are kept, so it can carry on where it stopped.
                await this.settle(g, 'failed', [`The designer stopped: ${err.message}`], { resumable: true });
                this.publish();
                return;
            }
            if (g.state !== 'running')
                return;
            g.chatId = session.chatId ?? g.chatId;
            g.saying = false;
            prompt = await this.handleTurn(g, session.workdir, text);
        }
    }
    /** Reads a designer's turn. Returns what to tell it next, or null once the generation is settled. */
    async handleTurn(g, workdir, text) {
        if (!hasOfficeReady(text)) {
            if (g.nudges < DESIGNER_NUDGES) {
                g.nudges += 1;
                this.note(g, 'It stopped without handing the office in, so it was told to carry on.');
                return nudgeBrief();
            }
            await this.settle(g, 'failed', ['The designer stopped without finishing the office.']);
            this.publish();
            return null;
        }
        const file = join(workdir, OFFICE_FILE);
        const checked = existsSync(file)
            ? validateOfficeManifest(readFileSync(file, 'utf8'))
            : { ok: false, errors: [`${OFFICE_FILE} was not written in ${workdir}`] };
        if (!checked.ok) {
            g.errors = checked.errors;
            if (g.attempt < OFFICE_ATTEMPTS) {
                g.attempt += 1;
                g.nudges = 0;
                const n = checked.errors.length;
                this.note(g, `The check found ${n} problem${n === 1 ? '' : 's'}, so they were sent back (try ${g.attempt} of ${OFFICE_ATTEMPTS}).`);
                this.publish();
                return fixBrief(checked.errors, g.attempt, OFFICE_ATTEMPTS);
            }
            await this.settle(g, 'failed', checked.errors);
            this.publish();
            return null;
        }
        let saved;
        try {
            saved = this.store.save({
                manifest: checked.value,
                brief: g.brief,
                source: { kind: 'generated' },
                ...(g.officeId ? { id: g.officeId } : {}),
            });
        }
        catch (err) {
            await this.settle(g, 'failed', [err.message]);
            this.publish();
            return null;
        }
        g.resultId = saved.id;
        this.note(g, `It passed the check and was saved as "${saved.name}".`);
        await this.settle(g, 'done', []);
        this.bus.toast(`"${saved.name}" is ready in the office picker.`, 'done');
        this.publish();
        return null;
    }
    /** Cancels a running generation, stopping its designer, or dismisses a finished one. */
    async cancel(id) {
        const g = this.generations.get(id);
        if (!g)
            throw new OfficeError('No such generation.', 404);
        const farewell = g.state === 'running' ? this.settle(g, 'failed', ['Cancelled.'], { toast: false }) : Promise.resolve(this.dropFolder(g));
        this.forget(g);
        this.publish();
        await farewell;
    }
    /** Ends and forgets every generation: the process is moving to another account. */
    reset() {
        for (const g of this.generations.values()) {
            if (g.state === 'running')
                void this.settle(g, 'failed', ['The account changed.'], { toast: false });
            else
                this.dropFolder(g);
            this.forget(g);
        }
    }
    /* ---------- helpers ---------- */
    needDesk() {
        if (this.runningCount() >= DESIGNERS_AT_ONCE) {
            throw new OfficeError(`${DESIGNERS_AT_ONCE} offices are already being built. Wait for one to finish, then try again.`, 409);
        }
    }
    /**
     * Ends a generation one way or the other and closes its designer. Its
     * folder goes too, unless it is `resumable` and has a chat to carry on.
     */
    settle(g, state, errors, opts = {}) {
        const resumable = state === 'failed' && opts.resumable === true && g.workdir !== null && g.chatId !== null;
        g.state = state;
        g.errors = errors;
        g.line = null;
        g.resumable = resumable;
        if (state === 'failed' && opts.toast !== false) {
            const why = errors[0] ?? 'unknown error';
            this.note(g, resumable ? `Stopped: ${why} You can resume it.` : `Stopped: ${why}`);
            this.bus.toast(resumable ? `The office designer was cut off: ${why} Open the build to resume it.` : `The office designer could not finish: ${why}`, 'error');
        }
        this.flushLog(g);
        const session = g.session;
        g.session = null;
        if (session)
            return session.close({ keepFolder: resumable }).catch(() => undefined);
        if (!resumable)
            this.dropFolder(g);
        return Promise.resolve();
    }
    /** Removes a folder kept for a resume. */
    dropFolder(g) {
        if (g.workdir)
            removeScratch(g.workdir);
        g.resumable = false;
    }
    forget(g) {
        if (g.logTimer)
            clearTimeout(g.logTimer);
        g.logTimer = null;
        g.logFrom = null;
        this.generations.delete(g.id);
    }
    /* ---------- the log ---------- */
    heard(g, a) {
        if (g.state !== 'running' || g.session === null)
            return;
        if (a.kind === 'text')
            return this.say(g, a.text);
        g.saying = false;
        if (a.kind === 'refused')
            return this.note(g, `Refused "${a.line}": nobody is there to approve it.`);
        this.append(g, 'tool', a.line);
        const line = a.line.slice(0, 140);
        if (g.line === line)
            return;
        g.line = line;
        this.publish();
    }
    /** Text as it streams: it joins what the model is saying now, or starts a new entry. */
    say(g, text) {
        const last = g.log.at(-1);
        if (g.saying && last?.kind === 'said') {
            last.text = clip(last.text + text);
            this.logChanged(g, g.log.length - 1);
            return;
        }
        const start = text.replace(/^\s+/, '');
        if (!start)
            return;
        g.saying = true;
        this.append(g, 'said', start);
    }
    note(g, text) {
        g.saying = false;
        this.append(g, 'office', text);
    }
    append(g, kind, text) {
        g.log.push({ kind, text: clip(text), at: new Date().toISOString() });
        if (g.log.length > LOG_LIMIT) {
            g.log.splice(0, g.log.length - LOG_LIMIT);
            this.logChanged(g, 0);
        }
        else {
            this.logChanged(g, g.log.length - 1);
        }
    }
    logChanged(g, from) {
        g.logFrom = g.logFrom === null ? from : Math.min(g.logFrom, from);
        g.logTimer ??= setTimeout(() => this.flushLog(g), LOG_FLUSH_MS);
    }
    flushLog(g) {
        if (g.logTimer)
            clearTimeout(g.logTimer);
        g.logTimer = null;
        if (g.logFrom === null || this.generations.get(g.id) !== g)
            return;
        const from = g.logFrom;
        g.logFrom = null;
        this.bus.emit({ type: 'offices.log', id: g.id, from, entries: g.log.slice(from) });
    }
    runningCount() {
        return [...this.generations.values()].filter((g) => g.state === 'running').length;
    }
    publish() {
        this.bus.emit({ type: 'offices.updated', ...this.list() });
    }
}
/** A handle as the showcase shows it: plain characters only, and not long. */
export function cleanCreator(raw) {
    const handle = typeof raw === 'string' ? raw.replace(/[^A-Za-z0-9_.-]+/g, '').slice(0, CREATOR_LIMIT) : '';
    return handle || 'unknown';
}
/** `{ model }` or `{ effort }` as sent, or nothing when it was not, so the designer falls back to Settings. */
function setupField(key, value) {
    if (value === undefined)
        return {};
    if (value !== null && typeof value !== 'string')
        throw new OfficeError(`${key} must be a string or null.`);
    return { [key]: value };
}
