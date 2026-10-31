import BetterSqlite3, {} from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from '../config.js';
import { migrate } from './schema.js';
export function openDb(path = DB_PATH) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new BetterSqlite3(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}
export * from './repositories.js';
