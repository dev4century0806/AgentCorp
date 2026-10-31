import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_LOOK, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, type WorkerLook } from '@shared';
import { $, el } from './dom.js';
import { api } from '../net/client.js';
import { bindUsernameAvailability, normalizeUsername, usernameSaveError, validateUsername } from './username.js';

const SUPABASE_KEY = SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce' } });
let session: Session | null = null;

/** The one Supabase client, for modules that make their own calls (the office showcase). */
export function supabaseClient(): SupabaseClient {
  return supabase;
}
const PUBLIC_APP_ORIGIN = 'http://127.0.0.1:4317';
const SHARE_PREVIEW_VERSION = '2';
// Capture immediately on module load
export interface UserProfile {
  user_id: string;
  username: string;
  username_set_at: string | null;
  /** An uploaded profile picture, or null for the default blocky bot. */
  avatar_url: string | null;
}

const PROFILE_COLUMNS = 'user_id, username, username_set_at, avatar_url';
let profile: UserProfile | null = null;

/** Tells whatever shows the signed-in profile, such as the HUD's avatar, to draw it again. */
function profileChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('profile-changed'));
}

/**
 * The signed-in session's access token, for calls the server checks (Edge
 * Functions, a sign-in the local server finishes). The session kept here can go
 * stale while auto-refresh is paused, such as when the window sat in the
 * background past the hour a token lasts, so one that has expired or is about
 * to is refreshed first. `force` refreshes it regardless, after a server said no.
 */
export async function accessToken(_force = false): Promise<string | null> {
  return session?.access_token ?? null;
}

export function signedInEmail(): string | null {
  return session?.user.email ?? null;
}

export function signedInUserId(): string | null {
  return session?.user.id ?? null;
}

export async function sendFeedback(message: string, diagnostics: string): Promise<void> {
  const current = session ?? (await supabase.auth.getSession()).data.session;
  if (!current) throw new Error('Sign in before sending feedback.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-feedback`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${current.access_token}`,
      apikey: SUPABASE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message, diagnostics }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Feedback delivery failed (${response.status}).`);
  }
}

export function signedInUsername(): string {
  return profile?.username ?? '';
}

/** Shared profile data used by Profile now and the leaderboard in issue #46. */
export async function loadProfile(userId = session?.user.id): Promise<UserProfile | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<UserProfile>();
  if (error) throw new Error(`Could not load your profile: ${error.message}`);
  profile = data;
  profileChanged();
  return profile;
}

export async function usernameAvailable(username: string): Promise<boolean> {
  const validation = validateUsername(username);
  if (!validation.valid) return false;
  if (profile && profile.username.toLowerCase() === username.toLowerCase()) return true;
  const { data, error } = await supabase.rpc('username_available', { candidate: username });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function saveUsername(username: string): Promise<string | null> {
  if (!session) return 'Sign in before changing your username.';
  const value = normalizeUsername(username);
  const validation = validateUsername(value);
  if (!validation.valid) return validation.message;
  const { data, error } = await supabase
    .from('profiles')
    .update({ username: value })
    .eq('user_id', session.user.id)
    .select(PROFILE_COLUMNS)
    .single<UserProfile>();
  if (error) return usernameSaveError(error.message);
  profile = data;
  profileChanged();
  return null;
}

export function signedInAvatarUrl(): string | null {
  return profile?.avatar_url ?? null;
}

/** The avatar Edge Function's reply: the new picture's URL, or null after a reset. */
async function callAvatar(method: 'POST' | 'DELETE', body?: unknown): Promise<string | null> {
  const token = await accessToken();
  if (!token) throw new Error('Sign in before changing your picture.');
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/avatar`, {
      method,
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const reply = await response.json().catch(() => null) as { avatarUrl?: string | null; error?: string } | null;
  if (!response.ok) throw new Error(reply?.error || `The picture could not be saved (${response.status}).`);
  const url = typeof reply?.avatarUrl === 'string' ? reply.avatarUrl : null;
  if (profile) {
    profile = { ...profile, avatar_url: url };
    profileChanged();
  }
  return url;
}

/** Replaces this account's picture with an image the caller has already squared and re-encoded. */
export async function uploadAvatar(image: Blob): Promise<string | null> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return callAvatar('POST', { image: btoa(binary) });
}

/** Puts this account back on the default blocky bot. */
export async function resetAvatar(): Promise<void> {
  await callAvatar('DELETE');
}

export function openTermsOfService(section: 'terms' | 'privacy' = 'terms'): void {
  const dialog = $<HTMLDialogElement>('termsDialog');
  if (!dialog.open) dialog.showModal();
  document.getElementById(section === 'privacy' ? 'termsPrivacyHeading' : 'termsUseHeading')?.scrollIntoView({ block: 'start' });
}

function bindTermsOfService(): void {
  const dialog = $<HTMLDialogElement>('termsDialog');
  document.getElementById('signInTerms')?.addEventListener('click', () => openTermsOfService('terms'));
  document.getElementById('signInPrivacy')?.addEventListener('click', () => openTermsOfService('privacy'));
  $('closeTerms').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export async function requireSignIn(): Promise<void> {
  bindTermsOfService();
  const response = await fetch('/api/supabase/auth/v1/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error('The local workspace could not be opened. Reload to retry.');
  session = await response.json() as Session;
  session.expires_at = Math.floor(Date.now() / 1000) + 31536000;
  await api.selectAccount(session.user.id);
  await loadProfile(session.user.id);
}

/* ---------- user messages (inbox) ---------- */

interface UserMessageRow {
  id: string;
  title: string;
  body: string;
  body_format: 'text' | 'html' | null;
  is_read: boolean;
  sender_type: 'system' | 'admin' | 'user';
  sender_id: string | null;
  sender_username: string | null;
  share_id: string | null;
  created_at: string;
}

export interface InboxMessage {
  id: string;
  title: string;
  body: string;
  /** 'html' bodies are shown through sanitizeHtml(). */
  bodyFormat: 'text' | 'html';
  isRead: boolean;
  senderType: 'system' | 'admin' | 'user';
  senderId: string | null;
  senderUsername: string | null;
  shareId: string | null;
  createdAt: string;
}

export async function getInboxMessages(): Promise<InboxMessage[]> {
  const { data, error } = await supabase.rpc('user_messages', { p_limit: 50, p_offset: 0 });
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return ((data ?? []) as UserMessageRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format === 'html' ? 'html' : 'text',
    isRead: row.is_read,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderUsername: row.sender_username,
    shareId: row.share_id,
    createdAt: row.created_at,
  }));
}

export async function getInboxUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('user_unread_count');
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

export async function markMessageRead(messageId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_message_read', { p_message_id: messageId });
  if (error) throw new Error(`Could not mark message as read: ${error.message}`);
  return data === true;
}

export async function deleteInboxMessage(messageId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_message', { p_message_id: messageId });
  if (error) throw new Error(`Could not delete message: ${error.message}`);
  return data === true;
}

/* ---------- sharing agents and skills ---------- */

export interface UserLookupResult {
  userId: string;
  username: string;
}

export interface SharePreview {
  shareId: string;
  packageType: 'agent' | 'skill';
  packageData: unknown;
  strippedSecrets: string[];
  senderUsername: string;
  expiresAt: string;
  downloadedAt: string | null;
}

export interface BlockedSender {
  userId: string;
  username: string;
  blockedAt: string;
}

/** Look up a user by username before sharing. */
export async function lookupUserByUsername(username: string): Promise<UserLookupResult | null> {
  const { data, error } = await supabase.rpc('lookup_user_by_username', { p_username: username });
  if (error) throw new Error(`Could not look up user: ${error.message}`);
  if (!data || !data.length) return null;
  const row = data[0] as { user_id: string; username: string };
  return { userId: row.user_id, username: row.username };
}

/** Share a package (agent or skill) with another user. */
export async function sharePackage(
  recipientUsername: string,
  packageType: 'agent' | 'skill',
  packageData: unknown,
  strippedSecrets: string[] = []
): Promise<{ shareId: string; messageId: string }> {
  const { data, error } = await supabase.rpc('share_package', {
    p_recipient_username: recipientUsername,
    p_package_type: packageType,
    p_package_data: packageData,
    p_stripped_secrets: strippedSecrets,
  });
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error('Share failed');
  const row = data[0] as { share_id: string; message_id: string };
  return { shareId: row.share_id, messageId: row.message_id };
}

/** Get share preview for a share message. */
export async function getSharePreview(messageId: string): Promise<SharePreview | null> {
  const { data, error } = await supabase.rpc('get_share_preview', { p_message_id: messageId });
  if (error) throw new Error(`Could not load share: ${error.message}`);
  if (!data || !data.length) return null;
  const row = data[0] as {
    share_id: string;
    package_type: 'agent' | 'skill';
    package_data: unknown;
    stripped_secrets: string[];
    sender_username: string;
    expires_at: string;
    downloaded_at: string | null;
  };
  return {
    shareId: row.share_id,
    packageType: row.package_type,
    packageData: row.package_data,
    strippedSecrets: row.stripped_secrets ?? [],
    senderUsername: row.sender_username,
    expiresAt: row.expires_at,
    downloadedAt: row.downloaded_at,
  };
}

/** Download a shared package. Returns the package data. */
export async function downloadShare(shareId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('download_share', { p_share_id: shareId });
  if (error) throw new Error(`Could not download: ${error.message}`);
  return data;
}

/** Block a user from sharing with you. */
export async function blockSender(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_sender', { p_user_id: userId });
  if (error) throw new Error(`Could not block user: ${error.message}`);
}

/** Unblock a user. */
export async function unblockSender(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_sender', { p_user_id: userId });
  if (error) throw new Error(`Could not unblock user: ${error.message}`);
}

/** Get list of blocked senders. */
export async function listBlockedSenders(): Promise<BlockedSender[]> {
  const { data, error } = await supabase.rpc('list_blocked_senders');
  if (error) throw new Error(`Could not load blocked list: ${error.message}`);
  return ((data ?? []) as Array<{ blocked_user_id: string; username: string; blocked_at: string }>).map((row) => ({
    userId: row.blocked_user_id,
    username: row.username,
    blockedAt: row.blocked_at,
  }));
}

/** Perk override from admin panel stored in Supabase. */
interface PerkOverride {
  id: string;
  unlock_level: number;
}
