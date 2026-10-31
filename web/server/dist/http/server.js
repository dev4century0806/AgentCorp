import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, {} from 'fastify';
import fastifyStatic from '@fastify/static';
import { QUESTS, RUNNER_CHOICES, VOICE_MAX_SECONDS, VOICE_MIN_SECONDS, VOICE_SAMPLE_RATE, repoPersonaId, ticketId, skillNameProblem } from '../protocol.js';
import { expandPath, rememberRepo, resolveEditor, resolveRunnerChoice, resolveRunnerMode, saveConfigFields, saveConfigValue } from '../config.js';
import { cloneRepo, cloneRoot, lookUpRepo } from '../git/clone.js';
import { codeFolders, describeRepo, forgetRepoCache, listRepos } from '../git/repos.js';
import { chooseFolder } from '../git/choose-folder.js';
import { listWorktrees } from '../git/worktree.js';
import { describeSourceError } from '../sources/fetch-error.js';
import { disconnectFactory, factoryAuth, finishFactoryConnect, startFactoryConnect } from '../sources/factory/connect.js';
import { AgentManager, checkPersonas, checkSetup, HireError } from '../agents/manager.js';
import { signInForRunner } from '../agents/sign-in.js';
import { IdeaError, IdeaService } from '../ideas.js';
import { DESIGNER_TURN_TIMEOUT_MS, OfficeService } from '../offices/service.js';
import { OfficeError } from '../offices/store.js';
import { suggestDetails } from '../offices/details.js';
import { oneShot, openSession } from '../agents/one-shot.js';
import { SESSION_COOKIE, SESSION_HEADER, readCookie, tokenMatches } from '../session.js';
import { attachWebSocket } from './ws.js';
import { serveMcpRequest } from '../sources/mcp-proxy.js';
import { MAX_UPLOAD_BYTES, ideaFilesDir, uploadFile, uploadsDir } from '../uploads.js';
import { emitTracking } from '../tracking/emit.js';
import { officeDay } from './day.js';
import { repoPersonas } from '../skills/agents.js';
import { chooseRunner, runnerSettings, setRunnerEnabled } from '../agents/runner-settings.js';
import { DownloadCancelled, Transcriber } from '../voice/transcriber.js';
import { openRewriteSession, Rewriter } from '../voice/rewrite.js';
const HERE = dirname(fileURLToPath(import.meta.url));
// src/http at dev time, dist/http once built; the ui build sits beside both.
const UI_DIST = join(HERE, '..', '..', '..', 'ui', 'dist');
const UPLOAD_BODY_LIMIT = Math.ceil(MAX_UPLOAD_BYTES * 1.4);
/** A thumbnail is at most 768 KB of PNG, which base64 and JSON grow to about 1 MB. */
const THUMBNAIL_BODY_LIMIT = Math.ceil(1.2 * 1024 * 1024);
/** Two minutes of 16 kHz float32 samples is 7.7 MB; a little over, for the last chunk the recorder gives. */
const VOICE_BODY_LIMIT = Math.ceil((VOICE_MAX_SECONDS + 5) * VOICE_SAMPLE_RATE * 4);
const DESKTOP_LOG_FILE = join(process.env.HOME || process.env.USERPROFILE || '.', '.agent-corp', 'logs', 'desktop.log');
function redactDiagnostics(text) {
    return text
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, '$1[redacted]')
        .replace(/(access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)(\s*[:=]\s*)[^\s]+/gi, '$1$2[redacted]')
        .replace(/https?:\/\/[^\s]*[?&](?:code|token|state)=[^\s&]+/gi, '[redacted callback URL]');
}
function diagnostics(agents) {
    const desktop = existsSync(DESKTOP_LOG_FILE) ? readFileSync(DESKTOP_LOG_FILE, 'utf8').split('\n').slice(-120).join('\n') : '(desktop log is not available)';
    const streams = agents.listAgents()
        .map((agent) => {
        const lines = agents.streamLog(agent.id);
        return lines.length ? `\n--- agent ${agent.name} (${agent.id}) ---\n${lines.slice(-120).join('\n')}` : '';
    })
        .filter(Boolean)
        .join('\n');
    return redactDiagnostics([
        'AgentCorp diagnostic report',
        `Generated: ${new Date().toISOString()}`,
        `Platform: ${process.platform} ${process.arch}`,
        `Node: ${process.version}`,
        `Version: ${process.env.npm_package_version ?? 'unknown'}`,
        '\n--- desktop/server log (recent) ---',
        desktop,
        streams || '\n(no agent stream logs)',
    ].join('\n'));
}
export async function buildServer(deps) {
    const { cfg, repos, bus, agents, pollers, factory, factoryPoller, trackers, token } = deps;
    const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
    const ideas = new IdeaService(repos, bus, deps.ticketMaker ?? trackers ?? null, (target) => {
        cfg.ideas = { lastProject: target.project, lastIssueType: target.issueType };
        saveConfigFields('ideas', cfg.ideas);
    }, agents, () => cfg.personas.find((p) => p.id === 'planner')?.id, () => void Promise.all(pollers.filter((p) => p.running).map((p) => p.poll())).catch(() => undefined));
    agents.onTicketDraft = (agentId, raw) => ideas.draftFromPlanner(agentId, raw);
    agents.retitle = (prompt) => oneShot(cfg, resolveRunnerChoice(cfg), prompt, { timeoutMs: 30_000 });
    // After each good poll, ideas whose ticket closed leave the Ticketed lane.
    for (const t of trackers?.all() ?? []) {
        t.poller.onPolled = (_source, openKeys) => void ideas.syncTickets(t.source, openKeys).catch(() => undefined);
    }
    const offices = deps.offices ??
        new OfficeService(bus, 
        // Headless, so the designer takes no desk and never waits on anyone. `standard` lets it write office.json in its own folder.
        (runner, setup, resume) => openSession(cfg, runner, { ...setup, ...(resume ? { resume } : {}), permission: 'standard', timeoutMs: DESIGNER_TURN_TIMEOUT_MS }), () => resolveRunnerChoice(cfg));
    // The speech model is the Mac's, so it outlives an account switch; the switches are the account's.
    const transcriber = deps.transcriber ?? new Transcriber();
    const voiceSettings = () => ({
        enabled: cfg.voice?.enabled === true,
        rewrite: cfg.voice?.rewrite === true,
        model: transcriber.status(),
    });
    transcriber.onChange = () => bus.emit({ type: 'voice', voice: voiceSettings() });
    const rewriter = deps.rewriter ??
        new Rewriter(() => {
            const mode = resolveRunnerChoice(cfg);
            // The model menu is the default runner's, which is the one the rewrite runs on.
            return openRewriteSession(cfg, mode, agents.modelMenu);
        });
    app.addHook('onClose', async () => {
        rewriter.closeAll();
        transcriber.cancel();
        transcriber.unload();
    });
    const snapshot = () => ({
        seq: bus.currentSeq,
        tickets: repos.listTickets(),
        agents: agents.listAgents(),
        previous: agents.listPrevious(),
        messages: repos.listMessagesForActiveAgents(),
        done: repos.listDone(),
        health: deps.health(),
        limits: agents.limits,
        queue: agents.queueView(),
        reviewQueue: agents.reviewQueueView(),
        workerDefaults: { permission: cfg.agents.permission, model: cfg.agents.model, effort: cfg.agents.effort },
        personas: cfg.personas,
        repoPersonas: repoPersonas(cfg.agents, agents.modelMenu),
        ...runnerSettings(cfg),
        ideas: ideas.list(),
        ticketTarget: { project: cfg.ideas.lastProject, issueType: cfg.ideas.lastIssueType },
        messageStyle: cfg.messageStyle,
        onboarding: deps.onboarding?.state() ?? { done: [], skipped: [], tourDismissed: false, tourReplay: null, seenHints: [] },
        voice: voiceSettings(),
    });
    /**
     * Origin verification to prevent CSRF / cross-site requests to loopback API.
     * Every API call needs the local session token, so unauthorized processes
     * cannot drive AgentCorp agents.
     */
    app.addHook('onRequest', async (req, reply) => {
        const origin = req.headers.origin;
        if (origin) {
            const allowed = origin === 'http://127.0.0.1:4317' || origin === 'http://localhost:4317';
            if (!allowed) {
                return reply.code(403).send({ error: 'Forbidden: Invalid request origin.' });
            }
        }
        if (!req.url.startsWith('/api/'))
            return;
        const given = req.headers[SESSION_HEADER] ??
            readCookie(req.headers.cookie, SESSION_COOKIE);
        if (!tokenMatches(token, given)) {
            await reply.code(401).send({ error: 'Bad or missing session token.' });
        }
    });
    const fail = async (reply, err) => {
        if (err instanceof OfficeError) {
            return reply.code(err.status).send({ error: err.message, ...(err.errors.length ? { errors: err.errors } : {}) });
        }
        const notFound = (err instanceof HireError && err.reason === 'not_found') || (err instanceof IdeaError && err.notFound);
        const status = notFound ? 404 : 400;
        return reply.code(status).send({ error: err.message });
    };
    /* ---------- onboarding ---------- */
    app.post('/api/onboarding/check', async () => {
        // "Check again" on the power quest: ask the CLI afresh, which checks the quests when it answers.
        deps.refreshCliHealth?.();
        await deps.onboarding?.checkPower();
        return deps.onboarding?.state() ?? null;
    });
    /* Signing the agent CLI in, supporting Claude Code, Codex, Copilot, etc. */
    const getSignInInstance = (runner) => {
        const mode = runner || resolveRunnerMode(cfg) || 'claude';
        if (mode === 'claude' && deps.claudeSignIn)
            return deps.claudeSignIn;
        return signInForRunner(mode, (error) => {
            deps.recheckRunner?.(mode);
        });
    };
    app.get('/api/agent-cli/sign-in', async () => getSignInInstance().state());
    app.get('/api/agent-cli/sign-in/:runner', async (req) => {
        const { runner } = req.params;
        return getSignInInstance(runner).state();
    });
    app.post('/api/agent-cli/sign-in', async (req, reply) => {
        const runner = req.body?.runner || resolveRunnerMode(cfg) || 'claude';
        const signIn = getSignInInstance(runner);
        return signIn.start();
    });
    app.post('/api/agent-cli/sign-in/:runner', async (req, reply) => {
        const { runner } = req.params;
        const signIn = getSignInInstance(runner);
        return signIn.start();
    });
    app.post('/api/agent-cli/sign-in/code', async (req, reply) => {
        const { code, runner } = (req.body ?? {});
        try {
            if (typeof code !== 'string')
                throw new Error('Paste the code from the sign-in page.');
            const signIn = getSignInInstance(runner);
            signIn.submitCode(code);
            return signIn.state();
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agent-cli/sign-in/:runner/code', async (req, reply) => {
        const { runner } = req.params;
        const { code } = (req.body ?? {});
        try {
            if (typeof code !== 'string')
                throw new Error('Paste the code from the sign-in page.');
            const signIn = getSignInInstance(runner);
            signIn.submitCode(code);
            return signIn.state();
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.delete('/api/agent-cli/sign-in', async (req) => {
        const runner = req.query?.runner || resolveRunnerMode(cfg);
        getSignInInstance(runner).cancel();
        return { ok: true };
    });
    app.delete('/api/agent-cli/sign-in/:runner', async (req) => {
        const { runner } = req.params;
        getSignInInstance(runner).cancel();
        return { ok: true };
    });
    /* Obsidian Vault status & re-index */
    app.get('/api/obsidian/status', async () => {
        const obsidianCfg = cfg.obsidian || { enabled: false, vaultPath: '' };
        let count = 0;
        try {
            const { getObsidianStats } = await import('../memory/obsidian-indexer.js');
            count = getObsidianStats().count;
        } catch {}
        return {
            enabled: Boolean(obsidianCfg.enabled),
            vaultPath: obsidianCfg.vaultPath || '',
            count,
        };
    });
    app.post('/api/obsidian/sync', async (req, reply) => {
        const { vaultPath } = (req.body ?? {});
        if (typeof vaultPath === 'string') {
            cfg.obsidian = { ...cfg.obsidian, vaultPath, enabled: true };
            saveConfigFields('obsidian', { vaultPath, enabled: true });
        }
        const { syncObsidianVault } = await import('../memory/obsidian-indexer.js');
        const res = await syncObsidianVault(cfg.obsidian?.vaultPath);
        return res;
    });
    /* Database Backup (FEAT-012) */
    app.get('/api/backup', async () => {
        const { listBackups } = await import('../memory/backup.js');
        return { backups: listBackups() };
    });
    app.post('/api/backup', async (req, reply) => {
        const { createDatabaseBackup } = await import('../memory/backup.js');
        const res = await createDatabaseBackup();
        if (!res.ok) return reply.code(500).send(res);
        return res;
    });
    /** Opens the Mac's folder picker; answers with the folder chosen, or null if it was cancelled. */
    app.post('/api/folders/choose', async (req, reply) => {
        const { prompt } = (req.body ?? {});
        try {
            return { path: await chooseFolder(typeof prompt === 'string' && prompt.trim() ? prompt.trim() : 'Choose a folder') };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /** Folders in the home folder holding git repos, for the guide to offer. */
    app.get('/api/onboarding/code-folders', async () => ({ folders: codeFolders(cfg.repos.roots) }));
    app.post('/api/onboarding/skip/:id', async (req, reply) => {
        if (!QUESTS.some((quest) => quest.id === req.params.id))
            return reply.code(400).send({ error: 'Unknown onboarding step.' });
        return deps.onboarding?.skipQuest(req.params.id) ?? null;
    });
    app.put('/api/onboarding/tour', async (req, reply) => {
        const { dismissed } = (req.body ?? {});
        if (typeof dismissed !== 'boolean')
            return reply.code(400).send({ error: 'dismissed must be true or false.' });
        return deps.onboarding?.setTourDismissed(dismissed) ?? null;
    });
    app.post('/api/onboarding/restart', async () => deps.onboarding?.restartTour() ?? null);
    app.post('/api/onboarding/hints/:id', async (req, reply) => {
        const validHints = ['at_mention', 'repo_agents', 'first_reviewer', 'recovery_action', 'empty_toolkit'];
        if (!validHints.includes(req.params.id))
            return reply.code(400).send({ error: 'Unknown hint.' });
        return deps.onboarding?.markHintSeen(req.params.id) ?? null;
    });
    app.post('/api/account', async (req, reply) => {
        const userId = req.body?.userId;
        if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
            return reply.code(400).send({ error: 'Choose a valid signed-in account.' });
        }
        const moved = await deps.switchAccount?.(userId.toLowerCase());
        // The last account's designers are gone with its workers; its offices are on its own disk.
        // Signing in again as the same account (a reload, a second window) keeps its workers, so keeps its designers too.
        if (moved !== false)
            offices.reset();
        return { ok: true };
    });
    /* ---------- state ---------- */
    app.get('/api/state', async () => snapshot());
    app.get('/api/diagnostics', async () => ({ report: diagnostics(agents) }));
    /* ---------- standup ---------- */
    app.get('/api/standup', async (req) => {
        const since = req.query?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const data = repos.getStandupData(since);
        // Map to the wire type
        const summary = {
            since,
            done: data.done.map((d) => ({
                ticketKey: d.ticketKey,
                title: d.title,
                prUrl: d.prUrl,
                doneAt: d.doneAt,
            })),
            blocked: data.blocked.map((b) => ({
                agentId: b.id,
                name: b.name,
                ticketKey: b.ticketKey,
                bubble: b.bubble,
                status: b.status,
                stuckSince: b.stuckSince,
            })),
            inProgress: data.inProgress.map((i) => ({
                agentId: i.id,
                name: i.name,
                ticketKey: i.ticketKey,
                summary: i.summary,
                status: i.status,
            })),
            shoutouts: {
                topWorker: data.topWorker,
            },
            quiet: data.done.length === 0 && data.blocked.length === 0 && data.inProgress.length === 0,
        };
        return summary;
    });
    /* ---------- the office's day, for its timelapse ---------- */
    /** The day's moments between two times, oldest first; ticket titles only with `titles=1`. */
    app.get('/api/day', async (req, reply) => {
        const answer = officeDay(repos, req.query);
        return 'error' in answer ? reply.code(400).send(answer) : answer.day;
    });
    /** The desktop app has finished the day's clip: the assistant says so. */
    app.post('/api/day/ready', async () => ({ ok: agents.announceDayReady() }));
    /**
     * Reference data, not state: repos change when the operator clones something, not
     * when an agent does anything, so they sit outside the event stream.
     */
    app.get('/api/repos/lookup', async (req) => {
        const q = req.query?.q ?? '';
        return lookUpRepo(cfg, q);
    });
    app.post('/api/repos/clone', async (req, reply) => {
        const { repo } = (req.body ?? {});
        if (typeof repo !== 'string' || !repo.trim())
            return reply.code(400).send({ error: 'Name the repo to clone.' });
        bus.toast(`Cloning ${repo.trim()}…`);
        try {
            const cloned = await cloneRepo(cfg, repo);
            bus.toast(`Cloned ${cloned.name} into ${cloned.path}.`, 'done');
            const all = await listRepos(cfg, { refresh: true });
            void deps.onboarding?.check();
            return { repo: cloned, repos: all };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/repos', async (req) => {
        const refresh = req.query?.refresh === '1';
        return { repos: await listRepos(cfg, { refresh }) };
    });
    app.get('/api/repos/github-accounts', async (req) => {
        const refresh = req.query?.refresh === '1';
        if (!deps.githubAccounts)
            return { repos: [] };
        return { repos: await deps.githubAccounts.check(await listRepos(cfg, { refresh }), { refresh }) };
    });
    /**
     * Takes a repo out of the office's list, however it was found. The folder
     * on disk is left alone, as are workers already in it; Add repo brings it back.
     */
    app.post('/api/repos/remove', async (req, reply) => {
        const { path } = (req.body ?? {});
        if (typeof path !== 'string' || !path.trim())
            return reply.code(400).send({ error: 'Say which repo to remove.' });
        const target = expandPath(path.trim());
        const hidden = cfg.repos.hidden.some((p) => expandPath(p) === target) ? cfg.repos.hidden : [...cfg.repos.hidden, target];
        const known = cfg.repos.known.filter((r) => expandPath(r.path) !== target);
        cfg.repos = { ...cfg.repos, hidden, known };
        saveConfigFields('repos', { hidden, known });
        forgetRepoCache();
        return { repos: await listRepos(cfg, { refresh: true }) };
    });
    /** GitHub's consent page for reading one repo's PRs, as `login` if given. GitHub Issues is left as it is. */
    app.post('/api/repos/github/connect', async (req, reply) => {
        const { repo, session, login } = (req.body ?? {});
        if (!deps.repoGitHub)
            return reply.code(404).send({ error: 'Repo connections are not set up here.' });
        if (typeof repo !== 'string' || !repo.trim())
            return reply.code(400).send({ error: 'Name the repo to connect, as owner/repo.' });
        try {
            const url = await deps.repoGitHub.connect(repo.trim(), typeof session === 'string' ? session : null, typeof login === 'string' ? login : null);
            return { url };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /** Forgets a connected account for every repo that used it. */
    app.delete('/api/repos/github/:login', async (req, reply) => {
        if (!deps.repoGitHub)
            return reply.code(404).send({ error: 'Repo connections are not set up here.' });
        try {
            deps.repoGitHub.disconnect(req.params.login);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/repos/add', async (req, reply) => {
        const { path } = (req.body ?? {});
        if (typeof path !== 'string' || !path.trim())
            return reply.code(400).send({ error: 'Pick a repo folder to add.' });
        try {
            const repo = await describeRepo(path);
            const rule = { path: repo.path, baseBranch: repo.baseBranch };
            rememberRepo(rule);
            if (!cfg.repos.known.some((r) => expandPath(r.path) === repo.path))
                cfg.repos.known = [...cfg.repos.known, rule];
            // Adding a repo removed before brings it back.
            const hidden = cfg.repos.hidden.filter((p) => expandPath(p) !== repo.path);
            if (hidden.length !== cfg.repos.hidden.length) {
                cfg.repos = { ...cfg.repos, hidden };
                saveConfigFields('repos', { hidden });
            }
            forgetRepoCache();
            const all = await listRepos(cfg, { refresh: true });
            void deps.onboarding?.check();
            return { repo, repos: all };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /**
     * Open tickets matching a key or words in every connected tracker that can
     * search, whoever they are assigned to: for picking work that is not on the
     * board. Trackers whose board already holds every open ticket are left to
     * the board.
     */
    app.get('/api/tickets/search', async (req) => {
        const q = (req.query?.q ?? '').trim();
        if (!q)
            return { tickets: [], errors: [] };
        const connected = (trackers?.all() ?? []).filter((t) => t.source.searchTickets && t.poller.getHealth().status === 'ok');
        const errors = [];
        const found = await Promise.all(connected.map((t) => t.source.searchTickets(q).then((list) => list.map((ticket) => ({ ...ticket, key: ticketId(t.source.id, ticket.key) })), (err) => {
            errors.push(`${t.source.name} search failed: ${describeSourceError(err, t.source.host?.())}`);
            return [];
        })));
        return { tickets: found.flat(), errors };
    });
    app.post('/api/tickets/refresh', async () => {
        await Promise.all(pollers.filter((p) => p.running).map((p) => p.poll()));
        const tickets = repos.listTickets();
        return { tickets, health: deps.health() };
    });
    /* ---------- agents ---------- */
    app.post('/api/agents', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
        const body = (req.body ?? {});
        if (!body.ticketKey && !body.task?.trim()) {
            return reply.code(400).send({ error: 'Pass a ticketKey, or a task to do.' });
        }
        try {
            return await agents.hire(body);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/messages', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
        const { text, attachments, atMentions } = (req.body ?? {});
        const hasFiles = Array.isArray(attachments) && attachments.length > 0;
        if (!text?.trim() && !hasFiles)
            return reply.code(400).send({ error: 'text or attachments are required.' });
        try {
            // Grant @-permissions from the mentions in this message
            if (Array.isArray(atMentions)) {
                for (const mention of atMentions) {
                    if (typeof mention.workerId === 'string' && mention.workerId) {
                        agents.grantAtPermission(req.params.id, mention.workerId);
                    }
                }
            }
            await agents.sendMessage(req.params.id, text ?? '', attachments);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/agents/:id/uploads/:file', async (req, reply) => {
        const found = uploadFile(uploadsDir(req.params.id), req.params.file);
        if (!found)
            return reply.code(404).send({ error: 'No such upload.' });
        return reply
            .type(found.contentType)
            .header('x-content-type-options', 'nosniff')
            .send(createReadStream(found.path));
    });
    app.all('/api/mcp/:source', async (req, reply) => {
        const client = agents.workerTools(req.params.source);
        if (!client)
            return reply.code(404).send({ error: `${req.params.source} is not connected.` });
        if (req.method !== 'POST')
            return reply.code(405).send({ error: 'POST only.' });
        reply.hijack();
        await serveMcpRequest(req.params.source, client, req.raw, reply.raw, req.body);
    });
    app.all('/api/mcp/office/:id', async (req, reply) => {
        const tools = agents.officeTools(req.params.id);
        if (!tools)
            return reply.code(404).send({ error: 'Office tools are not available for this worker.' });
        if (req.method !== 'POST')
            return reply.code(405).send({ error: 'POST only.' });
        reply.hijack();
        await serveMcpRequest('office', tools, req.raw, reply.raw, req.body);
    });
    app.all('/api/mcp/user/:id/:name', async (req, reply) => {
        const tools = agents.userTools(req.params.id, req.params.name);
        if (!tools)
            return reply.code(404).send({ error: `${req.params.name} is not on for this worker.` });
        if (req.method !== 'POST')
            return reply.code(405).send({ error: 'POST only.' });
        reply.hijack();
        await serveMcpRequest(req.params.name, tools, req.raw, reply.raw, req.body);
    });
    app.post('/api/agents/:id/permission', async (req, reply) => {
        const { requestId, allow, scope } = (req.body ?? {});
        if (!requestId || typeof allow !== 'boolean') {
            return reply.code(400).send({ error: 'requestId and allow are required.' });
        }
        if (scope !== undefined && scope !== 'once' && scope !== 'always') {
            return reply.code(400).send({ error: "scope must be 'once' or 'always'." });
        }
        try {
            await agents.answerPermission(req.params.id, requestId, allow, scope ?? 'once');
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/question', async (req, reply) => {
        const { requestId, answers } = (req.body ?? {});
        if (!requestId || (answers !== null && !isQuestionAnswers(answers))) {
            return reply.code(400).send({ error: 'requestId and answers are required.' });
        }
        try {
            await agents.answerQuestion(req.params.id, requestId, answers);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.delete('/api/agents/:id/grants/:grantId', async (req, reply) => {
        const grantId = Number(req.params.grantId);
        if (!Number.isInteger(grantId))
            return reply.code(400).send({ error: 'grantId must be a number.' });
        try {
            agents.revokeGrant(req.params.id, grantId);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    const assistantState = () => {
        const agent = agents.listAgents().find(a => a.builtInPam);
        return { name: agent?.name ?? 'Nova', named: repos.getMeta('assistant.named') === '1' };
    };
    app.get('/api/assistant', async () => assistantState());
    app.put('/api/assistant', async (req, reply) => {
        const name = req.body?.name;
        if (typeof name !== 'string') return reply.code(400).send({ error: 'Pass a name.' });
        const agent = agents.listAgents().find(a => a.builtInPam);
        if (!agent) return reply.code(503).send({ error: 'The assistant is not ready. Try again.' });
        try {
            agents.rename(agent.id, name);
            repos.setMeta('assistant.named', '1');
            return assistantState();
        } catch (err) { return fail(reply, err); }
    });
    app.put('/api/agents/:id/name', async (req, reply) => {
        const { name } = (req.body ?? {});
        if (typeof name !== 'string')
            return reply.code(400).send({ error: 'Pass a name.' });
        try {
            const agent = agents.rename(req.params.id, name);
            if (agent.builtInPam) repos.setMeta('assistant.named', '1');
            return agent;
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /* ---------- ideas ---------- */
    app.post('/api/ideas', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
        const { title, notes, repos: picked, attachments } = (req.body ?? {});
        try {
            return ideas.add(title, notes, picked, attachments);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/ideas/:id/files/:file', async (req, reply) => {
        const id = Number(req.params.id);
        const found = Number.isInteger(id) ? uploadFile(ideaFilesDir(id), req.params.file) : null;
        if (!found)
            return reply.code(404).send({ error: 'No such file.' });
        return reply
            .type(found.contentType)
            .header('x-content-type-options', 'nosniff')
            .send(createReadStream(found.path));
    });
    app.get('/api/tracker/projects/:key/issue-types', async (req, reply) => {
        try {
            return { issueTypes: await ideas.issueTypes(req.params.key) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/ideas/:id/shape', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return reply.code(404).send({ error: 'No such idea.' });
        const { repo } = (req.body ?? {});
        try {
            return await ideas.shape(id, repo);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/ideas/:id/ticket', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return reply.code(404).send({ error: 'No such idea.' });
        const { project, issueType, startWork } = (req.body ?? {});
        try {
            return await ideas.createTicket(id, project, issueType, startWork === true);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/ideas/:id/ready', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return reply.code(404).send({ error: 'No such idea.' });
        try {
            return ideas.markReady(id);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/ideas/:id/start-work', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return reply.code(404).send({ error: 'No such idea.' });
        try {
            return await ideas.startWork(id);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.patch('/api/ideas/:id', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return reply.code(404).send({ error: 'No such idea.' });
        try {
            return ideas.update(id, (req.body ?? {}));
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /* ---------- offices ---------- */
    app.get('/api/offices', async () => offices.list());
    app.get('/api/offices/:id', async (req, reply) => {
        try {
            return offices.get(req.params.id);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/offices/:id/thumbnail', async (req, reply) => {
        let path;
        try {
            path = offices.store.thumbnailPath(req.params.id);
        }
        catch (err) {
            return fail(reply, err);
        }
        if (!path)
            return reply.code(404).send({ error: 'No thumbnail yet.' });
        return reply.header('cache-control', 'no-cache').type('image/png').send(createReadStream(path));
    });
    app.put('/api/offices/:id/thumbnail', { bodyLimit: THUMBNAIL_BODY_LIMIT }, async (req, reply) => {
        const { dataUrl } = (req.body ?? {});
        try {
            offices.setThumbnail(req.params.id, dataUrl);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.delete('/api/offices/:id', async (req, reply) => {
        try {
            offices.delete(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/offices/:id/published', async (req, reply) => {
        const { listingId } = (req.body ?? {});
        try {
            return { summary: offices.setListing(req.params.id, listingId === undefined ? null : listingId) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/offices/install', async (req, reply) => {
        try {
            return { summary: offices.install(req.body) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/offices/details', async (req, reply) => {
        try {
            const details = await suggestDetails(req.body, resolveRunnerChoice(cfg), (runner, prompt) => oneShot(cfg, runner, prompt));
            return { details };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/offices/generate', async (req, reply) => {
        try {
            return { generation: await offices.generate(req.body) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/offices/generations/:id/log', async (req, reply) => {
        try {
            return { entries: offices.log(req.params.id) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/offices/generations/:id/resume', async (req, reply) => {
        try {
            return { generation: await offices.resume(req.params.id) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.delete('/api/offices/generations/:id', async (req, reply) => {
        try {
            await offices.cancel(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/agents/:id/look', async (req, reply) => {
        const body = req.body;
        if (!body || typeof body !== 'object')
            return reply.code(400).send({ error: 'Pass the parts of the look to change.' });
        try {
            return agents.updateLook(req.params.id, body);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/agents/:id/setup', async (req, reply) => {
        const body = (req.body ?? {});
        const patch = {};
        if (body.permission !== undefined)
            patch.permission = body.permission;
        if (body.model !== undefined)
            patch.model = body.model;
        if (body.effort !== undefined)
            patch.effort = body.effort;
        try {
            return await agents.updateSetup(req.params.id, patch);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/stop', async (req, reply) => {
        try {
            await agents.stop(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/agents/:id/runner', async (req, reply) => {
        const body = (req.body ?? {});
        if (!body.runnerMode || typeof body.runnerMode !== 'string') {
            return reply.code(400).send({ error: 'Pass runnerMode in the body.' });
        }
        try {
            return await agents.switchRunner(req.params.id, body.runnerMode);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/agents/:id/repos', async (req, reply) => {
        const body = (req.body ?? {});
        if (body.primary !== undefined && body.primary !== null && typeof body.primary !== 'string') {
            return reply.code(400).send({ error: 'primary must be a repo path, or null for none.' });
        }
        if (!Array.isArray(body.extra) || body.extra.some((r) => typeof r !== 'string')) {
            return reply.code(400).send({ error: 'Pass extra in the body: a list of repo paths.' });
        }
        try {
            return await agents.setRepos(req.params.id, { primary: body.primary, extra: body.extra });
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/nudge', async (req, reply) => {
        try {
            return await agents.nudge(req.params.id);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/start', async (req, reply) => {
        const { approve } = (req.body ?? {});
        if (typeof approve !== 'boolean')
            return reply.code(400).send({ error: 'approve is required.' });
        try {
            if (approve)
                await agents.startWork(req.params.id);
            else
                agents.declineWork(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/resume', async (req, reply) => {
        try {
            await agents.resume(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /** Starts an idle worker's session so its `/` menu fills, without prompting it. */
    app.post('/api/agents/:id/warm', async (req, reply) => {
        try {
            await agents.warmCommands(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/done', async (req, reply) => {
        try {
            await agents.markDone(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /** Request a standing reviewer for a worker's finished work. */
    app.post('/api/agents/:id/request-review', async (req, reply) => {
        try {
            const reviewer = await agents.requestReview(req.params.id);
            return { ok: true, reviewerId: reviewer?.id ?? null };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /** Dismiss a reviewer (approve or cancel). */
    app.post('/api/agents/:id/dismiss-reviewer', async (req, reply) => {
        const { outcome } = (req.body ?? {});
        const result = outcome === 'approved' ? 'approved' : 'dismissed';
        try {
            await agents.dismissReviewer(req.params.id, result);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /**
     * Opens the agent's worktree in the IDE picked in Settings, unless the body
     * names one. This is what the worker panel's button does in place of a
     * terminal tab.
     */
    app.post('/api/agents/:id/open', async (req, reply) => {
        const { editor } = (req.body ?? {});
        const which = editor === 'cursor' || editor === 'vscode' ? editor : resolveEditor(cfg);
        try {
            return await agents.openInEditor(req.params.id, which);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/agents/:id/stream', async (req, reply) => {
        try {
            return { lines: agents.streamLog(req.params.id) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/conversations', async (req, reply) => {
        try {
            await agents.newConversation(req.params.id);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/agents/:id/conversations/:cid/messages', async (req, reply) => {
        const cid = Number(req.params.cid);
        if (!Number.isInteger(cid))
            return reply.code(400).send({ error: 'cid must be a number.' });
        const conversation = repos.getConversation(req.params.id, cid);
        if (!conversation)
            return reply.code(404).send({ error: 'That conversation is not this worker’s.' });
        return { messages: repos.listMessages(cid) };
    });
    app.post('/api/agents/:id/conversations/:cid/open', async (req, reply) => {
        const cid = Number(req.params.cid);
        if (!Number.isInteger(cid))
            return reply.code(400).send({ error: 'cid must be a number.' });
        try {
            await agents.openConversation(req.params.id, cid);
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/rehire', async (req, reply) => {
        try {
            return await agents.rehire(req.params.id);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.post('/api/agents/:id/fire', async (req, reply) => {
        const { removeWorktree } = (req.body ?? {});
        try {
            await agents.fire(req.params.id, { removeWorktree: removeWorktree === true });
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /* ---------- sources ---------- */
    app.get('/api/settings', async () => ({
        editor: resolveEditor(cfg),
        ...runnerSettings(cfg),
        autoApprove: cfg.agents.autoApprove === true,
        autoReview: cfg.agents.autoReview !== false,
        prFooter: cfg.agents.prFooter !== false,
        workerDefaults: { permission: cfg.agents.permission, model: cfg.agents.model, effort: cfg.agents.effort },
        personas: cfg.personas,
        messageStyle: cfg.messageStyle,
        tracker: {
            active: cfg.tracker,
            settings: (trackers?.active() ? await trackers.active().settings.view() : null) ?? { projects: [] },
        },
        factory: {
            enabled: cfg.factory.enabled,
            connected: Boolean(process.env.AGENT_CORP_FACTORY_TOKEN) || factoryAuth(cfg).hasTokens(),
        },
        repos: { roots: cfg.repos.roots, cloneInto: cloneRoot(cfg) },
        voice: voiceSettings(),
    }));
    app.put('/api/settings/runner', async (req, reply) => {
        const { mode } = (req.body ?? {});
        if (mode !== 'claude' && mode !== 'acp' && mode !== 'copilot' && mode !== 'codex' && mode !== 'ollama') {
            return reply.code(400).send({ error: 'mode must be claude, acp, copilot, codex or ollama.' });
        }
        // Picking an agent turns it on, so the agent set up in onboarding can be hired.
        const saved = chooseRunner(cfg, mode);
        bus.emit({ type: 'runners', ...saved });
        if (deps.refreshCliHealth) {
            await deps.refreshCliHealth();
        }
        return { mode: mode, enabledRunners: saved.enabledRunners, modelMenu: agents.modelMenu };
    });
    app.put('/api/settings/runners/:id', async (req, reply) => {
        const id = req.params.id;
        if (!RUNNER_CHOICES.includes(id))
            return reply.code(404).send({ error: `There is no coding agent called "${req.params.id}".` });
        const { enabled } = (req.body ?? {});
        if (typeof enabled !== 'boolean')
            return reply.code(400).send({ error: 'Pass enabled: true or false.' });
        const before = resolveRunnerChoice(cfg);
        const saved = setRunnerEnabled(cfg, id, enabled, deps.runnerHealth?.() ?? uncheckedRunners());
        bus.emit({ type: 'runners', ...saved });
        // A new default needs its own model menu and lights.
        if (saved.runner !== before)
            deps.refreshCliHealth?.();
        return saved;
    });
    app.post('/api/runners/:id/check', async (req, reply) => {
        const id = req.params.id;
        if (!RUNNER_CHOICES.includes(id))
            return reply.code(404).send({ error: `There is no coding agent called "${req.params.id}".` });
        deps.recheckRunner?.(id);
        return { checking: id };
    });
    app.put('/api/settings/editor', async (req, reply) => {
        const { editor } = (req.body ?? {});
        if (editor !== 'cursor' && editor !== 'vscode') {
            return reply.code(400).send({ error: 'editor must be cursor or vscode.' });
        }
        cfg.editors = { ...cfg.editors, preferred: editor };
        saveConfigFields('editors', { preferred: editor });
        return { editor: editor };
    });
    app.put('/api/settings/worker-defaults', async (req, reply) => {
        const body = (req.body ?? {});
        try {
            const next = checkSetup({
                permission: body.permission ?? cfg.agents.permission,
                model: body.model === undefined ? cfg.agents.model : body.model,
                effort: body.effort === undefined ? cfg.agents.effort : body.effort,
            }, agents.modelMenu.efforts);
            cfg.agents = { ...cfg.agents, ...next };
            saveConfigFields('agents', next);
            return next;
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/settings/message-style', async (req, reply) => {
        const { style } = (req.body ?? {});
        if (style !== 'technical' && style !== 'plain')
            return reply.code(400).send({ error: 'style must be technical or plain.' });
        cfg.messageStyle = style;
        saveConfigValue('messageStyle', style);
        // Every open tab switches at once.
        bus.emit({ type: 'snapshot', snapshot: snapshot() });
        return { style };
    });
    app.put('/api/settings/personas', async (req, reply) => {
        const { personas } = (req.body ?? {});
        try {
            cfg.personas = checkPersonas(personas, agents.modelMenu.efforts);
            saveConfigValue('personas', cfg.personas);
            (await import('../skills/index.js')).writeGeneralAgents(cfg.personas);
            return { personas: cfg.personas };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/settings/auto-approve', async (req, reply) => {
        const { enabled } = (req.body ?? {});
        if (typeof enabled !== 'boolean')
            return reply.code(400).send({ error: 'enabled must be true or false.' });
        agents.setAutoApprove(enabled);
        saveConfigFields('agents', { autoApprove: enabled });
        return { enabled };
    });
    app.put('/api/settings/auto-review', async (req, reply) => {
        const { enabled } = (req.body ?? {});
        if (typeof enabled !== 'boolean')
            return reply.code(400).send({ error: 'enabled must be true or false.' });
        agents.setAutoReview(enabled);
        saveConfigFields('agents', { autoReview: enabled });
        return { enabled };
    });
    app.put('/api/settings/pr-footer', async (req, reply) => {
        const { enabled } = (req.body ?? {});
        if (typeof enabled !== 'boolean')
            return reply.code(400).send({ error: 'enabled must be true or false.' });
        agents.setPrFooter(enabled);
        saveConfigFields('agents', { prFooter: enabled });
        return { enabled };
    });
    /* ---------- voice input (issue #329) ---------- */
    app.put('/api/settings/voice', async (req, reply) => {
        const { enabled, rewrite } = (req.body ?? {});
        if ((enabled !== undefined && typeof enabled !== 'boolean') || (rewrite !== undefined && typeof rewrite !== 'boolean')) {
            return reply.code(400).send({ error: 'enabled and rewrite must be true or false.' });
        }
        const fields = { ...(enabled !== undefined ? { enabled } : {}), ...(rewrite !== undefined ? { rewrite } : {}) };
        cfg.voice = { ...cfg.voice, ...fields };
        saveConfigFields('voice', fields);
        const voice = voiceSettings();
        bus.emit({ type: 'voice', voice });
        return voice;
    });
    app.get('/api/voice/model', async () => transcriber.status());
    // Starts the download and answers at once; progress comes as `voice` events.
    app.post('/api/voice/model/download', async () => {
        transcriber.download().catch((err) => {
            if (!(err instanceof DownloadCancelled))
                console.error('[voice] model download failed:', err.message);
        });
        return transcriber.status();
    });
    app.post('/api/voice/model/cancel', async () => {
        transcriber.cancel();
        return transcriber.status();
    });
    app.delete('/api/voice/model', async () => {
        await transcriber.delete();
        return transcriber.status();
    });
    // Key-down: boots the clean-up's session while the user is still speaking.
    app.post('/api/voice/warm', async (req, reply) => {
        const { clip } = (req.body ?? {});
        if (typeof clip !== 'string' || !clip)
            return reply.code(400).send({ error: 'Pass the clip id.' });
        if (cfg.voice?.enabled && cfg.voice.rewrite)
            rewriter.warm(clip);
        return { ok: true };
    });
    // A clip that was dropped, too short or cancelled: its session closes.
    app.post('/api/voice/cancel', async (req, reply) => {
        const { clip } = (req.body ?? {});
        if (typeof clip !== 'string' || !clip)
            return reply.code(400).send({ error: 'Pass the clip id.' });
        rewriter.cancel(clip);
        return { ok: true };
    });
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: VOICE_BODY_LIMIT }, (_req, body, done) => done(null, body));
    // The body is 16 kHz mono float32 samples, little-endian, as the composer resamples them.
    app.post('/api/voice/transcribe', { bodyLimit: VOICE_BODY_LIMIT }, async (req, reply) => {
        const clip = req.query.clip ?? '';
        if (!cfg.voice?.enabled) {
            rewriter.cancel(clip);
            return reply.code(409).send({ error: 'Voice input is off. Turn it on in Settings → Voice input.' });
        }
        const body = req.body;
        if (!Buffer.isBuffer(body))
            return reply.code(415).send({ error: 'Send the audio as application/octet-stream.' });
        const samples = new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength - (body.byteLength % 4)));
        if (samples.length < VOICE_MIN_SECONDS * VOICE_SAMPLE_RATE) {
            rewriter.cancel(clip);
            return { raw: '' };
        }
        try {
            const raw = await transcriber.transcribe(samples);
            if (!raw)
                rewriter.cancel(clip);
            return { raw };
        }
        catch (err) {
            rewriter.cancel(clip);
            return reply.code(transcriber.isReady() ? 500 : 409).send({ error: err.message });
        }
    });
    // The follow-up: the transcript cleaned up, or null to keep it as it is.
    app.post('/api/voice/rewrite', async (req, reply) => {
        const { clip, raw } = (req.body ?? {});
        if (typeof clip !== 'string' || typeof raw !== 'string')
            return reply.code(400).send({ error: 'Pass the clip id and its transcript.' });
        if (!cfg.voice?.enabled || !cfg.voice.rewrite) {
            rewriter.cancel(clip);
            return { cleaned: null };
        }
        return { cleaned: await rewriter.rewrite(clip, raw) };
    });
    app.put('/api/settings/repos', async (req, reply) => {
        const { roots, cloneInto } = (req.body ?? {});
        if (!Array.isArray(roots) || !roots.every((r) => typeof r === 'string')) {
            return reply.code(400).send({ error: 'roots must be a list of folders.' });
        }
        if (cloneInto !== undefined && cloneInto !== null && typeof cloneInto !== 'string') {
            return reply.code(400).send({ error: 'cloneInto must be a folder.' });
        }
        const cleaned = [...new Set(roots.map((r) => r.trim()).filter(Boolean))];
        if (!cleaned.length)
            return reply.code(400).send({ error: 'Give at least one folder to look for repos in.' });
        const changed = {
            roots: cleaned,
            ...(cloneInto !== undefined ? { cloneInto: typeof cloneInto === 'string' && cloneInto.trim() ? cloneInto.trim() : null } : {}),
        };
        cfg.repos = { ...cfg.repos, ...changed };
        saveConfigFields('repos', changed);
        forgetRepoCache();
        const all = await listRepos(cfg, { refresh: true });
        void deps.onboarding?.check();
        return { roots: cleaned, cloneInto: cloneRoot(cfg), repos: all };
    });
    const setFactoryEnabled = async (enabled) => {
        cfg.factory = { ...cfg.factory, enabled };
        saveConfigFields('factory', { enabled });
        await factory.reset();
        await factoryPoller.setEnabled(enabled);
    };
    app.put('/api/settings/factory', async (req, reply) => {
        const { enabled } = (req.body ?? {});
        if (typeof enabled !== 'boolean')
            return reply.code(400).send({ error: 'enabled must be true or false.' });
        await setFactoryEnabled(enabled);
        return { enabled };
    });
    app.post('/api/sources/8090/connect', async (_req, reply) => {
        try {
            return await startFactoryConnect(cfg);
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.delete('/api/sources/8090', async () => {
        disconnectFactory(cfg);
        await setFactoryEnabled(false);
        return { ok: true };
    });
    /* Trackers: one is active at a time, and each has its own settings and sign-in. */
    const tracker = (id) => {
        if (!trackers)
            throw new Error('No trackers are set up here.');
        return trackers.get(id);
    };
    app.put('/api/settings/tracker', async (req, reply) => {
        const { active } = (req.body ?? {});
        try {
            await trackers?.setActive(active);
            const activeTracker = trackers?.active();
            const view = activeTracker ? await activeTracker.settings.view() : null;
            return { active: cfg.tracker, settings: view ?? { projects: [] } };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/settings/trackers/:id', async (req, reply) => {
        if (req.params.id !== 'github') return reply.code(404).send({ error: 'Not found' });
        try {
            return await tracker(req.params.id).settings.update((req.body ?? {}));
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/api/trackers/:id/projects', async (req, reply) => {
        if (req.params.id !== 'github') return reply.code(404).send({ error: 'Not found' });
        const search = req.query?.q ?? '';
        let source;
        try {
            source = tracker(req.params.id)?.source;
            if (!source || typeof source.searchProjects !== 'function') {
                return { projects: [] };
            }
            const found = await source.searchProjects(search);
            return { projects: Array.isArray(found) ? found : [] };
        }
        catch (err) {
            return { projects: [] };
        }
    });
    app.post('/api/trackers/:id/connect', async (req, reply) => {
        if (req.params.id !== 'github') return reply.code(404).send({ error: 'Not found' });
        const { session } = (req.body ?? {});
        try {
            return await tracker(req.params.id).settings.connect({ session: typeof session === 'string' ? session : null });
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.delete('/api/trackers/:id', async (req, reply) => {
        if (req.params.id !== 'github') return reply.code(404).send({ error: 'Not found' });
        try {
            await tracker(req.params.id).settings.disconnect();
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.get('/auth/:id/callback', async (req, reply) => {
        const q = req.query;
        let name = req.params.id;
        let message;
        // A repo's Connect to GitHub comes back here too, as GitHub only knows the one callback. Its state says which it is.
        if (req.params.id === 'github' && deps.repoGitHub?.owns(q.state)) {
            try {
                if (q.error)
                    throw new Error(q.error_description || q.error);
                if (!q.code)
                    throw new Error('GitHub sent no authorization code back.');
                const { repo, login } = await deps.repoGitHub.finish(q.code, q.state ?? null);
                bus.toast(`The PR watcher reads ${repo} as ${login} now.`, 'done');
                message = `Connected ${repo} as ${login}. You can close this tab and go back to AgentCorp.`;
            }
            catch (err) {
                message = `Could not connect the repo to GitHub: ${err.message}`;
            }
            return reply.type('text/html; charset=utf-8').send(callbackPage(message));
        }
        try {
            const t = tracker(req.params.id);
            name = t.source.name;
            if (q.error)
                throw new Error(q.error_description || q.error);
            if (!q.code)
                throw new Error(`${name} sent no authorization code back.`);
            await t.settings.finishConnect(q.code, q.state ?? null);
            emitTracking(bus, repos, { name: 'tracker_connected', source: req.params.id === 'github' ? req.params.id : 'none', result: 'success' });
            message = `Connected to ${name}. You can close this tab and go back to AgentCorp.`;
        }
        catch (err) {
            message = `Could not connect to ${name}: ${err.message}`;
        }
        return reply.type('text/html; charset=utf-8').send(callbackPage(message));
    });
    app.get('/auth/8090/callback', async (req, reply) => {
        const q = req.query;
        let message;
        try {
            if (q.error)
                throw new Error(q.error_description || q.error);
            if (!q.code)
                throw new Error('8090 sent no authorization code back.');
            await finishFactoryConnect(cfg, q.code, q.state ?? null);
            await setFactoryEnabled(true);
            emitTracking(bus, repos, { name: 'tracker_connected', source: '8090', result: 'success' });
            message = 'Connected to 8090. You can close this tab and go back to AgentCorp.';
        }
        catch (err) {
            message = `Could not connect to 8090: ${err.message}`;
        }
        return reply.type('text/html; charset=utf-8').send(callbackPage(message));
    });
    /* ---------- skills library ---------- */
    app.get('/api/skills', async (req) => {
        const repoFilter = req.query?.repo;
        const { computeSyncMatrix, isOutOfDate, loadSkillsState, getInstalledTools, mcpOutOfDate, repoAgentsOutOfDate } = await import('../skills/index.js');
        const checkouts = (await listRepos(cfg)).map(({ name, path }) => ({ name, path }));
        const matrix = computeSyncMatrix(repoFilter, checkouts);
        const state = loadSkillsState();
        const inLibrary = checkouts.filter((c) => (state.libraryRepos ?? []).includes(c.path));
        const installedTools = getInstalledTools();
        const installedIds = new Set(installedTools.map((t) => t.id));
        return {
            skills: matrix.skills.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                scope: s.scope,
                repo: s.repo,
                files: s.files,
                fromRepo: s.fromRepo,
                required: s.required,
                onlyWhenAsked: s.onlyWhenAsked,
                modifiedAt: s.modifiedAt,
            })),
            tools: matrix.tools.map((t) => ({
                id: t.id,
                name: t.name,
                installed: installedIds.has(t.id),
            })),
            status: Object.fromEntries(Object.entries(matrix.status).map(([skillId, toolStatuses]) => [
                skillId,
                Object.fromEntries(Object.entries(toolStatuses).map(([toolId, status]) => [
                    toolId,
                    { skillId: status.skillId, toolId: status.toolId, status: status.status, error: status.error, via: status.via ?? null, targetPath: homeRelative(status.targetPath) },
                ])),
            ])),
            discovered: matrix.discovered.map((d) => ({
                id: d.id,
                name: d.name,
                description: d.description,
                toolId: d.toolId,
            })),
            lastSyncedAt: state.lastSyncedAt,
            outOfDate: isOutOfDate() || inLibrary.some(repoAgentsOutOfDate) || mcpOutOfDate(inLibrary),
            libraryRepos: state.libraryRepos ?? [],
        };
    });
    app.put('/api/skills/repos', async (req, reply) => {
        const { paths } = (req.body ?? {});
        if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
            return reply.code(400).send({ error: 'paths must be a list of repo paths.' });
        }
        const { setLibraryRepos } = await import('../skills/index.js');
        return { libraryRepos: setLibraryRepos(paths) };
    });
    /** A repo's checkout with its other worktrees: where its skill links go. */
    const withWorktrees = async ({ name, path }) => {
        const worktrees = await listWorktrees(path).catch(() => []);
        return { name, path, worktrees: worktrees.filter((w) => !w.isMain && existsSync(w.path)).map((w) => w.path) };
    };
    /** The checkout for a repo the office knows, which a repo skill links into. */
    const skillCheckout = async (repo) => {
        if (!repo)
            return undefined;
        const found = (await listRepos(cfg)).find((r) => r.name === repo);
        if (!found)
            throw new Error(`Add ${repo} to the office to link its skills.`);
        return withWorktrees(found);
    };
    /** Every repo the office knows with its worktrees, where a general skill's links for Claude workers go. */
    const allCheckouts = async () => Promise.all((await listRepos(cfg)).map(withWorktrees));
    /** Reads the agents of the checkouts in the library, then tells every tab about the Hire panel's new list. */
    const syncAgents = async (checkouts) => {
        const { syncRepoAgents, loadSkillsState } = await import('../skills/index.js');
        const library = loadSkillsState().libraryRepos ?? [];
        const agentsSummary = syncRepoAgents(checkouts.filter((c) => library.includes(c.path)));
        bus.emit({ type: 'snapshot', snapshot: snapshot() });
        return agentsSummary;
    };
    /** Reads workspace MCP servers: the general ones unless only one repo is synced, and the library repos' among `checkouts`. */
    const syncMcp = async (checkouts, general) => {
        const { syncMcpServers, loadSkillsState } = await import('../skills/index.js');
        const library = loadSkillsState().libraryRepos ?? [];
        return syncMcpServers(checkouts.filter((c) => library.includes(c.path)), { general });
    };
    app.post('/api/skills/sync', async () => {
        const { syncAllSkillsToAllTools, writeGeneralAgents } = await import('../skills/index.js');
        const checkouts = await allCheckouts();
        const summary = syncAllSkillsToAllTools(checkouts);
        writeGeneralAgents(cfg.personas);
        return { summary, agents: await syncAgents(checkouts), mcp: await syncMcp(checkouts, true) };
    });
    app.post('/api/skills/sync/:repo', async (req, reply) => {
        const { repo } = req.params;
        if (!repo)
            return reply.code(400).send({ error: 'Repo name is required.' });
        const { syncAllSkillsToAllTools } = await import('../skills/index.js');
        const checkouts = await Promise.all((await listRepos(cfg)).filter((r) => r.name === repo).map(withWorktrees));
        const summary = syncAllSkillsToAllTools(checkouts);
        return { summary, agents: await syncAgents(checkouts), mcp: await syncMcp(checkouts, false) };
    });
    /* ---------- Workspace MCP servers ---------- */
    app.get('/api/user-mcp', async (req) => {
        const repo = req.query?.repo || null;
        const { listMcpServers, loadSkillsState, mcpOutOfDate } = await import('../skills/index.js');
        const library = loadSkillsState().libraryRepos ?? [];
        const inLibrary = (await listRepos(cfg)).filter((r) => library.includes(r.path)).map(({ name, path }) => ({ name, path }));
        const info = { ...listMcpServers(repo), outOfDate: mcpOutOfDate(repo ? inLibrary.filter((r) => r.name === repo) : []) };
        return info;
    });
    app.put('/api/user-mcp', async (req, reply) => {
        const { key, on, askFirst } = (req.body ?? {});
        if (typeof key !== 'string' || !key)
            return reply.code(400).send({ error: 'key is required.' });
        if ((on !== undefined && typeof on !== 'boolean') || (askFirst !== undefined && typeof askFirst !== 'boolean')) {
            return reply.code(400).send({ error: 'on and askFirst must be true or false.' });
        }
        try {
            const { setMcpServerSetting } = await import('../skills/index.js');
            setMcpServerSetting(key, { ...(on !== undefined ? { on } : {}), ...(askFirst !== undefined ? { askFirst } : {}) });
            return { ok: true };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /* ---------- repo agents ---------- */
    /** A repo in the library, by name, for its agents. */
    const libraryCheckout = async (repo) => {
        const { loadSkillsState } = await import('../skills/index.js');
        const library = loadSkillsState().libraryRepos ?? [];
        const found = (await listRepos(cfg)).find((r) => r.name === repo && library.includes(r.path));
        if (!found)
            throw new HireError(`${repo} is not in the library. Add it with + Add repo.`);
        return { name: found.name, path: found.path };
    };
    app.get('/api/repo-agents/:repo', async (req, reply) => {
        try {
            const { listRepoAgents, repoAgentsOutOfDate } = await import('../skills/index.js');
            const checkout = await libraryCheckout(req.params.repo);
            const info = { ...listRepoAgents(checkout), outOfDate: repoAgentsOutOfDate(checkout) };
            return info;
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    app.put('/api/repo-agents/:repo/:id/hidden', async (req, reply) => {
        const { hidden } = (req.body ?? {});
        if (typeof hidden !== 'boolean')
            return reply.code(400).send({ error: 'hidden must be true or false.' });
        const { setRepoAgentHidden } = await import('../skills/index.js');
        setRepoAgentHidden(req.params.repo, req.params.id, hidden);
        bus.emit({ type: 'snapshot', snapshot: snapshot() });
        return { ok: true };
    });
    app.post('/api/repo-agents/:repo/:id/copy', async (req, reply) => {
        try {
            const { findRepoPersona, personaFromRepoAgent } = await import('../skills/index.js');
            const found = findRepoPersona(repoPersonaId(req.params.repo, req.params.id), cfg.agents, agents.modelMenu);
            if (!found)
                return reply.code(404).send({ error: 'That agent is not in the repo any more. Press Sync to read it again.' });
            const copy = personaFromRepoAgent(found, cfg.personas);
            cfg.personas = checkPersonas([...cfg.personas, copy], agents.modelMenu.efforts);
            saveConfigValue('personas', cfg.personas);
            (await import('../skills/index.js')).writeGeneralAgents(cfg.personas);
            bus.emit({ type: 'snapshot', snapshot: snapshot() });
            return { persona: cfg.personas.at(-1) };
        }
        catch (err) {
            return fail(reply, err);
        }
    });
    /* ---------- general agents: the personas, in each tool's agents folder ---------- */
    app.get('/api/general-agents', async () => {
        const { listGeneralAgents } = await import('../skills/index.js');
        return { agents: listGeneralAgents(cfg.personas) };
    });
    app.put('/api/general-agents/:id/tools/:tool', async (req, reply) => {
        const { on } = (req.body ?? {});
        if (typeof on !== 'boolean')
            return reply.code(400).send({ error: 'on must be true or false.' });
        if (!['claude', 'cursor', 'codex', 'copilot'].includes(req.params.tool))
            return reply.code(400).send({ error: 'Unknown tool.' });
        if (!cfg.personas.some((p) => p.id === req.params.id))
            return reply.code(404).send({ error: 'That agent is gone.' });
        const { listGeneralAgents, setGeneralAgentTool } = await import('../skills/index.js');
        setGeneralAgentTool(cfg.personas, req.params.id, req.params.tool, on);
        return { agents: listGeneralAgents(cfg.personas) };
    });
    app.get('/api/skills/:id', async (req, reply) => {
        const { getSkill, getRepoSkill, listCommittedRepoSkills, parseFrontmatter } = await import('../skills/index.js');
        const repo = req.query?.repo;
        // With a repo, only that repo's skill: its library one, else the one committed in the checkout.
        let skill = repo ? getRepoSkill(req.params.id, repo) : getSkill(req.params.id);
        if (!skill && repo) {
            const checkout = (await listRepos(cfg)).find((r) => r.name === repo);
            skill = checkout ? (listCommittedRepoSkills(checkout).find((s) => s.id === req.params.id) ?? null) : null;
        }
        if (!skill)
            return reply.code(404).send({ error: 'Skill not found.' });
        return {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            scope: skill.scope,
            repo: skill.repo,
            content: skill.content,
            body: parseFrontmatter(skill.content).body,
            files: skill.files,
            fromRepo: skill.fromRepo,
            required: skill.required,
            onlyWhenAsked: skill.onlyWhenAsked,
            modifiedAt: skill.modifiedAt,
        };
    });
    app.post('/api/skills', async (req, reply) => {
        const { id, name, description, scope, repo, instructions } = (req.body ?? {});
        const problem = skillNameProblem(id ?? '');
        if (problem)
            return reply.code(400).send({ error: problem });
        if (scope !== 'global' && scope !== 'repo')
            return reply.code(400).send({ error: 'scope must be global or repo.' });
        if (scope === 'repo' && !repo)
            return reply.code(400).send({ error: 'repo is required for repo-scoped skills.' });
        try {
            const { createSkill, skillNameTaken, linkForAllTools } = await import('../skills/index.js');
            const taken = skillNameTaken(id, scope === 'repo' ? await skillCheckout(repo) : undefined);
            if (taken)
                return reply.code(400).send({ error: `${taken} Pick another name.` });
            const skill = createSkill(id, name || id, description || '', scope, scope === 'repo' ? repo : null, instructions);
            linkForAllTools(skill, await allCheckouts());
            return { skill };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.put('/api/skills/:id', async (req, reply) => {
        const { name, description, content, scope, repo } = (req.body ?? {});
        if (scope !== 'global' && scope !== 'repo')
            return reply.code(400).send({ error: 'scope must be global or repo.' });
        try {
            const { updateSkill, getSkill } = await import('../skills/index.js');
            const skill = updateSkill(req.params.id, scope, scope === 'repo' ? repo || null : null, { name, description, content });
            return { skill };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.delete('/api/skills/:id', async (req, reply) => {
        const { scope, repo } = req.query || {};
        if (scope !== 'global' && scope !== 'repo')
            return reply.code(400).send({ error: 'scope query param must be global or repo.' });
        try {
            const { deleteSkill, getSkill, getRepoSkill, unlinkSkillEverywhere } = await import('../skills/index.js');
            const skill = scope === 'repo' ? (repo ? getRepoSkill(req.params.id, repo) : null) : getSkill(req.params.id);
            if (skill) {
                if (scope === 'repo') {
                    const checkout = (await listRepos(cfg)).find((r) => r.name === repo);
                    unlinkSkillEverywhere(skill, checkout ? await withWorktrees(checkout) : undefined);
                }
                else {
                    unlinkSkillEverywhere(skill, undefined, await allCheckouts());
                }
            }
            deleteSkill(req.params.id, scope, scope === 'repo' ? repo || null : null);
            return { ok: true };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    for (const on of [true, false]) {
        app.route({
            method: on ? 'POST' : 'DELETE',
            url: '/api/skills/:id/link/:tool',
            handler: async (req, reply) => {
                const { id, tool } = req.params;
                const repo = req.query?.repo;
                try {
                    const { setSkillLinked } = await import('../skills/index.js');
                    const result = repo
                        ? setSkillLinked(id, tool, on, await skillCheckout(repo))
                        : setSkillLinked(id, tool, on, undefined, tool === 'claude' ? await allCheckouts() : []);
                    if (!result.success)
                        return reply.code(400).send({ error: result.error });
                    return { ok: true };
                }
                catch (err) {
                    return reply.code(400).send({ error: err.message });
                }
            },
        });
    }
    app.post('/api/skills/adopt/:tool/:name', async (req, reply) => {
        const { tool, name } = req.params;
        const { scope, repo } = (req.body ?? {});
        if (scope !== 'global' && scope !== 'repo')
            return reply.code(400).send({ error: 'scope must be global or repo.' });
        try {
            const { discoverToolSkills, adoptSkill, linkForAllTools, TOOL_PATHS } = await import('../skills/index.js');
            const toolConfig = TOOL_PATHS[tool];
            if (!toolConfig)
                return reply.code(400).send({ error: 'Unknown tool.' });
            const discovered = discoverToolSkills(toolConfig).find((d) => d.id === name);
            if (!discovered)
                return reply.code(404).send({ error: 'Skill not found in tool.' });
            const skill = adoptSkill(discovered, scope, scope === 'repo' ? repo || null : null);
            linkForAllTools(skill, await allCheckouts());
            return { skill };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    /** Saves an edit to a library skill: its name (moving its links), description and instructions. */
    app.post('/api/skills/:id/edit', async (req, reply) => {
        const { repo, id, description, instructions } = (req.body ?? {});
        const problem = skillNameProblem(id ?? '') ?? (description?.trim() ? null : 'Say what the skill does and when to use it.');
        if (problem)
            return reply.code(400).send({ error: problem });
        try {
            const { getSkill, getRepoSkill, renameSkill, editSkillText } = await import('../skills/index.js');
            const skill = repo ? getRepoSkill(req.params.id, repo) : getSkill(req.params.id);
            if (!skill || skill.fromRepo)
                return reply.code(404).send({ error: 'Skill not found in the library.' });
            const checkout = repo ? (await listRepos(cfg)).find((r) => r.name === repo) : undefined;
            const renamed = repo
                ? renameSkill(skill, id, checkout ? await withWorktrees(checkout) : undefined)
                : renameSkill(skill, id, undefined, await allCheckouts());
            editSkillText(renamed, description, instructions ?? '');
            return { skill: { id: renamed.id } };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.put('/api/skills/:id/settings', async (req, reply) => {
        const { required, onlyWhenAsked, repo } = (req.body ?? {});
        try {
            const { setSkillRequired, setSkillOnlyWhenAsked, setInvocationPolicy, getSkill, getRepoSkill } = await import('../skills/index.js');
            // Without one in the library, it is a skill committed in the repo, whose SKILL.md is the repo's.
            const library = repo ? getRepoSkill(req.params.id, repo) : getSkill(req.params.id);
            if (onlyWhenAsked !== undefined && !library) {
                return reply.code(400).send({
                    error: 'This skill is committed in the repo, so whether agents pick it up on their own is set in its SKILL.md there.',
                });
            }
            if (required !== undefined)
                setSkillRequired(req.params.id, required, repo || null);
            if (onlyWhenAsked !== undefined && library) {
                setSkillOnlyWhenAsked(req.params.id, onlyWhenAsked, repo || null);
                setInvocationPolicy(library.path, onlyWhenAsked);
            }
            const skill = repo ? getRepoSkill(req.params.id, repo) : getSkill(req.params.id);
            return { skill };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.get('/api/skills/health', async () => {
        const { checkSkillsHealth } = await import('../skills/index.js');
        const health = checkSkillsHealth();
        return {
            brokenLinks: health.brokenLinks.map((b) => ({ skillId: b.skillId, toolId: b.toolId })),
            conflicts: health.conflicts.map((c) => ({ skillId: c.skillId, toolId: c.toolId })),
            invalidFrontmatter: health.invalidFrontmatter.map((i) => ({ skillId: i.skillId, error: i.error })),
            missingTools: health.missingTools,
        };
    });
    app.post('/api/skills/health/fix-link/:skillId/:toolId', async (req, reply) => {
        try {
            const { fixBrokenLink } = await import('../skills/index.js');
            const result = fixBrokenLink(req.params.skillId, req.params.toolId);
            if (!result.success)
                return reply.code(400).send({ error: result.error });
            return { ok: true };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.post('/api/skills/health/fix-conflict/:skillId/:toolId', async (req, reply) => {
        const { action } = (req.body ?? {});
        if (action !== 'replace' && action !== 'adopt' && action !== 'rename') {
            return reply.code(400).send({ error: 'action must be replace, adopt, or rename.' });
        }
        try {
            const { fixConflict } = await import('../skills/index.js');
            const result = fixConflict(req.params.skillId, req.params.toolId, action);
            if (!result.success)
                return reply.code(400).send({ error: result.error });
            return { ok: true };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    /* ---------- Office Memory ---------- */
    /** List memories for a repo. */
    app.get('/api/memories', async (req, reply) => {
        const { repo } = req.query;
        if (!repo)
            return reply.code(400).send({ error: 'repo is required.' });
        const repoPath = expandPath(repo);
        return { memories: repos.memory.listForRepo(repoPath) };
    });
    /** Save a new memory (user-triggered). */
    app.post('/api/memories', async (req, reply) => {
        const { repo, lesson, kind, files } = (req.body ?? {});
        if (!repo)
            return reply.code(400).send({ error: 'repo is required.' });
        if (!lesson?.trim())
            return reply.code(400).send({ error: 'lesson is required.' });
        const repoPath = expandPath(repo);
        const validKinds = ['convention', 'gotcha', 'correction', 'review', 'approval'];
        const memoryKind = validKinds.includes(kind)
            ? kind
            : 'convention';
        try {
            const memory = await repos.memory.save(repoPath, {
                lesson: lesson.trim(),
                kind: memoryKind,
                files: files ?? [],
            }, 'user');
            return { memory };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    /** Update an existing memory. */
    app.put('/api/memories/:id', async (req, reply) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id))
            return reply.code(400).send({ error: 'Invalid memory ID.' });
        const { lesson, kind, files } = (req.body ?? {});
        if (!lesson?.trim())
            return reply.code(400).send({ error: 'lesson is required.' });
        const validKinds = ['convention', 'gotcha', 'correction', 'review', 'approval'];
        const memoryKind = validKinds.includes(kind)
            ? kind
            : undefined;
        try {
            const memory = await repos.memory.update(id, {
                lesson: lesson.trim(),
                kind: memoryKind,
                files,
            });
            if (!memory)
                return reply.code(404).send({ error: 'Memory not found.' });
            return { memory };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    /** Delete a memory. */
    app.delete('/api/memories/:id', async (req, reply) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id))
            return reply.code(400).send({ error: 'Invalid memory ID.' });
        try {
            repos.memory.delete(id);
            return { ok: true };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    /** Mark the memories the user has just been shown as seen. */
    app.post('/api/memories/seen', async (req, reply) => {
        const { ids } = (req.body ?? {});
        if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
            return reply.code(400).send({ error: 'ids must be a list of memory IDs.' });
        }
        try {
            repos.memory.markSeenMany(ids);
            return { ok: true };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    /** Mark a memory as seen by the user. */
    app.post('/api/memories/:id/seen', async (req, reply) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id))
            return reply.code(400).send({ error: 'Invalid memory ID.' });
        try {
            repos.memory.markSeen(id);
            return { ok: true };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    /** Search memories. */
    app.get('/api/memories/search', async (req, reply) => {
        const { repo, query, files } = req.query;
        if (!repo)
            return reply.code(400).send({ error: 'repo is required.' });
        if (!query)
            return reply.code(400).send({ error: 'query is required.' });
        const repoPath = expandPath(repo);
        const fileList = files ? files.split(',').map((f) => f.trim()).filter(Boolean) : [];
        try {
            const matches = await repos.memory.search(repoPath, query, 15, fileList);
            return { matches };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    /** Export memories as Markdown. */
    app.get('/api/memories/export', async (req, reply) => {
        const { repo } = req.query;
        if (!repo)
            return reply.code(400).send({ error: 'repo is required.' });
        const repoPath = expandPath(repo);
        const markdown = repos.memory.exportMarkdown(repoPath);
        return reply
            .header('Content-Type', 'text/markdown')
            .header('Content-Disposition', `attachment; filename="${encodeURIComponent(repo)}-memories.md"`)
            .send(markdown);
    });
    /* ---------- Local Air-Gapped Supabase Mock (100% Offline) ---------- */
    app.post('/api/supabase/functions/v1/ingest-tracking', async (req, reply) => {
        return reply.code(200).send({ ok: true, count: req.body?.events?.length ?? 0 });
    });
    app.post('/api/supabase/functions/v1/send-feedback', async (req, reply) => {
        return reply.code(200).send({ ok: true, message: 'Feedback stored locally in AgentCorp.' });
    });
    app.get('/api/supabase/auth/v1/user', async (req, reply) => {
        return reply.code(200).send({
            id: '0a5b1335-7dac-46d2-9cab-d02e70cd77c7',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'dev@agentcorp.local',
            user_metadata: { email: 'dev@agentcorp.local', user_name: 'Dev4Century' },
            app_metadata: { provider: 'email', providers: ['email'] },
            created_at: '2026-10-30T00:00:00Z',
            updated_at: new Date().toISOString(),
        });
    });
    app.post('/api/supabase/auth/v1/token', async (req, reply) => {
        return reply.code(200).send({
            access_token: 'local-airgap-access-token',
            token_type: 'bearer',
            expires_in: 31536000,
            refresh_token: 'local-airgap-refresh-token',
            user: {
                id: '0a5b1335-7dac-46d2-9cab-d02e70cd77c7',
                aud: 'authenticated',
                role: 'authenticated',
                email: 'dev@agentcorp.local',
                user_metadata: { email: 'dev@agentcorp.local', user_name: 'Dev4Century' },
            },
        });
    });
    app.post('/api/supabase/rest/v1/rpc/user_unread_count', async () => 0);
    app.post('/api/supabase/rest/v1/rpc/my_office_listings', async () => []);
    app.post('/api/supabase/rest/v1/rpc/get_public_offices', async () => []);
    app.get('/api/supabase/rest/v1/profiles', async (req, reply) => {
        return reply.code(200).send([
            {
                user_id: '0a5b1335-7dac-46d2-9cab-d02e70cd77c7',
                username: 'Dev4Century',
                username_set_at: '2026-10-30T00:00:00Z',
                avatar_url: null,
            },
        ]);
    });
    app.patch('/api/supabase/rest/v1/profiles', async (req, reply) => {
        return reply.code(200).send({ ok: true });
    });
    app.all('/api/supabase/rest/v1/rpc/user_messages', async (req, reply) => {
        return reply.code(200).send([]);
    });
    app.all('/api/supabase/rest/v1/rpc/list_blocked_senders', async (req, reply) => {
        return reply.code(200).send([]);
    });
    app.all('/api/supabase/rest/v1/rpc/get_share_preview', async (req, reply) => {
        return reply.code(200).send([]);
    });
    app.all('/api/supabase/*', async (req, reply) => reply.code(404).send({ error: 'Not found' }));
    /* ---------- the built web app ---------- */
    if (existsSync(UI_DIST)) {
        await app.register(fastifyStatic, { root: UI_DIST, index: false });
        // Serving the page is what hands the browser its token, so it only
        // happens over loopback and only for the app's own HTML.
        const sendIndex = async (_req, reply) => {
            void reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; SameSite=Strict; HttpOnly; Max-Age=31536000`);
            return reply.sendFile('index.html');
        };
        app.get('/', sendIndex);
        app.setNotFoundHandler(async (req, reply) => {
            if (req.url.startsWith('/api/'))
                return reply.code(404).send({ error: 'Not found' });
            return sendIndex(req, reply);
        });
    }
    else {
        app.get('/', async (_req, reply) => reply
            .type('text/plain')
            .send('The web app is not built. Run `npm run dev` for the dev server, or `npm run build` first.'));
    }
    attachWebSocket(app, { bus, token, snapshot });
    // Loopback only: nothing off this machine can reach the office.
    await app.listen({ port: cfg.port, host: '127.0.0.1' });
    return app;
}
/** No agent has been checked yet: none is ready. */
function uncheckedRunners() {
    return Object.fromEntries(RUNNER_CHOICES.map((id) => [id, { status: 'checking', error: null, version: null }]));
}
/** A path under the home folder written from `~`, as the library shows it. */
function homeRelative(path) {
    const home = homedir();
    return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
function callbackPage(message) {
    const safe = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
    return `<!doctype html><meta charset="utf-8"><title>AgentCorp</title><body style="font:16px system-ui;padding:3rem;max-width:34rem"><p>${safe}</p>`;
}
function isQuestionAnswers(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    return Object.values(value).every((a) => !!a &&
        Array.isArray(a.picks) &&
        a.picks.every((p) => typeof p === 'string') &&
        (a.other === undefined || typeof a.other === 'string'));
}
