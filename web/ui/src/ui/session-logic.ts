/** How close to expiry a sign-in token is refreshed before it is sent: a request takes a moment to arrive. */
export const REFRESH_MARGIN_MS = 60_000;

/**
 * Whether a token expiring at `expiresAt` (seconds, as Supabase gives it) should
 * be refreshed before it is sent. One with no expiry is refreshed, to be safe.
 */
export function expiresSoon(expiresAt: number | undefined, now: number): boolean {
  return !expiresAt || expiresAt * 1000 - now < REFRESH_MARGIN_MS;
}

/**
 * Supabase no longer knows the session behind the token: it was signed out,
 * perhaps on another device, and refreshing cannot bring it back. Only signing
 * in again can.
 */
export class SessionEndedError extends Error {
  constructor(message = 'You were signed out, maybe on another device. Sign in again to carry on.') {
    super(message);
    this.name = 'SessionEndedError';
  }
}

/** Whether a Supabase auth error says the session is gone for good, not that the network failed. */
export function isEndedSession(error: { code?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'session_not_found' || error.code === 'refresh_token_not_found' || error.code === 'user_not_found';
}
