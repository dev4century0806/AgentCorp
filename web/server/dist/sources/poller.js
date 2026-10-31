import { splitTicketId, ticketId } from '../protocol.js';
import { describeSourceError } from './fetch-error.js';
import { NeedsLoginError } from './mcp-client.js';
export class TicketPoller {
    source;
    repos;
    intervalSeconds;
    loginHint;
    onUpdate;
    timer = null;
    inFlight = null;
    generation = 0;
    health = { status: 'connecting', error: null, lastPoll: null };
    constructor(source, repos, intervalSeconds, loginHint, onUpdate) {
        this.source = source;
        this.repos = repos;
        this.intervalSeconds = intervalSeconds;
        this.loginHint = loginHint;
        this.onUpdate = onUpdate;
    }
    /** Runs after a good poll with the fresh open keys, never on the cached fallback after a failure. */
    onPolled = () => undefined;
    async setEnabled(on) {
        if (on) {
            this.start();
            await this.poll();
            return;
        }
        this.stop();
        this.repos.replaceTickets(this.source.id, []);
        this.onUpdate();
    }
    get running() {
        return this.timer !== null;
    }
    getHealth() {
        return { ...this.health };
    }
    start() {
        if (this.timer)
            return;
        void this.poll();
        this.timer = setInterval(() => void this.poll(), Math.max(10, this.intervalSeconds) * 1000);
        this.timer.unref();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.generation++;
        this.inFlight = null;
    }
    /** Returns the tickets on success; a caller-triggered refresh surfaces errors. */
    poll() {
        if (this.inFlight)
            return this.inFlight;
        const current = this.fetch().finally(() => {
            if (this.inFlight === current)
                this.inFlight = null;
        });
        this.inFlight = current;
        return current;
    }
    async fetch() {
        const generation = this.generation;
        try {
            const tickets = (await this.source.list()).map((t) => ({ ...t, key: ticketId(this.source.id, t.key) }));
            if (generation !== this.generation)
                return [];
            this.repos.replaceTickets(this.source.id, tickets);
            if (this.health.status === 'error')
                console.log(`${this.source.name}: check works again.`);
            this.health = { status: 'ok', error: null, lastPoll: new Date().toISOString() };
            this.onUpdate();
            this.onPolled(this.source, tickets.map((t) => splitTicketId(t.key)?.key ?? t.key));
            return tickets;
        }
        catch (err) {
            if (generation !== this.generation)
                return [];
            const needsLogin = err instanceof NeedsLoginError;
            const error = needsLogin ? this.loginHint : describeSourceError(err, this.source.host?.());
            // Once per new failure, not every poll, so the log says when it broke and why.
            if (!needsLogin && error !== this.health.error) {
                console.warn(`${this.source.name} check failed: ${error}`);
            }
            this.health = {
                status: needsLogin ? 'unconfigured' : 'error',
                error,
                lastPoll: this.health.lastPoll,
            };
            // Serve the cache so a dead connection still shows yesterday's board.
            this.onUpdate();
            return this.repos.listTickets().filter((t) => t.source === this.source.id);
        }
    }
}
