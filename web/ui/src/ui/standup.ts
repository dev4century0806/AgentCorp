/**
 * the assistant's morning standup: shown the first time the office is opened each day.
 * Covers everything since the last visit.
 */
import type { Agent, StandupSummary } from '@shared';
import { api } from '../net/client.js';
import { portrait } from '../scene/portrait.js';
import type { Store } from '../state/store.js';
import { localDate } from './day.js';
import { $, clear, closeButton, el, iconText, TEXT_ICONS } from './dom.js';

const LAST_VISIT_KEY = 'agent-corp.last-visit';
const STANDUP_ENABLED_KEY = 'agent-corp.standup-enabled';
const STANDUP_SHOWN_DATE_KEY = 'agent-corp.standup-shown-date';

/** Returns the last visit timestamp from localStorage, or null if never set. */
function getLastVisit(): string | null {
  try {
    return localStorage.getItem(LAST_VISIT_KEY);
  } catch {
    return null;
  }
}

/** Saves the current timestamp as the last visit. */
function setLastVisit(): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  } catch {
    // Storage blocked
  }
}

/** Returns whether standup is enabled (defaults to true). */
export function isStandupEnabled(): boolean {
  try {
    const saved = localStorage.getItem(STANDUP_ENABLED_KEY);
    return saved === null || saved === 'true';
  } catch {
    return true;
  }
}

/** Saves the standup enabled preference. */
export function setStandupEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STANDUP_ENABLED_KEY, String(enabled));
  } catch {
    // Storage blocked
  }
}

/** Returns the date (YYYY-MM-DD) when the standup was last shown. */
function getStandupShownDate(): string | null {
  try {
    return localStorage.getItem(STANDUP_SHOWN_DATE_KEY);
  } catch {
    return null;
  }
}

/** Saves today's date as when the standup was shown. */
function setStandupShownDate(): void {
  try {
    localStorage.setItem(STANDUP_SHOWN_DATE_KEY, todayDate());
  } catch {
    // Storage blocked
  }
}

/** Today's local calendar date (YYYY-MM-DD), so "once a day" follows Tom's day, not UTC's. */
export function todayDate(now = new Date()): string {
  return localDate(now);
}

/** Whether the standup was already shown today. */
function wasShownToday(): boolean {
  return getStandupShownDate() === todayDate();
}

/** Whether Tom has hired any workers (used to skip during onboarding). */
function hasHiredWorkers(store: Store): boolean {
  // Check if there are any non-the assistant agents (active or previous)
  return store.state.agents.some((a) => !a.builtInPam) || store.state.previous.some((a) => !a.builtInPam);
}

/** the assistant, who hosts the standup, or null if she isn't in the office. */
export function standupPam<T extends Pick<Agent, 'builtInPam'>>(agents: readonly T[]): T | null {
  return agents.find((a) => a.builtInPam) ?? null;
}

let standupVisible = false;

/** Shows the standup panel with the given summary. */
function showStandup(store: Store, summary: StandupSummary): void {
  standupVisible = true;

  const panel = document.getElementById('standupPanel');
  if (!panel) return;

  clear(panel);
  panel.hidden = false;

  const card = el('div', 'standup-card');

  // Header with the assistant
  const header = el('div', 'standup-header');
  const avatar = el('div', 'standup-avatar');
  const pam = standupPam(store.state.agents);
  const url = pam ? portrait(pam.look, pam.id) : null;
  if (url) {
    const img = el('img', 'standup-face');
    img.src = url;
    img.alt = '';
    avatar.appendChild(img);
  }
  const title = el('div', 'standup-title');
  title.appendChild(el('b', null, 'Good morning!'));
  const subtitle = el('span', 'm', "Here's what's been happening.");
  title.appendChild(subtitle);
  header.append(avatar, title);

  const close = closeButton('standup-close', 'Close standup');
  close.addEventListener('click', () => hideStandup());
  header.appendChild(close);
  card.appendChild(header);

  // Content
  const content = el('div', 'standup-content');

  if (summary.quiet) {
    content.appendChild(el('p', 'standup-quiet', 'Nothing to report since your last visit. The office is quiet.'));
  } else {
    // Done section
    if (summary.done.length > 0) {
      const section = el('div', 'standup-section');
      section.appendChild(iconText(el('h4'), TEXT_ICONS.check, `Done (${summary.done.length})`));
      const list = el('ul', 'standup-list');
      for (const item of summary.done.slice(0, 5)) {
        const li = el('li');
        const link = el('span', 'standup-item-title', item.title || item.ticketKey);
        li.appendChild(link);
        if (item.prUrl) {
          const pr = el('a', 'standup-pr', 'PR');
          pr.href = item.prUrl;
          pr.target = '_blank';
          pr.rel = 'noopener';
          li.appendChild(pr);
        }
        list.appendChild(li);
      }
      if (summary.done.length > 5) {
        list.appendChild(el('li', 'm', `+${summary.done.length - 5} more`));
      }
      section.appendChild(list);
      content.appendChild(section);
    }

    // Blocked section
    if (summary.blocked.length > 0) {
      const section = el('div', 'standup-section standup-blocked');
      section.appendChild(iconText(el('h4'), TEXT_ICONS.warning, `Needs attention (${summary.blocked.length})`));
      const list = el('ul', 'standup-list');
      for (const item of summary.blocked) {
        const li = el('li');
        const btn = el('button', 'standup-worker-link', item.name);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          store.selectAgent(item.agentId);
          hideStandup();
        });
        li.appendChild(btn);
        li.appendChild(el('span', 'm', ` — ${item.bubble}`));
        list.appendChild(li);
      }
      section.appendChild(list);
      content.appendChild(section);
    }

    // In Progress section
    if (summary.inProgress.length > 0) {
      const section = el('div', 'standup-section');
      section.appendChild(iconText(el('h4'), TEXT_ICONS.next, `In progress (${summary.inProgress.length})`));
      const list = el('ul', 'standup-list');
      for (const item of summary.inProgress.slice(0, 5)) {
        const li = el('li');
        const btn = el('button', 'standup-worker-link', item.name);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          store.selectAgent(item.agentId);
          hideStandup();
        });
        li.appendChild(btn);
        li.appendChild(el('span', 'm', ` — ${item.summary}`));
        list.appendChild(li);
      }
      if (summary.inProgress.length > 5) {
        list.appendChild(el('li', 'm', `+${summary.inProgress.length - 5} more`));
      }
      section.appendChild(list);
      content.appendChild(section);
    }

    // Shout-outs section
    if (summary.shoutouts.topWorker !== null) {
      const section = el('div', 'standup-section standup-shoutouts');
      section.appendChild(iconText(el('h4'), TEXT_ICONS.star, 'Shout-outs'));
      const list = el('ul', 'standup-list');
      if (summary.shoutouts.topWorker) {
        list.appendChild(el('li', null, `${summary.shoutouts.topWorker.name} completed ${summary.shoutouts.topWorker.count} ${summary.shoutouts.topWorker.count === 1 ? 'task' : 'tasks'}!`));
      }
      section.appendChild(list);
      content.appendChild(section);
    }
  }

  // Yesterday's clip, quiet day or not.

  card.appendChild(content);
  panel.appendChild(card);
}

/** Hides the standup panel. */
function hideStandup(): void {
  standupVisible = false;
  const panel = document.getElementById('standupPanel');
  if (panel) panel.hidden = true;
}

/** Whether the standup panel is currently visible. */
export function isStandupVisible(): boolean {
  return standupVisible;
}

/** Mounts the standup feature: checks for first-open-of-day and shows the standup. */
export function mountStandup(store: Store): void {
  // Create the panel container if it doesn't exist
  let panel = document.getElementById('standupPanel');
  if (!panel) {
    panel = el('div', 'standup-panel');
    panel.id = 'standupPanel';
    panel.hidden = true;
    document.getElementById('app')?.appendChild(panel);
  }

  // Wait for the store to be loaded before checking
  const checkAndShow = async (): Promise<void> => {
    // Skip if standup is disabled in settings
    if (!isStandupEnabled()) return;

    // Skip if already shown today
    if (wasShownToday()) return;

    // Skip during onboarding (before any workers have been hired)
    if (!hasHiredWorkers(store)) return;

    // Get the last visit timestamp
    const lastVisit = getLastVisit();
    const since = lastVisit ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // Default to 7 days ago

    try {
      const summary = await api.standup(since);
      // Mark as shown today
      setStandupShownDate();

      // Update last visit
      setLastVisit();

      // Show the standup
      showStandup(store, summary);

      // With Pre-render on, yesterday's clip renders now, in the background.
    } catch (err) {
      // Silently fail - standup is not critical
      console.warn('Could not load standup:', err);
    }
  };

  // Subscribe to store to wait for loaded state
  let hasChecked = false;
  store.subscribe((state) => {
    if (state.loaded && !hasChecked) {
      hasChecked = true;
      void checkAndShow();
    }
  });

  // If already loaded, check now
  if (store.state.loaded) {
    hasChecked = true;
    void checkAndShow();
  }
}
