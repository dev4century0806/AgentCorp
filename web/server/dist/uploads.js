import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { uploadsRoot } from './config.js';
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const INLINE_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.csv': 'text/plain; charset=utf-8',
    '.json': 'text/plain; charset=utf-8',
    '.log': 'text/plain; charset=utf-8',
};
export function uploadsDir(agentId, root = uploadsRoot()) {
    return join(root, agentId);
}
/** Where an idea's own files are kept, beside the workers' folders, whose names start `a-`. */
export function ideaFilesDir(id, root = uploadsRoot()) {
    return join(root, 'ideas', String(id));
}
export function saveUploads(dir, uploads) {
    return writeUploads(dir, decodeUploads(uploads));
}
/**
 * Checks uploads and decodes them, refusing them all if they come to more than
 * the limit along with `alreadyBytes`, the files already kept with them.
 */
export function decodeUploads(uploads, alreadyBytes = 0) {
    if (uploads === undefined)
        return [];
    if (!Array.isArray(uploads))
        throw new Error('attachments must be a list.');
    const decoded = uploads.map((u) => {
        if (typeof u?.name !== 'string' || !u.name.trim() || typeof u.data !== 'string') {
            throw new Error('Each attachment needs a name and its data.');
        }
        return { name: u.name.trim(), mimeType: typeof u.mimeType === 'string' ? u.mimeType : '', bytes: Buffer.from(u.data, 'base64') };
    });
    const total = decoded.reduce((sum, d) => sum + d.bytes.length, alreadyBytes);
    if (total > MAX_UPLOAD_BYTES)
        throw new Error(`Attachments come to more than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    return decoded;
}
export function writeUploads(dir, decoded) {
    if (!decoded.length)
        return [];
    mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    return decoded.map((d) => {
        // An idea's folder takes files from save after save, and two saves in one
        // millisecond share a stamp, so each name gets a random part too. `wx`
        // refuses to write over a file, should two names ever match anyway.
        const file = `${stamp}-${randomBytes(4).toString('hex')}-${safeName(d.name)}`;
        writeFileSync(join(dir, file), d.bytes, { mode: 0o600, flag: 'wx' });
        return { name: d.name, mimeType: d.mimeType, size: d.bytes.length, file };
    });
}
export function uploadFile(dir, file) {
    if (file !== basename(file) || file.startsWith('.'))
        return null;
    const path = join(dir, file);
    try {
        if (!statSync(path).isFile())
            return null;
    }
    catch {
        return null;
    }
    return { path, contentType: INLINE_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' };
}
/** Deletes one saved file; a name that is not a plain file in `dir` is ignored. */
export function removeUpload(dir, file) {
    const found = uploadFile(dir, file);
    if (found)
        rmSync(found.path, { force: true });
}
function safeName(name) {
    const cleaned = basename(name).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '');
    return (cleaned || 'file').slice(-80);
}
