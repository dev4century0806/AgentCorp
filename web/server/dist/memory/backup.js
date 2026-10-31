import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH } from '../config.js';

const BACKUP_DIR = 'D:/Project/AgentCorp/data/backups';
const MAX_BACKUPS = 7;

export async function createDatabaseBackup(customDbPath = null) {
    const sourceDbPath = customDbPath || (process.env.AGENT_CORP_HOME
        ? join(process.env.AGENT_CORP_HOME, 'office.db')
        : (existsSync('D:/Project/AgentCorp/data/office/office.db') ? 'D:/Project/AgentCorp/data/office/office.db' : DB_PATH));

    if (!existsSync(sourceDbPath)) {
        return { ok: false, error: `Database file "${sourceDbPath}" not found.` };
    }

    if (!existsSync(BACKUP_DIR)) {
        mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const backupFileName = `office-${timestamp}.db`;
    const targetPath = join(BACKUP_DIR, backupFileName);

    let db = null;
    try {
        db = new Database(sourceDbPath, { readonly: true });
        await db.backup(targetPath);

        // Prune old backups, keeping only the most recent MAX_BACKUPS
        pruneOldBackups();

        const stats = statSync(targetPath);
        return {
            ok: true,
            backupFile: backupFileName,
            backupPath: targetPath,
            sizeBytes: stats.size,
            createdAt: now.toISOString(),
        };
    } catch (err) {
        return { ok: false, error: err.message };
    } finally {
        if (db) {
            try { db.close(); } catch {}
        }
    }
}

export function listBackups() {
    if (!existsSync(BACKUP_DIR)) {
        return [];
    }
    const files = readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('office-') && f.endsWith('.db'))
        .map((f) => {
            const p = join(BACKUP_DIR, f);
            const stats = statSync(p);
            return {
                name: f,
                path: p,
                sizeBytes: stats.size,
                mtime: stats.mtimeMs,
            };
        });

    files.sort((a, b) => b.mtime - a.mtime);
    return files;
}

function pruneOldBackups() {
    try {
        const backups = listBackups();
        if (backups.length > MAX_BACKUPS) {
            const toDelete = backups.slice(MAX_BACKUPS);
            for (const b of toDelete) {
                try { unlinkSync(b.path); } catch {}
            }
        }
    } catch {}
}
