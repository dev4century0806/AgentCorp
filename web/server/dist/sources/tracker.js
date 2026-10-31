import { TRACKERS, trackerName, } from '../protocol.js';
import { saveConfigValue } from '../config.js';
/**
 * The trackers the office supports, of which one is active: the one whose
 * tickets reach the board and in which ideas become tickets.
 */
export class Trackers {
    cfg;
    byId = new Map();
    constructor(cfg, trackers) {
        this.cfg = cfg;
        for (const t of trackers)
            this.byId.set(t.source.id, t);
    }
    all() {
        return [...this.byId.values()];
    }
    get id() {
        return this.cfg.tracker;
    }
    get name() {
        return trackerName(this.cfg.tracker);
    }
    /** The tracker by id, or an error that says it is not one the office has. */
    get(id) {
        const t = this.byId.get(id);
        if (!t)
            throw new Error(`${TRACKERS.find((x) => x.id === id)?.name ?? id} is not supported yet.`);
        return t;
    }
    /** The active tracker, or null when it is one the office cannot use yet. */
    active() {
        return this.byId.get(this.cfg.tracker) ?? null;
    }
    isActive(id) {
        return this.cfg.tracker === id;
    }
    /** Switches the office to another tracker: the old one stops polling and its tickets leave the board. */
    async setActive(id) {
        const choice = TRACKERS.find((t) => t.id === id);
        if (!choice)
            throw new Error(`Pick one of ${TRACKERS.map((t) => t.name).join(', ')}.`);
        if (!choice.available || !this.byId.has(choice.id))
            throw new Error(`${choice.name} is not supported yet.`);
        if (this.cfg.tracker === choice.id)
            return;
        this.cfg.tracker = choice.id;
        saveConfigValue('tracker', choice.id);
        for (const t of this.all())
            await t.settings.apply();
    }
    /** Starts every enabled tracker's poller; the selected tracker remains the default for new tickets. */
    async start() {
        for (const t of this.all())
            await t.settings.apply();
    }
    /** Health for every supported tracker, including trackers not implemented in this process. */
    healths() {
        return Object.fromEntries(TRACKERS.map(({ id }) => [id, this.byId.get(id)?.poller.getHealth() ?? {
                id,
                status: 'disabled',
                error: null,
                lastPoll: null,
            }]));
    }
    health() {
        const t = this.active();
        if (!t || !t.settings.enabled())
            return { id: this.cfg.tracker, status: 'disabled', error: null, lastPoll: null };
        return { id: this.cfg.tracker, ...t.poller.getHealth() };
    }
    async issueTypes(project) {
        return this.connected().issueTypes(project);
    }
    async createIssue(input) {
        return this.connected().createIssue(input);
    }
    connected() {
        const t = this.active();
        if (!t)
            throw new Error(`${this.name} is not supported yet. Pick another tracker in Settings.`);
        if (!t.settings.enabled())
            throw new Error(`${this.name} is not connected. Connect it in Settings.`);
        return t.source;
    }
}
