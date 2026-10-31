import { QUESTS } from './protocol.js';
/**
 * The first day: three setup steps, each a quest that pays its XP once, the
 * first time the office sees the step done.
 *
 * Nothing is ticked by hand. Each check reads the real state (the agent CLI
 * answers, a repo is on disk, a worker was hired), so the XP cannot be
 * farmed, and someone who did a step before quests existed is paid for it
 * the first time the office looks.
 */
export class OnboardingService {
    repos;
    bus;
    checks;
    checking = null;
    again = false;
    constructor(repos, bus, checks) {
        this.repos = repos;
        this.bus = bus;
        this.checks = checks;
    }
    state() {
        return this.repos.getOnboarding();
    }
    /**
     * Looks at every unfinished quest and pays for any now done. Calls that
     * arrive mid-check run once more afterwards rather than in parallel, so a
     * quest is never paid twice.
     */
    check() {
        return this.startCheck(() => this.run());
    }
    /** Re-check only the badge-in step; other quests must wait for their own step. */
    checkPower() {
        return this.startCheck(() => this.run(['power']));
    }
    startCheck(run) {
        if (this.checking) {
            this.again = true;
            return this.checking;
        }
        this.checking = run().finally(() => {
            this.checking = null;
            if (this.again) {
                this.again = false;
                void this.check();
            }
        });
        return this.checking;
    }
    /** Continue past one active quest without awarding its XP. */
    skipQuest(id) {
        return this.skip([id]);
    }
    skip(ids) {
        let changed = false;
        for (const id of ids)
            changed = this.repos.markQuest(id, 'skipped') || changed;
        if (changed)
            this.publish();
        return this.state();
    }
    setTourDismissed(dismissed) {
        this.repos.setTourDismissed(dismissed);
        this.publish();
        return this.state();
    }
    restartTour() {
        return this.repos.restartTour(QUESTS[0].id);
    }
    /** Marks a one-time hint as seen. Returns the updated state. */
    markHintSeen(hintId) {
        if (this.repos.markHintSeen(hintId)) {
            this.publish();
        }
        return this.state();
    }
    async run(only) {
        const before = this.state();
        const finished = new Set([...before.done, ...before.skipped]);
        for (const quest of QUESTS) {
            if (only && !only.includes(quest.id))
                continue;
            if (finished.has(quest.id))
                continue;
            let done = false;
            try {
                done = await this.checks[quest.id]();
            }
            catch {
                done = false;
            }
            if (done && this.repos.markQuest(quest.id, 'done')) {
                // Told at once, not after the slower checks behind it: signing in turns the lights on.
                this.publish();
            }
        }
    }
    publish() {
        this.bus.emit({ type: 'onboarding', onboarding: this.state() });
    }
}
