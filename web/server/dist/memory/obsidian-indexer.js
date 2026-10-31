import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH } from '../config.js';
import { embed as embedText, EMBEDDING_DIM } from './embedder.js';

let sharedDb = null;

function getDb() {
    if (!sharedDb) {
        const path = process.env.AGENT_CORP_HOME
            ? join(process.env.AGENT_CORP_HOME, 'office.db')
            : (existsSync('D:/Project/AgentCorp/data/office/office.db') ? 'D:/Project/AgentCorp/data/office/office.db' : DB_PATH);
        sharedDb = new Database(path);
        sharedDb.exec(`
            CREATE TABLE IF NOT EXISTS obsidian_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT,
                title TEXT,
                content TEXT,
                mtime INTEGER,
                embedding BLOB
            );
            CREATE INDEX IF NOT EXISTS idx_obsidian_path ON obsidian_notes(path);
        `);
    }
    return sharedDb;
}

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

function findMarkdownFiles(dir, fileList = []) {
    if (!existsSync(dir)) return fileList;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            findMarkdownFiles(fullPath, fileList);
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

export async function syncObsidianVault(vaultPath) {
    if (!vaultPath || !existsSync(vaultPath)) {
        return { ok: false, error: `Vault directory "${vaultPath}" does not exist.` };
    }

    const db = getDb();
    const files = findMarkdownFiles(vaultPath);
    let indexedChunks = 0;

    const selectNote = db.prepare('SELECT mtime FROM obsidian_notes WHERE path = ? LIMIT 1');
    const deleteByPath = db.prepare('DELETE FROM obsidian_notes WHERE path = ?');
    const insertNote = db.prepare(`
        INSERT INTO obsidian_notes (path, title, content, mtime, embedding)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const file of files) {
        try {
            const stats = statSync(file);
            const mtime = Math.floor(stats.mtimeMs);
            const existing = selectNote.get(file);

            if (existing && existing.mtime === mtime) {
                continue;
            }

            deleteByPath.run(file);
            const rawContent = readFileSync(file, 'utf8');
            const fileName = basename(file, '.md');

            // Split into sections by Markdown headers
            const rawSections = rawContent.split(/\n(?=#{1,3}\s)/);
            for (const sec of rawSections) {
                const trimmed = sec.trim();
                if (trimmed.length < 20) continue;

                const firstLine = trimmed.split('\n')[0].replace(/^#{1,3}\s*/, '');
                const title = firstLine ? `${fileName} > ${firstLine}` : fileName;

                try {
                    const vec = await embedText(trimmed.slice(0, 1500));
                    insertNote.run(file, title, trimmed, mtime, Buffer.from(vec.buffer));
                    indexedChunks++;
                } catch {
                    // Skip single embedding failures
                }
            }
        } catch {
            // Skip unreadable files
        }
    }

    const totalCount = db.prepare('SELECT COUNT(*) as c FROM obsidian_notes').get()?.c || 0;
    return {
        ok: true,
        vaultPath,
        filesScanned: files.length,
        newChunksIndexed: indexedChunks,
        totalNotesInIndex: totalCount,
    };
}

export async function searchObsidianVault(query, limit = 3) {
    if (!query || typeof query !== 'string') return [];
    try {
        const db = getDb();
        const rows = db.prepare('SELECT id, path, title, content, embedding FROM obsidian_notes').all();
        if (!rows.length) return [];

        const queryVec = await embedText(query);
        const matches = [];

        for (const row of rows) {
            if (!row.embedding) continue;
            const noteVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM);
            const similarity = cosineSimilarity(queryVec, noteVec);
            if (similarity > 0.35) {
                matches.push({
                    title: row.title,
                    path: row.path,
                    content: row.content,
                    similarity,
                });
            }
        }

        matches.sort((a, b) => b.similarity - a.similarity);
        return matches.slice(0, limit);
    } catch {
        return [];
    }
}

export function getObsidianStats() {
    try {
        const db = getDb();
        const row = db.prepare('SELECT COUNT(*) as c FROM obsidian_notes').get();
        return { count: row?.c || 0 };
    } catch {
        return { count: 0 };
    }
}
