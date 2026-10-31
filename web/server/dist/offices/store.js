/**
 * Where generated and installed offices live on disk (issue #157).
 *
 * One folder per office under `officesRoot()`:
 *
 *     <id>/office.json     the manifest, validated on every read
 *     <id>/brief.json      the answers it was generated from (generated offices only)
 *     <id>/meta.json       where it came from, its listing, and when
 *     <id>/thumbnail.png   a capture of its preview, once the app has drawn one
 *
 * The root is read lazily, because the signed-in account changes at runtime.
 * Nothing here trusts the folder: a manifest that no longer passes the
 * contract is skipped from the list, and every id is checked against
 * OFFICE_ID before it is joined onto a path.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { officesRoot } from '../config.js';
import { OFFICE_ID, validateOfficeBrief, validateOfficeManifest, } from '../protocol.js';
/** A request about an office that cannot be met, with the HTTP status it deserves. */
export class OfficeError extends Error {
    status;
    errors;
    constructor(message, status = 400, 
    /** The contract's complaints, when a manifest or brief was refused. */
    errors = []) {
        super(message);
        this.status = status;
        this.errors = errors;
        this.name = 'OfficeError';
    }
}
/** Thumbnails are small captures of the preview; anything larger is refused. */
export const THUMBNAIL_MAX_BYTES = 768 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SLUG_MAX = 40;
/** A folder name for an office: the name as a slug, with a short random tail so two "Night office"s never collide. */
export function officeIdFor(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAX)
        .replace(/-+$/, '');
    const tail = randomBytes(3).toString('hex');
    const id = `${slug || 'office'}-${tail}`;
    if (!OFFICE_ID.test(id))
        throw new Error(`Could not make an office id from "${name}".`);
    return id;
}
/** Checks an id before it goes anywhere near the file system. */
export function checkOfficeId(id) {
    if (typeof id !== 'string' || !OFFICE_ID.test(id))
        throw new OfficeError('That is not an office id.', 404);
    return id;
}
function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJson(path, value) {
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function isSource(v) {
    if (!v || typeof v !== 'object')
        return false;
    const s = v;
    if (s.kind === 'generated')
        return true;
    return (s.kind === 'installed' &&
        typeof s.listingId === 'string' &&
        typeof s.creator === 'string' &&
        typeof s.installedAt === 'string');
}
function readMeta(path, fallbackTime) {
    const raw = existsSync(path) ? readJson(path) : {};
    const m = (raw && typeof raw === 'object' ? raw : {});
    return {
        source: isSource(m.source) ? m.source : { kind: 'generated' },
        listingId: typeof m.listingId === 'string' && OFFICE_ID.test(m.listingId) ? m.listingId : null,
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : fallbackTime,
        updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : fallbackTime,
    };
}
export class OfficeStore {
    root;
    constructor(root = officesRoot) {
        this.root = root;
    }
    dir(id) {
        return join(this.root(), checkOfficeId(id));
    }
    /** Every office that still passes the contract, newest change first. A broken folder is skipped, never fatal. */
    list() {
        const root = this.root();
        if (!existsSync(root))
            return [];
        const out = [];
        for (const name of readdirSync(root)) {
            if (!OFFICE_ID.test(name))
                continue;
            try {
                const record = this.read(name);
                if (record)
                    out.push(record.summary);
            }
            catch (err) {
                console.error(`[offices] skipping ${name}: ${err.message}`);
            }
        }
        return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
    }
    /** The office, or null when there is no such folder. Throws when the folder is there but no longer valid. */
    get(id) {
        return this.read(checkOfficeId(id));
    }
    /** `get`, as a 404 when it is missing. */
    need(id) {
        let record;
        try {
            record = this.get(id);
        }
        catch (err) {
            throw new OfficeError(`That office can no longer be read: ${err.message}`, 404);
        }
        if (!record)
            throw new OfficeError('No such office.', 404);
        return record;
    }
    read(id) {
        const dir = join(this.root(), id);
        const manifestPath = join(dir, 'office.json');
        if (!existsSync(manifestPath))
            return null;
        const checked = validateOfficeManifest(readFileSync(manifestPath, 'utf8'));
        if (!checked.ok)
            throw new Error(checked.errors.slice(0, 3).join('; '));
        const manifest = checked.value;
        const mtime = statSync(manifestPath).mtime.toISOString();
        const meta = readMeta(join(dir, 'meta.json'), mtime);
        let brief = null;
        const briefPath = join(dir, 'brief.json');
        if (meta.source.kind === 'generated' && existsSync(briefPath)) {
            const b = validateOfficeBrief(readJson(briefPath));
            if (b.ok)
                brief = b.value;
        }
        return {
            summary: {
                id,
                name: manifest.name,
                description: manifest.description,
                tags: manifest.tags,
                base: manifest.base,
                source: meta.source,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                hasThumbnail: existsSync(join(dir, 'thumbnail.png')),
                listingId: meta.listingId,
            },
            manifest,
            brief,
        };
    }
    /** Writes an office down, new or over an existing one, and returns it as the picker sees it. */
    save(input) {
        const checked = validateOfficeManifest(input.manifest);
        if (!checked.ok)
            throw new OfficeError('That office does not follow the contract.', 400, checked.errors);
        const manifest = checked.value;
        const now = new Date().toISOString();
        const existing = input.id ? this.get(input.id) : null;
        const id = input.id ? checkOfficeId(input.id) : officeIdFor(manifest.name);
        const dir = join(this.root(), id);
        mkdirSync(dir, { recursive: true });
        const meta = {
            source: input.source,
            listingId: existing?.summary.listingId ?? null,
            createdAt: existing?.summary.createdAt ?? now,
            updatedAt: now,
        };
        writeJson(join(dir, 'office.json'), manifest);
        writeJson(join(dir, 'meta.json'), meta);
        const briefPath = join(dir, 'brief.json');
        if (input.brief)
            writeJson(briefPath, input.brief);
        else
            rmSync(briefPath, { force: true });
        return this.need(id).summary;
    }
    /** Removes the office and everything in its folder. Missing is fine: the click already did its job. */
    delete(id) {
        const dir = this.dir(id);
        if (!existsSync(dir))
            return false;
        rmSync(dir, { recursive: true, force: true });
        return true;
    }
    /** The thumbnail's path, or null when none has been captured. */
    thumbnailPath(id) {
        const path = join(this.dir(id), 'thumbnail.png');
        return existsSync(path) ? path : null;
    }
    /** Saves a PNG data URL as the office's thumbnail. */
    setThumbnail(id, dataUrl) {
        this.need(id);
        if (typeof dataUrl !== 'string')
            throw new OfficeError('Send the thumbnail as a PNG data URL.');
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
        if (!m)
            throw new OfficeError('The thumbnail must be a PNG data URL.');
        const bytes = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
        if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
            throw new OfficeError('The thumbnail is not a PNG.');
        }
        if (bytes.length > THUMBNAIL_MAX_BYTES) {
            throw new OfficeError(`The thumbnail is too big: keep it under ${Math.round(THUMBNAIL_MAX_BYTES / 1024)} KB.`);
        }
        writeFileSync(join(this.dir(id), 'thumbnail.png'), bytes, { mode: 0o600 });
        return this.touch(id);
    }
    /** Records the showcase listing an office was published as, or null once unpublished. */
    setListing(id, listingId) {
        if (listingId !== null && (typeof listingId !== 'string' || !OFFICE_ID.test(listingId))) {
            throw new OfficeError('listingId must be a listing id or null.');
        }
        const dir = this.dir(id);
        const current = this.need(id).summary;
        const meta = { source: current.source, listingId, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
        writeJson(join(dir, 'meta.json'), meta);
        return this.need(id).summary;
    }
    /** The office installed from this listing, if it is still here. */
    findInstalled(listingId) {
        return this.list().find((o) => o.source.kind === 'installed' && o.source.listingId === listingId) ?? null;
    }
    /** The brief a generated office was made from, for editing it. */
    briefFor(id) {
        return this.need(id).brief;
    }
    touch(id) {
        const dir = this.dir(id);
        const current = this.need(id).summary;
        const meta = {
            source: current.source,
            listingId: current.listingId,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString(),
        };
        writeJson(join(dir, 'meta.json'), meta);
        return this.need(id).summary;
    }
}
