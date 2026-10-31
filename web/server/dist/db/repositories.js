import { cleanLook, QUESTS, STREAM_LOG_LIMIT, } from '../protocol.js';
import { MemoryStore } from '../memory/store.js';
function toTicket(row) {
    let assignees = [];
    try {
        const parsed = JSON.parse(row.assignees);
        if (Array.isArray(parsed))
            assignees = parsed.filter((a) => typeof a === 'string');
    }
    catch {
        // A malformed cache row should not stop the board from rendering.
    }
    return {
        key: row.key,
        source: row.source,
        summary: row.summary,
        description: row.description,
        type: row.type,
        status: row.status,
        phase: row.phase,
        points: row.points,
        url: row.url,
        assignees,
        assignedToMe: row.assigned_to_me === null ? null : row.assigned_to_me === 1,
        repo: row.repo,
        fetchedAt: row.fetched_at,
    };
}
function toMessage(r) {
    const row = r;
    return {
        id: row.id,
        agentId: row.agent_id,
        conversationId: row.conversation_id,
        role: row.role,
        text: row.text,
        ...(row.plain ? { plain: row.plain } : {}),
        ...(row.attachments ? { attachments: JSON.parse(row.attachments) } : {}),
        createdAt: row.created_at,
    };
}
function toIdea(row) {
    const attachments = safeJson(row.attachments);
    return {
        id: row.id,
        title: row.title,
        notes: row.notes,
        lane: row.lane,
        archived: row.archived === 1,
        repos: stringList(row.repos),
        attachments: Array.isArray(attachments) ? attachments : [],
        draft: row.draft ? safeJson(row.draft) : null,
        plannerId: row.planner_id,
        workerId: row.worker_id,
        ticketSource: row.ticket_source,
        ticketKey: row.ticket_key,
        ticketUrl: row.ticket_url,
        ticketClosedAt: row.ticket_closed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function toAgent(row) {
    return {
        id: row.id,
        builtInPam: row.built_in_pam === 1,
        ticketKey: row.ticket_key,
        ticketSummary: row.ticket_summary,
        name: row.name,
        deskIndex: row.desk_index,
        status: row.status,
        bubble: row.bubble,
        // These three columns are NOT NULL from the first migration, so "no repo"
        // is stored as empty and mapped back here rather than rebuilding the table.
        repoPath: row.repo_path || null,
        extraRepos: stringList(row.extra_repos),
        worktreePath: row.worktree_path,
        branch: row.branch || null,
        baseBranch: row.base_branch || null,
        chatId: row.chat_id,
        prUrl: row.pr_url,
        runnerMode: row.runner_mode,
        model: null,
        adopted: row.adopted === 1,
        needsBrief: row.needs_brief === 1,
        discuss: row.discuss === 1,
        commands: commandList(row.commands),
        kind: row.kind,
        workPlan: row.work_plan,
        permission: row.permission,
        chosenModel: row.model,
        effort: row.effort,
        look: cleanLook(row.look ? safeJson(row.look) : null),
        persona: row.persona,
        personaRepo: row.persona_repo,
        instructions: row.instructions,
        pendingPermission: null, // in-memory only; a request dies with its process
        pendingQuestion: null,
        grants: [], // loaded separately, by whoever seats the agent
        conversationId: row.conversation_id,
        conversations: [],
        queuedMessages: 0,
        sessionLive: false,
        runningSince: null,
        activity: 'idle',
        lastError: row.last_error,
        errorType: row.error_type,
        errorAction: row.error_action,
        createdAt: row.created_at,
        endedAt: row.ended_at,
        reviewerId: row.reviewer_id,
        reviewingId: row.reviewing_id,
        reviewRounds: row.review_rounds,
    };
}
export class Repositories {
    db;
    /** The office memory store for this database. */
    memory;
    constructor(db) {
        this.db = db;
        this.memory = new MemoryStore(db);
    }
    /** Counts account switches, so work started on one account can tell it must not write to the next. */
    generation = 0;
    /** Switches the active account database after all live work has stopped. */
    switchDatabase(next) {
        const previous = this.db;
        this.db = next;
        this.generation++;
        // Recreate memory store with new database
        this.memory = new MemoryStore(next);
        previous.close();
    }
    /* ---------- tickets ---------- */
    /** Replaces the cached board in one transaction so a failed poll can't half-write it. */
    replaceTickets(source, tickets, rawByKey = new Map()) {
        const insert = this.db.prepare(`
      INSERT INTO tickets (key, source, summary, description, type, status, phase, points, url, assignees, assigned_to_me, repo, raw_json, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM tickets WHERE source = ?').run(source);
            for (const t of tickets) {
                const raw = rawByKey.get(t.key);
                insert.run(t.key, source, t.summary, t.description, t.type, t.status, t.phase, t.points, t.url, JSON.stringify(t.assignees), t.assignedToMe === null ? null : Number(t.assignedToMe), t.repo, raw === undefined ? null : JSON.stringify(raw), t.fetchedAt);
            }
        })();
    }
    listTickets() {
        return this.db.prepare('SELECT * FROM tickets ORDER BY key').all().map((r) => toTicket(r));
    }
    getTicket(key) {
        const row = this.db.prepare('SELECT * FROM tickets WHERE key = ?').get(key);
        return row ? toTicket(row) : null;
    }
    /* ---------- agents ---------- */
    /**
     * The next free `ASK-n` key for an ad-hoc job.
     *
     * Derived from the rows rather than a stored counter, so it survives a
     * restart without a migration. Finished agents keep their rows, so numbers
     * are never handed out twice.
     */
    nextAskNumber() {
        const rows = this.db
            .prepare("SELECT ticket_key FROM agents WHERE ticket_key LIKE 'ASK-%'")
            .all();
        let max = 0;
        for (const r of rows) {
            const n = Number(/^ASK-(\d+)$/.exec(r.ticket_key)?.[1] ?? 0);
            if (n > max)
                max = n;
        }
        return max + 1;
    }
    insertAgent(a) {
        this.db.prepare(`
      INSERT INTO agents (id, built_in_pam, ticket_key, ticket_summary, name, desk_index, status, bubble,
                          repo_path, extra_repos, worktree_path, branch, base_branch, chat_id, pr_url,
                          runner_mode, adopted, discuss, kind, work_plan, permission, model, effort, look, persona, persona_repo, instructions,
                          conversation_id, last_error, error_type, error_action, reviewer_id, reviewing_id, review_rounds,
                          created_at, ended_at)
      VALUES (@id, @built_in_pam, @ticket_key, @ticket_summary, @name, @desk_index, @status, @bubble,
              @repo_path, @extra_repos, @worktree_path, @branch, @base_branch, @chat_id, @pr_url,
              @runner_mode, @adopted, @discuss, @kind, @work_plan, @permission, @model, @effort, @look, @persona, @persona_repo, @instructions,
              @conversation_id, @last_error, @error_type, @error_action, @reviewer_id, @reviewing_id, @review_rounds,
              @created_at, @ended_at)
    `).run({
            id: a.id,
            built_in_pam: a.builtInPam ? 1 : 0,
            ticket_key: a.ticketKey,
            ticket_summary: a.ticketSummary,
            name: a.name,
            desk_index: a.deskIndex,
            status: a.status,
            bubble: a.bubble,
            repo_path: a.repoPath ?? '',
            extra_repos: JSON.stringify(a.extraRepos ?? []),
            worktree_path: a.worktreePath,
            branch: a.branch ?? '',
            base_branch: a.baseBranch ?? '',
            chat_id: a.chatId,
            pr_url: a.prUrl,
            runner_mode: a.runnerMode,
            adopted: a.adopted ? 1 : 0,
            discuss: a.discuss ? 1 : 0,
            kind: a.kind,
            work_plan: a.workPlan,
            permission: a.permission,
            model: a.chosenModel,
            effort: a.effort,
            look: JSON.stringify(a.look),
            persona: a.persona,
            persona_repo: a.personaRepo ?? null,
            instructions: a.instructions,
            conversation_id: a.conversationId,
            last_error: a.lastError,
            error_type: a.errorType ?? null,
            error_action: a.errorAction ?? null,
            reviewer_id: a.reviewerId ?? null,
            reviewing_id: a.reviewingId ?? null,
            review_rounds: a.reviewRounds ?? 0,
            created_at: a.createdAt,
            ended_at: a.endedAt,
        });
    }
    updateAgent(id, patch) {
        const columns = {
            name: 'name',
            ticketSummary: 'ticket_summary',
            permission: 'permission',
            chosenModel: 'model',
            effort: 'effort',
            look: 'look',
            status: 'status',
            bubble: 'bubble',
            chatId: 'chat_id',
            prUrl: 'pr_url',
            lastError: 'last_error',
            errorType: 'error_type',
            errorAction: 'error_action',
            endedAt: 'ended_at',
            fired: 'fired',
            deskIndex: 'desk_index',
            runnerMode: 'runner_mode',
            conversationId: 'conversation_id',
            workPlan: 'work_plan',
            worktreePath: 'worktree_path',
            branch: 'branch',
            baseBranch: 'base_branch',
            repoPath: 'repo_path',
            extraRepos: 'extra_repos',
            adopted: 'adopted',
            needsBrief: 'needs_brief',
            discuss: 'discuss',
            commands: 'commands',
            reviewerId: 'reviewer_id',
            reviewingId: 'reviewing_id',
            reviewRounds: 'review_rounds',
        };
        const notNull = new Set(['branch', 'baseBranch', 'repoPath']);
        const sets = [];
        const values = [];
        for (const [key, value] of Object.entries(patch)) {
            const column = columns[key];
            if (!column)
                continue;
            sets.push(`${column} = ?`);
            // The look, the commands and the extra repos are object-valued, stored as JSON.
            const stored = key === 'look' ? JSON.stringify(value) : key === 'commands' || key === 'extraRepos' ? JSON.stringify(value ?? []) : key === 'fired' || key === 'adopted' || key === 'needsBrief' || key === 'discuss' ? (value ? 1 : 0) : value;
            values.push(stored ?? (notNull.has(key) ? '' : null));
        }
        if (!sets.length)
            return;
        this.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }
    /** Live agents only: anything still holding a desk. */
    listActiveAgents() {
        return this.db
            .prepare('SELECT * FROM agents WHERE ended_at IS NULL AND fired = 0 ORDER BY created_at')
            .all()
            .map((r) => toAgent(r));
    }
    builtInPam() {
        const row = this.db.prepare('SELECT * FROM agents WHERE built_in_pam = 1 LIMIT 1').get();
        return row ? toAgent(row) : null;
    }
    /** Every worker who has left the floor, newest first. */
    listEndedAgents() {
        return this.db
            .prepare('SELECT * FROM agents WHERE ended_at IS NOT NULL ORDER BY ended_at DESC')
            .all()
            .map((r) => toAgent(r));
    }
    isEnded(id) {
        const row = this.db.prepare('SELECT ended_at FROM agents WHERE id = ?').get(id);
        return row?.ended_at !== null && row?.ended_at !== undefined;
    }
    isFired(id) {
        const row = this.db.prepare('SELECT fired FROM agents WHERE id = ?').get(id);
        return row?.fired === 1;
    }
    /** The worktree of every worker still fired, so adoption leaves them be. */
    listFiredWorktreePaths() {
        return this.db
            .prepare("SELECT DISTINCT worktree_path FROM agents WHERE fired = 1 AND worktree_path <> ''")
            .all().map((r) => r.worktree_path);
    }
    /* ---------- ideas ---------- */
    listIdeas() {
        return this.db.prepare('SELECT * FROM ideas ORDER BY updated_at DESC, id DESC').all().map(toIdea);
    }
    getIdea(id) {
        const row = this.db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
        return row ? toIdea(row) : null;
    }
    insertIdea(title, notes, repos = []) {
        const now = new Date().toISOString();
        const { lastInsertRowid } = this.db
            .prepare('INSERT INTO ideas (title, notes, repos, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(title, notes, JSON.stringify(repos), now, now);
        return this.getIdea(Number(lastInsertRowid));
    }
    /** Changes the given fields and stamps the idea as updated. */
    updateIdea(id, patch) {
        const columns = {
            title: 'title',
            notes: 'notes',
            lane: 'lane',
            archived: 'archived',
            repos: 'repos',
            attachments: 'attachments',
            draft: 'draft',
            plannerId: 'planner_id',
            workerId: 'worker_id',
            ticketSource: 'ticket_source',
            ticketKey: 'ticket_key',
            ticketUrl: 'ticket_url',
            ticketClosedAt: 'ticket_closed_at',
        };
        // Kept as JSON; a draft can also be cleared to null.
        const json = new Set(['repos', 'attachments', 'draft']);
        const sets = ['updated_at = ?'];
        const values = [new Date().toISOString()];
        for (const [key, value] of Object.entries(patch)) {
            const column = columns[key];
            if (!column || value === undefined)
                continue;
            sets.push(`${column} = ?`);
            values.push(key === 'archived' ? (value ? 1 : 0) : json.has(key) ? (value ? JSON.stringify(value) : null) : value);
        }
        this.db.prepare(`UPDATE ideas SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
        return this.getIdea(id);
    }
    getAgent(id) {
        const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        return row ? toAgent(row) : null;
    }
    findActiveAgentByTicket(key) {
        const row = this.db.prepare('SELECT * FROM agents WHERE ticket_key = ? AND ended_at IS NULL').get(key);
        return row ? toAgent(row) : null;
    }
    /**
     * A process never survives a restart, so anything mid-flight comes back as
     * 'idle' with its chat id intact, ready for Resume.
     */
    demoteRunningAgentsOnBoot() {
        const rows = this.db
            .prepare("SELECT id FROM agents WHERE ended_at IS NULL AND status IN ('starting','working','needs_you') ORDER BY created_at")
            .all();
        if (rows.length) {
            this.db.prepare(`
        UPDATE agents SET status = 'idle', bubble = 'Stopped when the office closed. Resume me?'
        WHERE ended_at IS NULL AND status IN ('starting','working','needs_you')
      `).run();
        }
        return rows.map((r) => r.id);
    }
    /**
     * Workers left in `error` by something a fresh process can get past: a crash,
     * a dropped connection, a busy service. Sign-in, quota, a missing CLI or a
     * model that is not there would fail again, so they wait for Operator.
     */
    listRetryableErroredAgents() {
        return this.db
            .prepare(`
        SELECT id FROM agents
        WHERE ended_at IS NULL AND fired = 0 AND built_in_pam = 0 AND status = 'error'
          AND error_type IN ('process','connection','overloaded','rate_limit')
        ORDER BY created_at
      `)
            .all().map((r) => r.id);
    }
    /* ---------- standing approvals ---------- */
    /** The office's, shared by every worker. */
    listGrants() {
        return this.db
            .prepare('SELECT * FROM grants ORDER BY id')
            .all()
            .map((r) => {
            const row = r;
            return { id: row.id, key: row.rule_key, label: row.label, createdAt: row.created_at };
        });
    }
    /** Idempotent: granting the same rule twice leaves the first one in place. */
    addGrant(key, label) {
        this.db
            .prepare(`INSERT INTO grants (rule_key, label, created_at) VALUES (?, ?, ?)
         ON CONFLICT (rule_key) DO NOTHING`)
            .run(key, label, new Date().toISOString());
    }
    removeGrant(id) {
        this.db.prepare('DELETE FROM grants WHERE id = ?').run(id);
    }
    /* ---------- conversations ---------- */
    /** Newest first, which is the order the History menu wants them in. */
    listConversations(agentId) {
        return this.db
            .prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n
        FROM conversations c WHERE c.agent_id = ? ORDER BY c.id DESC
      `)
            .all(agentId)
            .map((r) => {
            const row = r;
            return {
                id: row.id,
                chatId: row.chat_id,
                title: row.title,
                messageCount: row.n,
                createdAt: row.created_at,
            };
        });
    }
    startConversation(agentId, title = '') {
        const info = this.db
            .prepare('INSERT INTO conversations (agent_id, chat_id, title, created_at) VALUES (?, NULL, ?, ?)')
            .run(agentId, title, new Date().toISOString());
        return Number(info.lastInsertRowid);
    }
    getConversation(agentId, id) {
        return this.listConversations(agentId).find((c) => c.id === id) ?? null;
    }
    /**
     * Remembers the Cursor session behind a conversation, so reopening it later
     * resumes that chat rather than starting a blank one.
     */
    setConversationChatId(id, chatId) {
        this.db.prepare('UPDATE conversations SET chat_id = ? WHERE id = ?').run(chatId, id);
    }
    /** Set once, from the first thing Operator says in a conversation. An Ask's is renamed later. */
    nameConversationIfUnnamed(id, title) {
        this.db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND title = ''").run(title, id);
    }
    /** An Ask's conversation, renamed as it becomes clear what it is about. */
    renameConversation(id, title) {
        this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
    }
    /* ---------- messages ---------- */
    addMessage(agentId, conversationId, role, text, attachments = [], plain = null) {
        const createdAt = new Date().toISOString();
        const info = this.db
            .prepare('INSERT INTO messages (agent_id, conversation_id, role, text, attachments, plain, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(agentId, conversationId, role, text, attachments.length ? JSON.stringify(attachments) : null, plain, createdAt);
        return {
            id: Number(info.lastInsertRowid),
            agentId,
            conversationId,
            role,
            text,
            ...(plain ? { plain } : {}),
            ...(attachments.length ? { attachments } : {}),
            createdAt,
        };
    }
    listMessages(conversationId) {
        return this.db
            .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id')
            .all(conversationId)
            .map(toMessage);
    }
    /**
     * Messages for every live agent, for the first-paint snapshot — but only
     * from the conversation each one has open. An earlier conversation is
     * fetched on demand, since there is no telling how many there are.
     */
    listMessagesForActiveAgents() {
        return this.db
            .prepare(`
        SELECT m.* FROM messages m
        JOIN agents a ON a.id = m.agent_id AND a.conversation_id = m.conversation_id
        WHERE a.ended_at IS NULL ORDER BY m.id
      `)
            .all()
            .map(toMessage);
    }
    /* ---------- stream log ---------- */
    appendStream(agentId, lines) {
        if (!lines.length)
            return;
        const next = this.db
            .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM stream_log WHERE agent_id = ?')
            .get(agentId).m;
        const insert = this.db.prepare('INSERT INTO stream_log (agent_id, seq, line) VALUES (?, ?, ?)');
        this.db.transaction(() => {
            lines.forEach((line, i) => insert.run(agentId, next + i + 1, line));
            this.db
                .prepare('DELETE FROM stream_log WHERE agent_id = ? AND seq <= ?')
                .run(agentId, next + lines.length - STREAM_LOG_LIMIT);
        })();
    }
    listStream(agentId) {
        return this.db
            .prepare('SELECT line FROM stream_log WHERE agent_id = ? ORDER BY seq')
            .all(agentId).map((r) => r.line);
    }
    /* ---------- done ---------- */
    addDone(entry) {
        this.db
            .prepare(`
        INSERT INTO done (ticket_key, title, points, pr_url, done_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticket_key) DO UPDATE SET title = excluded.title, points = excluded.points,
          pr_url = excluded.pr_url, done_at = excluded.done_at
      `)
            .run(entry.ticketKey, entry.title, entry.points, entry.prUrl, entry.doneAt);
    }
    listDone() {
        return this.db.prepare('SELECT * FROM done ORDER BY done_at DESC').all().map((r) => ({
            ticketKey: r.ticket_key, title: r.title, points: r.points, prUrl: r.pr_url, doneAt: r.done_at,
        }));
    }
    countDoneSince(isoDay) {
        return this.db
            .prepare('SELECT COUNT(*) AS n FROM done WHERE done_at >= ?')
            .get(isoDay).n;
    }
    countDone() {
        return this.db.prepare('SELECT COUNT(*) AS n FROM done').get().n;
    }
    countDoneWithPr() {
        return this.db.prepare("SELECT COUNT(*) AS n FROM done WHERE pr_url IS NOT NULL AND pr_url <> ''").get().n;
    }
    countAgents() {
        return this.db.prepare('SELECT COUNT(*) AS n FROM agents WHERE built_in_pam = 0').get().n;
    }
    /* ---------- the office's day ---------- */
    /** Records one moment of the day: what kind, who and when, and nothing about the work itself. */
    addOfficeEvent(kind, workerId, workerName, at = new Date().toISOString()) {
        this.db
            .prepare('INSERT INTO office_events (kind, worker_id, worker_name, at) VALUES (?, ?, ?, ?)')
            .run(kind, workerId, workerName, at);
    }
    /**
     * The moments from `from` up to `to` (ISO times), oldest first, and the
     * workers in them with their looks. Before the record began, a day has
     * only its hires and finished tickets, from the agents and done tables.
     * Ticket titles come from the done table, and only when `titles` asks.
     */
    getOfficeDay(from, to, titles) {
        const titleOf = titles
            ? `(SELECT d.title FROM done d JOIN agents a ON a.ticket_key = d.ticket_key WHERE a.id = e.worker_id ORDER BY d.done_at DESC LIMIT 1)`
            : 'NULL';
        const rows = this.db
            .prepare(`
        SELECT e.kind, e.worker_id, e.worker_name, e.at, CASE WHEN e.kind = 'done' THEN ${titleOf} END AS title
        FROM office_events e WHERE e.at >= ? AND e.at < ? ORDER BY e.at, e.id
      `)
            .all(from, to);
        const since = this.getMeta('office_events_since') ?? from;
        if (from < since) {
            const until = to < since ? to : since;
            const hires = this.db
                .prepare(`
          SELECT 'hire' AS kind, id AS worker_id, name AS worker_name, created_at AS at, NULL AS title
          FROM agents WHERE built_in_pam = 0 AND created_at >= ? AND created_at < ?
        `)
                .all(from, until);
            const done = this.db
                .prepare(`
          SELECT 'done' AS kind, a.id AS worker_id, COALESCE(a.name, '') AS worker_name, d.done_at AS at, ${titles ? 'd.title' : 'NULL'} AS title, d.pr_url
          FROM done d
          LEFT JOIN agents a ON a.id = (SELECT id FROM agents WHERE ticket_key = d.ticket_key AND built_in_pam = 0 ORDER BY created_at DESC LIMIT 1)
          WHERE d.done_at >= ? AND d.done_at < ?
        `)
                .all(from, until);
            // When a PR opened isn't kept, only that the ticket had one: its moment comes just before the ticket's.
            const made = done.flatMap(({ pr_url, ...d }) => (pr_url ? [{ ...d, kind: 'pr', title: null }, d] : [d]));
            rows.unshift(...[...hires, ...made].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)));
        }
        const events = rows.map((r) => ({
            kind: r.kind,
            workerId: r.worker_id,
            workerName: r.worker_name,
            at: r.at,
            ...(titles && r.title ? { title: r.title } : {}),
        }));
        const ids = [...new Set(events.map((e) => e.workerId).filter((id) => !!id))];
        const found = ids.length
            ? this.db.prepare(`SELECT id, name, look FROM agents WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
            : [];
        const byId = new Map(found.map((a) => [a.id, a]));
        const workers = ids.map((id) => {
            const a = byId.get(id);
            const named = events.find((e) => e.workerId === id)?.workerName ?? '';
            return { id, name: a?.name ?? named, look: a?.look ? cleanLook(safeJson(a.look)) : null };
        });
        return { from, to, events, workers };
    }
    /* ---------- setup ---------- */
    /** The first-day quests: done, skipped, and whether the guide was sent away. */
    getOnboarding() {
        const rows = this.db.prepare('SELECT quest, state FROM onboarding').all();
        const questIds = new Set(QUESTS.map((quest) => quest.id));
        const ids = (state) => rows.filter((r) => r.state === state && questIds.has(r.quest)).map((r) => r.quest);
        // A replay saved by an older first day names a step that is gone: start it from the top.
        const replay = rows.find((r) => r.quest === 'tour' && r.state.startsWith('replay:'))?.state.slice('replay:'.length);
        const seenHints = rows
            .filter((r) => r.quest.startsWith('hint:') && r.state === 'seen')
            .map((r) => r.quest.slice('hint:'.length));
        return {
            done: ids('done'),
            skipped: ids('skipped'),
            tourDismissed: rows.some((r) => r.quest === 'tour' && r.state === 'dismissed'),
            tourReplay: replay === undefined ? null : questIds.has(replay) ? replay : QUESTS[0].id,
            seenHints,
        };
    }
    /** Records a one-time hint as seen. Returns false when it was already seen. */
    markHintSeen(hintId) {
        const { changes } = this.db
            .prepare('INSERT OR IGNORE INTO onboarding (quest, state, at) VALUES (?, ?, ?)')
            .run(`hint:${hintId}`, 'seen', new Date().toISOString());
        return changes > 0;
    }
    /** Records a quest's state. Returns false when it was already recorded, so its XP is paid only once. */
    markQuest(quest, state) {
        const { changes } = this.db
            .prepare('INSERT OR IGNORE INTO onboarding (quest, state, at) VALUES (?, ?, ?)')
            .run(quest, state, new Date().toISOString());
        return changes > 0;
    }
    setTourDismissed(dismissed) {
        if (dismissed) {
            this.db
                .prepare("INSERT OR REPLACE INTO onboarding (quest, state, at) VALUES ('tour', 'dismissed', ?)")
                .run(new Date().toISOString());
        }
        else {
            this.db.prepare("DELETE FROM onboarding WHERE quest = 'tour'").run();
        }
    }
    restartTour(first) {
        this.db
            .prepare("INSERT OR REPLACE INTO onboarding (quest, state, at) VALUES ('tour', ?, ?)")
            .run(`replay:${first}`, new Date().toISOString());
        return this.getOnboarding();
    }
    /* ---------- meta ---------- */
    getMeta(key) {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
        return row?.value ?? null;
    }
    setMeta(key, value) {
        this.db
            .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, value);
    }
    /* ---------- standup ---------- */
    /**
     * Assembles data for the assistant's morning standup: work done since `since`,
     * blocked workers, in-progress work, and top worker stats.
     */
    getStandupData(since) {
        // Done entries since the given timestamp
        const done = this.db.prepare(`
      SELECT ticket_key, title, pr_url, done_at
      FROM done WHERE done_at >= ? ORDER BY done_at DESC
    `).all(since)
            .map((r) => ({ ticketKey: r.ticket_key, title: r.title, prUrl: r.pr_url, doneAt: r.done_at }));
        // Blocked workers: those with status 'needs_you', 'error', or 'idle' with pending permission/question
        // Oldest first so Operator sees the longest-waiting ones at the top
        const blocked = this.db.prepare(`
      SELECT id, name, ticket_key, bubble, status, created_at
      FROM agents
      WHERE ended_at IS NULL AND fired = 0
        AND (status IN ('needs_you', 'error') OR (status = 'idle' AND bubble LIKE '%Resume%'))
      ORDER BY created_at ASC
    `).all()
            .map((r) => ({ id: r.id, name: r.name, ticketKey: r.ticket_key, bubble: r.bubble, status: r.status, stuckSince: r.created_at }));
        // In-progress: workers currently working or starting
        const inProgress = this.db.prepare(`
      SELECT id, name, ticket_key, ticket_summary, status
      FROM agents
      WHERE ended_at IS NULL AND fired = 0
        AND status IN ('working', 'starting', 'review')
      ORDER BY created_at ASC
    `).all()
            .map((r) => ({ id: r.id, name: r.name, ticketKey: r.ticket_key, summary: r.ticket_summary, status: r.status }));
        // Top worker: who completed the most since the given timestamp
        // We look at done entries and try to match them with agent names
        let topWorker = null;
        if (done.length > 0) {
            // Count completions per ticket key, then try to find the agent that worked on them
            const completedKeys = new Set(done.map((d) => d.ticketKey));
            const agentCompletions = this.db.prepare(`
        SELECT name, COUNT(*) as cnt
        FROM agents
        WHERE ticket_key IN (${[...completedKeys].map(() => '?').join(',')})
          AND ended_at IS NOT NULL
        GROUP BY name
        ORDER BY cnt DESC
        LIMIT 1
      `).all(...completedKeys);
            if (agentCompletions.length > 0 && agentCompletions[0].cnt > 0) {
                topWorker = { name: agentCompletions[0].name, count: agentCompletions[0].cnt };
            }
        }
        return { done, blocked, inProgress, topWorker };
    }
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
/** A JSON list of strings, or an empty one for anything else. */
function stringList(text) {
    const parsed = text ? safeJson(text) : null;
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
}
/** A JSON list of slash commands, or an empty one for anything else. */
function commandList(text) {
    const parsed = text ? safeJson(text) : null;
    return Array.isArray(parsed)
        ? parsed.filter((c) => typeof c?.name === 'string' && typeof c.description === 'string')
        : [];
}
