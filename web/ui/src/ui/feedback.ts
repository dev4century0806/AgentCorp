/**
 * Utilities for the public feedback repo integration.
 */

/** The feedback repo path (owner/repo format). */
export const FEEDBACK_REPO = 'dev4century0806/AgentCorp';

/** The full URL to the feedback repo. */
export const FEEDBACK_REPO_URL = `https://github.com/${FEEDBACK_REPO}`;

/** Extracts macOS version from the user agent, e.g. "15.0" from "Mac OS X 15_0". */
export function getMacOsVersion(): string {
  const match = navigator.userAgent.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/);
  if (!match?.[1]) return '';
  return match[1].replace(/_/g, '.');
}

/** Gets the app version from the desktop bridge if available. */
export async function getAppVersion(): Promise<string> {
  const desktop = (window as unknown as { desktop?: { updateState?: () => Promise<{ current: string } | null> } }).desktop;
  if (!desktop?.updateState) return '';
  try {
    const state = await desktop.updateState();
    return state?.current ?? '';
  } catch {
    return '';
  }
}

/** Runner display name for the feedback form. */
export function runnerDisplayName(runner: string): string {
  switch (runner) {
    case 'claude': return 'Claude Code';
    case 'acp': return 'Cursor';
    case 'codex': return 'Codex';
    case 'copilot': return 'Copilot';
    default: return runner;
  }
}

export interface FeedbackUrlParams {
  template: 'bug_report' | 'feature_request';
  version?: string;
  runner?: string;
  macos?: string;
}

/** Builds a GitHub issue URL with pre-filled fields. */
export function buildFeedbackUrl(params: FeedbackUrlParams): string {
  const url = new URL(`https://github.com/${FEEDBACK_REPO}/issues/new`);
  url.searchParams.set('template', `${params.template}.yml`);
  if (params.version) url.searchParams.set('version', params.version);
  if (params.runner) url.searchParams.set('runner', params.runner);
  if (params.macos) url.searchParams.set('macos', params.macos);
  return url.toString();
}
