/**
 * Append-only list of migrations. `user_version` tracks how many have run, so
 * adding a statement to the end is the only safe way to change the schema.
 */
const MIGRATIONS = [
    // 1 — initial schema
    `
  CREATE TABLE tickets (
    key         TEXT PRIMARY KEY,
    summary     TEXT NOT NULL,
    description TEXT,
    type        TEXT,
    status      TEXT,
    phase       TEXT,
    points      INTEGER,
    url         TEXT,
    assignees   TEXT NOT NULL DEFAULT '[]',
    repo        TEXT,
    raw_json    TEXT,
    fetched_at  TEXT NOT NULL
  );

  CREATE TABLE agents (
    id             TEXT PRIMARY KEY,
    ticket_key     TEXT NOT NULL,
    ticket_summary TEXT NOT NULL DEFAULT '',
    name           TEXT NOT NULL,
    desk_index     INTEGER NOT NULL,
    status         TEXT NOT NULL,
    bubble         TEXT NOT NULL DEFAULT '',
    repo_path      TEXT NOT NULL,
    worktree_path  TEXT NOT NULL,
    branch         TEXT NOT NULL,
    base_branch    TEXT NOT NULL DEFAULT 'main',
    chat_id        TEXT,
    pr_url         TEXT,
    runner_mode    TEXT NOT NULL DEFAULT 'print',
    last_error     TEXT,
    created_at     TEXT NOT NULL,
    ended_at       TEXT
  );
  CREATE INDEX agents_status ON agents(status);

  CREATE TABLE messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   TEXT NOT NULL,
    role       TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_agent ON messages(agent_id, id);

  CREATE TABLE stream_log (
    agent_id TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    line     TEXT NOT NULL,
    PRIMARY KEY (agent_id, seq)
  );

  CREATE TABLE done (
    ticket_key TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    points     INTEGER NOT NULL DEFAULT 0,
    pr_url     TEXT,
    done_at    TEXT NOT NULL
  );

  CREATE TABLE game (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    xp              INTEGER NOT NULL DEFAULT 0,
    level           INTEGER NOT NULL DEFAULT 1,
    streak          INTEGER NOT NULL DEFAULT 0,
    streak_last_day TEXT
  );
  INSERT INTO game (id) VALUES (1);

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
    // 2 — workers seated from a worktree that already existed on disk
    `
  ALTER TABLE agents ADD COLUMN adopted INTEGER NOT NULL DEFAULT 0;
  `,
    // 3 — workers hired on a free-form request rather than a work order
    `
  ALTER TABLE agents ADD COLUMN ad_hoc INTEGER NOT NULL DEFAULT 0;
  `,
    // 4 — what the worker was hired for, which ad_hoc could not express once
    // research jobs arrived. ad_hoc is left behind: SQLite cannot drop a column
    // without rebuilding the table, and nothing reads it any more.
    `
  ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'ticket';
  UPDATE agents SET kind = 'ask' WHERE ad_hoc = 1;
  `,
    // 5 — standing approvals, so a worker stops asking about the same command
    // every turn. Kept per agent and not in the Cursor CLI's own allowlist,
    // which is machine-wide. The UNIQUE lets a repeat grant be a no-op.
    `
  CREATE TABLE grants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   TEXT NOT NULL,
    rule_key   TEXT NOT NULL,
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (agent_id, rule_key)
  );
  CREATE INDEX grants_agent ON grants(agent_id);
  `,
    // 6 — more than one conversation per worker, so a long one can be left
    // behind without losing it. agents.chat_id stays as the live session, and
    // mirrors whichever conversation is open; the table remembers the rest.
    //
    // The backfill gives every worker one conversation holding everything said
    // so far, which is what it has always effectively had.
    `
  CREATE TABLE conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   TEXT NOT NULL,
    chat_id    TEXT,
    title      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX conversations_agent ON conversations(agent_id, id);

  ALTER TABLE messages ADD COLUMN conversation_id INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE agents ADD COLUMN conversation_id INTEGER NOT NULL DEFAULT 0;

  INSERT INTO conversations (agent_id, chat_id, title, created_at)
    SELECT id, chat_id, '', created_at FROM agents;

  UPDATE messages SET conversation_id =
    (SELECT c.id FROM conversations c WHERE c.agent_id = messages.agent_id);
  UPDATE agents SET conversation_id =
    (SELECT c.id FROM conversations c WHERE c.agent_id = agents.id);

  CREATE INDEX messages_conversation ON messages(conversation_id, id);
  `,
    // 7 — names the conversations migration 6 created. They went in untitled,
    // because a title is taken from the first thing Operator says and there was
    // nowhere to take it from at the time. There is: the first thing he said.
    `
  UPDATE conversations SET title = COALESCE((
    SELECT substr(replace(replace(m.text, char(10), ' '), char(13), ' '), 1, 60)
    FROM messages m
    WHERE m.conversation_id = conversations.id AND m.role = 'you'
    ORDER BY m.id LIMIT 1
  ), '') WHERE title = '';
  `,
    // 8 — Jira alongside 8090. Ticket keys carry their source from here on, so
    // the two can never collide; everything already stored came from 8090.
    // Ad-hoc ASK-n jobs belong to no source and keep their keys.
    `
  ALTER TABLE tickets ADD COLUMN source TEXT NOT NULL DEFAULT '8090';
  UPDATE tickets SET key = '8090:' || key WHERE key NOT LIKE '%:%';
  UPDATE agents SET ticket_key = '8090:' || ticket_key WHERE kind = 'ticket' AND ticket_key NOT LIKE '%:%';
  UPDATE done SET ticket_key = '8090:' || ticket_key WHERE ticket_key NOT LIKE 'ASK-%' AND ticket_key NOT LIKE '%:%';
  `,
    // 9 — standing approvals belong to the office rather than one worker, so a
    // new hire starts with them, and there is one per program, so each can be
    // taken back on its own. A command approved as a whole splits into its
    // programs. A bare number is dropped: no program is called that, and it can
    // only be the `1` of a `2>&1` that the splitter used to read as one.
    `
  CREATE TABLE office_grants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_key   TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  INSERT INTO office_grants (rule_key, label, created_at)
    SELECT rule_key, MIN(label), MIN(created_at) FROM grants
    WHERE rule_key NOT LIKE 'shell:%'
    GROUP BY rule_key;

  WITH RECURSIVE parts(rest, program, created_at) AS (
    SELECT substr(rule_key, 7) || '+', NULL, created_at FROM grants WHERE rule_key LIKE 'shell:%'
    UNION ALL
    SELECT substr(rest, instr(rest, '+') + 1), substr(rest, 1, instr(rest, '+') - 1), created_at
    FROM parts WHERE rest <> ''
  )
  INSERT OR IGNORE INTO office_grants (rule_key, label, created_at)
    SELECT 'shell:' || program, program, MIN(created_at) FROM parts
    WHERE program <> '' AND program GLOB '*[^0-9]*'
    GROUP BY program;

  DROP TABLE grants;
  ALTER TABLE office_grants RENAME TO grants;
  `,
    // 10 — the brief a session opens with gets a role of its own, so the chat
    // can leave it out. Until now it went in as one of Operator's messages. A ticket
    // brief is the first message in its conversation and opens the way every
    // ticket brief does. An ad-hoc brief is left as it was, because what Operator
    // asked is inside it.
    `
  UPDATE messages SET role = 'brief'
  WHERE role = 'you'
    AND text LIKE 'You are picking up %'
    AND id IN (SELECT MIN(id) FROM messages GROUP BY conversation_id);
  `,
    `ALTER TABLE agents ADD COLUMN work_plan TEXT;`,
    `ALTER TABLE messages ADD COLUMN attachments TEXT;`,
    // 13 — each worker has its own permission level, model and effort. Workers
    // from before start as they always ran: standard, on the office's model.
    `
  ALTER TABLE agents ADD COLUMN permission TEXT NOT NULL DEFAULT 'standard';
  ALTER TABLE agents ADD COLUMN model TEXT;
  ALTER TABLE agents ADD COLUMN effort TEXT;
  `,
    // 14 — what each worker wears, as JSON. Null is the plain look they all had.
    `ALTER TABLE agents ADD COLUMN look TEXT;`,
    // 15 — the persona a worker was hired as, and the instructions it brought.
    `
  ALTER TABLE agents ADD COLUMN persona TEXT;
  ALTER TABLE agents ADD COLUMN instructions TEXT;
  `,
    // 16 — the Idea board: ideas kept here until they become Jira tickets.
    `
  CREATE TABLE ideas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    lane        TEXT NOT NULL DEFAULT 'inbox',
    archived    INTEGER NOT NULL DEFAULT 0,
    repo        TEXT,
    draft       TEXT,
    planner_id  TEXT,
    jira_key    TEXT,
    jira_url    TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  `,
    // 17 — Plain mode: each step a worker takes, said for someone who does not read code.
    `ALTER TABLE messages ADD COLUMN plain TEXT;`,
    // 18 — fired workers stay, so they can be rehired with the same name, look,
    // setup and chats. Mark done does not set this. Anyone already ended who
    // never landed in `done` was fired.
    `
  ALTER TABLE agents ADD COLUMN fired INTEGER NOT NULL DEFAULT 0;
  UPDATE agents SET fired = 1
  WHERE ended_at IS NOT NULL
    AND ticket_key NOT IN (SELECT ticket_key FROM done);
  `,
    // 19 — ideas can become tickets in any tracker, not only Jira. Every idea
    // already ticketed went to Jira.
    `
  ALTER TABLE ideas RENAME COLUMN jira_key TO ticket_key;
  ALTER TABLE ideas RENAME COLUMN jira_url TO ticket_url;
  ALTER TABLE ideas ADD COLUMN ticket_source TEXT;
  UPDATE ideas SET lane = 'ticket', ticket_source = 'jira' WHERE lane = 'jira';
  `,
    // 20 — the first-day quests: which are done or skipped, and whether the
    // guide was sent away. A quest's XP is paid when its row is first written.
    `
  CREATE TABLE onboarding (
    quest  TEXT PRIMARY KEY,
    state  TEXT NOT NULL,
    at     TEXT NOT NULL
  );
  `,
    // 21 — whether a cached ticket is assigned to the signed-in tracker user.
    // Older and non-supporting sources keep null, so their existing filters do
    // not change.
    `ALTER TABLE tickets ADD COLUMN assigned_to_me INTEGER;`,
    // 22 — the permanent secretary is an agent so she can keep chats and run
    // the configured CLI, but is never mistaken for an ordinary hire.
    `ALTER TABLE agents ADD COLUMN built_in_pam INTEGER NOT NULL DEFAULT 0;`,
    // 23 — the repo whose agent a worker was hired as, for the badge on its name tag.
    `ALTER TABLE agents ADD COLUMN persona_repo TEXT;`,
    // 24 — error classification: type and suggested action for showing recovery options.
    `
  ALTER TABLE agents ADD COLUMN error_type TEXT;
  ALTER TABLE agents ADD COLUMN error_action TEXT;
  `,
    // 25 — standing reviewer: a reviewer for a worker's finished work.
    // reviewer_id is the reviewer assigned to this worker.
    // reviewing_id is the worker this reviewer is reviewing.
    // review_rounds tracks how many fix → re-check cycles have happened.
    `
  ALTER TABLE agents ADD COLUMN reviewer_id TEXT;
  ALTER TABLE agents ADD COLUMN reviewing_id TEXT;
  ALTER TABLE agents ADD COLUMN review_rounds INTEGER NOT NULL DEFAULT 0;
  `,
    // 26 — Telegram Operator history: messages between the user and the operator.
    `
  CREATE TABLE telegram_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX telegram_messages_time ON telegram_messages(created_at DESC);
  `,
    // 27 — Office memory: lessons workers learn and get briefed with on new tickets.
    // FTS5 for keyword search, vectors stored separately for semantic search.
    `
  CREATE TABLE memories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    repo            TEXT NOT NULL,
    lesson          TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'convention',
    source          TEXT NOT NULL DEFAULT 'worker',
    worker_id       TEXT,
    worker_name     TEXT,
    ticket_key      TEXT,
    reviewer        TEXT,
    thread_url      TEXT,
    files           TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_used_at    TEXT,
    use_count       INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT,
    embedding       BLOB,
    stale           INTEGER NOT NULL DEFAULT 0,
    unseen_by_user  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX memories_repo ON memories(repo);
  CREATE INDEX memories_repo_kind ON memories(repo, kind);
  CREATE INDEX memories_stale ON memories(stale) WHERE stale = 1;

  CREATE VIRTUAL TABLE memories_fts USING fts5(
    lesson,
    files,
    content='memories',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, lesson, files) VALUES (new.id, new.lesson, new.files);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, lesson, files) VALUES ('delete', old.id, old.lesson, old.files);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, lesson, files) VALUES ('delete', old.id, old.lesson, old.files);
    INSERT INTO memories_fts(rowid, lesson, files) VALUES (new.id, new.lesson, new.files);
  END;
  `,
    // 28 — the office's day: who did what when, for the timelapse. Content-free:
    // no ticket titles, paths or repo names. Days before this table get their
    // moments from hire and finished-ticket times instead, from when it began.
    `
  CREATE TABLE office_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    worker_id   TEXT,
    worker_name TEXT NOT NULL DEFAULT '',
    at          TEXT NOT NULL
  );
  CREATE INDEX office_events_at ON office_events(at);
  INSERT OR REPLACE INTO meta (key, value) VALUES ('office_events_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  `,
    // 29 — an idea belongs to any number of repos, as a JSON list, and keeps its
    // own files. The one repo an idea had heads its list; ideas.repo is left
    // behind, unread. A worker hired on one of them reads the rest, never
    // changing them. Drafts not yet ticketed take the new footer, so no ticket
    // made from here on carries the old one.
    `
  ALTER TABLE ideas ADD COLUMN repos TEXT NOT NULL DEFAULT '[]';
  UPDATE ideas SET repos = json_array(repo) WHERE repo IS NOT NULL AND repo <> '';
  ALTER TABLE ideas ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE agents ADD COLUMN extra_repos TEXT NOT NULL DEFAULT '[]';
  UPDATE ideas SET draft = replace(draft,
    '_Drafted with AI assistance (Claude Code); reviewed by the reporter._',
    '_Drafted with AI assistance (AgentCorp); reviewed by the reporter._')
  WHERE draft IS NOT NULL AND lane <> 'ticket';
  `,
    // 30 — when an idea's ticket was found closed, so the Idea board can hide it.
    // Null while the ticket is open, or when it has not been checked.
    `
  ALTER TABLE ideas ADD COLUMN ticket_closed_at TEXT;
  `,
    // 31 — the worker hired on an idea's ticket, so the card can link to it.
    `
  ALTER TABLE ideas ADD COLUMN worker_id TEXT;
  `,
    // 32 — a worker switched to another agent, whose new chat has not been
    // briefed on the work order yet.
    `
  ALTER TABLE agents ADD COLUMN needs_brief INTEGER NOT NULL DEFAULT 0;
  `,
    // 33 — the slash commands a worker's session last reported, so the `/` menu
    // has them as soon as the office opens, before any session starts.
    `
  ALTER TABLE agents ADD COLUMN commands TEXT NOT NULL DEFAULT '[]';
  `,
    // 34 — a worker hired with Discuss, whose plan waits for Start work even in
    // auto mode until Operator approves it.
    `
  ALTER TABLE agents ADD COLUMN discuss INTEGER NOT NULL DEFAULT 0;
  `,
    // 35 — retired progression and remote messaging storage.
    `
  DROP TABLE IF EXISTS game;
  DROP TABLE IF EXISTS telegram_messages;
  `,
];
export function migrate(db) {
    const current = db.pragma('user_version', { simple: true });
    for (let i = current; i < MIGRATIONS.length; i++) {
        const sql = MIGRATIONS[i];
        if (!sql)
            continue;
        db.exec('BEGIN');
        try {
            db.exec(sql);
            db.pragma(`user_version = ${i + 1}`);
            db.exec('COMMIT');
        }
        catch (err) {
            db.exec('ROLLBACK');
            throw new Error(`migration ${i + 1} failed: ${err.message}`);
        }
    }
}
