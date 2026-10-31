import { validateOfficeManifest, type OfficeManifest } from '@shared';
import { api } from '../net/client.js';

/**
 * The manifests of generated offices, fetched once and kept. The server
 * validated every one it saved, but a manifest is read again here before it
 * is drawn: whatever came over the wire is checked by the same contract the
 * server used, so a bad file can only ever fall back to the built-in office.
 *
 * An entry is good for one `updatedAt`. When the list says an office has
 * changed (an edit finished), the next ask fetches it again.
 */

interface Entry {
  updatedAt: string | null;
  manifest: Promise<OfficeManifest | null>;
  /** Set once the fetch has settled, so a draw can read it without waiting. */
  done: { manifest: OfficeManifest | null; at: number } | null;
}

/** A failed read is remembered this long, so a missing office is not asked for again on every redraw. */
export const RETRY_AFTER_MS = 30_000;

const cache = new Map<string, Entry>();

/** Where a manifest is fetched from: the server, unless a test supplies its own. */
type Fetcher = (id: string) => Promise<unknown>;
let fetcher: Fetcher = async (id) => (await api.office(id)).manifest;

/** For tests: where manifests come from. */
export function setOfficeFetcher(fn: Fetcher | null): void {
  fetcher = fn ?? (async (id) => (await api.office(id)).manifest);
  cache.clear();
  clock = () => Date.now();
}

let clock = (): number => Date.now();
/** For tests: the time failed reads are held against. */
export function setOfficeClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

function stale(e: Entry | undefined, updatedAt: string | null): boolean {
  if (!e) return true;
  if (updatedAt !== null && e.updatedAt !== updatedAt) return true;
  return !!e.done && e.done.manifest === null && clock() - e.done.at >= RETRY_AFTER_MS;
}

/**
 * The manifest of a saved office, or null if the server does not have it or
 * what it sent does not pass the contract. Pass the `updatedAt` of the office's
 * summary so a changed office is read again.
 */
export function officeManifest(id: string, updatedAt: string | null = null): Promise<OfficeManifest | null> {
  const old = cache.get(id);
  if (!stale(old, updatedAt) && old) return old.manifest;
  const entry: Entry = { updatedAt, manifest: Promise.resolve(null), done: null };
  entry.manifest = fetcher(id)
    .then((raw) => {
      const checked = validateOfficeManifest(raw);
      return checked.ok ? checked.value : null;
    })
    .catch(() => null)
    .then((m) => {
      entry.done = { manifest: m, at: clock() };
      return m;
    });
  cache.set(id, entry);
  return entry.manifest;
}

/** The manifest if it has already been fetched and is still current; undefined if not yet known. */
export function cachedManifest(id: string, updatedAt: string | null = null): OfficeManifest | null | undefined {
  const e = cache.get(id);
  if (stale(e, updatedAt) || !e?.done) return undefined;
  return e.done.manifest;
}

/** Forgets an office, as when it is deleted. */
export function forgetOffice(id: string): void {
  cache.delete(id);
}
