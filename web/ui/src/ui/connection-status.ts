import type { SourceStatus } from '@shared';

export interface ConnectionStatus {
  label: string;
  pill: 'pill-ok' | 'pill-warn' | 'pill-off';
  /** Why it can't be reached, shown under the label. */
  error: string | null;
}

/**
 * A ticket source's label in Settings. Signed in is not the same as working:
 * a source whose last check failed says so, instead of a green Connected.
 */
export function connectionStatus(on: boolean, health: { status: SourceStatus; error: string | null }): ConnectionStatus {
  if (!on) return { label: 'Off', pill: 'pill-off', error: null };
  if (health.status === 'error') return { label: "Can't reach", pill: 'pill-warn', error: health.error || 'The last check failed.' };
  return { label: 'Connected', pill: 'pill-ok', error: null };
}
