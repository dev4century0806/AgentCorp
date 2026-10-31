import { CLAUDE_MODEL_MENU, RUNNER_CHOICES, runnerLabel } from './protocol.js';
import { accountDbPath, adoptSharedState, configPath, loadConfig, reloadConfig, resolveRunnerChoice, setActiveAccount } from './config.js';
import { adoptEnabledRunners, runnerSettings } from './agents/runner-settings.js';
import { openDb, Repositories } from './db/index.js';
import { EventBus } from './bus.js';
import { FactoryWorkSource } from './sources/factory/factory-source.js';
import { TicketPoller } from './sources/poller.js';
import { WorkSources } from './sources/work-source.js';
import { GitHubSource } from './sources/github/github-source.js';
import { GitHubSettingsService } from './sources/github/settings.js';
import { GitHubAuth, GITHUB_LOGIN_HINT } from './sources/github/oauth.js';
import { Trackers } from './sources/tracker.js';
import { AgentManager } from './agents/manager.js';
import { buildServer } from './http/server.js';
import { OnboardingService } from './onboarding.js';
import { ClaudeSignIn } from './agents/sign-in.js';
import { ensureSessionToken } from './session.js';
import { forgetRepoCache, listRepos } from './git/repos.js';
import { GitHubAccounts } from './git/github-accounts.js';
import { RepoGitHub } from './git/repo-github.js';
import { writeGeneralAgents } from './skills/general-agents.js';
import { syncAllSkillsToAllTools } from './skills/sync.js';
import { trustSystemCertificates } from './system-ca.js';
async function main() {
    trustSystemCertificates();
    const cfg = loadConfig();
    const token = ensureSessionToken();
    let db = openDb();
    const repos = new Repositories(db);
    const bus = new EventBus();
    const factory = new FactoryWorkSource(cfg);
    const githubAuth = new GitHubAuth(cfg);
    const github = new GitHubSource(cfg, githubAuth);
    const sources = new WorkSources([github, factory]);
    const agents = new AgentManager(cfg, repos, sources, bus);
    agents.restoreFromDb();
    // Lessons saved while the model couldn't load have no embedding, so they can't be matched by meaning.
    void repos.memory.reembedAll().catch(() => { });
    const checking = () => ({ status: 'checking', error: null, version: null });
    let cliHealth = {
        runners: Object.fromEntries(RUNNER_CHOICES.map((id) => [id, checking()])),
        modelMenu: CLAUDE_MODEL_MENU,
    };
    /** The lights and the first-day sign-in follow the default agent for new hires. */
    const defaultReady = () => cliHealth.runners[resolveRunnerChoice(cfg)].status === 'ok';
    /** Shows these agents being checked until they answer, so the page can say so straight away. */
    const markChecking = (ids) => {
        cliHealth = { ...cliHealth, runners: { ...cliHealth.runners, ...Object.fromEntries(ids.map((id) => [id, checking()])) } };
        bus.emit({ type: 'health', health: health() });
    };
    const onUpdate = () => {
        const tickets = repos.listTickets();
        bus.emit({ type: 'ticket.list', tickets, health: health() });
        // Seat anyone already working: a ticket in progress with a worktree on
        // disk should show up at a desk without having to rehire it again.
        void agents.adoptWorktrees(tickets);
    };
    const factoryPoller = new TicketPoller(factory, repos, cfg.factory.pollSeconds, 'Workspace source is not connected. Connect it in Settings.', onUpdate);
    const githubPoller = new TicketPoller(github, repos, cfg.github.pollSeconds, GITHUB_LOGIN_HINT, onUpdate);
    const pollers = [githubPoller, factoryPoller];
    const trackers = new Trackers(cfg, [
        { source: github, poller: githubPoller, settings: new GitHubSettingsService(cfg, github, githubPoller, githubAuth) },
    ]);
    const health = () => {
        const f = factoryPoller.getHealth();
        return {
            factory: cfg.factory.enabled ? f.status : 'disabled',
            factoryError: cfg.factory.enabled ? f.error : null,
            factoryLastPoll: f.lastPoll,
            tracker: trackers.health(),
            trackers: trackers.healths(),
            ...cliHealth,
        };
    };
    // Each quest's step, read from the office as it is now.
    const onboarding = new OnboardingService(repos, bus, {
        power: defaultReady,
        code: async () => (await listRepos(cfg)).length > 0,
        // Every worker ever hired counts, fired and finished ones included.
        hire: () => repos.countAgents() > 0,
    });
    bus.subscribe((e) => {
        if (e.type === 'agent.created')
            void onboarding.check();
    });
    agents.onCliChecked = (mode, result) => {
        const isDefault = mode === resolveRunnerChoice(cfg);
        cliHealth = {
            runners: { ...cliHealth.runners, [mode]: { status: result.ok ? 'ok' : 'error', error: result.error, version: result.version } },
            modelMenu: isDefault ? result.modelMenu : cliHealth.modelMenu,
        };
        bus.emit({ type: 'health', health: health() });
        // An office from before the enabled list turns on what passed, once every agent has answered.
        if (adoptEnabledRunners(cfg, cliHealth.runners))
            bus.emit({ type: 'runners', ...runnerSettings(cfg) });
        // The first-day sign-in step finishes itself the moment the CLI answers.
        if (isDefault && result.ok)
            void onboarding.check();
    };
    // The dot has to follow the runner in Settings, not only the one found at launch.
    const refreshCliHealth = () => void agents.checkAgentCli();
    /** Checks every agent, for Settings; the default's check also builds the model menu. */
    const refreshAllRunners = (announce = false) => {
        void agents.checkAllRunners().then((results) => {
            if (!announce)
                return;
            const id = resolveRunnerChoice(cfg);
            const result = results[id];
            if (result.ok) {
                console.log(`${runnerLabel(id)}: ${result.version}`);
            }
            else {
                console.warn(`${runnerLabel(id)} not usable: ${result.error}\n` +
                    '  Agents cannot start until the CLI is installed and signed in on this machine.');
            }
        });
    };
    const recheckRunner = (id) => {
        markChecking([id]);
        if (id === resolveRunnerChoice(cfg))
            refreshCliHealth();
        else
            void agents.checkRunner(id);
    };
    // Signing Claude Code in from the office: when it ends, look at the CLI again, which checks the quests.
    const claudeSignIn = new ClaudeSignIn((error) => {
        if (error)
            bus.toast(`Claude Code sign-in did not finish: ${error}`, 'error');
        // Checking the CLI takes a couple of seconds; say so straight away, so the page can show it.
        recheckRunner('claude');
    });
    // Each repo's PRs are read as the account the repo is worked as, connected
    // in Settings → Repos or signed in to gh, never GitHub Issues' token: that
    // is a ticket source, and plenty of offices track tickets elsewhere.
    const repoGitHub = new RepoGitHub(cfg, githubAuth, async (repo) => githubAccounts.workersLogin(repo, await listRepos(cfg)));
    const githubAccounts = new GitHubAccounts(cfg, repoGitHub);
    // Initialize PR watching if enabled. The watcher polls GitHub for PR status
    // on workers' own PRs and messages them to fix failing checks, conflicts, or
    // review comments. the assistant asks the operator before a fired or done worker is rehired.
    const startPrWatcher = async () => {
        if (!cfg.prWatch.enabled)
            return;
        agents.initPrWatcher(repoGitHub.api());
    };
    let activeAccount = null;
    /** Returns whether the office moved to another account; signing in again as the same one changes nothing. */
    const switchAccount = async (userId) => {
        if (activeAccount === userId)
            return false;
        const nextPath = accountDbPath(userId);
        for (const poller of pollers)
            poller.stop();
        const next = openDb(nextPath);
        await agents.shutdown();
        // Config, tokens, notes and skills are this user's from here on, not the last one's.
        setActiveAccount(userId);
        adoptSharedState(userId);
        reloadConfig(cfg);
        // The repo picker is cached from the last user's repo list.
        forgetRepoCache();
        repoGitHub.reset();
        repos.switchDatabase(next);
        void repos.memory.reembedAll().catch(() => { });
        db = next;
        activeAccount = userId;
        // This user's first day is their own: look at their agent again (their config may name
        // another one) and at their steps now, before the slower restarts below, so signing in
        // to the office turns the lights on straight away. Until their agent answers, the last
        // account's answer does not count for them: the sign-in step waits for it.
        markChecking(RUNNER_CHOICES);
        refreshAllRunners();
        void onboarding.check();
        await factory.reset();
        agents.restoreAccount();
        // Pick up the workers the last restart, or switching away, cut off. Only here and
        // not at boot: before sign-in the office is on the shared database, and the first
        // sign-in would stop anyone resumed there straight away.
        void agents.resumeCrashed();
        // The personas are this user's, and may have been edited in config.json while the office was closed.
        writeGeneralAgents(cfg.personas);
        syncAllSkillsToAllTools();
        // Each user's own config decides what polls, not what the last user had running.
        if (cfg.factory.enabled)
            factoryPoller.start();
        else
            repos.replaceTickets('8090', []);
        await trackers.start();
        await startPrWatcher();
        bus.emit({ type: 'ticket.list', tickets: repos.listTickets(), health: health() });
        return true;
    };
    const app = await buildServer({
        cfg, repos, bus, agents, pollers, factory, factoryPoller, trackers, token, health, refreshCliHealth, recheckRunner, runnerHealth: () => cliHealth.runners, onboarding, switchAccount,
        claudeSignIn,
        githubAccounts,
        repoGitHub,
    });
    await startPrWatcher();
    console.log(`\nAgentCorp is listening on http://127.0.0.1:${cfg.port}`);
    console.log(`Config: ${configPath()}`);
    refreshAllRunners(true);
    let closing = false;
    const shutdown = async (signal) => {
        if (closing)
            return;
        closing = true;
        console.log(`\n${signal}: closing the office.`);
        for (const p of pollers)
            p.stop();
        claudeSignIn.cancel();
        await agents.shutdown();
        await sources.close();
        await app.close().catch(() => { });
        db.close();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
main().catch((err) => {
    console.error(`\nAgentCorp failed to start: ${err.message}`);
    if (err.stack)
        console.error(err.stack);
    process.exit(1);
});
