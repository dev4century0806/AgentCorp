import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve as resolvePath } from 'node:path';
import { EDITOR_NAMES, launchEditor } from './open-editor.js';
import { agentSetup, asAgentSetup, autoWorkerName, BUILT_IN_PAM_ID, cleanLook, CLAUDE_MODEL_MENU, DEFAULT_LOOK, displayKey, INTER_WORKER_LIMITS, isRepoPersonaId, LOOK_CHOICES, PERSONA_DESCRIPTION_MAX, PERSONA_NAME_MAX, WORKER_NAME_MAX, EFFORT_CHOICES, NO_EFFORT_MODELS, pathKey, PERMISSION_LEVELS, RUNNER_CHOICES, splitTicketId, ticketId, waitingOnAgents, } from '../protocol.js';
import { emitTracking, factFromAgent, recordMoment } from '../tracking/emit.js';
import { enabledRunners, expandPath, notesRoot, rememberRepo, resolveRepo, resolveRunnerChoice, resolveRunnerMode } from '../config.js';
import { describeRepo, forgetRepoCache, listRepos } from '../git/repos.js';
import { alsoReading, findPullRequestUrl } from '../sources/work-source.js';
import { factoryMcpConfig } from '../sources/factory/brief.js';
import { andList, buildAskBrief } from './ask-brief.js';
import { alwaysSkillsBrief } from '../skills/brief.js';
import { memoryBriefFor, recallMemories, extractFilePaths } from '../memory/brief.js';
import { linkRepoSkillsIntoNotes, syncRepoSkillsToWorktree } from '../skills/sync.js';
import { findRepoPersona, writeAgentCopiesToWorktree } from '../skills/agents.js';
import { enabledMcpServers, mcpRunnerName, recordMcpError, scrubSecrets } from '../skills/mcp.js';
import { UserMcpPool } from './user-mcp.js';
import { buildWorktreeMcpConfig, createWorktree, diffStatAgainstBase, findExistingWorktree, githubRepoIn, githubRepoOf, isBranchPushed, isInside, planWorktree, prHeadBranch, realPath, removeWorktree, restoreWorktree, writeWorktreeMcpConfig, } from '../git/worktree.js';
import { findAdoptableWorktrees } from './adopt.js';
import { activityForTool, endsWithQuestion, extractQuestion, extractQuestionWithChoices, extractTicketDraft, extractWorkPlan, extractWorktreeHint, githubPullUrls, grantsFor, isCovered, isTextQuestion, makePermissionRequest, truncate, truncateLabel } from './events.js';
import { lookFor, pickName } from './identity.js';
import { CLI_SHAPES, describeCommand, runningCommands } from './process-tree.js';
import { classifyRunnerError, explainRunnerError, runnerLabel, signInHint, splitRunnerError } from './runner.js';
import { saveUploads, uploadsDir } from '../uploads.js';
import { AcpRunner, CLAUDE_ACP, claudeAgent, CODEX_ACP, codexAgent, COPILOT_CLI, copilotAgent } from './acp-runner.js';
import { runnerFor } from './make-runner.js';
import { findHandoff, HANDOFF_BLOCKERS, HANDOFF_TIMEOUT_MS, handoffNote, handoffPrompt, recapNote } from './handoff.js';
import { openSession } from './one-shot.js';
import { run } from '../util.js';
import { SESSION_HEADER, ensureSessionToken } from '../session.js';
import { PrWatcher, describeProblem, reviewSummary } from './pr-watcher.js';
/** Sixteen seats, matching the four pods of four desks in the scene. */
const DESK_COUNT = 16;
/** How often a thought in progress is sent on, so the panel hears from a thinking worker without a flood. */
const THOUGHT_EVERY_MS = 1_000;
/** How much of a thought the panel shows: the end of it, which is what the model is on now. */
const THOUGHT_TAIL = 240;
/** How often a working worker is checked for commands running behind its silence. */
const LOOK_EVERY_MS = 15_000;
/** How long a worker with no step running may say nothing before the office looks at what it has running. */
const LOOK_AFTER_MS = 20_000;
const OFFICE_MESSAGING_TOOLS = new Set([
    'mcp__office__tell_pam',
    'mcp__office__message_worker',
    'mcp__office__list_workers',
    'mcp__office__send_findings',
    'mcp__office__ready_for_recheck',
]);
/**
 * Where a repo-less researcher works. Outside any repo on purpose, so an
 * agent told to look rather than touch has nothing of Operator's within reach.
 */
function notesDir(key) {
    return join(notesRoot(), pathKey(key));
}
/**
 * The key an Ask's own worktree and branch are named after: ASK-3 becomes
 * agent-corp-ask-3, so office-made Ask worktrees stand out in `git worktree
 * list` from ticket ones and from Operator's own. Any other key is left alone.
 */
function askWorktreeKey(key) {
    const n = /^ASK-(\d+)$/i.exec(key)?.[1];
    return n ? `agent-corp-ask-${n}` : key;
}
/**
 * After which of Operator's messages an Ask is retitled: often while it is still
 * finding its subject, then every eighth, to keep the extra calls few.
 */
function retitleDue(said) {
    return said === 1 || said === 2 || said === 4 || (said >= 8 && said % 8 === 0);
}
/**
 * The ask for a new title: the current one, what Operator first asked, and the last
 * few exchanges, kept short. His first message stays in however long the chat
 * runs, so the title follows his request and not the worker's latest theory.
 */
function retitlePrompt(current, messages) {
    const lines = [];
    let room = 3000;
    const line = (m) => `${m.role === 'you' ? 'User' : 'Assistant'}: ${truncate(m.text.trim(), 600)}`;
    // The office writes Operator's permission answers into the chat as his; they say nothing about the subject.
    const said = messages.filter((m) => m.role === 'agent' || (m.role === 'you' && !/^(Approved|Denied): /.test(m.text)));
    const first = said.find((m) => m.role === 'you');
    if (first)
        room -= line(first).length;
    for (const m of said.filter((m) => m !== first).reverse().slice(0, 6)) {
        const next = line(m);
        if (next.length > room)
            break;
        lines.unshift(next);
        room -= next.length;
    }
    if (first)
        lines.unshift(line(first));
    return [
        'Give this chat a short title that says what it is about, as it stands now.',
        "Name the user's problem or request in the user's own terms. Leave out the assistant's diagnosis or guessed cause.",
        'Reply with the title only: plain text, 8 words or fewer, no quotes, no full stop.',
        `Current title: ${current}`,
        '',
        lines.join('\n\n'),
    ].join('\n');
}
/** The runner's answer as a title, or null when it is not one. */
function cleanTitle(raw) {
    const title = raw
        .trim()
        .replace(/^title:\s*/i, '')
        .replace(/^["'`*]+|["'`*]+$/g, '')
        .replace(/\.$/, '')
        .trim();
    return title && !title.includes('\n') && title.length <= 80 ? title : null;
}
/** An ad-hoc job, whose title is its chat's. Not a ticket, a reviewer (REVIEW-…) or the assistant. */
function isAsk(record) {
    return !record.builtInPam && !record.reviewingId && /^ASK-\d+$/i.test(record.ticketKey);
}
/** A one-line label for a free-form request, for desks and toasts. */
function firstLine(text, max) {
    const line = text.trim().split('\n')[0]?.trim() ?? '';
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
/** The thread's line for a worker's repos after a change: "Now reading web (main) and api, read only." */
function reposLine(record) {
    if (!record.repoPath)
        return 'Now reading no repo, only the notes folder.';
    const own = `${basename(record.repoPath)}${record.baseBranch ? ` (${record.baseBranch})` : ''}`;
    return `Now reading ${andList([own, ...(record.extraRepos ?? []).map((r) => basename(r))])}, read only.`;
}
/** What the agent is told about its repos after a change, with the paths it needs. */
function reposNote(record) {
    const extra = record.extraRepos ?? [];
    return [
        'Operator changed the repos you read. Anything you read before and not listed here is closed to you now.',
        record.repoPath
            ? `- Repo: ${record.repoPath}, read only. It is Operator's own checkout, on whatever branch he has out.`
            : `- No repo: only your notes folder, ${record.worktreePath}.`,
        ...alsoReading(extra),
    ].join('\n');
}
export const PAM_ID = BUILT_IN_PAM_ID;
const PAM_LOOK = {
    hair: 'shoulder',
    hat: 'headset',
    face: 'none',
    outfit: 'cardigan',
    shirtColor: '#b8476e',
    hairColor: '#c9a15a',
};
const pamBrief = (name = 'Nova') => `You are ${name}, the receptionist in AgentCorp. You sit at reception and help the user get work handed to the right worker.

You do not change code, create branches, create worktrees, or do assigned implementation work yourself. When the user asks for work to be done, use the office hire_worker tool to hire a worker and give that worker the task. Normal worker limits and the waiting queue still apply. You may use the connected ticket tools to identify a ticket first. Explain clearly who you hired or that the hire was queued. To pass a message or context to a worker, use list_workers to find them and message_worker to send it; workers reach you with tell_pam.`;
export class AgentManager {
    cfg;
    repos;
    sources;
    bus;
    live = new Map();
    hireQueue = [];
    /** Reviewers waiting for a slot, oldest first. */
    reviewerQueue = [];
    /** Guards the whole hire path, which races on desks and worktrees. */
    hiring = Promise.resolve();
    /** One adoption at a time: polls that land together would each seat the same worktree. */
    adopting = Promise.resolve();
    /** Set once the office is closing, so late work does not seat anyone. */
    closing = false;
    /** Workers the last restore found mid-turn, for resumeCrashed() to pick back up. */
    interrupted = [];
    modelMenu = CLAUDE_MODEL_MENU;
    onCliChecked = null;
    /** The last check of each agent, so a hire can wait on one still running. */
    cliChecks = new Map();
    /** Standing approvals. The office's, so every worker shares them. */
    grants;
    /** Operator's own MCP servers, started for the workers they are on for. */
    userMcp = new UserMcpPool();
    /** Requests the office raised itself, for a call to an Ask first server, by request id. */
    officeAsks = new Map();
    /** Watches worker PRs for failures, conflicts, and review comments. */
    prWatcher = null;
    /** the assistant's rehire questions for PR problems, one per worker, oldest first. Only the first is on her card. */
    prAsks = new Map();
    constructor(cfg, repos, sources, bus) {
        this.cfg = cfg;
        this.repos = repos;
        this.sources = sources;
        this.bus = bus;
        this.grants = repos.listGrants();
    }
    /**
     * Initializes PR watching with a GitHub API. Call this after the GitHub
     * source is authenticated to start watching worker PRs.
     */
    initPrWatcher(api) {
        if (this.prWatcher)
            return;
        const config = this.cfg.prWatch;
        this.prWatcher = new PrWatcher(config, api);
        this.prWatcher.onEvent((event) => void this.handlePrEvent(event));
        this.prWatcher.start();
        // Start watching any existing PRs from restored workers
        for (const l of this.live.values()) {
            if (l.record.prUrl && !l.record.builtInPam) {
                this.prWatcher.watch(l.record.id, l.record.name, l.record.prUrl, l.record.branch);
            }
        }
    }
    /** Stops the PR watcher, so `initPrWatcher` can start one for the next user. */
    stopPrWatcher() {
        this.prWatcher?.stop();
        this.prWatcher = null;
    }
    get limits() {
        return {
            maxConcurrentAgents: this.cfg.agents.maxConcurrent,
            deskCount: DESK_COUNT,
            maxConcurrentReviewers: this.cfg.agents.review.maxConcurrent,
            reviewEnabled: this.cfg.agents.review.enabled,
        };
    }
    /** How many reviewers are in the office. One waiting on a re-check still holds its slot. */
    activeReviewerCount() {
        return [...this.live.values()].filter((l) => l.record.reviewingId).length;
    }
    /** The reviewer queue, for the snapshot. */
    reviewQueueView() {
        return [...this.reviewerQueue];
    }
    /**
     * Hears a research worker's `TICKET_DRAFT:` hand-off; the Idea board sets
     * it. Called with the worker's id and the text after the marker.
     */
    onTicketDraft = null;
    /**
     * Asks a runner for a fresh title for an Ask's chat; the server sets it.
     * Without it, an Ask keeps the title its first line gave it.
     */
    retitle = null;
    /**
     * The persona's role, the skills marked "Always for workers", memory briefing,
     * and in Plain mode a word on who reads the messages, added to a brief.
     */
    briefFor(record, brief, memoryBriefing) {
        const skills = record.builtInPam ? '' : this.skillsBrief(record);
        let tailored = withRole(record, skills ? `${brief}\n\n${skills}` : brief);
        // Add memory briefing after skills, before Codex questions
        if (!record.builtInPam) {
            tailored = memoryBriefing ? `${tailored}\n\n${memoryBriefing}\n\n${OFFICE_MEMORY}` : `${tailored}\n\n${OFFICE_MEMORY}`;
        }
        if (record.runnerMode === 'codex')
            tailored = `${tailored}\n\n${CODEX_QUESTIONS}`;
        return this.cfg.messageStyle === 'plain' ? `${tailored}\n\n${PLAIN_AUDIENCE}` : tailored;
    }
    /**
     * Build the memory briefing for a worker at hire time.
     * Returns the briefing text and the IDs of memories used (for tracking).
     */
    async buildMemoryBriefing(agentId, repo, ticketSummary, ticketDescription) {
        let brief = '';
        const memoryIds = [];
        if (repo) {
            try {
                const mem = await this.usingMemory(agentId, 'reading', () => {
                    const likelyFiles = extractFilePaths(ticketDescription ?? '');
                    return memoryBriefFor(this.repos.memory, repo, ticketSummary, ticketDescription, likelyFiles);
                });
                if (mem?.brief) brief = mem.brief;
                if (mem?.memoryIds) memoryIds.push(...mem.memoryIds);
            }
            catch {}
        }
        try {
            const queryText = `${ticketSummary || ''} ${ticketDescription || ''}`.trim();
            if (queryText) {
                const { searchObsidianVault } = await import('../memory/obsidian-indexer.js');
                const matches = await searchObsidianVault(queryText, 2);
                if (matches && matches.length > 0) {
                    const obsidianSection = '## Architectural Context (Obsidian Memory)\n' +
                        matches.map((m) => `### ${m.title}\n${m.content}`).join('\n\n');
                    brief = brief ? `${brief}\n\n${obsidianSection}` : obsidianSection;
                }
                const { querySubGraph } = await import('../memory/graph-navigator.js');
                const graphRes = querySubGraph(queryText, 4);
                if (graphRes?.markdown) {
                    brief = brief ? `${brief}\n\n${graphRes.markdown}` : graphRes.markdown;
                }
            }
        }
        catch {}
        return { brief, memoryIds };
    }
    /**
     * Runs some memory work with the worker's brain lit for it, and puts the
     * brain back to idle however the work ends.
     */
    async usingMemory(agentId, memory, work) {
        this.bus.emit({ type: 'agent.memory', agentId, memory });
        try {
            return await work();
        }
        finally {
            this.bus.emit({ type: 'agent.memory', agentId, memory: 'idle' });
        }
    }
    skillsBrief(record) {
        const repo = record.repoPath ? { name: basename(record.repoPath), path: record.repoPath } : null;
        // Before its worktree exists a worker sits in a notes folder, not the repo.
        const workdir = record.branch ? record.worktreePath : record.repoPath;
        try {
            return alwaysSkillsBrief(repo, workdir);
        }
        catch {
            return '';
        }
    }
    /** A request as the office's message style says it, for text the server writes itself, such as toasts. */
    said(request) {
        return this.cfg.messageStyle === 'plain' && request.plain ? request.plain : request.title;
    }
    /** Whether a hire would get a desk now rather than queue at the door. */
    deskFree() {
        return this.runningCount() < this.cfg.agents.maxConcurrent;
    }
    /**
     * Agents that actually hold a process. The concurrency cap is about CPU and
     * Cursor plan limits, so a worker parked at `idle` — restored after a
     * restart, or adopted from an existing worktree — does not count against it.
     */
    runningCount() {
        return [...this.live.values()].filter((l) => !l.record.builtInPam &&
            (l.record.status === 'starting' || l.record.status === 'working' || l.record.status === 'needs_you')).length;
    }
    listAgents() {
        return [...this.live.values()].map((l) => this.view(l));
    }
    /** Completed and fired workers, newest first, for the Previous tab. */
    listPrevious() {
        return this.repos.listEndedAgents().map((record) => this.remembered(record));
    }
    queueView() {
        return this.hireQueue.map((h) => ({
            ticketKey: h.ticketKey ?? 'Ad-hoc job',
            summary: h.ticketKey
                ? this.repos.getTicket(h.ticketKey)?.summary ?? ''
                : firstLine(h.task ?? '', 90),
        }));
    }
    /**
     * Records a message and puts it on the wire.
     *
     * Both halves, always. Writing to SQLite alone leaves the message invisible
     * until the next full snapshot, which is how everything Operator typed used to
     * disappear until he reloaded the page.
     */
    say(agentId, role, text, attachments = [], plain = null) {
        const l = this.live.get(agentId);
        const message = this.repos.addMessage(agentId, l?.record.conversationId ?? 0, role, text, attachments, plain);
        this.bus.emit({ type: 'agent.message', message });
        return message;
    }
    /** A stored worker plus the chats that belong to it. */
    remembered(record) {
        return {
            ...record,
            conversations: this.repos.listConversations(record.id),
            grants: this.grants,
        };
    }
    /** The record plus the in-memory bits that never hit SQLite. */
    view(l) {
        return {
            ...l.record,
            pendingPermission: l.pending[0] ?? null,
            pendingQuestion: l.question,
            grants: this.grants,
            conversations: this.repos.listConversations(l.record.id),
            queuedMessages: l.queued.length,
            sessionLive: l.runner.isStarted,
            chatId: l.runner.chatId ?? l.record.chatId,
            runnerMode: l.runner.mode,
            model: l.runner.model,
            commands: l.runner.commands.length ? l.runner.commands : l.record.commands ?? [],
            modelMenu: l.runner.menu,
            backgroundAgents: l.runner.backgroundAgents,
            backgroundCommands: l.commands ?? [],
            thought: thoughtTail(l.thought),
        };
    }
    /**
     * Restores agents that outlived their processes. They come back as `idle`
     * with their chat id, so Resume picks the conversation back up.
     */
    restoreFromDb() {
        this.interrupted = this.repos.demoteRunningAgentsOnBoot();
        this.ensurePam();
        for (const record of this.repos.listActiveAgents()) {
            // No runner yet: resume() builds one on demand.
            this.live.set(record.id, {
                record,
                runner: this.makeRunner(record, null),
                queued: [],
                lastTool: null,
                pending: [],
                question: null,
                lastEventAt: 0,
                turnText: '',
                streamBatch: [],
                streamTimer: null,
                interWorkerMessages: [],
            });
        }
        this.repairReviewLinks();
        if (this.live.size)
            console.log(`[agents] restored ${this.live.size} agent(s) as idle`);
    }
    /**
     * Older builds never saved a reviewer's side of the link, and a reviewer
     * that left by Fire or Mark done never cleared the worker's side. Either way
     * the worker kept an End review button that did nothing.
     */
    repairReviewLinks() {
        for (const worker of this.live.values()) {
            const reviewerId = worker.record.reviewerId;
            if (!reviewerId)
                continue;
            const reviewer = this.live.get(reviewerId);
            if (reviewer) {
                if (!reviewer.record.reviewingId) {
                    reviewer.record.reviewingId = worker.record.id;
                    this.repos.updateAgent(reviewerId, { reviewingId: worker.record.id });
                }
                continue;
            }
            this.unlinkReviewer(worker);
            if (worker.record.status === 'in_review')
                this.rest(worker, 'Review ended');
        }
    }
    /** Creates the secretary once per account and repairs old accidental end/fired flags. */
    ensurePam() {
        const found = this.repos.builtInPam();
        if (found) {
            const patch = {};
            if (this.repos.getMeta('assistant.named') !== '1') patch.name = 'Nova';
            if (found.endedAt || this.repos.isFired(found.id)) {
                patch.endedAt = null;
                patch.fired = false;
                patch.status = 'idle';
                patch.bubble = 'At reception';
            }
            // Older builds saved PR links the assistant relayed as her own, leaving her stuck in review.
            if (found.prUrl || found.status === 'review') {
                patch.prUrl = null;
                patch.status = 'idle';
                patch.bubble = 'At reception';
            }
            const look = found.look;
            if (look.hair !== PAM_LOOK.hair ||
                look.hat !== PAM_LOOK.hat ||
                look.face !== PAM_LOOK.face ||
                look.outfit !== PAM_LOOK.outfit ||
                look.shirtColor !== PAM_LOOK.shirtColor ||
                look.hairColor !== PAM_LOOK.hairColor) {
                patch.look = { ...PAM_LOOK };
            }
            if (Object.keys(patch).length)
                this.repos.updateAgent(found.id, patch);
            return;
        }
        const now = new Date().toISOString();
        const notes = notesDir('PAM');
        mkdirSync(notes, { recursive: true });
        const record = {
            id: PAM_ID,
            builtInPam: true,
            ticketKey: 'PAM',
            ticketSummary: 'Reception and delegation',
            name: 'Nova',
            deskIndex: -1,
            status: 'idle',
            bubble: 'At reception',
            activity: 'idle',
            repoPath: null,
            worktreePath: notes,
            branch: null,
            baseBranch: null,
            chatId: null,
            prUrl: null,
            runnerMode: resolveRunnerMode(this.cfg),
            model: null,
            adopted: false,
            kind: 'research',
            workPlan: null,
            ...asAgentSetup(this.setupFor({})),
            look: { ...PAM_LOOK },
            persona: 'Secretary',
            instructions: null,
            pendingPermission: null,
            pendingQuestion: null,
            grants: [],
            conversationId: 0,
            conversations: [],
            queuedMessages: 0,
            sessionLive: false,
            runningSince: null,
            lastError: null,
            errorType: null,
            errorAction: null,
            createdAt: now,
            endedAt: null,
        };
        this.repos.insertAgent(record);
        record.conversationId = this.repos.startConversation(record.id);
        this.repos.updateAgent(record.id, { conversationId: record.conversationId });
    }
    /* ---------- hiring ---------- */
    async hire(req) {
        // Serialise hires so two clicks can't claim the same desk.
        const task = this.hiring.then(() => this.doHire(req), () => this.doHire(req));
        this.hiring = task.catch(() => undefined);
        return task;
    }
    /**
     * Works out where a worker's worktree goes.
     *
     * Any git repo on disk is allowed, not just a configured one: being told
     * "that repo is not in your config" when the checkout is plainly there is
     * no use to anybody. A path used for the first time is written into
     * `repos.known` so it stays in the picker.
     */
    async planRepoWork(req, ctx) {
        const source = splitTicketId(ctx.key)?.source;
        const fromTracker = source !== undefined && source !== '8090';
        const fallback = fromTracker ? null : resolveRepo(this.cfg, this.cfg.factory.filter.project);
        const raw = req.repo ?? ctx.ticketRepo ?? fallback?.path;
        if (!raw) {
            throw new HireError(fromTracker
                ? `No repo is mapped for ${displayKey(ctx.key)}'s project. Pick one in the hire sheet.`
                : `No repo is set for ${displayKey(ctx.key)}. Pick one, or set repos.default.`);
        }
        const repo = await this.checkRepo(raw);
        if (req.repo)
            await this.rememberIfNew(repo, req.baseBranch ?? repo.baseBranch);
        return planWorktree(this.cfg, {
            repoPath: repo.path,
            key: askWorktreeKey(displayKey(ctx.key)),
            summary: ctx.summary,
            baseBranch: req.baseBranch ?? repo.baseBranch,
        });
    }
    async isKnownRepo(path) {
        return (await listRepos(this.cfg)).some((r) => r.path === path);
    }
    async checkRepo(raw) {
        try {
            return await describeRepo(raw);
        }
        catch (err) {
            throw new HireError(err.message);
        }
    }
    /** A repo picked for the first time goes into the picker, so it is there next time. */
    async rememberIfNew(repo, baseBranch) {
        if (await this.isKnownRepo(repo.path))
            return;
        rememberRepo({ path: repo.path, baseBranch });
        forgetRepoCache();
        this.bus.toast(`Added ${repo.name} to your repos.`, 'info');
    }
    /**
     * The repos a job reads beside its own, each a git repo on this Mac. Any
     * kind of job can have them, but only beside a repo of its own: its runner
     * keeps writes out of the repo it reads, and a researcher with no repo has
     * no such fence around these either. A worker with a branch drops them.
     */
    extraReposFor(req, repoPath) {
        const raw = req.extraRepos ?? [];
        if (!Array.isArray(raw) || raw.some((r) => typeof r !== 'string'))
            throw new HireError('extraRepos must be a list of paths.');
        if (!raw.length)
            return [];
        if (!repoPath)
            throw new HireError('Only a job with a repo of its own can read other repos beside it. Pick a repo first.');
        const paths = [];
        for (const r of raw) {
            const path = expandPath(r.trim());
            if (!existsSync(join(path, '.git')))
                throw new HireError(`${path} is not a git repo on this machine, so it cannot be read.`);
            if (path !== repoPath && !paths.includes(path))
                paths.push(path);
        }
        return paths;
    }
    /** A ticket that is not on the board, read from its tracker, or null when it cannot be. */
    async liveTicket(id) {
        try {
            const { source, key } = this.sources.resolve(id);
            return await source.get(key);
        }
        catch {
            return null;
        }
    }
    async doHire(req) {
        const task = req.task?.trim();
        if (!req.ticketKey && !task) {
            throw new HireError('Give the worker either a work order or something to do.');
        }
        const kind = req.kind ?? (req.ticketKey ? 'ticket' : 'ask');
        if (req.runner !== undefined && !['claude', 'acp', 'copilot', 'codex', 'ollama'].includes(req.runner)) {
            throw new HireError('runner must be claude, acp, copilot, codex or ollama.');
        }
        const repoPersona = isRepoPersonaId(req.persona)
            ? findRepoPersona(req.persona, this.cfg.agents, this.modelMenu) ?? undefined
            : undefined;
        const persona = repoPersona
            ?? (req.persona && !isRepoPersonaId(req.persona) ? this.cfg.personas.find((p) => p.id === req.persona) : undefined);
        if (req.persona && !persona)
            throw new HireError('That agent no longer exists. Pick another one.');
        // A ticket found by search, rather than on the board, is read from its tracker, once.
        const onBoard = req.ticketKey ? this.repos.getTicket(req.ticketKey) : null;
        const live = req.ticketKey && !onBoard ? await this.liveTicket(req.ticketKey) : null;
        const ticket = onBoard ?? (live && req.ticketKey ? { ...live.ticket, key: req.ticketKey } : null);
        if (req.ticketKey && !ticket) {
            throw new HireError(`${displayKey(req.ticketKey)} could not be found. Refresh and try again.`);
        }
        // Ad-hoc jobs get their own key, so two unrelated requests never collide.
        const key = req.ticketKey ?? `ASK-${this.repos.nextAskNumber()}`;
        const summary = ticket?.summary ?? firstLine(task ?? '', 90);
        const existing = [...this.live.values()].find((l) => l.record.ticketKey === key);
        if (existing)
            throw new HireError(`${displayKey(key)} already has ${existing.record.name} on it.`);
        const runnerMode = req.runner ?? resolveRunnerMode(this.cfg);
        this.ensureRunnerEnabled(runnerMode);
        await this.ensureCliReady(runnerMode);
        if (this.runningCount() >= this.cfg.agents.maxConcurrent) {
            this.track('limit_reached', null);
            if (!this.hireQueue.some((q) => q.ticketKey === key || (q.task && q.task === task))) {
                this.hireQueue.push(req);
                this.bus.emit({ type: 'queue.update', queue: this.queueView() });
                this.bus.toast(`${displayKey(key)} is waiting at the door for a free desk.`);
            }
            throw new HireError(`All ${this.cfg.agents.maxConcurrent} desks are taken. ${displayKey(key)} is queued at the door.`, 'queued');
        }
        const deskIndex = this.freeDesk();
        if (deskIndex < 0)
            throw new HireError('Every desk is taken.');
        // Research is the only job that can run without a repo. Everywhere else a
        // missing repo means "use the default", because the work has to land
        // somewhere and silently picking nowhere would be worse.
        const wantsRepo = kind !== 'research' || !!req.repo;
        const plan = wantsRepo
            ? await this.planRepoWork(req, { key, summary, ticketRepo: ticket?.repo ?? null })
            : null;
        if (repoPersona && plan?.repoPath !== repoPersona.repoPath && basename(plan?.repoPath ?? '') !== repoPersona.repo) {
            throw new HireError(`${repoPersona.title} is an agent from ${repoPersona.repo}. Pick ${repoPersona.repo} as the repo, or another agent.`);
        }
        const extraRepos = this.extraReposFor(req, plan?.repoPath ?? null);
        // Read the live work order, not the cached row: the brief is the one thing
        // that must not be stale. Ad-hoc jobs have nothing to read.
        const target = req.ticketKey ? this.sources.resolve(req.ticketKey) : null;
        const detail = live ?? (target ? await target.source.get(target.key) : null);
        // A repo-less researcher still needs somewhere to stand and somewhere to
        // write its findings down.
        const workdir = notesDir(key);
        mkdirSync(workdir, { recursive: true });
        const id = `a-${randomUUID().slice(0, 8)}`;
        const record = {
            id,
            builtInPam: false,
            ticketKey: key,
            ticketSummary: detail?.ticket.summary || summary,
            name: req.name?.trim()
                ? this.checkName(req.name)
                : autoWorkerName(persona?.name ?? null, [...this.live.values()].map((l) => l.record.name)),
            deskIndex,
            status: 'starting',
            bubble: 'Walking to my desk',
            activity: 'idle',
            repoPath: plan?.repoPath ?? null,
            extraRepos,
            worktreePath: workdir,
            branch: null,
            baseBranch: plan?.baseBranch ?? null,
            chatId: null,
            prUrl: detail?.pullRequestUrls.at(-1) ?? null,
            runnerMode,
            model: null,
            adopted: false,
            ...(req.discuss === true ? { discuss: true } : {}),
            kind,
            workPlan: null,
            ...asAgentSetup(this.setupFor(req, persona)),
            look: persona?.look ?? DEFAULT_LOOK,
            persona: persona?.name ?? null,
            personaRepo: repoPersona?.repo ?? null,
            instructions: persona?.instructions.trim() || null,
            pendingPermission: null,
            pendingQuestion: null,
            grants: [],
            conversationId: 0, // replaced below, once the row exists to hang it off
            conversations: [],
            queuedMessages: 0,
            sessionLive: false,
            runningSince: null,
            lastError: null,
            errorType: null,
            errorAction: null,
            createdAt: new Date().toISOString(),
            endedAt: null,
        };
        // Saved before anyone is seated, so a bad upload fails the hire outright
        // rather than leaving a worker who never got the files.
        const dir = uploadsDir(id);
        let attachments;
        try {
            attachments = saveUploads(dir, req.attachments);
        }
        catch (err) {
            throw new HireError(err.message);
        }
        const files = attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, path: join(dir, a.file) }));
        const runner = this.makeRunner(record, null);
        // Persisted before any streaming, so a crash mid-turn still leaves a row.
        this.repos.insertAgent(record);
        // Every worker starts in a conversation, so nothing has to cope with a
        // message that belongs to none.
        record.conversationId = this.repos.startConversation(id, firstLine(task ?? summary, 60));
        this.repos.updateAgent(id, { conversationId: record.conversationId });
        const l = {
            record,
            runner,
            queued: [],
            lastTool: null,
            pending: [],
            question: null,
            lastEventAt: Date.now(),
            turnText: '',
            streamBatch: [],
            streamTimer: null,
            interWorkerMessages: [],
        };
        this.live.set(id, l);
        this.wire(l);
        this.bus.emit({ type: 'agent.created', agent: this.view(l) });
        this.bus.toast(`${record.name} joined to work on ${displayKey(record.ticketKey)}.`, 'info', id);
        try {
            const ticketBrief = target && detail && plan
                ? target.source.brief(detail, {
                    branch: null,
                    baseBranch: plan.baseBranch,
                    worktreePath: workdir,
                    repoPath: plan.repoPath,
                    note: req.note,
                    extraRepos,
                    discuss: record.discuss,
                })
                : null;
            // An ad-hoc brief is Operator's request wrapped in the house rules, and the
            // request is still his to read back.
            if (!ticketBrief && task) {
                this.say(id, 'you', task, attachments);
                l.typed = 1;
            }
            else if (attachments.length)
                this.say(id, 'you', '', attachments);
            // Build memory briefing before starting the runner
            const memoryBriefing = await this.buildMemoryBriefing(id, plan?.repoPath ?? null, record.ticketSummary, 
            // An ad-hoc summary is the request's first 90 characters; the files it names may come later.
            detail?.body ?? detail?.ticket.description ?? task);
            // Record which memories were used (for usage tracking)
            if (memoryBriefing.memoryIds.length > 0) {
                this.repos.memory.recordUsage(memoryBriefing.memoryIds, id, key);
            }
            await runner.start();
            const brief = this.briefFor(record, ticketBrief ??
                buildAskBrief(this.cfg, {
                    task: task ?? '',
                    key,
                    kind,
                    branch: null,
                    baseBranch: plan?.baseBranch ?? null,
                    worktreePath: workdir,
                    repoPath: plan?.repoPath ?? null,
                    extraRepos,
                    discuss: record.discuss,
                }), memoryBriefing.brief);
            this.say(id, 'brief', brief);
            await runner.prompt(brief, files);
            this.setStatus(l, 'working', kind === 'ticket' ? 'Reading the ticket' : 'Reading your request');
        }
        catch (err) {
            this.fail(l, err.message);
        }
        this.track('worker_hired', record, { result: 'in_progress' });
        if (attachments.length)
            this.track('attachment_sent', record, { count: attachments.length });
        return this.view(l);
    }
    /**
     * Seats a worker for every board ticket that already has a worktree but no
     * worker, so work Operator started by hand shows up in the office.
     *
     * These arrive as `idle`, not `working`: no agent process has ever run in
     * that worktree, and a worker shown typing at a desk when nothing is
     * happening would be exactly the kind of lie the office has to avoid. The
     * panel offers Resume, which starts an agent there and briefs it to carry on.
     *
     * Called after every poll. Idempotent: a ticket that already has a worker is
     * skipped, so re-polling never duplicates anyone.
     *
     * "Already has a worker" is answered from SQLite rather than memory. A poll
     * that lands while the office is closing would otherwise see an emptied map
     * and seat a second worker on a ticket that already has one.
     */
    adoptWorktrees(tickets) {
        const task = this.adopting.then(() => this.doAdoptWorktrees(tickets));
        this.adopting = task.catch(() => undefined);
        return task;
    }
    async doAdoptWorktrees(tickets) {
        if (this.closing)
            return;
        const seated = new Set([
            ...[...this.live.values()].map((l) => l.record.ticketKey),
            ...this.repos.listActiveAgents().map((a) => a.ticketKey),
        ]);
        // A worktree Operator fired someone out of is not work waiting for a worker:
        // seating a stranger there on the next poll is the fired worker coming
        // back. Rehire is how they return. Matched by path, so a new worktree
        // for the same ticket is still adopted.
        const skip = new Set([
            ...this.occupiedWorktrees().keys(),
            ...this.repos.listFiredWorktreePaths().map(realPath),
        ]);
        let candidates;
        try {
            candidates = await findAdoptableWorktrees(this.cfg, tickets, seated, skip);
        }
        catch (err) {
            console.error('[agents] worktree adoption failed:', err.message);
            return;
        }
        for (const c of candidates) {
            const deskIndex = this.freeDesk();
            if (deskIndex < 0)
                break;
            const id = `a-${randomUUID().slice(0, 8)}`;
            const record = {
                id,
                builtInPam: false,
                ticketKey: c.ticket.key,
                ticketSummary: c.ticket.summary,
                name: pickName([...this.live.values()].map((l) => l.record.name)),
                deskIndex,
                status: 'idle',
                bubble: 'This one was already underway',
                activity: 'idle',
                repoPath: c.repoPath,
                worktreePath: c.worktree.path,
                branch: c.worktree.branch ?? '(detached)',
                baseBranch: c.baseBranch,
                chatId: null,
                prUrl: null,
                runnerMode: resolveRunnerMode(this.cfg),
                model: null,
                adopted: true,
                kind: 'ticket',
                workPlan: null,
                ...asAgentSetup(this.setupFor({})),
                look: DEFAULT_LOOK,
                persona: null,
                instructions: null,
                pendingPermission: null,
                pendingQuestion: null,
                grants: [],
                conversationId: 0,
                conversations: [],
                queuedMessages: 0,
                sessionLive: false,
                runningSince: null,
                lastError: null,
                errorType: null,
                errorAction: null,
                createdAt: new Date().toISOString(),
                endedAt: null,
            };
            this.repos.insertAgent(record);
            record.conversationId = this.repos.startConversation(id, c.ticket.key);
            this.repos.updateAgent(id, { conversationId: record.conversationId });
            const l = {
                record,
                runner: this.makeRunner(record, null),
                queued: [],
                lastTool: null,
                pending: [],
                question: null,
                lastEventAt: 0,
                turnText: '',
                streamBatch: [],
                streamTimer: null,
                interWorkerMessages: [],
            };
            this.live.set(id, l);
            this.wire(l);
            this.bus.emit({ type: 'agent.created', agent: this.view(l) });
            console.log(`[agents] adopted ${c.ticket.key} from ${c.worktree.path}`);
        }
        if (candidates.length) {
            const names = candidates.map((c) => c.ticket.key).join(', ');
            this.bus.toast(`Found work already underway on ${names}. Open the worker to pick it up.`, 'info');
        }
    }
    /* ---------- reviewer ---------- */
    /**
     * Hires a reviewer for a worker's finished work. The reviewer:
     * - Takes no desk (deskIndex: -1)
     * - Gets a read-only brief with just the ticket and diff
     * - Uses a different runner when configured
     * - Stands beside the worker's desk in the scene
     */
    async hireReviewer(workerId) {
        const worker = this.live.get(workerId);
        if (!worker)
            throw new HireError('That worker is not in the office.');
        if (worker.record.reviewerId && this.live.has(worker.record.reviewerId)) {
            throw new HireError(`${worker.record.name} already has a reviewer.`);
        }
        if (worker.record.builtInPam)
            throw new HireError('the assistant does not need review.');
        if (!worker.record.repoPath || !worker.record.branch) {
            throw new HireError('Only work with a branch can be reviewed.');
        }
        // Check if we're at the reviewer limit
        if (this.activeReviewerCount() >= this.cfg.agents.review.maxConcurrent) {
            // Queue the review request
            if (!this.reviewerQueue.some((q) => q.workerId === workerId)) {
                this.reviewerQueue.push({
                    workerId,
                    workerName: worker.record.name,
                    queuedAt: new Date().toISOString(),
                });
                this.bus.toast(`${worker.record.name} is waiting for a reviewer.`, 'info', workerId);
            }
            // Update worker status to awaiting_review
            this.setStatus(worker, 'awaiting_review', 'Waiting for a reviewer');
            return null;
        }
        await this.ensureCliReady();
        // Pick a different runner when configured, else a different model
        const workerRunner = worker.record.runnerMode;
        const reviewerRunner = await this.pickReviewerRunner(workerRunner);
        const id = `r-${randomUUID().slice(0, 8)}`;
        const name = `Reviewer - ${pickName([...this.live.values()].map((l) => l.record.name))}`;
        const record = {
            id,
            builtInPam: false,
            ticketKey: `REVIEW-${worker.record.ticketKey}`,
            ticketSummary: `Review: ${worker.record.ticketSummary}`,
            name,
            deskIndex: -1, // Reviewers don't take a desk
            status: 'reviewing',
            bubble: `Reviewing ${worker.record.name}'s work`,
            activity: 'thinking',
            repoPath: worker.record.repoPath,
            worktreePath: worker.record.worktreePath, // Read-only access to worker's worktree
            branch: worker.record.branch,
            baseBranch: worker.record.baseBranch,
            chatId: null,
            prUrl: null,
            runnerMode: reviewerRunner,
            model: null,
            adopted: false,
            kind: 'research', // Reviewers don't create their own changes
            workPlan: null,
            ...asAgentSetup(this.setupFor({ permission: 'ask', model: this.pickReviewerModel(worker, reviewerRunner) })), // Reviewers use ask permission
            look: { ...DEFAULT_LOOK, hat: 'cap', outfit: 'tie' }, // Professional look with a clipboard
            persona: 'Reviewer',
            instructions: null,
            pendingPermission: null,
            pendingQuestion: null,
            grants: [],
            conversationId: 0,
            conversations: [],
            queuedMessages: 0,
            sessionLive: false,
            runningSince: null,
            lastError: null,
            errorType: null,
            errorAction: null,
            createdAt: new Date().toISOString(),
            endedAt: null,
            reviewingId: workerId, // This is who the reviewer is reviewing
            reviewRounds: 0,
        };
        const runner = this.makeRunner(record, null);
        this.repos.insertAgent(record);
        record.conversationId = this.repos.startConversation(id, `Review: ${worker.record.ticketSummary}`);
        this.repos.updateAgent(id, { conversationId: record.conversationId });
        const l = {
            record,
            runner,
            queued: [],
            lastTool: null,
            pending: [],
            question: null,
            lastEventAt: Date.now(),
            turnText: '',
            streamBatch: [],
            streamTimer: null,
            interWorkerMessages: [],
        };
        this.live.set(id, l);
        this.wire(l);
        // Link the worker to this reviewer
        worker.record.reviewerId = id;
        worker.record.reviewRounds = 0;
        this.repos.updateAgent(workerId, { reviewerId: id, reviewRounds: 0 });
        this.setStatus(worker, 'in_review', `${name} is reviewing`);
        this.bus.emit({ type: 'agent.created', agent: this.view(l) });
        this.bus.emit({ type: 'agent.updated', agent: this.view(worker) });
        this.bus.toast(`${name} is reviewing ${worker.record.name}'s work.`, 'info', id);
        await this.startReview(l, worker.record, true);
        return this.view(l);
    }
    /** Starts the reviewer's runner on its brief. `announce` also puts the brief in its chat. */
    async startReview(l, worker, announce) {
        try {
            const brief = await this.buildReviewerBrief(worker);
            await l.runner.start();
            if (announce)
                this.say(l.record.id, 'brief', brief);
            await l.runner.prompt(brief);
        }
        catch (err) {
            this.fail(l, err.message);
        }
    }
    /**
     * A reviewer on a different runner from its worker's that cannot sign in,
     * is not installed or is out of quota reviews on the worker's runner
     * instead, which is known to work. True when it has been moved.
     */
    moveReviewToWorkerRunner(l, classified) {
        const worker = l.record.reviewingId ? this.live.get(l.record.reviewingId) : undefined;
        if (!worker || this.live.get(l.record.id) !== l || l.record.runnerMode === worker.record.runnerMode)
            return false;
        if (classified.type !== 'auth' && classified.type !== 'cli_missing' && classified.type !== 'quota')
            return false;
        const from = l.record.runnerMode;
        const to = worker.record.runnerMode;
        // On the worker's runner, a model other than the worker's, where there is one.
        const setup = checkSetup({ ...agentSetup(l.record), model: this.pickReviewerModel(worker, to) }, this.modelMenu.efforts);
        void l.runner.dispose().catch(() => { });
        l.record.runnerMode = to;
        l.record.chatId = null;
        // The old runner's commands may not exist on the new one.
        l.record.commands = [];
        Object.assign(l.record, asAgentSetup(setup));
        this.repos.updateAgent(l.record.id, { runnerMode: to, chatId: null, commands: [], chosenModel: setup.model, effort: setup.effort });
        l.runner = this.makeRunner(l.record, null);
        this.wire(l);
        this.setStatus(l, 'reviewing', `Reviewing ${worker.record.name}'s work`);
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        const model = this.reviewMenu(worker)?.models.find((m) => m.value === setup.model)?.label;
        this.bus.toast(`${runnerLabel(from)} is not available (${classified.shortMessage.toLowerCase()}), so ${l.record.name} reviews on ${runnerLabel(to)}${setup.model && model ? ` with ${model}` : ''} instead.`, 'info', l.record.id);
        void this.startReview(l, worker.record, false);
        return true;
    }
    /**
     * Picks the runner for a reviewer based on config.
     * 'different' tries to use a different runner from the worker, one that is
     * turned on and has not failed its check, else the worker's own.
     */
    async pickReviewerRunner(workerRunner) {
        const pref = this.cfg.agents.review.reviewerRunner;
        if (pref === 'same')
            return workerRunner;
        if (pref !== 'different')
            return pref;
        // Prefer local ollama or cloud ACP for review
        const own = workerRunner === 'print' ? 'acp' : workerRunner;
        const enabled = enabledRunners(this.cfg);
        for (const r of ['ollama', 'codex', 'claude', 'acp', 'copilot']) {
            if (r === own || (!enabled.includes(r) && r !== 'ollama'))
                continue;
            // Not checked yet is no failure, as for a hire.
            const check = await this.cliChecks.get(r);
            if (!check || check.ok)
                return r;
        }
        return workerRunner;
    }
    /**
     * Picks the reviewer's model. Claude Code reviews on Opus and Codex and
     * Copilot on their own default. On the worker's own runner it is the first
     * model there other than the worker's, Default counting as the model it
     * comes to, and the worker's only when the runner offers nothing else.
     */
    pickReviewerModel(worker, runnerMode) {
        if (runnerMode !== worker.record.runnerMode)
            return runnerMode === 'codex' || runnerMode === 'copilot' ? null : 'opus';
        const models = this.reviewMenu(worker)?.models ?? [];
        const defaultName = models.find((m) => m.value === null)?.hint;
        const current = worker.record.chosenModel ?? models.find((m) => m.value && m.label === defaultName)?.value ?? null;
        return models.find((m) => m.value && m.value !== current)?.value ?? worker.record.chosenModel;
    }
    /** The models on the worker's runner, by their full names; null when its runner has not said. */
    reviewMenu(worker) {
        const mode = worker.record.runnerMode;
        const isDefault = mode === resolveRunnerMode(this.cfg);
        if (mode === 'codex' || mode === 'copilot')
            return worker.runner.menu ?? (isDefault ? this.modelMenu : null);
        // The office's Claude Code list, as the session names it.
        if (worker.runner.menu)
            return namedModels(CLAUDE_MODEL_MENU, worker.runner.menu);
        return isDefault ? this.modelMenu : CLAUDE_MODEL_MENU;
    }
    /**
     * Builds the brief for a reviewer: the ticket and the diff, nothing else.
     */
    async buildReviewerBrief(worker) {
        const diffStat = worker.baseBranch
            ? await diffStatAgainstBase(worker.worktreePath, worker.baseBranch).catch(() => 'Could not get diff')
            : 'No base branch';
        return [
            'You are a code reviewer. Review the following work and provide structured feedback.',
            '',
            '## What you are reviewing',
            '',
            `**Ticket:** ${displayKey(worker.ticketKey)} - ${worker.ticketSummary}`,
            `**Worker:** ${worker.name}`,
            `**Branch:** ${worker.branch}`,
            '',
            '## Changes',
            '',
            '```',
            diffStat,
            '```',
            '',
            '## Your task',
            '',
            '1. Review the diff for correctness, security, and code quality',
            '2. Check that tests were added or updated appropriately',
            '3. Look for leftover debug code, hardcoded values, or security issues',
            '',
            '## How to respond',
            '',
            'Finish with exactly one call to the office `send_findings` tool. Its `outcome` is:',
            '- `approved`: nothing needs fixing. The review ends and the work moves on.',
            '- `changes_requested`: the worker must fix the findings, then you re-check their work.',
            '- `needs_user`: a judgment call only the user can make. The review ends and the user decides.',
            '',
            'Each finding has:',
            '- `file`: The file path',
            '- `line`: Optional line number',
            '- `severity`: "error", "warning", or "info"',
            '- `message`: What needs to be fixed or improved',
            '',
            'Findings are required for `changes_requested` and optional otherwise.',
            'Run `git diff` against the base branch to read the full change.',
            '',
            '**Important:** You are read-only. Do not edit any files. Only review and provide feedback.',
        ].join('\n');
    }
    /**
     * Analyzes a worker's changes to determine if automatic review should trigger.
     * Returns true if the work is "risky" based on:
     * - Large diff (over threshold)
     * - Sensitive file patterns matched
     * - Tests changed or deleted
     */
    async shouldAutoReview(worker) {
        if (!this.cfg.agents.review.enabled)
            return { trigger: false, reasons: [] };
        if (!worker.repoPath || !worker.branch || !worker.baseBranch)
            return { trigger: false, reasons: [] };
        const reasons = [];
        try {
            // Get the diff
            const { stdout: diffOutput } = await run('git', ['diff', '--stat', `origin/${worker.baseBranch}...HEAD`], {
                cwd: worker.worktreePath,
                timeoutMs: 30_000,
            });
            // Count lines changed
            const statMatch = /(\d+) files? changed(?:, (\d+) insertions?.*)?(?:, (\d+) deletions?.*)?/.exec(diffOutput);
            const insertions = parseInt(statMatch?.[2] ?? '0', 10);
            const deletions = parseInt(statMatch?.[3] ?? '0', 10);
            const totalLines = insertions + deletions;
            if (totalLines >= this.cfg.agents.review.largeDiffThreshold) {
                reasons.push(`Large diff: ${totalLines} lines changed`);
            }
            // Get list of changed files
            const { stdout: filesOutput } = await run('git', ['diff', '--name-only', `origin/${worker.baseBranch}...HEAD`], {
                cwd: worker.worktreePath,
                timeoutMs: 30_000,
            });
            const changedFiles = filesOutput.trim().split('\n').filter(Boolean);
            // Check for sensitive patterns
            for (const pattern of this.cfg.agents.review.sensitivePatterns) {
                const regex = this.globToRegex(pattern);
                const matches = changedFiles.filter((f) => regex.test(f));
                if (matches.length > 0) {
                    reasons.push(`Sensitive files: ${matches.slice(0, 3).join(', ')}${matches.length > 3 ? '...' : ''}`);
                    break;
                }
            }
            // Check for test changes
            if (this.cfg.agents.review.reviewTestChanges) {
                const testPatterns = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /__tests__\//, /\/test\//];
                const testChanges = changedFiles.filter((f) => testPatterns.some((p) => p.test(f)));
                if (testChanges.length > 0) {
                    reasons.push(`Tests changed: ${testChanges.length} file(s)`);
                }
            }
        }
        catch (err) {
            console.error('[agents] Could not analyze diff for review:', err.message);
            return { trigger: false, reasons: [] };
        }
        return { trigger: reasons.length > 0, reasons };
    }
    /** Converts a glob pattern to a regex. */
    globToRegex(pattern) {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '@@GLOBSTAR@@')
            .replace(/\*/g, '[^/]*')
            .replace(/@@GLOBSTAR@@/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`);
    }
    /**
     * Called when a worker's work is ready for review (PR opened or turn ended).
     * Checks if automatic review should trigger.
     */
    async maybeAutoReview(workerId) {
        const worker = this.live.get(workerId);
        if (!worker || worker.record.reviewerId)
            return;
        // Off, reviews only happen when Operator asks for one.
        if (this.cfg.agents.autoReview === false)
            return;
        const { trigger, reasons } = await this.shouldAutoReview(worker.record);
        if (!trigger)
            return;
        console.log(`[agents] Auto-review triggered for ${worker.record.name}: ${reasons.join('; ')}`);
        try {
            await this.hireReviewer(workerId);
        }
        catch (err) {
            console.error(`[agents] Failed to auto-hire reviewer:`, err.message);
        }
    }
    /**
     * User requests a review for a specific worker.
     */
    async requestReview(workerId) {
        return this.hireReviewer(workerId);
    }
    /**
     * Called when a reviewer finishes (either approved or user took over).
     * Cleans up the reviewer and processes the queue.
     */
    async dismissReviewer(reviewerId, outcome) {
        const reviewer = this.live.get(reviewerId);
        if (!reviewer || !reviewer.record.reviewingId) {
            // The reviewer already left, so End review only has the worker to free.
            const worker = [...this.live.values()].find((l) => l.record.reviewerId === reviewerId);
            if (worker)
                this.reviewerLeft(worker, 'Review dismissed');
            return;
        }
        const workerId = reviewer.record.reviewingId;
        const worker = this.live.get(workerId);
        // Out of the office first, so a second call while disposing finds nothing to do.
        this.live.delete(reviewerId);
        await reviewer.runner.dispose().catch(() => { });
        this.repos.updateAgent(reviewerId, { status: 'done', endedAt: new Date().toISOString() });
        this.bus.emit({ type: 'agent.removed', agentId: reviewerId });
        // Update worker
        if (worker) {
            this.unlinkReviewer(worker);
            if (outcome === 'approved') {
                if (worker.record.prUrl)
                    this.setStatus(worker, 'review', '👍 Review passed, PR ready');
                else
                    this.setStatus(worker, 'idle', '👍 Review passed');
                this.bus.toast(`${worker.record.name}'s work was approved by ${reviewer.record.name}.`, 'done', workerId);
            }
            else if (outcome === 'needs_user') {
                this.setStatus(worker, 'needs_you', 'Reviewer wants your call');
                this.bus.toast(`${reviewer.record.name} needs your call on ${worker.record.name}'s work.`, 'needs_you', workerId);
            }
            else {
                this.rest(worker, 'Review dismissed');
            }
            this.bus.emit({ type: 'agent.updated', agent: this.view(worker) });
        }
        // Process the review queue
        void this.drainReviewQueue();
    }
    unlinkReviewer(worker) {
        worker.record.reviewerId = null;
        this.repos.updateAgent(worker.record.id, { reviewerId: null });
    }
    /**
     * Frees a worker whose reviewer went home without passing judgement. One
     * still fixing findings is mid-turn, so it keeps working.
     */
    reviewerLeft(worker, bubble) {
        this.unlinkReviewer(worker);
        if (worker.record.status === 'in_review')
            this.rest(worker, bubble);
        this.bus.emit({ type: 'agent.updated', agent: this.view(worker) });
        void this.drainReviewQueue();
    }
    /** Processes the reviewer queue when a slot opens up. */
    async drainReviewQueue() {
        while (this.reviewerQueue.length && this.activeReviewerCount() < this.cfg.agents.review.maxConcurrent) {
            const next = this.reviewerQueue.shift();
            if (!next)
                break;
            const worker = this.live.get(next.workerId);
            if (!worker || worker.record.reviewerId)
                continue; // Worker gone or already has reviewer
            try {
                await this.hireReviewer(next.workerId);
            }
            catch (err) {
                console.error(`[agents] Could not hire reviewer from queue:`, err.message);
            }
        }
    }
    /** Builds the runner for the next turn, on the stored chat id when there is one. */
    attachRunner(l, chatId) {
        l.runner = this.makeRunner(l.record, chatId);
        return chatId ? 'resumed' : 'fresh';
    }
    freeDesk() {
        return this.claimDesk(-1);
    }
    /** The preferred desk when it is free, otherwise any free one. -1 when the office is full. */
    claimDesk(preferred) {
        const taken = new Set([...this.live.values()].map((l) => l.record.deskIndex));
        if (preferred >= 0 && preferred < DESK_COUNT && !taken.has(preferred))
            return preferred;
        const free = Array.from({ length: DESK_COUNT }, (_, i) => i).filter((i) => !taken.has(i));
        return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
    }
    makeRunner(record, chatId) {
        if (record.repoPath && !record.branch) {
            try {
                linkRepoSkillsIntoNotes(record.repoPath, record.worktreePath);
            }
            catch (err) {
                console.error(`[agents] could not link ${record.repoPath}'s skills for ${record.name}:`, err.message);
            }
        }
        const opts = {
            worktreePath: record.worktreePath,
            chatId,
            model: record.chosenModel,
            effort: record.effort,
            permission: record.permission,
            readOnlyRepo: record.branch ? null : record.repoPath,
            // Read only beside a repo read only: once the worker has a worktree of
            // its own, nothing would stop it changing them.
            extraRepos: record.branch || !record.repoPath ? [] : (record.extraRepos ?? []),
            uploadsDir: uploadsDir(record.id),
            reviewingId: record.reviewingId ?? null,
            onToolCall: async (name, args) => {
                const liveAgent = this.live.get(record.id);
                if (liveAgent) return this.handleOfficeTool(liveAgent, name, args);
                return null;
            },
            mcpServers: async () => [
                ...this.sources
                    .all()
                    .filter((s) => s.workerTools())
                    .map((s) => ({
                    type: 'http',
                    name: s.id,
                    url: `http://127.0.0.1:${this.cfg.port}/api/mcp/${s.id}`,
                    headers: [{ name: SESSION_HEADER, value: ensureSessionToken() }],
                })),
                {
                    type: 'http',
                    name: 'office',
                    url: `http://127.0.0.1:${this.cfg.port}/api/mcp/office/${record.id}`,
                    headers: [{ name: SESSION_HEADER, value: ensureSessionToken() }],
                },
                ...(await this.startUserMcp(record)),
            ],
        };
        return runnerFor(record.runnerMode, opts);
    }
    workerTools(sourceId) {
        return this.sources.workerTools(sourceId);
    }
    /** Operator's servers that are on for a worker. the assistant hands work on and uses none of them. */
    userMcpFor(record) {
        if (record.builtInPam)
            return [];
        try {
            return enabledMcpServers(record.repoPath);
        }
        catch (err) {
            console.error('[agents] could not read the MCP servers:', err.message);
            return [];
        }
    }
    /** Where a worker's servers run, as the tool would run them: its worktree, else the repo it is reading. */
    userMcpCwd(record) {
        return record.branch || !record.repoPath ? record.worktreePath : record.repoPath;
    }
    /**
     * Starts the worker's servers for the session about to open. One that fails
     * is reported and left out of the session; the worker starts without it.
     */
    async startUserMcp(record) {
        const cwd = this.userMcpCwd(record);
        const started = await Promise.all(this.userMcpFor(record).map(async (server) => {
            try {
                await this.userMcp.start(record.id, server, cwd);
                recordMcpError(server.key, null);
            }
            catch (err) {
                const message = err.message;
                recordMcpError(server.key, message);
                this.bus.toast(`The ${server.name} MCP server did not start for ${record.name}, so this session goes without it: ${truncate(message, 160)}`, 'error', record.id);
                return [];
            }
            const name = mcpRunnerName(server.name);
            return [{
                    type: 'http',
                    name,
                    url: `http://127.0.0.1:${this.cfg.port}/api/mcp/user/${encodeURIComponent(record.id)}/${encodeURIComponent(name)}`,
                    headers: [{ name: SESSION_HEADER, value: ensureSessionToken() }],
                }];
        }));
        return started.flat();
    }
    /**
     * One of Operator's servers as the office's endpoint serves it to a worker, or
     * null when it is not on for that worker. A call to an Ask first server
     * waits for Operator, whatever the worker's level or auto mode.
     */
    userTools(agentId, name) {
        const l = this.live.get(agentId);
        const find = () => (l ? this.userMcpFor(l.record).find((s) => mcpRunnerName(s.name) === name) ?? null : null);
        if (!l || !find())
            return null;
        const off = { content: [{ type: 'text', text: `${name} was turned off in the Toolkit.` }], isError: true };
        return {
            listTools: async () => {
                const server = find();
                if (!server)
                    return [];
                try {
                    return await this.userMcp.listTools(agentId, server, this.userMcpCwd(l.record));
                }
                catch (err) {
                    recordMcpError(server.key, err.message);
                    throw err;
                }
            },
            callTool: async (tool, args) => {
                const server = find();
                if (!server)
                    return off;
                if (server.askFirst && !(await this.askFirst(l, server, tool, args))) {
                    return { content: [{ type: 'text', text: 'Operator denied this call. Find another way.' }], isError: true };
                }
                try {
                    return await this.userMcp.callTool(agentId, server, this.userMcpCwd(l.record), tool, args);
                }
                catch (err) {
                    return { content: [{ type: 'text', text: scrubSecrets(err.message, server) }], isError: true };
                }
            },
        };
    }
    /** Holds a call to an Ask first server until Operator answers it in the panel. */
    askFirst(l, server, tool, args) {
        const request = makePermissionRequest({
            title: `${server.name}: ${tool}`,
            detail: Object.keys(args).length ? truncate(JSON.stringify(args, null, 2), 400) : null,
            plain: `Use ${tool} on ${server.name}, which you set to ask first`,
        });
        return new Promise((resolve) => {
            this.officeAsks.set(request.id, resolve);
            this.raiseHand(l, request);
        });
    }
    /**
     * A runner's own prompt for a tool of an Ask first server. The office asks
     * Operator when the call reaches it, so this one goes through without a second.
     */
    asksAtTheCall(l, request) {
        const server = /^mcp__(.+?)__/.exec(request.title)?.[1];
        return !!server && this.userMcpFor(l.record).some((s) => s.askFirst && mcpRunnerName(s.name) === server);
    }
    /** Drops what the worker was waiting on. A call the office held for Operator is refused, so it does not hang. */
    clearPending(l) {
        for (const p of l.pending) {
            const office = this.officeAsks.get(p.id);
            if (!office)
                continue;
            this.officeAsks.delete(p.id);
            office(false);
        }
        l.pending = [];
    }
    /**
     * Check if a worker is rate-limited for inter-worker messages.
     * Returns true if rate limit exceeded.
     */
    isRateLimited(l) {
        const now = Date.now();
        const windowMs = 60_000; // 1 minute window
        // Clean old timestamps
        l.interWorkerMessages = l.interWorkerMessages.filter((t) => now - t < windowMs);
        return l.interWorkerMessages.length >= INTER_WORKER_LIMITS.rateLimit;
    }
    /**
     * Record an inter-worker message for rate limiting.
     */
    recordInterWorkerMessage(l) {
        l.interWorkerMessages.push(Date.now());
    }
    /**
     * Deliver an inter-worker message to the recipient.
     * The message appears in the recipient's chat with a sender label.
     */
    deliverInterWorkerMessage(message) {
        const recipient = this.live.get(message.toId);
        if (!recipient)
            return;
        // Format the message for the recipient
        let text;
        switch (message.kind) {
            case 'findings':
                text = `**From ${message.fromName} (reviewer):**\n\n`;
                if (message.outcome === 'approved')
                    text += '👍 Approved. Nothing needs fixing.\n\n';
                else if (message.outcome === 'needs_user')
                    text += 'This needs a decision from the user before it goes further.\n\n';
                if (message.findings?.length) {
                    if (message.outcome === 'changes_requested')
                        text += 'Please address these findings, then ask for a re-check:\n\n';
                    for (const f of message.findings) {
                        const loc = f.line ? `${f.file}:${f.line}` : f.file;
                        const icon = f.severity === 'error' ? '❌' : f.severity === 'warning' ? '⚠️' : 'ℹ️';
                        text += `${icon} **${loc}** (${f.severity}): ${f.message}\n`;
                    }
                }
                if (message.note)
                    text += `\n${message.note}`;
                break;
            case 'ready_for_recheck':
                text = `**From ${message.fromName}:**\n\nReady for re-check.`;
                if (message.note)
                    text += ` ${message.note}`;
                break;
            case 'tell_pam':
                text = `**From ${message.fromName}:**\n\n${message.note || '(no message)'}`;
                break;
            case 'handoff':
                text = `**From ${message.fromName}, sent at your request:**\n\n${message.note || ''}`;
                if (message.files?.length) {
                    text += `\n\nAttached files: ${message.files.join(', ')}`;
                }
                break;
        }
        // Add to the recipient's chat as if it came from the office
        this.say(recipient.record.id, 'agent', text);
        // Log the exchange in the sender's chat too
        const sender = this.live.get(message.fromId);
        if (sender) {
            const ack = message.kind === 'findings'
                ? `Sent findings to ${message.toName}.`
                : message.kind === 'ready_for_recheck'
                    ? `Told ${message.toName} you're ready for re-check.`
                    : message.kind === 'tell_pam'
                        ? `Told the assistant: "${truncate(message.note || '', 60)}"`
                        : `Sent message to ${message.toName}.`;
            this.say(sender.record.id, 'tool', ack);
        }
        // Emit scene event for animation
        this.bus.emit({
            type: 'agent.bubble',
            agentId: message.fromId,
            bubble: message.kind === 'findings' ? `Reviewing ${message.toName}'s work` : `Messaging ${message.toName}`,
            plain: null,
        });
        // So the recipient can answer without the user having to @-mention the sender back.
        if (message.kind === 'handoff' && !recipient.record.builtInPam) {
            this.grantAtPermission(recipient.record.id, message.fromId);
        }
        // A decision that ends the review is for the record, not something to act on.
        if (message.kind === 'findings' && message.outcome !== 'changes_requested')
            return;
        void this.promptWith(recipient, text)
            .then(() => {
            if (message.kind === 'findings' && recipient.record.status === 'working') {
                this.setStatus(recipient, 'fixing_findings', 'Fixing review findings');
            }
        })
            .catch((err) => {
            console.error(`[agents] could not deliver ${message.fromName}'s message to ${message.toName}:`, err.message);
        });
    }
    /**
     * Hands the worker's fixes back to its reviewer, or the review to the user
     * once the round cap is used up.
     */
    askForRecheck(l, note) {
        const reviewer = l.record.reviewerId ? this.live.get(l.record.reviewerId) : undefined;
        if (!reviewer)
            return { ok: false, text: 'Your reviewer is no longer active.' };
        const rounds = (l.record.reviewRounds ?? 0) + 1;
        const cap = INTER_WORKER_LIMITS.maxReviewRounds;
        if (rounds > cap) {
            void this.dismissReviewer(reviewer.record.id, 'needs_user');
            return { ok: false, text: `Review round cap (${cap}) reached. The user will review from here.` };
        }
        // In memory only, not persisted.
        l.record.reviewRounds = rounds;
        this.recordInterWorkerMessage(l);
        this.deliverInterWorkerMessage({
            kind: 'ready_for_recheck',
            fromId: l.record.id,
            fromName: l.record.name,
            toId: reviewer.record.id,
            toName: reviewer.record.name,
            note,
            createdAt: new Date().toISOString(),
        });
        this.setStatus(l, 'in_review', `${reviewer.record.name} is re-checking`);
        return { ok: true, text: `Told ${reviewer.record.name} you're ready for re-check (round ${rounds}/${cap}).` };
    }
    /**
     * Hands an office message to the recipient's agent, already recorded in its
     * chat: a sleeping worker is woken, a busy or starting one reads it next turn.
     */
    async promptWith(l, text) {
        await this.settled(l);
        if (l.runner.isBusy || l.waking || l.record.status === 'starting') {
            l.queued.push({ text, files: [] });
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
            return;
        }
        if (!l.runner.isStarted)
            return this.wake(l, text, [], [], null);
        l.turnText = '';
        await l.runner.prompt(text);
        this.setStatus(l, l.record.reviewingId ? 'reviewing' : 'working', 'Reading a message');
    }
    /**
     * Grant a one-time permission to message a worker (from @-mention).
     */
    grantAtPermission(fromId, toId) {
        const l = this.live.get(fromId);
        if (!l)
            return;
        l.record.atPermissions = l.record.atPermissions ?? [];
        if (!l.record.atPermissions.includes(toId)) {
            l.record.atPermissions.push(toId);
        }
    }
    /** Office workers named as `@Name` in a message, whether typed or picked from the @-menu. */
    mentionedIn(fromId, text) {
        const lower = text.toLowerCase();
        return [...this.live.values()].filter((w) => {
            if (w.record.id === fromId)
                return false;
            const at = `@${w.record.name.toLowerCase()}`;
            for (let i = lower.indexOf(at); i !== -1; i = lower.indexOf(at, i + 1)) {
                if (!/[\p{L}\p{N}_-]/u.test(lower[i + at.length] ?? ''))
                    return true;
            }
            return false;
        });
    }
    /**
     * Tells the agent who an @-mention means. Without it a name like Eve reads
     * as anyone, and the assistant went looking for an Eve in the ticket tracker.
     */
    mentionNote(l, mentioned) {
        if (!mentioned.length)
            return '';
        const lines = mentioned.map((w) => w.record.builtInPam
            ? '- @the assistant is the office secretary. Reach her with the office tell_pam tool.'
            : `- @${w.record.name} is a worker in this office (ID ${w.record.id}). Reach them with the office message_worker tool${l.record.builtInPam ? '' : '; this mention lets you message them once'}.`);
        return `\n\n[Office note: these @-mentions are workers in AgentCorp, not people in other systems.\n${lines.join('\n')}]`;
    }
    /**
     * Consume a one-time @-permission (returns true if permission existed and was consumed).
     */
    consumeAtPermission(fromId, toId) {
        const l = this.live.get(fromId);
        if (!l || !l.record.atPermissions)
            return false;
        const idx = l.record.atPermissions.indexOf(toId);
        if (idx === -1)
            return false;
        l.record.atPermissions.splice(idx, 1);
        return true;
    }
    /** A worker by ID or by name (ignoring case), or why there isn't exactly one. */
    findWorker(ref) {
        const byId = this.live.get(ref);
        if (byId)
            return byId;
        const wanted = ref.replace(/^@/, '').toLowerCase();
        const named = [...this.live.values()].filter((w) => w.record.name.toLowerCase() === wanted);
        if (named.length === 1)
            return named[0];
        if (named.length > 1)
            return `More than one worker is called ${ref}. Use the ID from list_workers.`;
        return `No worker called ${ref} is in the office. Use list_workers to see who is here.`;
    }
    /**
     * Office tools available to all workers. The tools offered depend on the worker's role:
     * - the assistant: hire_worker
     * - Reviewers: send_findings
     * - Workers being reviewed: ready_for_recheck
     * - the assistant: message_worker, freely
     * - Other workers: tell_pam, message_worker (with @-permission)
     */
    officeTools(agentId) {
        const l = this.live.get(agentId);
        if (!l)
            return null;
        const isPam = l.record.builtInPam;
        const isReviewer = !!l.record.reviewingId;
        const isBeingReviewed = !!l.record.reviewerId;
        const tools = [];
        // the assistant's hire tool
        if (isPam) {
            tools.push({
                name: 'hire_worker',
                description: 'Hire a worker for a ticket or a free-form task. The normal worker limit and queue apply.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        task: { type: 'string', description: 'The work to hand to a new worker. Required when ticket_key is omitted.' },
                        ticket_key: { type: 'string', description: 'The exact board ticket key, including its source prefix when present.' },
                        repo: { type: 'string', description: 'An optional local repository path.' },
                        name: { type: 'string', description: 'An optional name for the new worker.' },
                    },
                },
            });
        }
        // Reviewer tools
        if (isReviewer) {
            tools.push({
                name: 'send_findings',
                description: 'Send your review decision to the worker you are reviewing: approved, changes_requested (with findings to fix), or needs_user for a judgment call.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        outcome: {
                            type: 'string',
                            enum: ['approved', 'changes_requested', 'needs_user'],
                            description: 'Your decision',
                        },
                        findings: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    file: { type: 'string', description: 'The file path' },
                                    line: { type: 'number', description: 'Optional line number' },
                                    severity: { type: 'string', enum: ['error', 'warning', 'info'], description: 'Severity level' },
                                    message: { type: 'string', description: 'What to fix' },
                                },
                                required: ['file', 'severity', 'message'],
                            },
                            description: 'List of findings',
                        },
                        note: { type: 'string', description: 'Optional additional note' },
                    },
                    required: ['outcome'],
                },
            });
        }
        // Worker being reviewed tools
        if (isBeingReviewed) {
            tools.push({
                name: 'ready_for_recheck',
                description: 'Tell your reviewer you have addressed their findings and are ready for another review.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        note: { type: 'string', description: 'Optional note about what was fixed' },
                    },
                },
            });
        }
        // All workers can message the assistant
        if (!isPam) {
            tools.push({
                name: 'tell_pam',
                description: 'Send a message to the assistant (reception). Use this when you are blocked, need a decision, or want the assistant to coordinate something.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', description: 'What to tell the assistant' },
                    },
                    required: ['message'],
                },
            });
        }
        tools.push({
            name: 'message_worker',
            description: isPam
                ? 'Send a message to a worker in the office, for example to pass on context after hiring them.'
                : 'Send a message to another worker. Works once per @-mention: the user has to mention that worker with @ in your chat, or that worker messaged you first.',
            inputSchema: {
                type: 'object',
                properties: {
                    worker_id: { type: 'string', description: 'The ID or exact name of the worker to message (see list_workers)' },
                    message: { type: 'string', description: 'The message to send' },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional file names to attach (from your worktree)',
                    },
                },
                required: ['worker_id', 'message'],
            },
        });
        // List current workers (useful for all)
        tools.push({
            name: 'list_workers',
            description: 'List all current workers in the office with their names, IDs, tickets, and status.',
            inputSchema: { type: 'object', properties: {} },
        });
        // Memory tools for all workers (not the assistant)
        if (!isPam) {
            tools.push({
                name: 'remember',
                description: `Save a reusable lesson about this repo for future workers. Use this for:
- Conventions: how this repo does things (test style, naming, where config lives)
- Gotchas: flaky tests, fragile modules, commands that don't work here
- Corrections: something the user told you that applies beyond this ticket
Do NOT save facts specific to this one ticket. The office will show you related existing memories so you can update one instead of creating a duplicate: call again with its id as update_id.`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        lesson: { type: 'string', description: 'The lesson to remember, stated as a general rule or pattern' },
                        kind: {
                            type: 'string',
                            enum: ['convention', 'gotcha', 'correction'],
                            description: 'What kind of lesson: convention (how things are done), gotcha (watch out for), or correction (from user feedback)',
                        },
                        files: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Related file paths (for search boosting)',
                        },
                        update_id: {
                            type: 'number',
                            description: 'The id of an existing memory to replace with this lesson, instead of saving a new one',
                        },
                    },
                    required: ['lesson'],
                },
            });
            tools.push({
                name: 'recall',
                description: 'Search the office memory for lessons about this repo. Use before touching unfamiliar or fragile code, or when you hit an unexpected error.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'What to search for (file name, concept, error message, etc.)' },
                        files: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Files you are working on (boosts matches related to them)',
                        },
                    },
                    required: ['query'],
                },
            });
        }
        return {
            listTools: async () => tools,
            callTool: async (name, args) => this.handleOfficeTool(l, name, args),
        };
    }
    /**
     * A hire_worker call, from the assistant or the remote operator: a ticket key or a
     * free-form task, under the normal worker limit and queue.
     */
    async hireFromTool(args) {
        const task = typeof args.task === 'string' ? args.task.trim() : undefined;
        let ticketKey = typeof args.ticket_key === 'string' ? args.ticket_key.trim() : undefined;
        const repo = typeof args.repo === 'string' ? args.repo.trim() : undefined;
        const workerName = typeof args.name === 'string' ? args.name.trim() : undefined;
        if (!task && !ticketKey)
            return { ok: false, text: 'Give the worker either ticket_key or task.' };
        if (ticketKey && !this.repos.getTicket(ticketKey)) {
            const matches = this.repos.listTickets().filter((ticket) => displayKey(ticket.key).toLowerCase() === ticketKey.toLowerCase());
            if (matches.length === 1)
                ticketKey = matches[0].key;
        }
        try {
            const hired = await this.hire({
                ...(ticketKey ? { ticketKey, ...(task ? { note: task } : {}) } : { task: task }),
                ...(repo ? { repo } : {}),
                ...(workerName ? { name: workerName } : {}),
            });
            return { ok: true, text: `${hired.name} (ID ${hired.id}) was hired for ${displayKey(hired.ticketKey)}.` };
        }
        catch (e) {
            if (e instanceof HireError && e.reason === 'queued') {
                return { ok: true, text: `${displayKey(ticketKey ?? 'that task')} was added to the normal waiting queue.` };
            }
            return { ok: false, text: e.message };
        }
    }
    /** A worker by ID or exact name, or why there isn't exactly one. */
    resolveWorker(ref) {
        const found = this.findWorker(ref);
        return typeof found === 'string' ? found : this.view(found);
    }
    /**
     * Handle a call to an office tool.
     */
    async handleOfficeTool(l, name, args) {
        const isPam = l.record.builtInPam;
        const isReviewer = !!l.record.reviewingId;
        const isBeingReviewed = !!l.record.reviewerId;
        // Helper to create properly typed MCP responses
        const ok = (text) => ({ content: [{ type: 'text', text }] });
        const err = (text) => ({ content: [{ type: 'text', text }], isError: true });
        switch (name) {
            case 'hire_worker': {
                if (!isPam)
                    return err('Only the assistant can hire workers.');
                const hired = await this.hireFromTool(args);
                return hired.ok ? ok(hired.text) : err(hired.text);
            }
            case 'send_findings': {
                if (!isReviewer)
                    return err('You are not assigned as a reviewer.');
                const reviewingId = l.record.reviewingId;
                const target = this.live.get(reviewingId);
                if (!target)
                    return err('The worker you were reviewing is no longer active.');
                if (this.isRateLimited(l))
                    return err('Rate limit reached. Wait a moment before sending more messages.');
                const outcome = args.outcome === 'approved' || args.outcome === 'needs_user' ? args.outcome : 'changes_requested';
                const findings = Array.isArray(args.findings) ? args.findings : [];
                if (outcome === 'changes_requested' && !findings.length) {
                    return err('List what to fix, or send outcome "approved" if nothing needs fixing.');
                }
                this.recordInterWorkerMessage(l);
                this.deliverInterWorkerMessage({
                    kind: 'findings',
                    fromId: l.record.id,
                    fromName: l.record.name,
                    toId: reviewingId,
                    toName: target.record.name,
                    findings,
                    outcome,
                    note: typeof args.note === 'string' ? args.note : undefined,
                    createdAt: new Date().toISOString(),
                });
                if (outcome !== 'changes_requested') {
                    l.reviewOutcome = outcome;
                    return ok(`Sent your decision to ${target.record.name}. The review ends when this turn does.`);
                }
                return ok(`Sent ${findings.length} finding(s) to ${target.record.name}. They will ask for a re-check once fixed.`);
            }
            case 'ready_for_recheck': {
                if (!isBeingReviewed)
                    return err('You do not have a reviewer assigned.');
                if (this.isRateLimited(l))
                    return err('Rate limit reached. Wait a moment before sending more messages.');
                const asked = this.askForRecheck(l, typeof args.note === 'string' ? args.note : undefined);
                return asked.ok ? ok(asked.text) : err(asked.text);
            }
            case 'tell_pam': {
                if (isPam)
                    return err('You are the assistant.');
                const pam = this.live.get(PAM_ID);
                if (!pam)
                    return err('the assistant is not at reception right now.');
                const message = typeof args.message === 'string' ? args.message.trim() : '';
                if (!message)
                    return err('Say what you want to tell the assistant.');
                if (this.isRateLimited(l))
                    return err('Rate limit reached. Wait a moment before sending more messages.');
                this.recordInterWorkerMessage(l);
                this.deliverInterWorkerMessage({
                    kind: 'tell_pam',
                    fromId: l.record.id,
                    fromName: l.record.name,
                    toId: PAM_ID,
                    toName: 'the assistant',
                    note: message,
                    createdAt: new Date().toISOString(),
                });
                return ok('Told the assistant.');
            }
            case 'message_worker': {
                const ref = typeof args.worker_id === 'string' ? args.worker_id.trim() : '';
                const message = typeof args.message === 'string' ? args.message.trim() : '';
                if (!ref)
                    return err('Specify which worker to message (worker_id).');
                if (!message)
                    return err('Provide a message to send.');
                const target = this.findWorker(ref);
                if (typeof target === 'string')
                    return err(target);
                if (target.record.id === l.record.id)
                    return err('You cannot message yourself.');
                const workerId = target.record.id;
                if (this.isRateLimited(l))
                    return err('Rate limit reached. Wait a moment before sending more messages.');
                // the assistant coordinates the office; everyone else needs the user's @-mention (or a message to reply to).
                if (!isPam && !this.consumeAtPermission(l.record.id, workerId)) {
                    return err(`You do not have permission to message ${target.record.name}. Ask the user to mention them with @ in your chat, or use tell_pam to have the assistant pass it on.`);
                }
                this.recordInterWorkerMessage(l);
                this.deliverInterWorkerMessage({
                    kind: 'handoff',
                    fromId: l.record.id,
                    fromName: l.record.name,
                    toId: workerId,
                    toName: target.record.name,
                    note: message,
                    files: Array.isArray(args.files) ? args.files.filter((f) => typeof f === 'string') : undefined,
                    createdAt: new Date().toISOString(),
                });
                return ok(`Sent message to ${target.record.name}.`);
            }
            case 'list_workers': {
                const workers = this.listAgents()
                    .filter((a) => a.id !== l.record.id) // Exclude self
                    .map((a) => `- ${a.name} (${a.id}): ${displayKey(a.ticketKey)} - ${a.status}`);
                if (!workers.length)
                    return ok('No other workers are currently in the office.');
                return ok(`Current workers:\n${workers.join('\n')}`);
            }
            case 'remember': {
                if (isPam)
                    return err('the assistant does not save memories.');
                const lesson = typeof args.lesson === 'string' ? args.lesson.trim() : '';
                if (!lesson)
                    return err('Provide a lesson to remember.');
                if (lesson.length > 2000)
                    return err('Lesson is too long. Keep it under 2000 characters.');
                const repo = l.record.repoPath;
                if (!repo)
                    return err('Cannot save memories without a repo.');
                const validWorkerKinds = ['convention', 'gotcha', 'correction'];
                const givenKind = validWorkerKinds.includes(args.kind)
                    ? args.kind
                    : undefined;
                const kind = givenKind ?? 'convention';
                const givenFiles = Array.isArray(args.files)
                    ? args.files.filter((f) => typeof f === 'string')
                    : undefined;
                const files = givenFiles ?? [];
                const updateId = args.update_id === undefined || args.update_id === null ? null : Number(args.update_id);
                if (updateId !== null) {
                    if (!Number.isInteger(updateId))
                        return err('update_id must be a memory id number.');
                    // A worker may only rewrite its own repo's memories.
                    const existing = this.repos.memory.get(updateId);
                    if (!existing || existing.repo !== repo)
                        return err(`No memory #${updateId} for this repo.`);
                    // Review lessons and Operator's own keep their author's name, so a worker's words can't go under it.
                    if (existing.source !== 'worker') {
                        return err(`Memory #${updateId} was not saved by a worker, so it can't be updated. Save your lesson as a new memory instead.`);
                    }
                }
                // The brain by the worker's name shows this, so there is no toast.
                return this.usingMemory(l.record.id, 'saving', async () => {
                    try {
                        if (updateId !== null) {
                            // Kind and files the worker left out stay as they were.
                            const updated = await this.repos.memory.update(updateId, { lesson, kind: givenKind, files: givenFiles });
                            if (!updated)
                                return err(`No memory #${updateId} for this repo.`);
                            return ok(`Updated memory #${updated.id}: "${truncate(lesson, 80)}"`);
                        }
                        // Check for related memories to avoid duplicates
                        const related = await this.repos.memory.findRelated(repo, lesson, 0.85);
                        if (related.length > 0) {
                            // Show the worker the related memories so it can update one
                            const relatedList = related.map((m) => `- [id=${m.id}] ${m.lesson}`).join('\n');
                            return ok(`Found related memories:\n${relatedList}\n\nIf your lesson replaces or refines one of these, call remember again with the full new lesson and update_id set to that memory's id. If none of them cover it, reword the lesson so it is clearly distinct.`);
                        }
                        const memory = await this.repos.memory.save(repo, { lesson, kind, files }, 'worker', {
                            workerId: l.record.id,
                            workerName: l.record.name,
                            ticketKey: l.record.ticketKey,
                        });
                        return ok(`Saved memory #${memory.id}: "${truncate(lesson, 80)}"`);
                    }
                    catch (e) {
                        return err(`Failed to save memory: ${e.message}`);
                    }
                });
            }
            case 'recall': {
                if (isPam)
                    return err('the assistant does not use memories.');
                const query = typeof args.query === 'string' ? args.query.trim() : '';
                if (!query)
                    return err('Provide a query to search for.');
                const repo = l.record.repoPath;
                if (!repo)
                    return err('Cannot search memories without a repo.');
                const files = Array.isArray(args.files)
                    ? args.files.filter((f) => typeof f === 'string')
                    : [];
                return this.usingMemory(l.record.id, 'reading', async () => {
                    try {
                        const { memories, formatted } = await recallMemories(this.repos.memory, repo, query, files);
                        // Record usage for tracking
                        if (memories.length > 0) {
                            this.repos.memory.recordUsage(memories.map((m) => m.memory.id), l.record.id, l.record.ticketKey);
                        }
                        return ok(formatted);
                    }
                    catch (e) {
                        return err(`Memory search failed: ${e.message}`);
                    }
                });
            }
            default:
                return err(`Unknown office tool: ${name}`);
        }
    }
    /* ---------- runner events ---------- */
    wire(l) {
        const runner = l.runner;
        runner.onEvent((event) => {
            // A runner that has been replaced can still report its own shutdown.
            if (l.runner !== runner)
                return;
            try {
                this.onRunnerEvent(l, event);
            }
            catch (err) {
                console.error('[agents] event handling failed:', err.message);
            }
        });
    }
    onRunnerEvent(l, event) {
        // A new command list is the CLI describing itself, not a sign the turn is moving.
        if (event.kind !== 'raw' && event.kind !== 'commands' && event.kind !== 'menu') {
            l.lastEventAt = Date.now();
            if (event.kind !== 'thinking')
                l.thinking = false;
        }
        if (l.record.status === 'working')
            this.watch(l);
        switch (event.kind) {
            case 'session':
                l.record.chatId = event.chatId;
                // Written together. Saving the new id under the old runner would make
                // the next boot try to resume a Claude session as a Cursor one.
                l.record.runnerMode = l.runner.mode;
                // A chat now exists, and it was started with the brief.
                l.record.needsBrief = false;
                this.repos.updateAgent(l.record.id, { chatId: event.chatId, runnerMode: l.runner.mode, needsBrief: false });
                // Onto the conversation too, which is what reopening it resumes.
                this.repos.setConversationChatId(l.record.conversationId, event.chatId);
                break;
            case 'commands':
                // Saved, so the `/` menu has them after a restart, before any session
                // starts. An empty list is a session that has not said yet, so it
                // never clears the saved one; switching runners does that.
                if (event.commands.length && JSON.stringify(event.commands) !== JSON.stringify(l.record.commands ?? [])) {
                    l.record.commands = event.commands;
                    this.repos.updateAgent(l.record.id, { commands: event.commands });
                }
                this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
                break;
            case 'model':
            case 'menu':
                this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
                break;
            case 'background':
                // The CLI goes silent until they are all done, so the bubble says
                // what it is waiting on rather than the last step it took.
                if (l.record.status === 'working') {
                    this.setBubble(l, event.agents.length ? waitingOnAgents(event.agents.length) : 'Going through what they found');
                }
                this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
                break;
            case 'raw':
                this.pushStream(l, event.line);
                break;
            case 'text_delta':
                l.turnText += event.text;
                this.bus.emit({ type: 'agent.message.delta', agentId: l.record.id, text: event.text });
                if (l.record.status === 'starting')
                    this.setStatus(l, 'working', l.record.bubble);
                this.setActivity(l, 'typing');
                break;
            case 'thinking':
                if (l.record.status === 'working') {
                    this.setBubble(l, 'Thinking it over');
                    this.setActivity(l, 'thinking');
                }
                // Not kept for a turn the CLI started by itself, as Claude Code does
                // when a background command finishes: nothing shows it, and it would
                // turn up under the next turn Operator starts.
                if (event.text && (l.record.status === 'working' || l.record.status === 'starting')) {
                    l.thought = (l.thinking ? (l.thought ?? '') : '') + event.text;
                    l.thinking = true;
                }
                // Sent even with nothing new to show. Thinking can go on for minutes,
                // and the bubble above does not change while it does, so without this
                // the panel hears nothing and calls the worker quiet.
                this.sendThought(l);
                break;
            case 'tool_start':
                // A step that starts after the turn has ended will never end, and it
                // would turn a worker who is waiting on Operator back to working.
                if (!l.runner.isBusy && l.record.status !== 'starting')
                    break;
                l.record.runningSince = new Date().toISOString();
                // A step of its own says what it is doing; the rest is out of date.
                this.clearThought(l);
                this.clearCommands(l);
                // While agents it sent off are out, the steps are mostly theirs and
                // the bubble keeps saying what the worker is waiting on.
                if (!l.runner.backgroundAgents.length)
                    this.setBubble(l, event.label, event.plain);
                // The bubble is set just above, with its plain words; the status
                // change must not set it again without them.
                if (l.record.status === 'starting' || l.record.status === 'idle') {
                    this.setStatus(l, 'working');
                }
                // After the status: a turn starting resets the activity to thinking.
                this.setActivity(l, activityForTool(event.tool, event.input, event.label));
                // Also into the transcript. The bubble floats over a worker's head in
                // the office and is gone a second later; the chat is the only place
                // Operator can see what it actually did, and it was showing nothing at all
                // between his message and the eventual answer.
                if (event.label !== l.lastTool) {
                    l.lastTool = event.label;
                    this.say(l.record.id, 'tool', event.label, [], event.plain);
                }
                break;
            case 'tool_end':
                l.record.runningSince = null;
                // What it printed. The CLI hands the whole of stdout over at once when
                // the command ends and says nothing before then, so this is the only
                // place the output can appear at all.
                if (event.output)
                    this.say(l.record.id, 'output', event.output);
                // Always published, output or not: a message does not carry the record,
                // so without this the panel would go on counting against a tool that
                // had already finished.
                this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
                break;
            case 'permission_request': {
                if (this.answerable(l, event.request)) {
                    this.answerWithoutAsking(l, event.request);
                    break;
                }
                this.raiseHand(l, event.request);
                break;
            }
            case 'permission_resolved': {
                const shown = l.pending[0]?.id === event.requestId;
                l.pending = l.pending.filter((p) => p.id !== event.requestId);
                if (shown)
                    this.bus.emit({ type: 'agent.permission', agentId: l.record.id, request: l.pending[0] ?? null });
                break;
            }
            case 'question_request':
                l.question = event.request;
                recordMoment(this.repos, 'question', l.record.id);
                this.setStatus(l, 'needs_you', truncateLabel(event.request.title, 46));
                this.bus.emit({ type: 'agent.question', agentId: l.record.id, request: event.request });
                this.bus.toast(`${l.record.name} has a question: ${truncateLabel(event.request.title, 80)}`, 'needs_you', l.record.id);
                break;
            case 'question_resolved':
                if (l.question?.id !== event.requestId)
                    break;
                l.question = null;
                this.bus.emit({ type: 'agent.question', agentId: l.record.id, request: null });
                if (l.record.status === 'needs_you')
                    this.showNext(l, 'Carrying on without an answer');
                this.showPrAsk(l);
                break;
            case 'turn_end':
                this.onTurnEnd(l);
                break;
            case 'error':
                // warmCommands() handles its own failure, without the error state.
                if (l.warming)
                    break;
                this.fail(l, event.message);
                break;
        }
    }
    /** Puts a request in front of Operator, or in line behind the one already there. */
    raiseHand(l, request) {
        l.pending.push(request);
        if (l.pending.length > 1)
            return;
        recordMoment(this.repos, 'question', l.record.id);
        this.setStatus(l, 'needs_you', truncateLabel(request.title, 46));
        this.bus.emit({ type: 'agent.permission', agentId: l.record.id, request });
        this.bus.toast(`${l.record.name} needs you: ${this.said(request)}`, 'needs_you', l.record.id);
    }
    /**
     * An Ask is named after its first line, which is often not what the chat
     * turns out to be about. Its title follows the conversation instead.
     * Tickets keep their tracker's title, and the branch and worktree keep the
     * first one, so nothing in git moves under the worker.
     */
    maybeRetitle(l) {
        const { record } = l;
        if (!this.retitle || l.retitling || !isAsk(record))
            return;
        const said = l.typed ?? 0;
        if (!retitleDue(said) || l.retitledAt === said)
            return;
        l.retitling = true;
        l.retitledAt = said;
        const conversationId = record.conversationId;
        // This chat's own title: after New chat the card still has the last one's.
        const current = this.repos.getConversation(record.id, conversationId)?.title || record.ticketSummary;
        void this.retitle(retitlePrompt(current, this.repos.listMessages(conversationId)))
            .then((raw) => {
            const title = cleanTitle(raw);
            // Fired, or moved to another conversation, while the runner thought.
            if (!title || title === current || this.live.get(record.id) !== l || record.conversationId !== conversationId)
                return;
            record.ticketSummary = title;
            this.repos.updateAgent(record.id, { ticketSummary: title });
            this.repos.renameConversation(conversationId, title);
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        })
            .catch(() => undefined)
            .finally(() => {
            l.retitling = false;
        });
    }
    /** A worker moved to another chat. The retitle schedule counts that chat's messages, from its first. */
    changedConversation(l) {
        l.typed = 0;
        l.retitledAt = 0;
    }
    onTurnEnd(l) {
        const text = l.turnText.trim();
        l.turnText = '';
        l.lastTool = null;
        // Nothing from the turn outlives it. A request the agent stopped waiting
        // for left an Allow button in the panel with nothing on the other end —
        // Ada had one sitting there forty-seven minutes after she had moved on —
        // and a tool that never reported finishing left the clock running.
        l.record.runningSince = null;
        this.clearThought(l);
        this.clearCommands(l);
        this.setActivity(l, 'idle');
        if (l.pending.length) {
            this.clearPending(l);
            this.bus.emit({ type: 'agent.permission', agentId: l.record.id, request: null });
        }
        if (l.question) {
            l.question = null;
            this.bus.emit({ type: 'agent.question', agentId: l.record.id, request: null });
        }
        this.showPrAsk(l);
        this.flushStream(l);
        // The CLI can end a turn on its own failed request, after whatever the
        // worker had said. That is an error to retry, not part of what it said.
        // A reviewer that sent its decision this turn is done, so it still goes home.
        const failed = splitRunnerError(text);
        const said = failed ? failed.said : text;
        if (said)
            this.say(l.record.id, 'agent', said);
        if (failed && !l.reviewOutcome) {
            this.fail(l, failed.error);
            return;
        }
        this.maybeRetitle(l);

        if (l.reviewOutcome) {
            void this.dismissReviewer(l.record.id, l.reviewOutcome);
            return;
        }
        // A message typed mid-turn becomes the next turn. It was recorded when it
        // was typed, so it is only sent here.
        const next = l.queued.shift();
        if (next !== undefined) {
            if (next.forOperator)
                l.replyToOperator = true;
            void l.runner.prompt(next.text, next.files).catch((err) => this.fail(l, err.message));
            this.setStatus(l, 'working', 'Picking up your note');
            return;
        }
        // Workers forget to call ready_for_recheck, and the reviewer would wait forever.
        if (l.record.status === 'fixing_findings')
            this.askForRecheck(l, text ? truncate(text, 600) : undefined);
        const asking = endsWithQuestion(text);
        // the assistant never opens PRs. A link in her reply is one she is relaying for a worker.
        const prUrl = l.record.builtInPam ? null : findPullRequestUrl(text);
        if (prUrl && prUrl !== l.record.prUrl) {
            // The worker has moved on from the old PR, so its problems are no longer the worker's to fix.
            if (l.record.prUrl)
                this.prWatcher?.unwatch(l.record.prUrl, l.record.id);
            l.record.prUrl = prUrl;
            this.repos.updateAgent(l.record.id, { prUrl });
            this.track('pr_opened', l.record);
            this.bus.toast(`${l.record.name} opened a PR for ${displayKey(l.record.ticketKey)}.`, 'done', l.record.id);
            // Start watching this PR for problems (failed checks, conflicts, comments).
            // The first poll drops it if it is not on the worker's branch.
            this.prWatcher?.watch(l.record.id, l.record.name, prUrl, l.record.branch);
            void this.ensurePrFooter(l.record, prUrl);
            // Trigger auto-review if enabled and this worker doesn't already have a reviewer
            if (!l.record.reviewerId && !l.record.reviewingId) {
                void this.maybeAutoReview(l.record.id);
            }
        }
        if (prUrl && !asking) {
            // Don't go to 'review' if we're waiting for/in a review
            if (!l.record.reviewerId) {
                this.setStatus(l, 'review', 'PR ready for review');
            }
            return;
        }
        // A shaping Planner's draft goes to the Idea board, which sends it home.
        const ticketDraft = l.record.kind === 'research' && this.onTicketDraft ? extractTicketDraft(text) : null;
        if (ticketDraft) {
            this.rest(l, 'Ticket draft written', false);
            this.onTicketDraft?.(l.record.id, ticketDraft);
            return;
        }
        const workPlan = l.record.branch || !l.record.repoPath || l.record.kind === 'research' ? null : extractWorkPlan(text);
        if (workPlan) {
            l.record.workPlan = workPlan;
            this.repos.updateAgent(l.record.id, { workPlan });
            if (this.autoStarts(l)) {
                void this.startWork(l.record.id).catch((err) => this.fail(l, err.message));
                return;
            }
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
            this.setStatus(l, 'needs_you', 'Wants to start work');
            this.bus.toast(`${l.record.name} has a plan for ${displayKey(l.record.ticketKey)} and wants to start work.`, 'needs_you', l.record.id);
            return;
        }
        // Try to parse as a question with clickable choices first
        const questionWithChoices = extractQuestionWithChoices(text);
        if (questionWithChoices) {
            l.question = questionWithChoices;
            this.setStatus(l, 'needs_you', truncateLabel(questionWithChoices.title, 46));
            this.bus.emit({ type: 'agent.question', agentId: l.record.id, request: questionWithChoices });
            this.bus.toast(`${l.record.name} has a question: ${truncateLabel(questionWithChoices.title, 80)}`, 'needs_you', l.record.id);
            return;
        }
        // Fall back to plain text question detection
        const question = extractQuestion(text);
        if (question) {
            this.setStatus(l, 'needs_you', truncate(question, 46));
            this.bus.toast(`${l.record.name} has a question about ${displayKey(l.record.ticketKey)}.`, 'needs_you', l.record.id);
            return;
        }
        if (l.record.status === 'done')
            return;
        this.rest(l, text ? truncateLabel(text.split('\n')[0] ?? 'Waiting on you', 46) : 'Waiting on you', !asking);
    }
    /**
     * Parks a worker with nothing to do.
     *
     * One with a PR open belongs at 'review' rather than 'idle', because the
     * open PR is the durable fact and 'idle' takes the Mark done button away
     * with it. Ending a turn, being stopped, and changing conversation each had
     * to learn this separately, so now none of them decides it.
     */
    rest(l, bubble, offerDone = true) {
        const reviewer = l.record.reviewerId ? this.live.get(l.record.reviewerId) : undefined;
        if (reviewer)
            this.setStatus(l, 'in_review', `${reviewer.record.name} is reviewing`);
        else if (l.record.prUrl && offerDone)
            this.setStatus(l, 'review', 'PR ready for review');
        else
            this.setStatus(l, 'idle', bubble);
    }
    setStatus(l, status, bubble) {
        const changed = l.record.status !== status;
        l.record.status = status;
        // Kept in step with what is saved, so the event and view() drop the error
        // banner too, not just the database.
        if (status !== 'error') {
            l.record.lastError = null;
            l.record.errorType = null;
            l.record.errorAction = null;
        }
        if (changed) {
            this.repos.updateAgent(l.record.id, {
                status,
                lastError: l.record.lastError,
                errorType: l.record.errorType,
                errorAction: l.record.errorAction,
            });
            this.bus.emit({
                type: 'agent.status',
                agentId: l.record.id,
                status,
                lastError: l.record.lastError,
                errorType: l.record.errorType,
                errorAction: l.record.errorAction,
            });
        }
        if (bubble)
            this.setBubble(l, bubble);
        if (status === 'working')
            this.watch(l);
        else
            this.stopWatching(l);
        if (status !== 'working' && status !== 'starting')
            this.clearThought(l);
        // needs_you is either half: a request in the middle of a turn, or a
        // question at the end of one, which onTurnEnd has already set idle.
        // Review-related statuses are also idle states (waiting for review, etc.)
        const idleStatuses = ['idle', 'review', 'error', 'done', 'awaiting_review', 'in_review'];
        if (idleStatuses.includes(status)) {
            this.setActivity(l, 'idle');
        }
        else if (status !== 'needs_you' && l.record.activity === 'idle') {
            this.setActivity(l, 'thinking');
        }
    }
    setActivity(l, activity) {
        if (l.record.activity === activity)
            return;
        l.record.activity = activity;
        this.bus.emit({ type: 'agent.activity', agentId: l.record.id, activity });
    }
    /** `plain` is the bubble in everyday words, for a tool step; other bubbles are plain already. */
    setBubble(l, bubble, plain = null) {
        if (l.record.bubble === bubble && (l.record.bubblePlain ?? null) === plain)
            return;
        l.record.bubble = bubble;
        l.record.bubblePlain = plain;
        this.repos.updateAgent(l.record.id, { bubble });
        this.bus.emit({ type: 'agent.bubble', agentId: l.record.id, bubble, plain });
    }
    track(name, agent, extra = {}) {
        emitTracking(this.bus, this.repos, { ...(agent ? factFromAgent(agent) : {}), ...extra, name });
    }
    fail(l, error) {
        const classified = classifyRunnerError(l.record.runnerMode, error);
        if (this.moveReviewToWorkerRunner(l, classified))
            return;
        // Kept from the first failure, so a Retry that fails too still remembers.
        if (l.record.status !== 'error')
            l.failedFixing = l.record.status === 'fixing_findings';
        l.record.lastError = classified.message;
        l.record.errorType = classified.type;
        l.record.errorAction = classified.action;
        this.repos.updateAgent(l.record.id, {
            lastError: classified.message,
            errorType: classified.type,
            errorAction: classified.action,
        });
        this.setStatus(l, 'error', classified.shortMessage);
        this.bus.toast(`${l.record.name} hit an error: ${truncate(classified.message, 90)}`, 'error', l.record.id);
        this.track('worker_errored', l.record, { result: 'error' });

    }
    /** Sends on what the worker is thinking, at most once every THOUGHT_EVERY_MS and always the latest of it. */
    sendThought(l) {
        const wait = (l.thoughtSentAt ?? 0) + THOUGHT_EVERY_MS - Date.now();
        if (wait > 0) {
            if (l.thoughtTimer)
                return;
            l.thoughtTimer = setTimeout(() => {
                l.thoughtTimer = null;
                this.sendThought(l);
            }, wait);
            l.thoughtTimer.unref();
            return;
        }
        l.thoughtSentAt = Date.now();
        this.bus.emit({ type: 'agent.thought', agentId: l.record.id, text: thoughtTail(l.thought) });
    }
    clearThought(l) {
        if (l.thoughtTimer)
            clearTimeout(l.thoughtTimer);
        l.thoughtTimer = null;
        l.thinking = false;
        if (!l.thought)
            return;
        l.thought = '';
        this.bus.emit({ type: 'agent.thought', agentId: l.record.id, text: null });
    }
    /** Starts checking on a working worker, unless that is already happening. */
    watch(l) {
        if (l.lookTimer || l.record.builtInPam)
            return;
        l.lookTimer = setInterval(() => void this.lookAround(l), LOOK_EVERY_MS);
        l.lookTimer.unref();
    }
    stopWatching(l) {
        if (l.lookTimer)
            clearInterval(l.lookTimer);
        l.lookTimer = null;
        this.clearCommands(l);
    }
    clearCommands(l) {
        if (!l.commands?.length)
            return;
        l.commands = [];
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
    }
    /** What `ps` says a CLI is running. Its own field, so a test can stand in for `ps`. */
    listCommands = runningCommands;
    /**
     * Looks at what a silent worker has running, for the panel to show instead
     * of calling it quiet. A command sent to the background reports as done,
     * and the CLI then waits on it without a word; `ps` is the only place it
     * shows. Only while no step is running, since a running step already says
     * what the wait is for, and only once the silence has gone on a while.
     */
    async lookAround(l) {
        if (this.live.get(l.record.id) !== l || l.record.status !== 'working') {
            this.stopWatching(l);
            return;
        }
        if (l.looking || !l.runner.isBusy || l.record.runningSince || l.runner.backgroundAgents.length)
            return;
        // Once something has turned up it is kept current, whatever else is heard.
        if (!l.commands?.length && Date.now() - l.lastEventAt < LOOK_AFTER_MS)
            return;
        l.looking = true;
        try {
            const { pid } = await l.runner.probe();
            const found = pid ? await this.listCommands(pid, CLI_SHAPES[l.runner.mode]).catch(() => []) : [];
            // A step started, or the turn ended, while ps ran.
            if (!l.lookTimer || l.record.runningSince)
                return;
            const now = Date.now();
            const before = new Map((l.commands ?? []).map((c) => [c.command, c]));
            // Kept from the last look when it is the same command, so its clock does not jump by ps's rounding.
            const commands = found.map((c) => ({
                command: c.command,
                since: before.get(c.command)?.since ?? new Date(now - c.seconds * 1000).toISOString(),
                cpu: c.cpu,
            }));
            if (JSON.stringify(commands) === JSON.stringify(l.commands ?? []))
                return;
            l.commands = commands;
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        }
        finally {
            l.looking = false;
        }
    }
    /** Batches stream lines on a short timer; a chatty turn is otherwise a flood. */
    pushStream(l, line) {
        l.streamBatch.push(line);
        if (l.streamTimer)
            return;
        l.streamTimer = setTimeout(() => this.flushStream(l), 120);
        l.streamTimer.unref();
    }
    flushStream(l) {
        if (l.streamTimer) {
            clearTimeout(l.streamTimer);
            l.streamTimer = null;
        }
        if (!l.streamBatch.length)
            return;
        const lines = l.streamBatch;
        l.streamBatch = [];
        this.repos.appendStream(l.record.id, lines);
        this.bus.emit({ type: 'agent.stream', agentId: l.record.id, lines });
    }
    /* ---------- commands ---------- */
    /**
     * Starts the session of an idle worker that has no `/` commands to show, so
     * the CLI lists them without Operator having to send a message first. Nothing is
     * prompted and the status is left alone.
     *
     * Only a worker with a chat to load: one without has a brief still to read,
     * and wake() is what sends it.
     */
    async warmCommands(agentId) {
        const l = this.need(agentId);
        if (l.warming || l.handoff || !l.record.chatId)
            return;
        if (l.runner.isStarted || l.runner.isBusy || l.record.status === 'starting' || l.record.status === 'error')
            return;
        if (l.runner.commands.length || l.record.commands?.length)
            return;
        this.attachRunner(l, l.record.chatId);
        this.wire(l);
        const runner = l.runner;
        // Started a tick later, so l.warming is set before anything it reports.
        l.warming = Promise.resolve()
            .then(() => runner.start())
            .then(() => {
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        })
            .catch(async (err) => {
            // Nothing Operator asked for, so the worker stays idle rather than going
            // red, and the next message starts it the usual way.
            console.warn(`[agents] could not start ${l.record.name} to list its commands:`, err.message);
            await runner.dispose().catch(() => { });
        })
            .finally(() => {
            l.warming = null;
        });
        await l.warming;
    }
    /** Anything about to start a session waits for warmCommands() to finish its own. */
    async settled(l) {
        if (l.warming)
            await l.warming;
    }
    /**
     * `forOperator` is a message the remote operator sent in the user's voice;
     * the turn that answers it goes back to the Operator through onOperatorReply.
     */
    async sendMessage(agentId, text, uploads, opts = {}) {
        const forOperator = false;
        const l = this.need(agentId);
        // The new agent's first brief carries the handoff, so it has to be written first.
        if (l.handoff)
            await l.handoff;
        await this.settled(l);
        const trimmed = text.trim();
        const dir = uploadsDir(agentId);
        const attachments = saveUploads(dir, uploads);
        if (!trimmed && !attachments.length)
            return;
        l.typed = (l.typed ?? 0) + 1;
        this.track('message_sent', l.record);
        if (attachments.length)
            this.track('attachment_sent', l.record, { count: attachments.length });
        const files = attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, path: join(dir, a.file) }));
        // A conversation is named after the first thing said in it, which is how
        // the History menu reads as a list of subjects rather than timestamps.
        this.repos.nameConversationIfUnnamed(l.record.conversationId, firstLine(trimmed || attachments.map((a) => a.name).join(', '), 60));
        if (l.record.workPlan) {
            l.record.workPlan = null;
            this.repos.updateAgent(agentId, { workPlan: null });
        }
        // Workers adopted from an existing worktree, and workers restored after a
        // restart, are seated without a process. Operator typing to one is as good a
        // reason to start it as pressing Resume.
        const mentioned = this.mentionedIn(agentId, trimmed);
        for (const w of mentioned)
            if (!w.record.builtInPam)
                this.grantAtPermission(agentId, w.record.id);
        const identity = l.record.builtInPam ? `Your current receptionist name is ${JSON.stringify(l.record.name)}. Use this name when asked about your identity.\n\n` : '';
        const prompt = identity + this.takeReposNote(l) + trimmed + this.mentionNote(l, mentioned);
        if (l.waking)
            await l.waking;
        if (!l.runner.isStarted && !l.waking) {
            await this.wake(l, prompt, attachments, files, trimmed, forOperator);
            return;
        }
        // A second message sent while the first is still waking the worker would
        // otherwise start a second CLI over the first, and its "not started"
        // put a worker that is working in error.
        if (l.runner.isBusy || l.waking) {
            // Recorded now rather than when it is finally delivered: the transcript
            // should show what Operator said at the moment he said it. The chip under it
            // is what says the worker has not read it yet.
            this.say(agentId, 'you', trimmed, attachments);
            l.queued.push({ text: prompt, files, forOperator });
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
            return;
        }
        this.say(agentId, 'you', trimmed, attachments);
        l.turnText = '';
        if (forOperator)
            l.replyToOperator = true;
        await l.runner.prompt(prompt, files);
        this.setStatus(l, 'working', 'Reading your message');
    }
    /**
     * Starts a session for a seated worker that has no process, then delivers
     * the message that woke it.
     *
     * The runner is rebuilt on the stored chat id so the conversation continues
     * instead of starting over. A worker that has never been briefed gets the
     * brief first, and the message lands as the next turn.
     *
     * `shown` is what the transcript records: Operator's words when the agent is told
     * more than he typed, or null when the message is already there.
     */
    async wake(l, text, attachments = [], files = [], shown = text, forOperator = false) {
        const needsBrief = (l.record.adopted || l.record.builtInPam || !!l.record.needsBrief) && !l.record.chatId;
        let said;
        l.waking = new Promise((resolve) => { said = resolve; });
        try {
            await l.runner.dispose().catch(() => { });
            this.attachRunner(l, l.record.chatId);
            l.record.lastError = null;
            l.record.errorType = null;
            l.record.errorAction = null;
            this.clearPending(l);
            l.question = null;
            this.showPrAsk(l);
            l.turnText = '';
            this.wire(l);
            this.setStatus(l, 'starting', needsBrief ? 'Catching up on the ticket' : 'Waking up');
            // Both go into the transcript before the CLI boots, which takes seconds.
            // Operator should see what he typed the moment he sends it, not once the agent
            // is ready to read it. The brief goes first because the agent reads it
            // first.
            const brief = needsBrief
                ? this.briefFor(l.record, l.record.builtInPam ? pamBrief(l.record.name) : await this.resumePrompt(l, true))
                : null;
            if (brief)
                this.say(l.record.id, 'brief', brief);
            if (shown !== null)
                this.say(l.record.id, 'you', shown, attachments);
            said();
            try {
                await l.runner.start();
                if (brief) {
                    // Queued rather than sent: onTurnEnd delivers it once the brief lands.
                    // Ahead of anything sent while the worker was waking.
                    l.queued.unshift({ text, files, forOperator });
                    await l.runner.prompt(brief);
                    this.setStatus(l, 'working', 'Reading the ticket');
                }
                else {
                    if (forOperator)
                        l.replyToOperator = true;
                    await l.runner.prompt(text, files);
                    this.setStatus(l, 'working', 'Reading your message');
                }
                this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
            }
            catch (err) {
                this.fail(l, err.message);
            }
        }
        finally {
            said();
            l.waking = null;
        }
    }
    async answerPermission(agentId, requestId, allow, scope = 'once') {
        const l = this.need(agentId);
        const request = l.pending.find((p) => p.id === requestId);
        if (!request)
            return;
        // Name what was approved. The request box disappears once it is answered,
        // so a bare "Approved." left no record of what Operator had agreed to.
        const what = request.title;
        const rule = allow && scope === 'always' ? request.rule : null;
        // Recorded before the answer goes back, so the next request this unblocks
        // is already covered by it.
        if (rule) {
            for (const grant of grantsFor(rule))
                this.repos.addGrant(grant.key, grant.label);
            this.grants = this.repos.listGrants();
        }
        // Taken off first, so the runner reporting it resolved has nothing to do.
        l.pending = l.pending.filter((p) => p !== request);
        // The CLI only ever hears "once". The standing part is the office's, which
        // is what keeps it revocable.
        const office = this.officeAsks.get(requestId);
        if (office) {
            this.officeAsks.delete(requestId);
            office(allow);
        }
        else {
            await l.runner.answerPermission(requestId, allow);
        }
        this.say(agentId, 'you', !allow
            ? `Denied: ${what}. Find another way.`
            : rule
                ? `Approved: ${what}. Go ahead with ${rule.label} from now on.`
                : `Approved: ${what}`);
        // The approval just given may cover requests that arrived alongside this
        // one, and requests at other desks. Whatever is left here is the next to
        // ask about.
        if (rule) {
            this.answerCovered(l);
            for (const other of this.live.values())
                if (other !== l)
                    this.letThrough(other);
        }
        // Named rather than 'Back to it', which overwrote the running command in
        // the bubble and the live chip with nothing at all useful — and did it at
        // the start of the one stretch where the panel has nothing else to show.
        this.showNext(l, allow ? truncateLabel(what, 46) : 'Trying another way');
        if (rule)
            this.publishGrants();
        this.track('permission_answered', l.record, { result: !allow ? 'denied' : rule ? 'always' : 'allowed' });
    }
    async answerQuestion(agentId, requestId, answers) {
        const l = this.need(agentId);
        const request = l.question;
        if (request?.id !== requestId)
            return;
        l.question = null;
        // the assistant's rehire questions are the office's, not her runner's.
        const ask = l.record.builtInPam ? [...this.prAsks.values()].find((a) => a.request.id === requestId) : undefined;
        if (ask) {
            this.prAsks.delete(ask.agentId);
            this.bus.emit({ type: 'agent.question', agentId, request: null });
            this.say(agentId, 'you', describeAnswer(request, answers));
            this.showPrAsk(l);
            if (answers?.rehire?.picks.includes('rehire'))
                await this.rehireForPr(ask);
            return;
        }
        // A question read out of the agent's reply ended its turn, and its runner
        // never asked it, so nothing is waiting on the answer. The answer goes to
        // the agent as Operator's message, the same way as anything he types. A skip
        // tells the agent nothing and leaves the worker resting.
        if (isTextQuestion(request)) {
            this.bus.emit({ type: 'agent.question', agentId, request: null });
            this.showPrAsk(l);
            const said = answerText(request, answers);
            if (said)
                await this.sendMessage(agentId, said);
            else
                this.rest(l, 'Question skipped');
            return;
        }
        await l.runner.answerQuestion(requestId, answers);
        this.bus.emit({ type: 'agent.question', agentId, request: null });
        this.say(agentId, 'you', describeAnswer(request, answers));
        this.showNext(l, answers ? 'Carrying on with your answer' : 'Carrying on without an answer');
        this.showPrAsk(l);
    }
    /**
     * Turns auto mode on or off. Turning it on also lets through everything
     * already waiting, so a raised hand goes down without a click.
     */
    setAutoApprove(on) {
        this.cfg.agents.autoApprove = on;
        if (!on)
            return;
        for (const l of this.live.values()) {
            this.letThrough(l);
            if (l.record.workPlan && this.autoStarts(l))
                void this.startWork(l.record.id).catch((err) => this.fail(l, err.message));
        }
    }
    /** Turns automatic review on or off. Asking for a review by hand works either way. */
    setAutoReview(on) {
        this.cfg.agents.autoReview = on;
    }
    /** Turns the "Created by AgentCorp" PR footer on or off. */
    setPrFooter(on) {
        this.cfg.agents.prFooter = on;
    }
    /**
     * Adds the PR footer if the worker left it out. A failure is only logged; the PR is open either way.
     * A reviewer's reply quotes the PR it reviewed, which is not its own, so reviewers are skipped.
     */
    async ensurePrFooter(record, prUrl) {
        if (!this.prWatcher || this.cfg.agents.prFooter === false || record.reviewingId)
            return;
        try {
            if ((await this.prWatcher.ensurePrFooter(prUrl, record.branch)) === 'added') {
                console.log(`[agents] Added the PR footer to ${record.name}'s PR ${prUrl}`);
            }
        }
        catch (err) {
            console.warn(`[agents] Could not add the PR footer to ${prUrl}: ${err.message}`);
        }
    }
    async worktreeName(record) {
        const own = { key: displayKey(record.ticketKey), summary: record.ticketSummary };
        if (record.kind === 'ticket')
            return own;
        const text = record.ticketSummary;
        // Jira links end /browse/KEY, Linear links /issue/KEY/title.
        const linked = new Set([...text.matchAll(/\/(?:browse|issue)\/([A-Z][A-Z0-9]+-\d+)/gi)].map((m) => m[1].toUpperCase()));
        const withoutUrls = text.replace(/https?:\/\/\S+/g, ' ').trim();
        const candidates = [...linked, ...[...withoutUrls.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => m[0])];
        for (const key of new Set(candidates)) {
            const title = await this.trackerTitle(key);
            if (title)
                return { key, summary: title };
            if (linked.has(key))
                return { key, summary: withoutUrls || key };
        }
        return { key: askWorktreeKey(own.key), summary: withoutUrls || own.summary };
    }
    /** The title of an issue in the active tracker, or null when it does not know the key. */
    async trackerTitle(key) {
        try {
            const target = this.sources.resolve(ticketId(this.cfg.tracker, key));
            return (await target.source.get(target.key)).ticket.summary || null;
        }
        catch {
            return null;
        }
    }
    /**
     * Writes the worktree's MCP config, for print mode (which doesn't receive
     * session MCP servers) and for ACP when the factory is enabled.
     */
    writeMcpConfig(record, worktreePath) {
        if (!['acp', 'print'].includes(record.runnerMode))
            return;
        const mcpConfig = buildWorktreeMcpConfig({
            officeUrl: `http://127.0.0.1:${this.cfg.port}/api/mcp/office/${record.id}`,
            sessionHeader: { name: SESSION_HEADER, value: ensureSessionToken() },
            ...(this.cfg.agents.registerFactoryMcp ? {
                factoryUrl: this.cfg.factory.mcpUrl,
                factoryHeaders: this.cfg.factory.headers,
            } : {}),
        });
        writeWorktreeMcpConfig(worktreePath, mcpConfig);
    }
    /** Links the repo's skills and agents into a worktree; a failure is worth a toast, not the job. */
    linkSkills(record, repoName, worktreePath) {
        try {
            syncRepoSkillsToWorktree(repoName, worktreePath);
            writeAgentCopiesToWorktree(repoName, worktreePath);
        }
        catch (err) {
            this.bus.toast(`Could not link ${repoName}'s skills into the worktree: ${err.message}`, 'error', record.id);
        }
    }
    async startWork(agentId) {
        const l = this.need(agentId);
        if (l.record.builtInPam)
            throw new HireError('the assistant delegates work and never creates a worktree.');
        const { workPlan, repoPath, baseBranch } = l.record;
        if (!workPlan || l.record.branch || !repoPath || !baseBranch) {
            throw new HireError(`${l.record.name} has no plan waiting to start.`);
        }
        l.record.workPlan = null;
        // Approved, so the discussion is over: auto mode applies from here on.
        l.record.discuss = false;
        this.repos.updateAgent(agentId, { workPlan: null, discuss: false });
        this.setStatus(l, 'starting', 'Setting up the worktree');
        const existing = await this.existingWorktreeFor(l, repoPath, workPlan);
        const plan = existing
            ? {
                repoPath: expandPath(repoPath),
                repoName: basename(expandPath(repoPath)),
                worktreePath: existing.path,
                branch: existing.branch,
                baseBranch,
            }
            : planWorktree(this.cfg, {
                repoPath,
                ...(await this.worktreeName(l.record)),
                baseBranch,
            });
        try {
            if (existing) {
                this.bus.toast(`${displayKey(l.record.ticketKey)} is carrying on in ${existing.path} (${existing.branch}), not a new worktree.` +
                    (existing.locked
                        ? ' It is locked, so another session may still be working there: check before the worker gets far.'
                        : ''), existing.locked ? 'error' : 'info', agentId);
            }
            else {
                const { fetched } = await createWorktree(plan);
                if (!fetched) {
                    this.bus.toast(`Could not reach origin for ${plan.repoName}, so ${displayKey(l.record.ticketKey)} branched off your local ${plan.baseBranch}.`);
                }
            }
            this.writeMcpConfig(l.record, plan.worktreePath);
        }
        catch (err) {
            l.record.workPlan = workPlan;
            this.repos.updateAgent(agentId, { workPlan });
            this.fail(l, err.message);
            return;
        }
        this.linkSkills(l.record, plan.repoName, plan.worktreePath);
        l.record.worktreePath = plan.worktreePath;
        l.record.branch = plan.branch;
        l.record.baseBranch = plan.baseBranch;
        // An existing worktree is not the office's, so Mark done and Fire leave it.
        l.record.adopted = !!existing;
        this.repos.updateAgent(agentId, {
            worktreePath: plan.worktreePath,
            branch: plan.branch,
            baseBranch: plan.baseBranch,
            adopted: !!existing,
        });
        const target = l.record.kind === 'ticket' ? this.sources.resolve(l.record.ticketKey) : null;
        if (target) {
            target.source.markInProgress(target.key).catch((err) => {
                this.bus.toast(`Could not move ${target.key} to In Progress in ${target.source.name}: ${err.message}`, 'error', agentId);
            });
        }
        await this.settled(l);
        await l.runner.dispose().catch(() => { });
        l.record.chatId = null;
        l.runner = this.makeRunner(l.record, null);
        this.clearPending(l);
        l.question = null;
        l.turnText = '';
        this.wire(l);
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        try {
            const brief = this.briefFor(l.record, await this.workBrief(l, workPlan));
            this.say(agentId, 'brief', brief);
            await l.runner.start();
            await l.runner.prompt(brief);
            this.setStatus(l, 'working', 'Starting on the plan');
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
            this.track('plan_approved', l.record);
            this.track('worker_started', l.record, { result: 'in_progress' });
        }
        catch (err) {
            this.fail(l, err.message);
        }
    }
    /**
     * The worktree an approved plan belongs in when it already exists: the one
     * its `WORKTREE:` line names, by path or branch, or one on the head branch
     * of a pull request either that line or Operator's task links to. Null means
     * make a new one.
     *
     * PR links elsewhere in the plan do not count: a worker citing a PR as an
     * example should not be moved into that PR's worktree.
     */
    async existingWorktreeFor(l, repoPath, workPlan) {
        const hint = extractWorktreeHint(workPlan);
        const isUrl = !!hint && /^https?:/.test(hint);
        // A relative path is read from the repo: the worker planned from a notes
        // folder, so its own cwd says nothing about where `./wt` is.
        const path = hint && !isUrl && /^[~/.]/.test(hint) ? (hint.startsWith('.') ? resolvePath(expandPath(repoPath), hint) : hint) : null;
        const branches = hint && !isUrl && !path ? [hint] : [];
        // Only PRs on this repo: a PR elsewhere that shares a branch name with one
        // here says nothing about where this job's work lives.
        const repo = await githubRepoOf(repoPath);
        const fromPr = new Map();
        for (const url of githubPullUrls(`${hint ?? ''}\n${this.taskOf(l)}`)) {
            if (repo && githubRepoIn(url) !== repo)
                continue;
            const head = await this.prHeadBranch(url);
            if (head && !fromPr.has(head))
                fromPr.set(head, url);
        }
        branches.push(...fromPr.keys());
        if (!path && !branches.length)
            return null;
        const found = await findExistingWorktree(repoPath, { paths: path ? [path] : [], branches });
        const asked = hint ?? [...fromPr.values()].join(', ');
        if (!found) {
            if (hint)
                this.bus.toast(`No worktree of ${basename(repoPath)} matches ${hint}, so ${l.record.name} gets a new one.`, 'info', l.record.id);
            return null;
        }
        if (!found.branch) {
            this.bus.toast(`${found.path} has no branch checked out, so ${l.record.name} gets a new worktree.`, 'info', l.record.id);
            return null;
        }
        // Two workers in one tree would overwrite each other's edits.
        const owner = this.occupiedWorktrees(l.record.id).get(realPath(found.path));
        if (owner) {
            this.bus.toast(`${owner} is already working in ${found.path}, which ${asked} points at, so ${l.record.name} gets a new worktree.`, 'info', l.record.id);
            return null;
        }
        const pr = fromPr.get(found.branch);
        if (pr && found.branch !== hint)
            this.bus.toast(`${found.path} is on ${found.branch}, the head of ${pr}.`, 'info', l.record.id);
        return found;
    }
    /**
     * The real path of every worktree a seated worker is in, to that worker's
     * name, leaving out `exceptId`. Read from SQLite as well as memory, for the
     * same reason as in adoptWorktrees.
     */
    occupiedWorktrees(exceptId) {
        const out = new Map();
        for (const a of [...[...this.live.values()].map((l) => l.record), ...this.repos.listActiveAgents()]) {
            if (a.id === exceptId || !a.branch)
                continue;
            out.set(realPath(a.worktreePath), a.name);
        }
        return out;
    }
    /** Looks up a PR's head branch with `gh`. A method so tests can stand in for GitHub. */
    prHeadBranch(url) {
        return prHeadBranch(url);
    }
    /** What Operator asked for: his first message on the job, or the summary it was hired on. */
    taskOf(l) {
        return this.repos.listMessages(l.record.conversationId).find((m) => m.role === 'you')?.text ?? l.record.ticketSummary;
    }
    declineWork(agentId) {
        const l = this.need(agentId);
        if (!l.record.workPlan)
            return;
        l.record.workPlan = null;
        this.repos.updateAgent(agentId, { workPlan: null });
        this.rest(l, 'Waiting for your notes on the plan');
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        this.track('plan_declined', l.record, { result: 'plan_declined' });
    }
    async workBrief(l, workPlan) {
        const { worktreePath, branch, baseBranch, repoPath, ticketKey, ticketSummary } = l.record;
        const approved = `Operator approved this plan of yours. Carry it out:\n\n${workPlan}`;
        if (l.record.kind === 'ticket') {
            try {
                const target = this.sources.resolve(ticketKey);
                const detail = await target.source.get(target.key);
                return target.source.brief(detail, {
                    branch,
                    baseBranch: baseBranch,
                    worktreePath,
                    repoPath: repoPath,
                    note: approved,
                });
            }
            catch {
                return `You are picking up ${displayKey(ticketKey)}: ${ticketSummary}\n\nWorktree: ${worktreePath}\nBranch: ${branch}\n\n${approved}`;
            }
        }
        const task = this.taskOf(l);
        const brief = buildAskBrief(this.cfg, {
            task,
            key: ticketKey,
            kind: l.record.kind,
            branch,
            baseBranch,
            worktreePath,
            repoPath,
        });
        return `${brief}\n\n## Your approved plan\n\n${workPlan}`;
    }
    /**
     * Whether a request can go ahead without Operator: auto mode, or approvals that
     * cover it. config.json is edited by hand too, and only a real `true` turns
     * auto mode on, the same as Settings reports it.
     */
    answerable(l, request) {
        if (this.officeAsks.has(request.id))
            return false;
        if (this.asksAtTheCall(l, request))
            return true;
        if (this.autoFor(l))
            return true;
        // the assistant's one privileged action is the point of her role. The local MCP
        // endpoint verifies her id, and hire() still applies every normal limit.
        if (l.record.builtInPam && request.title === 'mcp__office__hire_worker')
            return true;
        // Messaging only posts into office chats; the endpoint enforces role, @-permission and rate limits.
        if (OFFICE_MESSAGING_TOOLS.has(request.title))
            return true;
        // Research only reads: reading the code it was asked about needs no click,
        // whatever the worker's level. Anything that could write still asks.
        if (l.record.kind === 'research' && request.readOnly)
            return true;
        return l.record.permission !== 'ask' && this.granted(request);
    }
    /** Office-wide auto mode overrides each worker's own level. */
    autoFor(l) {
        return this.cfg.agents.autoApprove === true || l.record.permission === 'auto';
    }
    /** Whether a plan starts without a click. A Discuss hire's first plan always waits for Operator. */
    autoStarts(l) {
        return this.autoFor(l) && !l.record.discuss;
    }
    granted(request) {
        return request.rule !== null && isCovered(request.rule, new Set(this.grants.map((g) => g.key)));
    }
    /**
     * Answers a request without raising a hand, but still writes it into the
     * chat. Standing approvals and auto mode are meant to save Operator the click,
     * not to hide what the worker did with it.
     */
    answerWithoutAsking(l, request) {
        const why = this.asksAtTheCall(l, request)
            ? 'the office asks you when the call is made'
            : l.record.builtInPam && request.title === 'mcp__office__hire_worker'
                ? 'the assistant delegation'
                : OFFICE_MESSAGING_TOOLS.has(request.title)
                    ? 'office messaging'
                    : request.rule && l.record.permission !== 'ask' && this.granted(request)
                        ? `you always allow ${request.rule.label}`
                        : l.record.kind === 'research' && request.readOnly && !this.autoFor(l)
                            ? 'read-only'
                            : this.cfg.agents.autoApprove === true
                                ? 'auto mode'
                                : 'full auto';
        this.say(l.record.id, 'tool', `${request.title} — ${why}`, [], request.plain ? `${request.plain} (${why})` : null);
        void l.runner.answerPermission(request.id, true).catch((err) => this.fail(l, err.message));
    }
    /** Answers everything this worker is waiting on that no longer needs Operator. */
    answerCovered(l) {
        const through = l.pending.filter((p) => this.answerable(l, p));
        l.pending = l.pending.filter((p) => !through.includes(p));
        for (const p of through)
            this.answerWithoutAsking(l, p);
    }
    /**
     * `answerCovered` for a worker Operator did not just answer. If the request in
     * front of him went, the next takes its place or the worker gets on.
     */
    letThrough(l) {
        const shown = l.pending[0];
        if (!shown)
            return;
        this.answerCovered(l);
        if (l.pending[0] !== shown)
            this.showNext(l, truncateLabel(shown.title, 46));
    }
    /** Puts the next waiting request in front of Operator, or lets the worker get on. */
    showNext(l, otherwise) {
        const next = l.pending[0] ?? null;
        this.bus.emit({ type: 'agent.permission', agentId: l.record.id, request: next });
        if (next) {
            this.setStatus(l, 'needs_you', truncateLabel(next.title, 46));
        }
        else if (l.question) {
            this.setStatus(l, 'needs_you', truncateLabel(l.question.title, 46));
        }
        else {
            this.setStatus(l, 'working', otherwise);
        }
    }
    /** Every worker's view carries the office's approvals, so all of them change. */
    publishGrants() {
        for (const l of this.live.values())
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
    }
    /**
     * Starts a fresh conversation: a new Cursor session that remembers none of
     * the last one. The old transcript stays in the table to be reopened.
     *
     * The session itself is not started here. It costs about ten seconds to
     * boot, and it should be spent when Operator says something, not when he clicks.
     */
    async newConversation(agentId) {
        const l = this.need(agentId);
        const kept = await this.parkConversation(l, null);
        l.record.conversationId = this.repos.startConversation(agentId);
        l.record.chatId = null;
        this.repos.updateAgent(agentId, { conversationId: l.record.conversationId, chatId: null });
        this.changedConversation(l);
        // Rebuilt on no chat id at all, which is what makes the next message open
        // a new session rather than resume the old one.
        if (!kept) {
            l.runner = this.makeRunner(l.record, null);
            this.wire(l);
        }
        this.sendTranscript(l);
        this.rest(l, 'Clean slate. What are we doing?', false);
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
    }
    /** Reopens an earlier conversation and carries it on where it left off. */
    async openConversation(agentId, conversationId) {
        const l = this.live.get(agentId);
        if (!l) {
            await this.openPreviousConversation(agentId, conversationId);
            return;
        }
        if (l.record.conversationId === conversationId)
            return;
        const conversation = this.repos.getConversation(agentId, conversationId);
        if (!conversation)
            throw new HireError('That conversation is not this worker’s.');
        const kept = await this.parkConversation(l, conversation.chatId);
        l.record.conversationId = conversationId;
        l.record.chatId = conversation.chatId;
        this.repos.updateAgent(agentId, { conversationId, chatId: conversation.chatId });
        this.changedConversation(l);
        // An Ask's card says what the open chat is about, as its header does.
        if (isAsk(l.record) && conversation.title) {
            l.record.ticketSummary = conversation.title;
            this.repos.updateAgent(agentId, { ticketSummary: conversation.title });
        }
        // On the conversation's own chat id, so the next message resumes that
        // session. Without one — a conversation nothing was ever said in — this
        // behaves exactly like a new one.
        const how = kept ? (conversation.chatId ? 'resumed' : 'fresh') : this.attachRunner(l, conversation.chatId);
        if (!kept)
            this.wire(l);
        this.sendTranscript(l);
        this.rest(l, how === 'resumed'
            ? 'Picking that thread back up'
            : 'Nothing said in this one yet');
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
    }
    /**
     * Shows an earlier chat of a previous worker. Nothing is started: they are not
     * back at a desk, so this only remembers which chat is open and sends it.
     */
    async openPreviousConversation(agentId, conversationId) {
        const record = this.repos.getAgent(agentId);
        if (!record || !this.repos.isEnded(agentId))
            throw new HireError('No such worker.', 'not_found');
        const conversation = this.repos.getConversation(agentId, conversationId);
        if (!conversation)
            throw new HireError('That conversation is not this worker’s.');
        if (record.conversationId !== conversationId) {
            this.repos.updateAgent(agentId, { conversationId, chatId: conversation.chatId });
        }
        const next = this.repos.getAgent(agentId);
        if (next)
            this.bus.emit({ type: 'agent.ended', agent: this.remembered(next) });
        this.bus.emit({
            type: 'agent.messages',
            agentId,
            conversationId,
            messages: this.repos.listMessages(conversationId),
        });
    }
    /**
     * Puts the current conversation down before another is picked up: stops the
     * turn, and writes the live session id onto the conversation so reopening
     * it later lands in the same Cursor chat.
     */
    async parkConversation(l, nextChatId) {
        const chatId = l.runner.chatId ?? l.record.chatId;
        if (chatId)
            this.repos.setConversationChatId(l.record.conversationId, chatId);
        l.queued.length = 0;
        const active = resolveRunnerMode(this.cfg);
        const reusable = l.runner.mode === active && l.record.runnerMode === active;
        const kept = reusable && (await l.runner.switchSession(nextChatId).catch(() => false));
        if (!kept)
            await l.runner.dispose().catch(() => { });
        this.clearPending(l);
        l.question = null;
        this.showPrAsk(l);
        l.turnText = '';
        l.lastTool = null;
        return kept;
    }
    /** Replaces the panel's transcript wholesale, after the open one changes. */
    sendTranscript(l) {
        this.bus.emit({
            type: 'agent.messages',
            agentId: l.record.id,
            conversationId: l.record.conversationId,
            messages: this.repos.listMessages(l.record.conversationId),
        });
    }
    /**
     * Sends a worker home without finishing the job. Nothing is written back to
     * 8090: firing is a decision about Operator's office, not about the work order,
     * which stays exactly as it was.
     */
    async fire(agentId, opts) {
        const l = this.need(agentId);
        if (l.record.builtInPam)
            throw new HireError('the assistant is the permanent secretary and cannot be fired.');
        const { name, ticketKey, repoPath, branch, worktreePath, adopted } = l.record;
        // The live session id has to be on the conversation, or Rehire would open
        // a blank chat instead of the one they were in.
        const chatId = l.runner.chatId ?? l.record.chatId;
        if (chatId)
            this.repos.setConversationChatId(l.record.conversationId, chatId);
        this.clearPending(l);
        await l.runner.dispose().catch(() => { });
        await this.userMcp.release(agentId);
        this.repos.updateAgent(agentId, {
            status: 'idle',
            chatId,
            bubble: '',
            endedAt: new Date().toISOString(),
            fired: true,
        });
        if (repoPath && !branch) {
            this.bus.toast(`${name} is off ${displayKey(ticketKey)}.`, 'info', agentId);
        }
        else if (!opts.removeWorktree || !repoPath || !branch) {
            if (branch)
                console.log(`[agents] fire ${ticketKey}: kept ${worktreePath}, removal not asked for`);
            this.bus.toast(`${name} is off ${displayKey(ticketKey)}. Their work is still in ${worktreePath}.`, 'info', agentId);
        }
        else if (adopted) {
            // AgentCorp did not create this worktree, so it is not ours to delete.
            console.log(`[agents] fire ${ticketKey}: kept ${worktreePath}, adopted`);
            this.bus.toast(`${name} is off ${displayKey(ticketKey)}. Left ${worktreePath} alone — you set that one up.`, 'info', agentId);
        }
        else if (!(await isBranchPushed(worktreePath, branch, l.record))) {
            // The same rule as Mark done, and the reason the dialog promises it:
            // unpushed commits are the one thing a click cannot throw away.
            console.log(`[agents] fire ${ticketKey}: kept ${worktreePath}, ${branch} has unpushed commits`);
            this.bus.toast(`${branch} has unpushed commits, so ${worktreePath} stays put.`, 'info', agentId);
        }
        else if (await this.removeWorkerTree('fire', l.record, agentId)) {
            this.bus.toast(`${name} is off ${displayKey(ticketKey)}, and the worktree is gone.`, 'info', agentId);
        }
        else {
            this.bus.toast(`${name} is off ${displayKey(ticketKey)}.`, 'info', agentId);
        }
        this.live.delete(agentId);
        this.bus.emit({ type: 'agent.removed', agentId });
        const reviewed = l.record.reviewingId ? this.live.get(l.record.reviewingId) : undefined;
        if (reviewed?.record.reviewerId === agentId)
            this.reviewerLeft(reviewed, 'Review ended');
        this.track('worker_fired', { ...l.record, endedAt: new Date().toISOString() }, { result: 'fired' });
        const gone = this.repos.getAgent(agentId);
        if (gone)
            this.bus.emit({ type: 'agent.ended', agent: this.remembered(gone) });
        void this.drainQueue();
    }
    /**
     * Brings a previous worker back to a desk with the same name, look, setup
     * and chats. The session is not started: Resume, or the next message, picks
     * the old chat up. Switching engines is a different action.
     */
    async rehire(agentId) {
        const task = this.hiring.then(() => this.doRehire(agentId), () => this.doRehire(agentId));
        this.hiring = task.catch(() => undefined);
        return task;
    }
    async doRehire(agentId) {
        const record = this.repos.getAgent(agentId);
        if (record?.builtInPam)
            throw new HireError('the assistant is already permanently part of the office.');
        if (!record || (!this.repos.isFired(agentId) && record.status !== 'done')) {
            throw new HireError(record ? 'That worker is not available for rehire.' : 'No such worker.', record ? 'bad_request' : 'not_found');
        }
        if (this.live.has(agentId))
            throw new HireError('That worker is already here.');
        // Fire can remove the worktree. Putting it back at the same path, on the
        // same branch, keeps Resume on the old chat too: Claude keeps its
        // sessions by folder.
        const gone = !existsSync(record.worktreePath);
        const restoreError = gone ? await this.restoreWorkdir(record) : null;
        const rehireName = this.nameForRehire(record.name);
        const deskIndex = this.claimDesk(record.deskIndex);
        if (deskIndex < 0)
            throw new HireError('Every desk is taken.');
        const bubble = !gone
            ? 'Back again. Resume me?'
            : restoreError
                ? 'Back again. The worktree is gone, but the chats are here.'
                : record.branch
                    ? 'Back again. I put the worktree back. Resume me?'
                    : 'Back again. Resume me?';
        record.name = rehireName;
        record.deskIndex = deskIndex;
        record.status = 'idle';
        record.bubble = bubble;
        record.endedAt = null;
        record.lastError = null;
        record.errorType = null;
        record.errorAction = null;
        record.activity = 'idle';
        record.sessionLive = false;
        record.queuedMessages = 0;
        record.pendingPermission = null;
        record.pendingQuestion = null;
        record.runningSince = null;
        this.repos.updateAgent(agentId, {
            name: rehireName,
            deskIndex,
            status: 'idle',
            bubble,
            endedAt: null,
            lastError: null,
            errorType: null,
            errorAction: null,
            fired: false,
        });
        const l = {
            record,
            runner: this.makeRunner(record, null),
            queued: [],
            lastTool: null,
            pending: [],
            question: null,
            lastEventAt: 0,
            turnText: '',
            streamBatch: [],
            streamTimer: null,
            interWorkerMessages: [],
        };
        this.live.set(agentId, l);
        const agent = this.view(l);
        this.bus.emit({ type: 'agent.created', agent });
        this.sendTranscript(l);
        this.bus.toast(`${record.name} is back.`, 'info', agentId);
        if (restoreError) {
            this.bus.toast(`Could not put ${record.worktreePath} back: ${restoreError}`, 'error', agentId);
        }
        this.track('rehire', record, { result: 'in_progress' });
        return agent;
    }
    /**
     * Recreates a rehired worker's missing folder: its worktree, on the branch
     * it had, or its notes folder when it had no branch. Returns why it could
     * not, or null.
     */
    async restoreWorkdir(record) {
        try {
            if (!record.repoPath || !record.branch) {
                mkdirSync(record.worktreePath, { recursive: true });
                return null;
            }
            const repoPath = expandPath(record.repoPath);
            await restoreWorktree({ repoPath, worktreePath: record.worktreePath, branch: record.branch });
            this.writeMcpConfig(record, record.worktreePath);
            this.linkSkills(record, basename(repoPath), record.worktreePath);
            return null;
        }
        catch (err) {
            return err.message;
        }
    }
    /** Rehiring should work even when a newer worker has taken the old name. */
    nameForRehire(name) {
        try {
            return this.checkName(name);
        }
        catch (err) {
            if (!(err instanceof HireError) || !err.message.endsWith('is already working here.'))
                throw err;
        }
        for (let n = 2; n < 100; n += 1) {
            const suffix = ` ${n}`;
            const candidate = `${name.slice(0, WORKER_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
            try {
                return this.checkName(candidate);
            }
            catch (err) {
                if (!(err instanceof HireError) || !err.message.endsWith('is already working here.'))
                    throw err;
            }
        }
        throw new HireError('Could not find a unique name for that worker.');
    }
    /**
     * Takes back a standing approval, for every worker. The next request that
     * needs it asks again. Said in the chat of whoever's panel it was taken
     * back from.
     */
    revokeGrant(agentId, grantId) {
        this.need(agentId);
        const grant = this.grants.find((g) => g.id === grantId);
        if (!grant)
            return;
        this.repos.removeGrant(grantId);
        this.grants = this.repos.listGrants();
        this.say(agentId, 'you', `Ask me about ${grant.label} again.`);
        this.publishGrants();
    }
    /**
     * Gives a worker a name of Operator's choosing. Names stay unique among the
     * workers in the office, since toasts and the hire list tell them apart by
     * name alone.
     */
    rename(agentId, name) {
        const l = this.need(agentId);
        const next = this.checkName(name, agentId);
        if (next === l.record.name)
            return this.view(l);
        this.repos.updateAgent(agentId, { name: next });
        l.record.name = next;
        const agent = this.view(l);
        this.bus.emit({ type: 'agent.updated', agent });
        return agent;
    }
    /**
     * A typed name, tidied: spaces collapsed, not blank, not too long, and not
     * already worn by another worker (`self` is the one being renamed).
     */
    checkName(name, self) {
        const next = name.replace(/\s+/g, ' ').trim();
        if (!next)
            throw new HireError('A worker needs a name.');
        if (next.length > WORKER_NAME_MAX) {
            throw new HireError(`Keep the name to ${WORKER_NAME_MAX} characters or fewer.`);
        }
        const clash = [...this.live.values()].find((o) => o.record.id !== self && o.record.name.toLowerCase() === next.toLowerCase());
        if (clash)
            throw new HireError(`${clash.record.name} is already working here.`);
        return next;
    }
    /**
     * Changes a worker's permission level, model or effort. Claude Code takes
     * a new model or effort mid-session; going to full auto also lets through
     * whatever the worker is already waiting on.
     */
    async updateSetup(agentId, patch) {
        const l = this.need(agentId);
        const next = checkSetup({ ...agentSetup(l.record), ...patch }, this.modelMenu.efforts);
        Object.assign(l.record, asAgentSetup(next));
        this.repos.updateAgent(agentId, asAgentSetup(next));
        await l.runner.applySetup(next).catch((err) => {
            this.bus.toast(`${l.record.name} will switch when its next session starts: ${err.message}`, 'info', agentId);
        });
        if (this.autoFor(l)) {
            this.letThrough(l);
            if (l.record.workPlan && this.autoStarts(l))
                void this.startWork(agentId).catch((err) => this.fail(l, err.message));
        }
        const agent = this.view(l);
        this.bus.emit({ type: 'agent.updated', agent });
        return agent;
    }
    /**
     * Switches a worker's runner engine. Only allowed when the worker is idle
     * or in error state (not mid-turn). The next Resume or message starts a
     * fresh session with the new runner.
     *
     * Switching runners starts a new conversation because different runners have
     * different capabilities and context formats.
     */
    async switchRunner(agentId, runnerMode) {
        const l = this.need(agentId);
        const { record } = l;
        // Only allow switching when not mid-turn
        if (record.status === 'working' || record.status === 'starting') {
            throw new HireError(`${record.name} is busy. Stop the turn first, then switch runners.`);
        }
        if (record.builtInPam) {
            throw new HireError('the assistant uses the office default runner.');
        }
        const validRunners = ['claude', 'acp', 'copilot', 'codex'];
        if (!validRunners.includes(runnerMode)) {
            throw new HireError(`"${runnerMode}" is not a valid runner.`);
        }
        if (record.runnerMode === runnerMode) {
            return this.view(l);
        }
        this.ensureRunnerEnabled(runnerMode);
        // Save the current chat id to the conversation before switching
        const chatId = l.runner.chatId ?? record.chatId;
        if (chatId)
            this.repos.setConversationChatId(record.conversationId, chatId);
        // Read before the switch clears them: an agent out of credits cannot write a handoff.
        const from = record.runnerMode;
        const oldConversation = record.conversationId;
        const blocked = record.status === 'error' && !!record.errorType && HANDOFF_BLOCKERS.has(record.errorType) ? (record.lastError ?? 'it is out of action') : null;
        // Dispose the old runner
        await l.runner.dispose().catch(() => { });
        this.clearPending(l);
        l.question = null;
        this.showPrAsk(l);
        l.turnText = '';
        l.lastTool = null;
        // Update the record
        record.runnerMode = runnerMode;
        record.chatId = null; // Fresh session with the new runner
        // The new agent has never seen the work order, so its first turn gets the brief.
        record.needsBrief = true;
        record.lastError = null;
        record.errorType = null;
        record.errorAction = null;
        // The old runner's commands may not exist on the new one.
        record.commands = [];
        this.repos.updateAgent(agentId, {
            runnerMode,
            chatId: null,
            commands: [],
            needsBrief: true,
            lastError: null,
            errorType: null,
            errorAction: null,
        });
        // Start a new conversation for the new runner
        record.conversationId = this.repos.startConversation(agentId, `Switched to ${runnerLabel(runnerMode)}`);
        this.repos.updateAgent(agentId, { conversationId: record.conversationId });
        this.changedConversation(l);
        // Build a fresh runner for the new mode
        l.runner = this.makeRunner(record, null);
        this.wire(l);
        // Nothing was said yet, so there is nothing to hand off.
        if (chatId) {
            l.handoff = this.writeHandoff(l, { from, to: runnerMode, chatId, conversationId: oldConversation, blocked });
            try {
                await l.handoff;
            }
            finally {
                l.handoff = null;
            }
        }
        this.rest(l, `Switched to ${runnerLabel(runnerMode)} in a new chat. Resume to brief it on the work order.`, false);
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        this.sendTranscript(l);
        this.bus.toast(`${record.name} switched to ${runnerLabel(runnerMode)}.`, 'info', agentId);
        return this.view(l);
    }
    /**
     * Changes the repos a worker reads, on the same chat, so the conversation
     * carries on. `primary` is its own repo (null for none, which only research
     * can do; left out to keep it) and `extra` the ones it reads beside it.
     *
     * Only before it has a branch: after that its worktree and PR are cut from
     * the primary, and the runner no longer opens the extras anyway. The runner
     * is rebuilt on the new folders, which also re-links the new primary's
     * skills and reads its MCP servers. The thread shows the change, and the
     * agent is told at the front of the next message.
     */
    async setRepos(agentId, req) {
        const l = this.need(agentId);
        const { record } = l;
        if (record.builtInPam)
            throw new HireError('the assistant works at reception without a repo. Hire a worker to read one.');
        if (record.reviewingId)
            throw new HireError(`${record.name} is reviewing and reads the work under review only.`);
        if (record.branch) {
            throw new HireError(`${record.name} has a branch in ${basename(record.repoPath ?? record.worktreePath)}. Mark it done or fire it before changing repos.`);
        }
        // Waiting on Operator's answer is still mid-turn: rebuilding the runner would drop the turn.
        if (record.status === 'working' || record.status === 'starting' || l.runner.isBusy || l.pending.length || l.question) {
            throw new HireError(`${record.name} is busy. Stop the turn first, then change repos.`);
        }
        if (record.workPlan) {
            throw new HireError(`${record.name}'s plan is waiting for you, and it was written for ${basename(record.repoPath ?? '')}. Approve or decline it before changing repos.`);
        }
        const picked = req.primary?.trim() ? await this.checkRepo(req.primary.trim()) : null;
        const primary = req.primary === undefined ? record.repoPath : (picked?.path ?? null);
        if (!primary && record.kind !== 'research') {
            throw new HireError(`${record.name} needs a repo to work in. Pick another one rather than none.`);
        }
        if (record.personaRepo && basename(primary ?? '') !== record.personaRepo) {
            throw new HireError(`${record.name} is an agent from ${record.personaRepo}, so ${record.personaRepo} stays its repo.`);
        }
        const extra = this.extraReposFor({ extraRepos: req.extra }, primary);
        const newPrimary = primary !== record.repoPath;
        const before = record.extraRepos ?? [];
        if (!newPrimary && extra.length === before.length && extra.every((r, i) => r === before[i]))
            return this.view(l);
        // The base branch set for the repo in the picker, else the one git says is its default.
        const baseBranch = picked ? ((await listRepos(this.cfg)).find((r) => r.path === picked.path)?.baseBranch ?? picked.baseBranch) : null;
        if (picked && newPrimary)
            await this.rememberIfNew(picked, picked.baseBranch);
        // Kept, so the rebuilt runner resumes the same chat rather than a new one.
        const chatId = l.runner.chatId ?? record.chatId;
        await l.runner.dispose().catch(() => { });
        this.clearPending(l);
        l.question = null;
        l.turnText = '';
        l.lastTool = null;
        // The old repo's servers stop; the rebuilt runner starts the new one's.
        if (newPrimary)
            await this.userMcp.release(agentId);
        record.repoPath = primary;
        // A new repo's work is cut from its own default branch, not the old one's.
        if (newPrimary)
            record.baseBranch = baseBranch;
        record.extraRepos = extra;
        record.chatId = chatId;
        this.repos.updateAgent(agentId, { repoPath: record.repoPath, baseBranch: record.baseBranch, extraRepos: extra, chatId });
        l.runner = this.makeRunner(record, chatId);
        this.wire(l);
        this.say(agentId, 'tool', reposLine(record));
        l.reposNote = reposNote(record);
        this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
        return this.view(l);
    }
    /** The note about changed repos, once, for the message about to go to the agent. */
    takeReposNote(l) {
        const note = l.reposNote;
        l.reposNote = null;
        return note ? `${note}\n\n` : '';
    }
    /**
     * Leaves a handoff at the top of a switched worker's new chat, for the new
     * agent's first brief: the old agent's own, asked for on its old chat, or a
     * recap of that chat when it cannot answer.
     */
    async writeHandoff(l, h) {
        let why = h.blocked;
        let text = null;
        if (!why) {
            this.setStatus(l, 'starting', `Writing a handoff for ${runnerLabel(h.to)}`);
            try {
                text = (await this.askHandoff(l.record, h.from, h.chatId, handoffPrompt(h.to))).trim() || null;
                if (!text)
                    why = `${runnerLabel(h.from)} sent back an empty one`;
            }
            catch (err) {
                why = err.message;
                console.error(`[agents] ${l.record.name}'s handoff from ${h.from} failed:`, why);
            }
        }
        const note = text
            ? handoffNote(h.from, text)
            : recapNote(this.repos.listMessages(h.conversationId), h.from, l.record.name, why ?? 'it did not answer');
        if (note)
            this.say(l.record.id, 'brief', note);
    }
    /** Asks the old agent, read only and on its own chat, for the handoff. A seam for the tests. */
    async askHandoff(record, mode, chatId, prompt) {
        const session = await openSession(this.cfg, mode, {
            resume: { workdir: record.worktreePath, chatId },
            model: record.chosenModel,
            effort: record.effort,
            permission: 'ask',
            timeoutMs: HANDOFF_TIMEOUT_MS,
        });
        try {
            return await session.ask(prompt);
        }
        finally {
            // The folder is the worker's worktree, not a scratch folder.
            await session.close({ keepFolder: true });
        }
    }
    /** Changes what a worker wears. Anything not in the patch stays as it was. */
    updateLook(agentId, patch) {
        const l = this.need(agentId);
        for (const [key, value] of Object.entries(patch)) {
            const choices = LOOK_CHOICES[key];
            if (!choices)
                throw new HireError(`"${key}" is not part of a worker's look.`);
            if (!choices.some((c) => c.value === value))
                throw new HireError(`"${String(value)}" is not a ${key} choice.`);
        }
        l.record.look = cleanLook({ ...l.record.look, ...patch });
        this.repos.updateAgent(agentId, { look: l.record.look });
        const agent = this.view(l);
        this.bus.emit({ type: 'agent.updated', agent });
        return agent;
    }
    /** What a new hire starts as: the hire's own choices, then the office defaults. */
    setupFor(req, persona) {
        const d = persona ?? this.cfg.agents;
        return checkSetup({
            permission: req.permission ?? d.permission ?? 'standard',
            model: req.model === undefined ? d.model : req.model,
            effort: req.effort === undefined ? d.effort : req.effort,
        }, this.modelMenu.efforts);
    }
    /**
     * Cancels the turn in flight. The process and the session live on, so the
     * next message carries the same conversation rather than starting over.
     */
    async stop(agentId) {
        const l = this.need(agentId);
        await l.runner.cancel();
        if (l.pending.length) {
            this.clearPending(l);
            this.bus.emit({ type: 'agent.permission', agentId, request: null });
        }
        this.rest(l, 'Stopped. Tell me what to do next.');
    }
    /**
     * Checks on a worker that has gone quiet: whether its CLI is still there,
     * still answering, and what it has running. A CLI found dead or deaf is
     * failed, which puts Retry in front of Operator. Stop would only send a cancel
     * to a process that is not reading.
     */
    async nudge(agentId) {
        const l = this.need(agentId);
        const { name, status } = l.record;
        if (status !== 'working' && status !== 'starting') {
            return { verdict: 'idle', text: `${name} is not in the middle of anything.` };
        }
        // Both failures fit the desk bubble whole.
        const probe = await l.runner.probe();
        if (probe.alive === false) {
            this.fail(l, 'The CLI had exited without finishing the turn.');
            return { verdict: 'dead', text: `${name}'s CLI has stopped. Retry picks the conversation back up.` };
        }
        if (probe.answering === false) {
            this.fail(l, 'The CLI was running but had stopped answering.');
            return {
                verdict: 'stuck',
                text: `${name}'s CLI is still running but did not answer within 5 seconds, so it is stuck. Retry restarts it on the same conversation.`,
            };
        }
        const helpers = l.runner.backgroundAgents;
        if (helpers.length) {
            return {
                verdict: 'working',
                text: `${name} is still waiting on ${helpers.length === 1 ? 'a background agent' : `${helpers.length} background agents`}: ${helpers.map((h) => h.name).join('; ')}. ${runnerLabel(l.record.runnerMode)} says nothing until they finish. Stop ends them too.`,
            };
        }
        const running = probe.pid ? await this.listCommands(probe.pid, CLI_SHAPES[l.runner.mode]).catch(() => []) : [];
        if (running.length) {
            return { verdict: 'working', text: `${name} is still working. ${running.map(describeCommand).join('. ')}.` };
        }
        if (probe.alive === null) {
            return status === 'starting'
                ? { verdict: 'working', text: `${name} is still getting set up and has not started its CLI yet.` }
                : {
                    verdict: 'unknown',
                    text: `${runnerLabel(l.record.runnerMode)} gives the office no way to check on ${name}. If this goes on, Stop, then tell ${name} to carry on.`,
                };
        }
        if (status === 'starting') {
            // Still being briefed, so there is no turn of its own to restart yet.
            return { verdict: 'working', text: `${name} is still getting set up. Its CLI is up and answering.` };
        }
        // Nothing is running, so there is nothing to lose: do what Operator would be
        // told to do, in the same conversation.
        await this.stop(agentId);
        try {
            await this.sendMessage(agentId, 'Carry on.');
        }
        catch (err) {
            return {
                verdict: 'waiting',
                text: `${name}'s CLI was waiting on ${runnerLabel(l.record.runnerMode)} for a reply that was not coming, so the office stopped that turn, but could not tell ${name} to carry on: ${err.message}. Tell ${name} to carry on yourself.`,
            };
        }
        // Hearing from it again clears the panel's answer, so this one is said twice.
        this.bus.toast(`Nudged ${name}: stopped a turn that had stalled and told them to carry on.`, 'info', agentId);
        return {
            verdict: 'waiting',
            text: `${name}'s CLI was up and answering, with nothing running on this machine, so it was waiting on ${runnerLabel(l.record.runnerMode)} for a reply that was not coming. The office stopped that turn and told ${name} to carry on in the same conversation.`,
        };
    }
    /** Rebuilds the runner on the stored chat id after a crash or a restart. */
    async resume(agentId) {
        const l = this.need(agentId);
        if (l.handoff)
            await l.handoff;
        await this.settled(l);
        // Decided before start(), which populates the chat id.
        const fresh = (l.record.adopted || !!l.record.needsBrief) && !l.record.chatId;
        const interrupted = !l.runner.isStarted || l.record.status === 'error';
        // Back to its reviewer's findings, so the end of the turn still asks for the re-check.
        const fixing = l.record.status === 'error' && !!l.failedFixing && !!l.record.reviewerId;
        await l.runner.dispose().catch(() => { });
        this.attachRunner(l, l.record.chatId);
        l.record.lastError = null;
        l.record.errorType = null;
        l.record.errorAction = null;
        this.clearPending(l);
        l.question = null;
        this.showPrAsk(l);
        l.turnText = '';
        this.wire(l);
        try {
            await l.runner.start();
            if (fixing)
                this.setStatus(l, 'fixing_findings', 'Fixing review findings');
            else
                this.setStatus(l, 'working', 'Picking up where I left off');
            const prompt = fresh
                ? this.briefFor(l.record, await this.resumePrompt(l, true, interrupted))
                : await this.resumePrompt(l, false, interrupted);
            // Only a fresh one is a brief. The nudge is a line long, and it is how
            // the chat says why the worker started again.
            this.say(l.record.id, fresh ? 'brief' : 'you', prompt);
            await l.runner.prompt(prompt);
            this.bus.emit({ type: 'agent.updated', agent: this.view(l) });
            this.track('resume', l.record, { result: 'success' });
        }
        catch (err) {
            this.fail(l, err.message);
        }
    }
    /**
     * Picks back up the workers a restart cut off mid-turn, and the ones that
     * crashed in a way a fresh process can get past. One at a time, and only
     * while there are desks free, so a big office does not stampede the CLI.
     */
    async resumeCrashed() {
        const ids = [...new Set([...this.interrupted, ...this.repos.listRetryableErroredAgents()])];
        this.interrupted = [];
        if (!this.cfg.agents.resumeOnStart)
            return;
        const resumed = [];
        for (const id of ids) {
            if (this.closing || !this.deskFree())
                break;
            const l = this.live.get(id);
            if (!l || l.record.builtInPam)
                continue;
            console.log(`[agents] resuming ${l.record.name} (${l.record.ticketKey}) after the restart`);
            await this.resume(id);
            // resume() leaves one that would not start in `error`, with its own toast.
            if (l.record.status !== 'error')
                resumed.push(l.record);
        }
        const [only] = resumed;
        if (resumed.length === 1 && only)
            this.bus.toast(`Picked ${only.name} back up where they left off.`, 'info', only.id);
        else if (resumed.length)
            this.bus.toast(`Picked ${resumed.length} workers back up where they left off.`, 'info');
    }
    /**
     * An agent resuming its own chat only needs a nudge. A worker that has never
     * been briefed, or was just switched to another agent, gets the full ticket
     * plus whatever is already in the worktree.
     *
     * `fresh` has to be decided before the session is started: starting it emits
     * a chat id, so by the time this runs the record can no longer tell us
     * whether there was a conversation to resume.
     */
    async resumePrompt(l, fresh, interrupted = true) {
        if (!fresh) {
            return interrupted
                ? 'You were interrupted. Re-read your worktree to see where you got to, then carry on with the work order.'
                : 'Carry on with the work order.';
        }
        const { worktreePath, baseBranch, branch } = l.record;
        // What the agent before it left, when this worker was switched.
        const handoff = findHandoff(this.repos.listMessages(l.record.conversationId));
        if (!branch || !baseBranch) {
            // A repo-less researcher has no diff and no ticket to re-read.
            const carryOn = `Carry on with ${displayKey(l.record.ticketKey)}: ${l.record.ticketSummary}\n\nYour notes are in ${worktreePath}.`;
            return handoff ? `${carryOn}\n\nAnother coding agent worked on this before you. You do not have its conversation, but here is what it left you.\n\n${handoff}` : carryOn;
        }
        let changed;
        try {
            changed = await diffStatAgainstBase(worktreePath, baseBranch);
        }
        catch {
            changed = 'Could not read the diff; run `git status` yourself before you start.';
        }
        const note = [
            l.record.adopted
                ? 'This work was started before you arrived, by hand rather than by an agent.'
                : handoff
                    ? `This work was started before you arrived, by another coding agent. You do not have its conversation, but here is what it left you.\n\n${handoff}\n`
                    : 'This work was started before you arrived, by another coding agent. You do not have its conversation.',
            'The worktree already exists and may hold uncommitted changes.',
            '',
            changed,
            '',
            'Read those files and `git log ' + baseBranch + '..' + branch + '` before you touch anything,',
            'then continue the work order. Do not revert or rewrite existing work unless it is wrong.',
        ].join('\n');
        try {
            const target = this.sources.resolve(l.record.ticketKey);
            const detail = await target.source.get(target.key);
            return target.source.brief(detail, {
                branch,
                baseBranch,
                worktreePath,
                repoPath: l.record.repoPath ?? worktreePath,
                note,
            });
        }
        catch {
            // 8090 unreachable: the worktree contents are still enough to carry on.
            return `You are picking up ${displayKey(l.record.ticketKey)}: ${l.record.ticketSummary}\n\nWorktree: ${worktreePath}\n\n${note}`;
        }
    }
    /**
     * Mark done: write the PR link and a summary back to 8090, award the XP,
     * then free the desk. The worktree only goes away once its branch is pushed.
     */
    async markDone(agentId) {
        const l = this.need(agentId);
        if (l.record.builtInPam)
            throw new HireError('the assistant stays at reception and delegates work instead of being marked done.');
        const { ticketKey, ticketSummary, prUrl } = l.record;
        const summary = this.lastAgentMessage(agentId);
        // Only a work order has somewhere in 8090 to move to.
        if (l.record.kind === 'ticket') {
            const target = this.sources.resolve(ticketKey);
            await target.source.markDone(target.key, {
                prUrl,
                summary: summary ? `AgentCorp: ${l.record.name} finished this.\n\n${summary}` : null,
            });
        }
        this.repos.addDone({
            ticketKey,
            title: ticketSummary,
            points: this.repos.getTicket(ticketKey)?.points ?? 0,
            prUrl,
            doneAt: new Date().toISOString(),
        });
        this.track('work_completed', l.record, { result: 'done', hasPr: Boolean(prUrl) });
        this.setStatus(l, 'done', 'Posting a win');
        this.bus.toast(l.record.kind === 'ticket' ? `${displayKey(ticketKey)} is in Review. Nice.` : `${l.record.name} finished that one. Nice.`, 'done', agentId);
        await l.runner.dispose().catch(() => { });
        this.repos.updateAgent(agentId, { status: 'done', endedAt: new Date().toISOString() });
        const { repoPath, branch, worktreePath } = l.record;
        if (!repoPath || !branch) {
            // A researcher's notes are the deliverable, so they stay put.
            this.bus.toast(`${l.record.name}'s notes are in ${worktreePath}.`, 'info', agentId);
        }
        else if (l.record.adopted) {
            // AgentCorp did not create this worktree, so it is not ours to delete.
            console.log(`[agents] done ${ticketKey}: kept ${worktreePath}, adopted`);
            this.bus.toast(`Left ${worktreePath} in place — you set that one up.`, 'info', agentId);
        }
        else if (await isBranchPushed(worktreePath, branch, l.record)) {
            await this.removeWorkerTree('done', l.record, agentId);
        }
        else {
            console.log(`[agents] done ${ticketKey}: kept ${worktreePath}, ${branch} has unpushed commits`);
            this.bus.toast(`${l.record.branch} has unpushed commits, so ${l.record.name}'s worktree stays put.`, 'info', agentId);
        }
        await this.userMcp.release(agentId);
        this.live.delete(agentId);
        this.bus.emit({ type: 'agent.removed', agentId });
        const reviewed = l.record.reviewingId ? this.live.get(l.record.reviewingId) : undefined;
        if (reviewed?.record.reviewerId === agentId)
            this.reviewerLeft(reviewed, 'Review ended');
        const finished = this.repos.getAgent(agentId);
        if (finished)
            this.bus.emit({ type: 'agent.ended', agent: this.remembered(finished) });
        this.bus.emit({ type: 'done.update', done: this.repos.listDone() });
        void this.drainQueue();
    }
    lastAgentMessage(agentId) {
        const l = this.live.get(agentId);
        if (!l)
            return null;
        const messages = this.repos.listMessages(l.record.conversationId).filter((m) => m.role === 'agent');
        return messages.at(-1)?.text ?? null;
    }
    /** Removes a worker's pushed worktree, saying why when it stays. True once it is gone. */
    async removeWorkerTree(why, record, agentId) {
        const { repoPath, worktreePath, branch, baseBranch, prUrl, ticketKey } = record;
        try {
            await removeWorktree({ repoPath: repoPath, worktreePath, branch: branch, baseBranch, prUrl });
            console.log(`[agents] ${why} ${ticketKey}: removed ${worktreePath}`);
            return true;
        }
        catch (err) {
            console.log(`[agents] ${why} ${ticketKey}: kept ${worktreePath}, ${err.message}`);
            this.bus.toast(`Left ${worktreePath} in place: ${err.message}`, 'info', agentId);
            return false;
        }
    }
    async drainQueue() {
        while (this.hireQueue.length && this.runningCount() < this.cfg.agents.maxConcurrent) {
            const next = this.hireQueue.shift();
            if (!next)
                break;
            this.bus.emit({ type: 'queue.update', queue: this.queueView() });
            try {
                await this.doHire(next);
            }
            catch (err) {
                this.bus.toast(`Could not start ${next.ticketKey ? displayKey(next.ticketKey) : 'that job'}: ${err.message}`, 'error');
            }
        }
    }
    /**
     * Opens the agent's worktree in Cursor (or VS Code).
     *
     * This is what the worker panel's button does instead of showing a terminal:
     * the raw stream is a poor substitute for the editor the agent is working in.
     */
    async openInEditor(agentId, editor) {
        const l = this.need(agentId);
        const path = l.record.worktreePath;
        // The path comes from SQLite, so re-check it against config before handing
        // it to a launcher.
        if (!isInside(this.cfg.worktrees.root, path)) {
            throw new Error(`${path} is outside the configured worktree root; refusing to open it.`);
        }
        if (!existsSync(path)) {
            throw new Error(`${path} is gone. The worktree may have been cleaned up already.`);
        }
        const launched = await launchEditor(editor, editor === 'vscode' ? this.cfg.editors.vscode : this.cfg.editors.cursor, path);
        this.bus.toast(`Opened ${displayKey(l.record.ticketKey)} in ${EDITOR_NAMES[editor]}.`, 'info', agentId);
        this.track('ide_opened', l.record, { choice: editor });
        return { command: launched.command, path };
    }
    streamLog(agentId) {
        this.need(agentId);
        return this.repos.listStream(agentId);
    }
    /** Checks the default agent for new hires, for the lights and the model menu. */
    async checkAgentCli() {
        return this.checkRunner(resolveRunnerChoice(this.cfg));
    }
    /**
     * Checks one coding agent is installed and signed in. Only the default's
     * check asks for its models: Copilot and Codex have to open a session for
     * that, and doing it for every agent at every launch would be slow.
     */
    async checkRunner(mode) {
        const isDefault = mode === resolveRunnerChoice(this.cfg);
        const check = this.inspectAgentCli(mode, isDefault);
        this.cliChecks.set(mode, check);
        const result = await check;
        if (isDefault)
            this.modelMenu = result.modelMenu;
        this.onCliChecked?.(mode, result);
        return result;
    }
    /** Checks all four agents at once, for Settings. */
    async checkAllRunners() {
        const results = await Promise.all(RUNNER_CHOICES.map(async (mode) => [mode, await this.checkRunner(mode)]));
        return Object.fromEntries(results);
    }
    /** Refuses an agent Operator turned off in Settings. */
    ensureRunnerEnabled(mode) {
        const choice = mode === 'print' ? 'acp' : mode;
        if (!enabledRunners(this.cfg).includes(choice)) {
            throw new HireError(`${runnerLabel(choice)} is turned off. Turn it on in Settings → Coding agents, or pick another agent.`);
        }
    }
    async ensureCliReady(mode = resolveRunnerMode(this.cfg)) {
        const choice = mode === 'print' ? 'acp' : mode;
        const pending = this.cliChecks.get(choice);
        if (!pending)
            return;
        let cli = await pending;
        if (!cli.ok)
            cli = await this.checkRunner(choice);
        if (!cli.ok)
            throw new HireError(cli.error ?? `${runnerLabel(choice)} is not available.`);
    }
    async inspectAgentCli(mode, withMenu) {
        if (mode === 'ollama') {
            try {
                const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
                if (res.ok) {
                    const data = await res.json();
                    const models = (data.models || []).map((m) => ({
                        value: m.name,
                        label: m.name,
                        hint: `${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB · Local GPU`
                    }));
                    if (!models.length) {
                        models.push({ value: 'qwen3.5:4b', label: 'qwen3.5:4b (Available to pull)', hint: 'ollama pull qwen3.5:4b' });
                    }
                    return {
                        ok: true,
                        version: 'Ollama local',
                        error: null,
                        modelMenu: {
                            models,
                            efforts: [
                                { value: null, label: 'Default' },
                                { value: 'instant', label: 'Instant' },
                                { value: 'low', label: 'Low' },
                                { value: 'medium', label: 'Medium' },
                                { value: 'high', label: 'High' },
                                { value: 'max', label: 'Max' }
                            ]
                        }
                    };
                }
            } catch {
                return {
                    ok: false,
                    version: null,
                    error: 'Ollama is not running. Start it with "ollama serve" in terminal.',
                    modelMenu: CLAUDE_MODEL_MENU
                };
            }
        }
        const [cli, ...args] = mode === 'claude' ? [process.execPath, CLAUDE_ACP, '--cli'] :
            mode === 'copilot' ? [process.execPath, COPILOT_CLI] :
                mode === 'codex' ? [process.execPath, CODEX_ACP] :
                    ['agent'];
        try {
            const { stdout } = await run(cli, [...args, '--version'], { timeoutMs: 15_000 });
            const version = stdout.trim().split('\n')[0] ?? null;
            if (mode === 'claude') {
                const loggedIn = await run(process.execPath, [CLAUDE_ACP, '--cli', 'auth', 'status'], { timeoutMs: 15_000 }).then((status) => JSON.parse(status.stdout).loggedIn === true, () => false);
                if (!loggedIn) {
                    return { ok: false, version, error: signInHint(mode), modelMenu: CLAUDE_MODEL_MENU };
                }
            }
            if (mode === 'codex') {
                const loggedIn = await run(process.execPath, [CODEX_ACP, 'cli', 'login', 'status'], { timeoutMs: 15_000 }).then(() => true, () => false);
                if (!loggedIn) {
                    return { ok: false, version, error: signInHint(mode), modelMenu: CLAUDE_MODEL_MENU };
                }
            }
            // Claude Code's list is the office's own; its session only names them and says what Default comes to, and missing that is no failure.
            const modelMenu = !withMenu || mode === 'acp' ? CLAUDE_MODEL_MENU :
                mode === 'claude' ? await this.askModelMenu(mode).then((own) => namedModels(CLAUDE_MODEL_MENU, own), () => CLAUDE_MODEL_MENU) :
                    await this.askModelMenu(mode);
            return { ok: true, version, error: null, modelMenu };
        }
        catch (err) {
            return { ok: false, version: null, error: explainRunnerError(mode, err.message), modelMenu: CLAUDE_MODEL_MENU };
        }
    }
    async askModelMenu(mode) {
        if (mode === 'ollama') {
            try {
                const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
                if (res.ok) {
                    const data = await res.json();
                    const models = (data.models || []).map((m) => ({ value: m.name, label: m.name, hint: `${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB` }));
                    return { models, efforts: CLAUDE_MODEL_MENU.efforts };
                }
            } catch {}
            return CLAUDE_MODEL_MENU;
        }
        const dir = mkdtempSync(join(tmpdir(), 'agent-corp-models-'));
        const opts = { worktreePath: dir };
        const agent = mode === 'claude' ? claudeAgent(opts) : mode === 'copilot' ? copilotAgent(opts) : codexAgent(opts);
        const runner = new AcpRunner(opts, agent);
        try {
            await runner.start();
            return runner.modelMenu();
        }
        catch (err) {
            throw new Error(`${runnerLabel(mode)} could not open a session: ${err.message}`);
        }
        finally {
            await runner.dispose().catch(() => { });
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {}
        }
    }
    async shutdown() {
        this.closing = true;
        this.stopPrWatcher();
        await Promise.all([...this.live.values()].map(async (l) => {
            this.flushStream(l);
            this.clearPending(l);
            await l.runner.dispose().catch(() => { });
        }));
        await this.userMcp.closeAll();
        this.live.clear();
    }
    /** Drops the old account's live workers and restores the newly selected account. */
    async switchAccount() {
        await this.shutdown();
        this.restoreAccount();
    }
    restoreAccount() {
        this.hireQueue.length = 0;
        this.grants = this.repos.listGrants();
        this.closing = false;
        this.restoreFromDb();
    }
    need(agentId) {
        const l = this.live.get(agentId);
        if (!l)
            throw new HireError(`No agent ${agentId} is at a desk.`, 'not_found');
        return l;
    }
    /**
     * Handles PR watcher events. A worker at a desk is sent the problem to fix.
     * A fired or done worker is only rehired once Operator says so: the assistant asks him.
     */
    async handlePrEvent(event) {
        // Handle closed PRs
        if (!('problems' in event)) {
            const closedEvent = event;
            // A closed PR needs no fixing, so a rehire question about it goes.
            if (this.prAsks.get(closedEvent.agentId)?.prUrl === closedEvent.prUrl)
                this.dropPrAsk(closedEvent.agentId);
            // PR was merged or closed—stop watching and optionally notify
            const worker = this.repos.getAgent(closedEvent.agentId);
            if (closedEvent.merged && worker) {
                this.bus.toast(`${worker.name}'s PR was merged.`, 'done', closedEvent.agentId);
            }
            return;
        }
        const prEvent = event;
        const { agentId, agentName, prUrl, branch, problems, attemptNumber } = prEvent;
        // Past the cap the watcher still reports new problems, once per poll, so Operator hears of them.
        const maxAttempts = this.cfg.prWatch.maxFixAttempts;
        if (attemptNumber > maxAttempts) {
            this.bus.toast(`${agentName}'s PR has had ${maxAttempts} fix attempts. Manual intervention needed.`, 'needs_you', agentId);
            return;
        }
        // Check if worker is still at a desk
        const live = this.live.get(agentId);
        if (live) {
            // Worker is here—just message them
            try {
                await this.sendMessage(agentId, prFixMessage(problems, branch, attemptNumber, maxAttempts));
                this.prWatcher?.incrementAttempts(prUrl);
                this.notifyPam(agentName, problems, false);
            }
            catch (err) {
                console.warn(`PR watcher: failed to message ${agentName}:`, err.message);
            }
            return;
        }
        // Worker is not at a desk—check if they can be rehired
        const record = this.repos.getAgent(agentId);
        if (!record)
            return; // Worker doesn't exist anymore
        const isFired = this.repos.isFired(agentId);
        const isDone = record.status === 'done';
        if (!isFired && !isDone) {
            // Worker exists but is not rehirable (shouldn't happen, but handle it)
            return;
        }
        this.askToRehire(prEvent);
    }
    /**
     * Has the assistant ask Operator whether to rehire a fired or done worker for a PR
     * problem. A worker has one question; problems that come while it waits
     * are added to it, so the worker gets all of them at once.
     */
    askToRehire(event) {
        const pam = this.live.get(PAM_ID);
        if (!pam)
            return;
        const held = this.prAsks.get(event.agentId);
        if (held) {
            held.problems.push(...event.problems);
            held.request.questions[0].text = held.problems.map(describeProblem).join('\n\n');
            if (pam.question === held.request)
                this.bus.emit({ type: 'agent.question', agentId: PAM_ID, request: held.request });
            return;
        }
        const name = event.agentName;
        const title = `${name}'s PR #${event.number} has ${listPhrases(event.problems.map(problemNoun))}. Rehire ${name} to fix it?`;
        const request = {
            id: `pr-rehire-${event.agentId}-${Date.now().toString(36)}`,
            title,
            questions: [
                {
                    key: 'rehire',
                    header: null,
                    text: event.problems.map(describeProblem).join('\n\n'),
                    multiple: false,
                    options: [
                        { value: 'rehire', label: `Rehire ${name}`, description: null },
                        { value: 'not_now', label: 'Not now', description: null },
                    ],
                    otherKey: null,
                },
            ],
            createdAt: new Date().toISOString(),
        };
        this.prAsks.set(event.agentId, {
            agentId: event.agentId,
            agentName: name,
            prUrl: event.prUrl,
            branch: event.branch,
            attemptNumber: event.attemptNumber,
            problems: [...event.problems],
            request,
        });
        this.say(PAM_ID, 'agent', title);
        this.bus.toast(title, 'needs_you', PAM_ID);
        this.showPrAsk(pam);
    }
    /** Puts the oldest rehire question on the assistant's card, unless something else is on it. */
    showPrAsk(l) {
        if (!l.record.builtInPam || l.question)
            return;
        const ask = this.prAsks.values().next().value;
        if (!ask)
            return;
        l.question = ask.request;
        this.bus.emit({ type: 'agent.question', agentId: PAM_ID, request: ask.request });
    }
    /** Forgets a worker's rehire question, and takes it off the assistant's card if it is there. */
    dropPrAsk(agentId) {
        const ask = this.prAsks.get(agentId);
        if (!ask)
            return;
        this.prAsks.delete(agentId);
        const pam = this.live.get(PAM_ID);
        if (!pam || pam.question !== ask.request)
            return;
        pam.question = null;
        this.bus.emit({ type: 'agent.question', agentId: PAM_ID, request: null });
        this.showPrAsk(pam);
    }
    /** Operator said yes: brings the worker back and sends every problem the assistant asked about. */
    async rehireForPr(ask) {
        const message = prFixMessage(ask.problems, ask.branch, ask.attemptNumber, this.cfg.prWatch.maxFixAttempts);
        try {
            // Operator may have rehired them himself while the question waited.
            const rehired = this.live.has(ask.agentId) ? null : await this.rehire(ask.agentId);
            this.prWatcher?.incrementAttempts(ask.prUrl);
            await this.sendMessage(rehired?.id ?? ask.agentId, message);
            this.notifyPam(ask.agentName, ask.problems, rehired !== null);
        }
        catch (err) {
            if (err instanceof HireError && err.message === 'Every desk is taken.') {
                this.bus.toast(`${ask.agentName}'s PR needs attention but all desks are full.`, 'needs_you', ask.agentId);
            }
            else {
                console.warn(`PR watcher: failed to rehire ${ask.agentName}:`, err.message);
            }
        }
    }
    /**
     * Notifies the assistant (and through her, potentially remote messaging) about a PR issue.
     */
    notifyPam(workerName, problems, wasRehired) {
        const pam = this.live.get(PAM_ID);
        if (!pam)
            return;
        const action = wasRehired ? 'rehired' : 'notified';
        const what = problems.map(problemWhat).join(', and ');
        const report = `I ${action} ${workerName} because ${what} on their PR.`;
        this.say(PAM_ID, 'agent', report);
        this.bus.toast(report, 'info', PAM_ID);
    }
    /** the assistant tells Operator the day's timelapse has finished rendering, in her chat and as a toast. */
    announceDayReady() {
        if (!this.live.get(PAM_ID))
            return false;
        const report = 'Your day is ready.';
        this.say(PAM_ID, 'agent', report);
        this.bus.toast(report, 'info', PAM_ID);
        return true;
    }
}
export class HireError extends Error {
    reason;
    constructor(message, reason = 'bad_request') {
        super(message);
        this.reason = reason;
        this.name = 'HireError';
    }
}
/**
 * The office's own models, named the way the session names them ("Sonnet
 * 5.5" rather than "Sonnet"), with Default's hint saying what it comes to
 * ("Opus 5.5"), so the hire cards can say which model a worker gets, and
 * Default effort's hint the level it comes to ("Medium"). A model the
 * session does not offer keeps the office's name.
 */
export function namedModels(office, own) {
    const models = office.models.map((m) => {
        const theirs = own.models.find((t) => t.value === m.value);
        if (m.value === null)
            return theirs?.hint ? { ...m, hint: theirs.hint } : m;
        return theirs ? { ...m, label: theirs.label } : m;
    });
    const effortHint = own.efforts.find((e) => e.value === null)?.hint;
    const efforts = effortHint ? office.efforts.map((e) => (e.value === null ? { ...e, hint: effortHint } : e)) : office.efforts;
    return efforts === office.efforts && models.every((m, i) => m === office.models[i]) ? office : { ...office, models, efforts };
}
/**
 * Rejects a level, model or effort the office does not know, so a bad value
 * fails at the click rather than inside Claude Code later on.
 */
export function checkSetup(setup, efforts = EFFORT_CHOICES) {
    if (!PERMISSION_LEVELS.some((p) => p.value === setup.permission)) {
        throw new HireError(`"${setup.permission}" is not a permission level.`);
    }
    const model = setup.model?.trim() || null;
    const effort = setup.effort?.trim() || null;
    if (effort && ![...EFFORT_CHOICES, ...efforts].some((e) => e.value === effort)) {
        throw new HireError(`"${effort}" is not an effort level.`);
    }
    // Ids such as claude-sonnet-5 are allowed as well as the aliases, and
    // Ollama tagged models (e.g. qwen3.5:4b, library/qwen3.5:9b) are also permitted.
    if (model && !/^[a-z0-9][a-z0-9.\-\[\]:_/]*$/i.test(model)) {
        throw new HireError(`"${model}" is not a model name.`);
    }
    return { permission: setup.permission, model, effort: model && NO_EFFORT_MODELS.has(model) ? null : effort };
}
/** The persona's instructions as the brief's last section, so they read as the worker's role. */
function withRole(record, brief) {
    return record.instructions ? `${brief}\n\n## Your role\n\n${record.instructions}` : brief;
}
/** Added to every brief while the office is in Plain mode. */
export const PLAIN_AUDIENCE = [
    '## Who reads your messages',
    '',
    "The people following your work here don't read code. Write every message for them: say what you are doing and why in everyday words, name screens and features rather than files and functions, and keep code, commands and file paths out of your messages unless someone asks for them. Your work itself stays as precise as ever.",
].join('\n');
/** Tells a worker when to use the office's `recall` and `remember` tools; without it they rarely do. */
export const OFFICE_MEMORY = [
    '## Office memory',
    '',
    "The office keeps lessons about this repo from earlier workers. Call `recall` before you touch unfamiliar or fragile code, or when you hit an unexpected error. Call `remember` when you find a repo convention or gotcha, or when Operator corrects you on something that applies beyond this ticket. Don't save facts that only matter to this ticket.",
].join('\n');
/** Codex can turn a blocking question into choices instead of ending on plain text. */
export const CODEX_QUESTIONS = [
    '## Asking Operator a question',
    '',
    'Whenever you need Operator to answer before you can continue, use `request_user_input` and wait for the answer so the office shows clickable choices. This includes asking whether to install something or run or authorize a command. Do not ask a blocking question only in prose or only with a `QUESTION:` line. If a tool itself raises an approval prompt, use that prompt instead of asking the same question separately.',
].join('\n');
/** "Frontend Engineer - Ada". See autoWorkerName. */
export function personaName(base, taken, random = Math.random) {
    return autoWorkerName(base, taken, random);
}
/**
 * Checks a list of personas from Settings: names present, short enough to
 * number and unique, and a setup and look the office knows. Ids are kept
 * when given and made from the name when not.
 */
export function checkPersonas(list, efforts = EFFORT_CHOICES) {
    if (!Array.isArray(list))
        throw new HireError('Agents must be a list.');
    const seen = new Set();
    const ids = new Set();
    return list.map((raw) => {
        const p = (raw ?? {});
        const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : '';
        if (!name)
            throw new HireError('Every agent needs a name.');
        if (name.length > PERSONA_NAME_MAX) {
            throw new HireError(`"${name}" is too long. Keep agent names to ${PERSONA_NAME_MAX} characters.`);
        }
        if (seen.has(name.toLowerCase()))
            throw new HireError(`There are two agents called "${name}".`);
        seen.add(name.toLowerCase());
        const setup = checkSetup({
            permission: p.permission ?? 'standard',
            model: p.model ?? null,
            effort: p.effort ?? null,
        }, efforts);
        let id = typeof p.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id) ? p.id : slug(name);
        while (ids.has(id))
            id = `${id}-2`;
        ids.add(id);
        const description = typeof p.description === 'string' ? p.description.replace(/\s+/g, ' ').trim() : '';
        if (description.length > PERSONA_DESCRIPTION_MAX) {
            throw new HireError(`${name}'s description is too long. Keep it to ${PERSONA_DESCRIPTION_MAX} characters.`);
        }
        return {
            id,
            name,
            ...setup,
            look: cleanLook(p.look),
            instructions: typeof p.instructions === 'string' ? p.instructions.trim() : '',
            ...(description ? { description } : {}),
        };
    });
}
function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'persona';
}
/** What a worker is sent to fix its PR: every problem, then the branch to push to. */
function prFixMessage(problems, branch, attemptNumber, maxAttempts) {
    const problemDesc = problems.map(describeProblem).join('\n\n');
    const branchNote = branch ? `\n\nBranch: \`${branch}\`` : '';
    const attemptNote = attemptNumber > 1 ? ` (attempt ${attemptNumber}/${maxAttempts})` : '';
    return `Your PR needs attention${attemptNote}:\n\n${problemDesc}${branchNote}\n\nPlease fix this and push to the same branch.`;
}
/** What happened to a PR, as the end of "… because ___ on their PR." */
function problemWhat(problem) {
    switch (problem.kind) {
        case 'failed_check':
            return `CI check "${problem.checkName}" failed`;
        case 'conflict':
            return 'merge conflicts appeared';
        case 'review':
            return reviewSummary(problem);
    }
}
/** "a, b and c". */
function listPhrases(phrases) {
    if (phrases.length <= 1)
        return phrases[0] ?? '';
    return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}
/** What a PR has, as the end of "Ada's PR #123 has ___." */
function problemNoun(problem) {
    switch (problem.kind) {
        case 'failed_check':
            return `a failed check, "${problem.checkName}"`;
        case 'conflict':
            return 'merge conflicts';
        case 'review':
            if (!problem.comments)
                return 'a "changes requested" review';
            return problem.comments === 1 ? 'a new review comment' : `${problem.comments} new review comments`;
    }
}
function describeAnswer(request, answers) {
    return answerText(request, answers) ?? `Skipped: ${request.title}`;
}
/** What Operator picked or wrote, under the question's title; null when he gave no answer. */
function answerText(request, answers) {
    if (!answers)
        return null;
    const lines = request.questions.flatMap((q) => {
        const answer = answers[q.key];
        const labels = (answer?.picks ?? []).map((p) => q.options.find((o) => o.value === p)?.label ?? p);
        const other = answer?.other?.trim();
        const said = [...labels, ...(other ? [other] : [])].join(', ');
        if (!said)
            return [];
        return [request.questions.length > 1 ? `${q.header ?? q.text ?? q.key}: ${said}` : said];
    });
    return lines.length ? `${request.title}\n${lines.join('\n')}` : null;
}
/** The end of a thought, on one line, from a word boundary; null when there is none. */
function thoughtTail(thought) {
    const flat = (thought ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (flat.length <= THOUGHT_TAIL)
        return flat || null;
    const tail = flat.slice(-THOUGHT_TAIL);
    const space = tail.indexOf(' ');
    return `…${space > 0 && space < 40 ? tail.slice(space + 1) : tail}`;
}
