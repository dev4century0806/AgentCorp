/**
 * Memory store: SQLite + FTS5 for keyword search + vector similarity for semantic search.
 *
 * Hybrid search merges keyword matches (exact file/function names) with semantic
 * matches (lessons phrased differently), boosted by file relevance.
 */
import { embed as embedText, EMBEDDING_DIM, EMBEDDING_MODEL } from './embedder.js';
function toMemory(row) {
    let files = [];
    try {
        const parsed = JSON.parse(row.files);
        if (Array.isArray(parsed))
            files = parsed.filter((f) => typeof f === 'string');
    }
    catch {
        // Malformed JSON shouldn't break the UI
    }
    return {
        id: row.id,
        repo: row.repo,
        lesson: row.lesson,
        kind: row.kind,
        source: row.source,
        workerId: row.worker_id,
        workerName: row.worker_name,
        ticketKey: row.ticket_key,
        reviewer: row.reviewer,
        threadUrl: row.thread_url,
        files,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at,
        useCount: row.use_count,
        embeddingModel: row.embedding_model,
        stale: row.stale === 1,
        unseenByUser: row.unseen_by_user === 1,
    };
}
/** Words too common to say anything about which lesson a query wants. */
const FTS_STOPWORDS = new Set([
    'and', 'the', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'not', 'but', 'you', 'your',
    'can', 'should', 'when', 'what', 'how', 'its', 'has', 'have', 'add', 'like', 'use', 'make',
]);
/**
 * Turns free text (a ticket title, a file path, an error) into an FTS5 query
 * that matches a lesson sharing any of its words. Raw text is not safe to
 * pass: punctuation such as `(`, `.` or `"` is query syntax, and bare words
 * must all match. When embeddings are unavailable this is the only search.
 */
export function ftsQuery(text) {
    const words = new Set((text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => w.length >= 3 && !FTS_STOPWORDS.has(w)));
    return [...words].map((w) => `"${w}"`).join(' OR ');
}
/** Days without use before a memory is flagged as stale. */
const STALE_DAYS = 90;
export class MemoryStore {
    db;
    embed;
    /** @param embed Turns text into a vector; tests pass their own so results don't depend on the model. */
    constructor(db, embed = embedText) {
        this.db = db;
        this.embed = embed;
    }
    /* ---------- CRUD ---------- */
    /**
     * Save a new memory. Called by workers via `remember` or by users via UI.
     * Generates embedding asynchronously.
     */
    async save(repo, input, source, context) {
        const now = new Date().toISOString();
        const files = JSON.stringify(input.files ?? []);
        // Generate embedding
        let embedding = null;
        try {
            const vec = await this.embed(input.lesson);
            embedding = Buffer.from(vec.buffer);
        }
        catch {
            // Embedding can fail if model fails to load; save without it
        }
        const info = this.db.prepare(`
      INSERT INTO memories (
        repo, lesson, kind, source, worker_id, worker_name, ticket_key,
        reviewer, thread_url, files, created_at, updated_at,
        embedding_model, embedding, unseen_by_user
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(repo, input.lesson, input.kind ?? 'convention', source, context?.workerId ?? null, context?.workerName ?? null, context?.ticketKey ?? null, input.reviewer ?? null, input.threadUrl ?? null, files, now, now, embedding ? EMBEDDING_MODEL : null, embedding, source === 'worker' ? 1 : 0);
        return this.get(Number(info.lastInsertRowid));
    }
    /** Update an existing memory's lesson and re-embed. */
    async update(id, input) {
        const existing = this.get(id);
        if (!existing)
            return null;
        const now = new Date().toISOString();
        const files = JSON.stringify(input.files ?? existing.files);
        // Re-generate embedding
        let embedding = null;
        try {
            const vec = await this.embed(input.lesson);
            embedding = Buffer.from(vec.buffer);
        }
        catch {
            // Keep going without embedding
        }
        this.db.prepare(`
      UPDATE memories SET
        lesson = ?, kind = ?, files = ?, updated_at = ?,
        embedding_model = ?, embedding = ?
      WHERE id = ?
    `).run(input.lesson, input.kind ?? existing.kind, files, now, embedding ? EMBEDDING_MODEL : null, embedding, id);
        return this.get(id);
    }
    get(id) {
        const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
        return row ? toMemory(row) : null;
    }
    delete(id) {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    }
    /** List all memories for a repo, newest first. */
    listForRepo(repo) {
        return this.db
            .prepare('SELECT * FROM memories WHERE repo = ? ORDER BY updated_at DESC')
            .all(repo)
            .map(toMemory);
    }
    /** Count memories for a repo. */
    countForRepo(repo) {
        return this.db
            .prepare('SELECT COUNT(*) as n FROM memories WHERE repo = ?')
            .get(repo).n;
    }
    /** Mark a memory as seen by the user. */
    markSeen(id) {
        this.db.prepare('UPDATE memories SET unseen_by_user = 0 WHERE id = ?').run(id);
    }
    /** Mark several memories as seen by the user, in batches under SQLite's variable limit. */
    markSeenMany(ids) {
        const batch = 500;
        this.db.transaction(() => {
            for (let i = 0; i < ids.length; i += batch) {
                const chunk = ids.slice(i, i + batch);
                const marks = chunk.map(() => '?').join(', ');
                this.db.prepare(`UPDATE memories SET unseen_by_user = 0 WHERE id IN (${marks})`).run(...chunk);
            }
        })();
    }
    /** Mark memories as used (for usage tracking). */
    recordUsage(ids, workerId, ticketKey) {
        if (ids.length === 0)
            return;
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      UPDATE memories SET use_count = use_count + 1, last_used_at = ?, stale = 0
      WHERE id = ?
    `);
        this.db.transaction(() => {
            for (const id of ids)
                stmt.run(now, id);
        })();
    }
    /** Flag memories that haven't been used in STALE_DAYS. */
    flagStale() {
        const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { changes } = this.db.prepare(`
      UPDATE memories SET stale = 1
      WHERE stale = 0 AND (last_used_at IS NULL OR last_used_at < ?)
        AND created_at < ?
    `).run(cutoff, cutoff);
        return changes;
    }
    /* ---------- Search ---------- */
    /**
     * Hybrid search: FTS5 keyword search + vector similarity, merged and ranked.
     *
     * @param repo The repo to search in
     * @param query The search query (ticket title/description or free text)
     * @param limit Max results to return
     * @param boostFiles Files to boost (paths the ticket likely touches)
     * @param minSimilarity Keep only memories at least this close in meaning, or
     *   tagged with one of boostFiles. Without it a shared keyword is enough.
     */
    async search(repo, query, limit = 15, boostFiles = [], minSimilarity) {
        // Get all memories for this repo
        const all = this.db
            .prepare('SELECT * FROM memories WHERE repo = ?')
            .all(repo);
        if (all.length === 0)
            return [];
        // FTS5 keyword search
        const ftsMatches = new Map();
        const match = ftsQuery(query);
        // A query of only short or common words has nothing to match on.
        if (match) {
            try {
                // The index holds every repo's lessons, so filter before the limit or
                // other repos' matches can crowd this one's out.
                const ftsRows = this.db.prepare(`
          SELECT memories_fts.rowid AS rowid, bm25(memories_fts) as score
          FROM memories_fts
          JOIN memories ON memories.id = memories_fts.rowid
          WHERE memories_fts MATCH ? AND memories.repo = ?
          ORDER BY score
          LIMIT 50
        `).all(match, repo);
                for (const row of ftsRows) {
                    // BM25 returns negative scores (more negative = better match)
                    // Normalize to 0-1 range
                    ftsMatches.set(row.rowid, Math.min(1, -row.score / 10));
                }
            }
            catch {
                // The FTS index can fail to read; skip keyword matching
            }
        }
        // Vector similarity search
        const vectorMatches = new Map();
        try {
            const queryVec = await this.embed(query);
            for (const row of all) {
                if (!row.embedding)
                    continue;
                const memVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM);
                const sim = cosineSimilarity(queryVec, memVec);
                if (sim > 0.3) { // Minimum threshold
                    vectorMatches.set(row.id, sim);
                }
            }
        }
        catch {
            // Embedding can fail; fall back to keyword-only
        }
        // File boost: memories mentioning relevant files get a boost
        const fileBoost = new Map();
        if (boostFiles.length > 0) {
            const boostSet = new Set(boostFiles.map((f) => f.toLowerCase()));
            for (const row of all) {
                const files = safeJsonArray(row.files);
                const matchCount = files.filter((f) => boostSet.has(f.toLowerCase())).length;
                if (matchCount > 0) {
                    fileBoost.set(row.id, Math.min(0.3, matchCount * 0.1));
                }
            }
        }
        // Merge scores
        const scores = new Map();
        const allIds = new Set([...ftsMatches.keys(), ...vectorMatches.keys(), ...fileBoost.keys()]);
        for (const id of allIds) {
            if (minSimilarity !== undefined && (vectorMatches.get(id) ?? 0) < minSimilarity && !fileBoost.has(id))
                continue;
            const fts = ftsMatches.get(id) ?? 0;
            const vec = vectorMatches.get(id) ?? 0;
            const boost = fileBoost.get(id) ?? 0;
            // Weighted combination: vector similarity is primary, FTS adds precision
            const score = vec * 0.6 + fts * 0.3 + boost + 0.1;
            scores.set(id, score);
        }
        // Sort by score and return top results
        const sorted = [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);
        const rowsById = new Map(all.map((r) => [r.id, r]));
        return sorted
            .map(([id, score]) => {
            const row = rowsById.get(id);
            if (!row)
                return null;
            return { memory: toMemory(row), score };
        })
            .filter((m) => m !== null);
    }
    /**
     * Find memories related to a given lesson, for deduplication.
     * A worker should update an existing memory rather than create a near-duplicate.
     */
    async findRelated(repo, lesson, threshold = 0.8) {
        const matches = await this.search(repo, lesson, 5);
        return matches
            .filter((m) => m.score >= threshold)
            .map((m) => m.memory);
    }
    /* ---------- Re-embedding ---------- */
    /**
     * Re-embed memories that use an old model.
     * Run in the background when the model changes.
     */
    async reembed(repo, batchSize = 50) {
        const outdated = this.db.prepare(`
      SELECT id, lesson FROM memories
      WHERE repo = ? AND (embedding_model IS NULL OR embedding_model != ?)
      LIMIT ?
    `).all(repo, EMBEDDING_MODEL, batchSize);
        if (outdated.length === 0)
            return 0;
        const update = this.db.prepare(`
      UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?
    `);
        let count = 0;
        for (const row of outdated) {
            try {
                const vec = await this.embed(row.lesson);
                update.run(Buffer.from(vec.buffer), EMBEDDING_MODEL, row.id);
                count++;
            }
            catch {
                // Skip failures
            }
        }
        return count;
    }
    /**
     * Re-embed every repo's outdated memories, a batch at a time, until none are
     * left or a batch makes no progress (the model can't load). Run in the
     * background at startup.
     */
    async reembedAll(batchSize = 50) {
        const repos = this.db.prepare(`
      SELECT DISTINCT repo FROM memories WHERE embedding_model IS NULL OR embedding_model != ?
    `).all(EMBEDDING_MODEL).map((r) => r.repo);
        let total = 0;
        for (const repo of repos) {
            for (;;) {
                const count = await this.reembed(repo, batchSize);
                total += count;
                if (count === 0 || this.countOutdatedEmbeddings(repo) === 0)
                    break;
            }
        }
        return total;
    }
    /** Count memories needing re-embedding. */
    countOutdatedEmbeddings(repo) {
        return this.db.prepare(`
      SELECT COUNT(*) as n FROM memories
      WHERE repo = ? AND (embedding_model IS NULL OR embedding_model != ?)
    `).get(repo, EMBEDDING_MODEL).n;
    }
    /* ---------- Export ---------- */
    /** Export all memories for a repo as Markdown. */
    exportMarkdown(repo) {
        const memories = this.listForRepo(repo);
        if (memories.length === 0)
            return '# Memories\n\nNo memories saved for this repo yet.';
        const lines = ['# Memories', '', `Exported from ${repo}`, ''];
        const byKind = new Map();
        for (const m of memories) {
            const list = byKind.get(m.kind) ?? [];
            list.push(m);
            byKind.set(m.kind, list);
        }
        const kindLabels = {
            convention: 'Conventions',
            gotcha: 'Gotchas',
            correction: 'Corrections',
            review: 'From Reviews',
            approval: 'Approval Patterns',
        };
        for (const [kind, label] of Object.entries(kindLabels)) {
            const list = byKind.get(kind);
            if (!list?.length)
                continue;
            lines.push(`## ${label}`, '');
            for (const m of list) {
                lines.push(`- ${m.lesson}`);
                if (m.files.length > 0) {
                    lines.push(`  - Files: ${m.files.join(', ')}`);
                }
                if (m.source === 'review' && m.reviewer) {
                    lines.push(`  - From ${m.reviewer}'s review${m.threadUrl ? `: ${m.threadUrl}` : ''}`);
                }
            }
            lines.push('');
        }
        return lines.join('\n');
    }
}
/* ---------- Helpers ---------- */
function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
function safeJsonArray(text) {
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    }
    catch {
        return [];
    }
}
