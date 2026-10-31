import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackerInfo, trackerName } from './protocol.js';
import { parseTicketDraft } from './agents/events.js';
import { SHAPING_BRIEF_OPENING, ticketId, TICKET_FOOTER } from './protocol.js';
import { emitTracking } from './tracking/emit.js';
import { decodeUploads, ideaFilesDir, removeUpload, writeUploads } from './uploads.js';
export const IDEA_TITLE_MAX = 120;
export const IDEA_NOTES_MAX = 20_000;
export const IDEA_REPOS_MAX = 10;
/** A request about an idea that cannot be met, said so the panel can show it as it is. */
export class IdeaError extends Error {
    notFound;
    constructor(message, notFound = false) {
        super(message);
        this.notFound = notFound;
        this.name = 'IdeaError';
    }
}
/**
 * The Idea board: ideas Operator keeps here until they become tickets in the tracker.
 *
 * Every change is saved and then published as `idea.updated`, so every open
 * tab shows the same board. Ideas are archived rather than deleted, so
 * nothing typed into the board is lost by a stray click.
 */
export class IdeaService {
    repos;
    bus;
    tracker;
    remember;
    planners;
    plannerPersona;
    afterTicket;
    /** Ideas becoming tickets right now, so a double click cannot make two. */
    creating = new Set();
    syncing = new Map();
    constructor(repos, bus, 
    /** The active tracker in the app, a fake in tests. */
    tracker = null, 
    /** Remembers where a ticket was made, so the next one starts there. */
    remember = () => undefined, planners = null, 
    /** The persona a shaping Planner is hired as, if there is one. */
    plannerPersona = () => undefined, 
    /** Checks the tracker again, so a ticket just made shows on the Ticket board without waiting for the next poll. */
    afterTicket = () => undefined) {
        this.repos = repos;
        this.bus = bus;
        this.tracker = tracker;
        this.remember = remember;
        this.planners = planners;
        this.plannerPersona = plannerPersona;
        this.afterTicket = afterTicket;
        bus.subscribe((e) => {
            if (e.type !== 'agent.removed')
                return;
            const ideas = this.repos.listIdeas();
            // A Planner sent home before the idea was marked Ready leaves it with its draft, or in the Inbox without one.
            const shaped = ideas.find((i) => i.plannerId === e.agentId);
            if (shaped?.lane === 'shaping') {
                const back = this.repos.updateIdea(shaped.id, { lane: shaped.draft ? 'ready' : 'inbox', plannerId: null });
                this.bus.emit({ type: 'idea.updated', idea: back });
            }
            // A worker sent home leaves its ticket's idea free to start work again.
            const worked = ideas.find((i) => i.workerId === e.agentId);
            if (worked)
                this.bus.emit({ type: 'idea.updated', idea: this.repos.updateIdea(worked.id, { workerId: null }) });
        });
    }
    /**
     * Shape with Planner: hires a Planner as a research job on the idea, working
     * in `repo` and reading the idea's other repos, changing nothing, and moves
     * the idea to Shaping. The idea's files go with the hire. The Planner talks
     * the idea through with Operator, and its drafts come back through `draftFromPlanner`.
     *
     * `repo` is whichever one the shape form ended on, which starts as the
     * idea's first. Null works from the idea alone, with no repo at all.
     */
    async shape(id, repo) {
        if (!this.planners)
            throw new IdeaError('Shaping is not available here.');
        const idea = this.repos.getIdea(id);
        if (!idea)
            throw new IdeaError('That idea no longer exists.', true);
        if (idea.archived)
            throw new IdeaError('Restore the idea before shaping it.');
        if (idea.lane === 'shaping')
            throw new IdeaError('A Planner is already shaping this idea.');
        if (idea.lane === 'ticket')
            throw new IdeaError(alreadyTicket(idea));
        if (repo !== null && repo !== undefined && typeof repo !== 'string')
            throw new IdeaError('repo must be a path or null.');
        // A queued hire would never tell the idea who picked it up, so shaping needs a desk now.
        if (!this.planners.deskFree())
            throw new IdeaError('Every desk is taken. Free one, then shape the idea.');
        const path = typeof repo === 'string' && repo.trim() ? repo.trim() : null;
        // The working repo first, then the idea's others, which it only reads.
        const repos = path ? [path, ...idea.repos.filter((r) => r !== path)] : [];
        const attachments = this.filesFor(idea);
        const persona = this.plannerPersona();
        const planner = await this.planners.hire({
            task: shapingBrief(idea, this.tracker?.id ?? 'github', repos),
            kind: 'research',
            ...(path ? { repo: path } : {}),
            ...(repos.length > 1 ? { extraRepos: repos.slice(1) } : {}),
            ...(attachments.length ? { attachments } : {}),
            ...(persona ? { persona } : {}),
        });
        // The repo picked here is remembered as the idea's, so the next shaping starts from it.
        const saved = this.repos.updateIdea(id, { lane: 'shaping', plannerId: planner.id, ...(path ? { repos } : {}) });
        this.bus.emit({ type: 'idea.updated', idea: saved });
        return saved;
    }
    /** The idea's files as a hire takes them. */
    filesFor(idea) {
        const dir = ideaFilesDir(idea.id);
        return idea.attachments.map((a) => {
            let data;
            try {
                data = readFileSync(join(dir, a.file)).toString('base64');
            }
            catch {
                throw new IdeaError(`${a.name} is missing from this Mac. Remove it from the idea, then shape it again.`);
            }
            return { name: a.name, mimeType: a.mimeType, data };
        });
    }
    /**
     * Takes a Planner's hand-off onto its idea. The first draft is stored, and so
     * is every revision after it, replacing the last. The Planner stays and the
     * idea stays in Shaping, so the talk goes on; `markReady` is what ends it.
     */
    draftFromPlanner(agentId, raw) {
        const idea = this.repos.listIdeas().find((i) => i.plannerId === agentId && i.lane === 'shaping');
        if (!idea)
            return;
        const draft = cleanDraft(parseTicketDraft(raw, idea.title));
        const saved = this.repos.updateIdea(idea.id, { draft });
        this.bus.emit({ type: 'idea.updated', idea: saved });
        this.bus.toast(`${idea.draft ? 'The ticket draft was revised' : 'There is a ticket draft'} for "${idea.title}".`, 'done', agentId);
        if (!idea.draft)
            emitTracking(this.bus, this.repos, { name: 'idea_shaped' });
    }
    /** Ends the talk: the draft is good, so the idea moves to Ready and the Planner goes home. */
    markReady(id) {
        const idea = this.repos.getIdea(id);
        if (!idea)
            throw new IdeaError('That idea no longer exists.', true);
        if (idea.lane !== 'shaping')
            throw new IdeaError('Only an idea being shaped can be marked Ready.');
        if (!idea.draft)
            throw new IdeaError('Ask the Planner for a ticket draft first.');
        const planner = idea.plannerId;
        const saved = this.repos.updateIdea(id, { lane: 'ready', plannerId: null });
        this.bus.emit({ type: 'idea.updated', idea: saved });
        if (planner)
            void this.planners?.fire(planner, { removeWorktree: false }).catch(() => undefined);
        return saved;
    }
    issueTypes(project) {
        if (!this.tracker)
            throw new IdeaError('No tracker is connected. Connect one in Settings.');
        return this.tracker.issueTypes(cleanKey(project));
    }
    /**
     * Turns a Ready idea's draft into a ticket in the active tracker, assigned
     * to Operator, and moves the idea to Ticketed with the new key. If the tracker
     * refuses, the idea stays in Ready untouched and the error says why.
     *
     * With `startWork`, a worker is then hired on the new ticket. That needs a
     * free desk, which is checked before anything is made. If the ticket is made
     * and the hire still fails, the idea stays Ticketed, a toast says why, and
     * `startWork` can be tried again without making a second ticket.
     */
    async createTicket(id, project, issueType, startWork = false) {
        if (!this.tracker)
            throw new IdeaError('No tracker is connected. Connect one in Settings.');
        const idea = this.repos.getIdea(id);
        if (!idea)
            throw new IdeaError('That idea no longer exists.', true);
        if (idea.lane === 'ticket')
            throw new IdeaError(alreadyTicket(idea));
        if (idea.lane !== 'ready' || !idea.draft)
            throw new IdeaError('Write a ticket draft first; only Ready ideas become tickets.');
        if (idea.archived)
            throw new IdeaError('Restore the idea before making it a ticket.');
        if (typeof issueType !== 'string' || !issueType.trim())
            throw new IdeaError('Pick an issue type.');
        const key = cleanKey(project);
        if (this.creating.has(id))
            throw new IdeaError('This ticket is already being created.');
        if (startWork)
            this.needDesk();
        this.creating.add(id);
        try {
            const source = this.tracker.id;
            const made = await this.tracker.createIssue({
                project: key,
                issueType: issueType.trim(),
                summary: idea.draft.title,
                description: idea.draft.description,
                labels: idea.draft.labels,
                priority: idea.draft.priority,
            });
            const saved = this.repos.updateIdea(id, {
                lane: 'ticket',
                ticketSource: source,
                ticketKey: made.key,
                ticketUrl: made.url,
                draft: { ...idea.draft, type: issueType.trim() },
            });
            this.remember({ project: key, issueType: issueType.trim() });
            this.bus.emit({ type: 'idea.updated', idea: saved });
            this.afterTicket();
            emitTracking(this.bus, this.repos, { name: 'idea_ticketed', source });
            if (!startWork)
                return saved;
            try {
                return await this.hireOn(saved);
            }
            catch (err) {
                this.bus.toast(`${made.key} was created, but no worker could start on it: ${err.message} Press Start work to try again.`, 'error');
                return saved;
            }
        }
        finally {
            this.creating.delete(id);
        }
    }
    /** Hires a worker on a Ticketed idea's ticket, for an idea whose ticket was made without one or whose worker could not start. */
    async startWork(id) {
        const idea = this.repos.getIdea(id);
        if (!idea)
            throw new IdeaError('That idea no longer exists.', true);
        if (idea.lane !== 'ticket' || !idea.ticketKey)
            throw new IdeaError('Make the ticket first.');
        if (idea.workerId)
            throw new IdeaError('A worker is already on this ticket.');
        if (this.creating.has(id))
            throw new IdeaError('A worker is already being hired on this ticket.');
        this.needDesk();
        this.creating.add(id);
        try {
            return await this.hireOn(idea);
        }
        finally {
            this.creating.delete(id);
        }
    }
    /** A queued hire would never tell the idea who picked it up, so starting work needs a desk now. */
    needDesk() {
        if (!this.planners)
            throw new IdeaError('Starting work is not available here.');
        if (!this.planners.deskFree())
            throw new IdeaError('Every desk is taken. Free one, then start work.');
    }
    /**
     * The worker on the idea's ticket: hired the way the ticket board hires,
     * in the idea's first repo, with the ticket draft as its note and the
     * idea's files, and recorded on the idea so its card can link to it.
     */
    async hireOn(idea) {
        if (!this.planners || !idea.ticketSource || !idea.ticketKey)
            throw new IdeaError('Starting work is not available here.');
        const attachments = this.filesFor(idea);
        const [repo] = idea.repos;
        const worker = await this.planners.hire({
            ticketKey: ticketId(idea.ticketSource, idea.ticketKey),
            ...(repo ? { repo } : {}),
            ...(idea.draft ? { note: workNote(idea.draft) } : {}),
            ...(attachments.length ? { attachments } : {}),
        });
        const saved = this.repos.updateIdea(idea.id, { workerId: worker.id });
        this.bus.emit({ type: 'idea.updated', idea: saved });
        return saved;
    }
    list() {
        return this.repos.listIdeas();
    }
    /**
     * Keeps closed tickets off the board. Called after a good poll with the keys
     * still open: an idea on that list is open (and comes back if it was marked
     * closed) with no tracker call, and only an idea that dropped off it is
     * looked up. A lookup that fails leaves that idea as it was.
     */
    async syncTickets(source, openKeys) {
        if (this.syncing.has(source.id))
            return;
        const run = Symbol(source.id);
        this.syncing.set(source.id, run);
        // An account switch swaps the database under this run, and idea ids repeat across accounts.
        const generation = this.repos.generation;
        try {
            const open = new Set(openKeys.map((k) => k.toLowerCase()));
            for (const idea of this.repos.listIdeas()) {
                if (idea.lane !== 'ticket' || idea.ticketSource !== source.id || !idea.ticketKey)
                    continue;
                let closed;
                if (open.has(idea.ticketKey.toLowerCase()))
                    closed = false;
                else {
                    try {
                        closed = await source.isFinished(idea.ticketKey);
                    }
                    catch {
                        continue;
                    }
                }
                if (this.repos.generation !== generation)
                    return;
                if (closed === !!idea.ticketClosedAt)
                    continue;
                const saved = this.repos.updateIdea(idea.id, { ticketClosedAt: closed ? new Date().toISOString() : null });
                if (saved)
                    this.bus.emit({ type: 'idea.updated', idea: saved });
            }
        }
        finally {
            if (this.syncing.get(source.id) === run)
                this.syncing.delete(source.id);
        }
    }
    /** Repos and files are optional, so an idea can still be just a title. */
    add(title, notes, repos, attachments) {
        const cleanedTitle = cleanTitle(title);
        const cleanedNotes = cleanNotes(notes);
        const cleanedRepos = cleanRepos(repos);
        // Checked before the idea is saved, so files that are refused leave no idea behind.
        const files = decoded(attachments);
        let idea = this.repos.insertIdea(cleanedTitle, cleanedNotes, cleanedRepos);
        if (files.length)
            idea = this.repos.updateIdea(idea.id, { attachments: writeUploads(ideaFilesDir(idea.id), files) });
        this.bus.emit({ type: 'idea.updated', idea });
        emitTracking(this.bus, this.repos, { name: 'idea_created' });
        return idea;
    }
    /**
     * Changes what Operator may change by hand. Moving is between Inbox and Ready
     * only: Shaping belongs to a Planner at work and Ticketed to a real ticket.
     */
    update(id, patch) {
        const idea = this.repos.getIdea(id);
        if (!idea)
            throw new IdeaError('That idea no longer exists.', true);
        const next = {};
        if (patch.title !== undefined)
            next.title = cleanTitle(patch.title);
        if (patch.notes !== undefined)
            next.notes = cleanNotes(patch.notes);
        if (patch.archived !== undefined) {
            if (typeof patch.archived !== 'boolean')
                throw new IdeaError('archived must be true or false.');
            next.archived = patch.archived;
        }
        if (patch.repos !== undefined)
            next.repos = cleanRepos(patch.repos);
        // Files are written only once everything else has passed, and the ones
        // taken off are deleted only once the idea no longer lists them.
        let files = null;
        if (patch.removeAttachments !== undefined || patch.attachments !== undefined) {
            const remove = patch.removeAttachments ?? [];
            if (!Array.isArray(remove) || remove.some((f) => typeof f !== 'string')) {
                throw new IdeaError('removeAttachments must be a list of file names.');
            }
            const kept = idea.attachments.filter((a) => !remove.includes(a.file));
            files = {
                kept,
                added: decoded(patch.attachments, kept.reduce((sum, a) => sum + a.size, 0)),
                dropped: idea.attachments.filter((a) => remove.includes(a.file)).map((a) => a.file),
            };
        }
        if (patch.draft !== undefined) {
            if (idea.lane === 'ticket') {
                throw new IdeaError(`${alreadyTicket(idea)} Edit the ticket in ${idea.ticketSource ? trackerName(idea.ticketSource) : 'the tracker'}.`);
            }
            next.draft = patch.draft === null ? null : cleanDraft(patch.draft);
        }
        if (patch.lane !== undefined) {
            if (patch.lane !== 'inbox' && patch.lane !== 'ready') {
                throw new IdeaError('Ideas can be moved to Inbox or Ready by hand.');
            }
            if (idea.lane === 'ticket')
                throw new IdeaError(alreadyTicket(idea));
            if (idea.lane === 'shaping')
                throw new IdeaError('A Planner is shaping this idea. Wait for its draft.');
            // Ready means there is a draft to turn into a ticket, so it takes one.
            if (patch.lane === 'ready' && !(next.draft ?? idea.draft)) {
                throw new IdeaError('Write a ticket draft first. Saving it moves the idea to Ready.');
            }
            next.lane = patch.lane;
        }
        if (files)
            next.attachments = [...files.kept, ...writeUploads(ideaFilesDir(id), files.added)];
        const saved = this.repos.updateIdea(id, next);
        for (const file of files?.dropped ?? [])
            removeUpload(ideaFilesDir(id), file);
        this.bus.emit({ type: 'idea.updated', idea: saved });
        return saved;
    }
}
export function cleanDraft(raw) {
    const d = (raw && typeof raw === 'object' ? raw : {});
    const title = typeof d.title === 'string' ? d.title.replace(/\s+/g, ' ').trim() : '';
    if (!title)
        throw new IdeaError('The ticket needs a title.');
    if (title.length > 255)
        throw new IdeaError('Ticket titles are 255 characters at most.');
    const type = typeof d.type === 'string' && d.type.trim() ? d.type.trim() : 'User Story';
    const labels = Array.isArray(d.labels)
        ? [...new Set(d.labels.filter((l) => typeof l === 'string').map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean))]
        : [];
    const priority = typeof d.priority === 'string' && d.priority.trim() ? d.priority.trim() : null;
    const description = typeof d.description === 'string' ? d.description.trim() : '';
    if (description.length > 32_000)
        throw new IdeaError('The description is too long for a ticket. Keep it under 32,000 characters.');
    return { title, type, labels, priority, description };
}
/**
 * What a shaping Planner is told: the idea and its files, the repos it may
 * draw on, how to talk with Operator, the team's template, and the exact hand-off
 * the board reads back.
 *
 * `repos` are the ones the Planner was hired with, its working repo first.
 * The tracker tools reach every repo Operator can see, so naming the repos is the
 * only thing that keeps other teams' tickets out of the draft.
 */
export function shapingBrief(idea, tracker = 'github', repos = []) {
    const info = trackerInfo(tracker);
    const names = info.priorities;
    const priorities = `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
    const files = idea.attachments ?? [];
    return [
        `${SHAPING_BRIEF_OPENING}, like a whiteboarding session, until it is ready to be a ticket. Read whatever code you need to ground it, but change nothing.`,
        '',
        `Idea: ${idea.title}`,
        idea.notes ? `Notes: ${idea.notes}` : 'Notes: none',
        ...(files.length
            ? [`Files: ${files.map((f) => f.name).join(', ')}. They come with this message and are part of the idea, so read them first.`]
            : []),
        ...(repos.length
            ? [
                '',
                'The repos this idea belongs to:',
                ...repos.map((r, i) => `- ${r} (${i === 0 ? 'your working repo' : 'read only'})`),
                'Read code only in the repos above, and cite related tickets and PRs only from them.',
                "The tracker tools also list other repos' and teams' tickets and PRs. Leave all of those out of the draft.",
            ]
            : []),
        '',
        'How to talk:',
        '- Your replies appear in a small chat thread on the idea card. Keep each to 1-3 short sentences, with no headings and no lists.',
        '- Ask one question at a time. When you can guess, state your assumption ("I\'ll assume X, say if not") instead of asking.',
        '- After a question, you may offer 2-3 short answers Operator can tap, on one last line: Options: first | second | third',
        '- Do not write the ticket yet. Write it when Operator asks for it, or when you know enough, and then say so in one line, such as "Draft is ready: see the card."',
        '- Operator may answer, add files, or ask for changes. Revise the draft by sending the whole draft again after the same one-line note.',
        '- Do not paste the draft into your reply as chat; it goes only after the TICKET_DRAFT: line.',
        '',
        "The ticket is written in the team's template, the structure of RPT-8278:",
        '- Title: "Area: what — part".',
        `- Summary: what to build and why, with the routes, files, related tickets and PRs you found${repos.length ? ' in those repos' : ''}.`,
        '- Scope: short bullets, each starting with a bold name, e.g. **Header:** or **Data:**.',
        '- Acceptance criteria: statements someone can test.',
        `- End with this line: ${TICKET_FOOTER}`,
        '',
        'To hand in a draft, end that reply with TICKET_DRAFT: on its own line, followed by exactly:',
        'Title: <the ticket title>',
        info.issueTypes ? 'Type: <the issue type, usually User Story>' : 'Type: Issue',
        'Labels: <comma-separated labels, or leave blank>',
        ...(names.length ? [`Priority: <${priorities}, or leave blank>`] : []),
        '---',
        '<the description, in Markdown>',
        '',
        'Operator marks the idea Ready when the draft is good, which ends this session. Stay until then.',
    ].join('\n');
}
/** What a worker hired on an idea's ticket is told beside the ticket itself: the draft the ticket was made from. */
function workNote(draft) {
    return ['This ticket was shaped on the Idea board with a Planner. The agreed draft:', '', `# ${draft.title}`, '', draft.description].join('\n');
}
function cleanKey(raw) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    // A GitHub repo, as owner/repo, keeps its case.
    if (/^[\w.-]+\/[\w.-]+$/.test(text))
        return text;
    const key = text.toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key))
        throw new IdeaError('Pick a project.');
    return key;
}
function alreadyTicket(idea) {
    const where = idea.ticketSource ? trackerName(idea.ticketSource) : 'the tracker';
    return `This idea is already ${idea.ticketKey ?? `a ticket in ${where}`}.`;
}
function cleanTitle(raw) {
    const title = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!title)
        throw new IdeaError('An idea needs a title.');
    if (title.length > IDEA_TITLE_MAX)
        throw new IdeaError(`Keep the title to ${IDEA_TITLE_MAX} characters or fewer.`);
    return title;
}
function cleanNotes(raw) {
    if (raw === undefined || raw === null)
        return '';
    if (typeof raw !== 'string')
        throw new IdeaError('Notes must be text.');
    const notes = raw.trim();
    if (notes.length > IDEA_NOTES_MAX)
        throw new IdeaError('Those notes are too long. Keep them under 20,000 characters.');
    return notes;
}
/** Repo paths, each once, in the order given. */
function cleanRepos(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw) || raw.some((r) => typeof r !== 'string'))
        throw new IdeaError('repos must be a list of paths.');
    const repos = [...new Set(raw.map((r) => r.trim()).filter(Boolean))];
    if (repos.length > IDEA_REPOS_MAX)
        throw new IdeaError(`Pick ${IDEA_REPOS_MAX} repos at most.`);
    return repos;
}
/** Uploads checked against the limit, said the way the panel shows an idea's errors. */
function decoded(uploads, alreadyBytes = 0) {
    try {
        return decodeUploads(uploads, alreadyBytes);
    }
    catch (err) {
        throw new IdeaError(err.message);
    }
}
