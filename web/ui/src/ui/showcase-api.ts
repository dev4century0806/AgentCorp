import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, type OfficeManifest } from '@shared';
import { accessToken, supabaseClient } from './auth.js';
import { SessionEndedError } from './session-logic.js';
import { galleryParams, type GalleryQuery, type ListingStatus } from './offices-logic.js';

/**
 * Every Supabase call the office showcase makes lives here, so the names can
 * change in one place. Results are plain data; errors throw with a sentence.
 */

export interface ListingRow {
  id: string;
  name: string;
  description: string;
  tags: string[];
  creator_username: string;
  /** The creator's uploaded picture, or null for the default bot. */
  creator_avatar_url: string | null;
  thumbnail_url: string | null;
  visit_count: number;
  featured: boolean;
  published_at: string;
}

export interface ListingDetail {
  id: string;
  name: string;
  description: string;
  tags: string[];
  creator_username: string;
  /** The creator's uploaded picture, or null for the default bot. */
  creator_avatar_url: string | null;
  thumbnail_url: string | null;
  manifest: OfficeManifest;
  prompt: string | null;
  visit_count: number;
}

export interface MyListing {
  id: string;
  local_id: string;
  status: ListingStatus;
  reject_reason: string | null;
}

export interface PublishResult {
  listingId: string;
  status: ListingStatus;
  reason?: string;
}

const sb = () => supabaseClient();

/** One page of the public gallery: rpc get_public_offices(p_sort, p_tag, p_limit, p_offset). */
export async function listPublicOffices(q: GalleryQuery): Promise<ListingRow[]> {
  const { data, error } = await sb().rpc('get_public_offices', galleryParams(q));
  if (error) throw new Error(`Could not load the showcase: ${error.message}`);
  return (data ?? []) as ListingRow[];
}

/** rpc get_public_office(p_id): the listing with its manifest, or null once it is gone. */
export async function getPublicOffice(id: string): Promise<ListingDetail | null> {
  const { data, error } = await sb().rpc('get_public_office', { p_id: id });
  if (error) throw new Error(`Could not load that office: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as ListingDetail | null | undefined;
  return row ?? null;
}

/** rpc record_office_install(p_id). A failed count never blocks an install. */
export async function recordInstall(id: string): Promise<void> {
  await sb().rpc('record_office_install', { p_id: id });
}

/** rpc unpublish_office(p_id). */
export async function unpublishOffice(id: string): Promise<void> {
  const { error } = await sb().rpc('unpublish_office', { p_id: id });
  if (error) throw new Error(error.message);
}

/** rpc my_office_listings(): this account's listings, for the status chips. */
export async function myListings(): Promise<MyListing[]> {
  const { data, error } = await sb().rpc('my_office_listings');
  if (error) throw new Error(error.message);
  return (data ?? []) as MyListing[];
}

/** rpc report_office(p_id, p_reason). */
export async function reportOffice(id: string, reason: string): Promise<void> {
  const { error } = await sb().rpc('report_office', { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
}

/**
 * Edge function POST /functions/v1/publish-office, with the session's bearer
 * token and the apikey. `thumbnail` is base64 PNG with no data: prefix; `prompt`
 * is null unless the creator chose to show it.
 */
export async function publishOffice(body: {
  localId: string;
  manifest: OfficeManifest;
  thumbnail: string;
  prompt: string | null;
}): Promise<PublishResult> {
  const send = (token: string): Promise<Response> =>
    fetch(`${SUPABASE_URL}/functions/v1/publish-office`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const token = await accessToken();
  if (!token) throw new Error('Sign in before publishing.');
  let response = await send(token);
  // A token can still be turned down as expired; refresh it once and try again.
  // If refreshing fails too, the session is gone and only signing in again helps.
  if (response.status === 401) {
    const fresh = await accessToken(true);
    if (!fresh) throw new SessionEndedError('You were signed out, maybe on another device. Sign in again to publish.');
    response = await send(fresh);
    if (response.status === 401) throw new SessionEndedError('You were signed out, maybe on another device. Sign in again to publish.');
  }
  const result = (await response.json().catch(() => null)) as (Partial<PublishResult> & { error?: string }) | null;
  if (!response.ok || !result?.listingId || !result.status) {
    throw new Error(result?.error || result?.reason || `Publishing failed (${response.status}).`);
  }
  return { listingId: result.listingId, status: result.status, ...(result.reason ? { reason: result.reason } : {}) };
}
