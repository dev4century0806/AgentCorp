/**
 * Your day: the office's record of yesterday, as the timelapse's stage asks
 * for it, and the post that goes with the clip. Pure, so it is tested
 * without the page; your-day.ts puts it on the standup card.
 */
import { DAY_WORKERS_MAX, DEFAULT_LOOK, encodeDayMoments, type DayMoment, type OfficeDay, type WorkerLook } from '@shared';
import type { Room } from '../state/store.js';

/** Seconds of day between the timelapse's intro and outro: 15s in all. */
export const DAY_LENGTH = 10;
export type ClipAspect = 'tall' | 'land';

const PRERENDER_KEY = 'agent-corp.day-prerender';
const TITLES_KEY = 'agent-corp.day-titles';

/** Yesterday, the local calendar day: a finished day, so its clip is made once. */
export function yesterday(now = new Date()): { date: string; from: string; to: string; start: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { date: localDate(start), from: start.toISOString(), to: end.toISOString(), start };
}

export interface DayTotals {
  workers: number;
  tickets: number;
  prs: number;
  /** The worker with the most tickets done, then the most moments: the recap's top worker. */
  top: string | null;
}

/**
 * The stage's template keys for a day (video/commercials/timelapse/template.ts):
 * the counts, the top worker and their look, the crew's looks, and the
 * moments as the `ev` key writes them, in seconds since the day's midnight.
 * Ticket titles go in only when the user has opted in to them.
 */
export function dayTemplate(day: OfficeDay, o: { date: string; start: Date; theme: Room; code: string | null; titles: boolean }): { query: string; totals: DayTotals } {
  const ids = [...new Set(day.events.map((e) => e.workerId).filter((id): id is string => !!id))];
  const score = new Map(ids.map((id) => [id, { done: 0, all: 0, first: Infinity }]));
  day.events.forEach((e, i) => {
    const s = e.workerId ? score.get(e.workerId) : undefined;
    if (!s) return;
    s.all++;
    if (e.kind === 'done') s.done++;
    s.first = Math.min(s.first, i);
  });
  const ranked = [...ids].sort((a, b) => {
    const x = score.get(a)!;
    const y = score.get(b)!;
    return y.done - x.done || y.all - x.all || x.first - y.first;
  });
  // The top worker takes the front desk; everyone else in the order they first had a moment.
  const top = ranked[0] ?? null;
  const order = top ? [top, ...ids.filter((id) => id !== top)] : ids;
  const place = new Map(order.slice(0, DAY_WORKERS_MAX).map((id, i) => [id, i]));
  const worker = (id: string): { name: string; look: WorkerLook } => {
    const w = day.workers.find((x) => x.id === id);
    return { name: w?.name ?? '', look: w?.look ?? DEFAULT_LOOK };
  };

  const moments: DayMoment[] = day.events.map((e) => ({ kind: e.kind, worker: e.workerId ? (place.get(e.workerId) ?? null) : null, at: secondsSince(o.start, new Date(e.at)) }));
  const totals: DayTotals = {
    workers: ids.length,
    tickets: day.events.filter((e) => e.kind === 'done').length,
    prs: day.events.filter((e) => e.kind === 'pr').length,
    top: top ? worker(top).name : null,
  };
  const q = new URLSearchParams({ theme: o.theme, recap: 'day', len: String(DAY_LENGTH), date: o.date });
  q.set('workers', String(totals.workers));
  q.set('tickets', String(totals.tickets));
  q.set('prs', String(totals.prs));
  q.set('top', totals.top ?? '');
  q.set('look', JSON.stringify(top ? worker(top).look : DEFAULT_LOOK));
  q.set('ref', o.code ?? '');
  q.set('ev', encodeDayMoments(moments));
  const crew = order.slice(1, DAY_WORKERS_MAX).map((id) => worker(id).look);
  if (crew.length) q.set('crew', JSON.stringify(crew));
  if (o.titles) q.set('titles', JSON.stringify(day.events.filter((e) => e.kind === 'done').map((e) => e.title ?? '')));
  return { query: q.toString(), totals };
}

/** The post that goes with the clip, ending on the invite link. */
export function postText(t: DayTotals, link: string): string {
  const counts = [t.tickets ? `${t.tickets} ${t.tickets === 1 ? 'ticket' : 'tickets'} done` : '', t.prs ? `${t.prs} ${t.prs === 1 ? 'PR' : 'PRs'} opened` : ''].filter(Boolean);
  const said = counts.length ? `: ${counts.join(' and ')}` : '';
  return `My day in AgentCorp${said}. Get your own office of AI coding agents: ${link}`;
}

/** How far a render is, and why it's going slowly, if it is: the desktop app's news. */
export interface DayNews {
  progress: number;
  /** 'power': a pre-render paused until the Mac is plugged in; the others only slow it down. */
  waiting: 'battery' | 'workers' | 'power' | null;
}

/** The status line while a clip renders: how far, and why it's going slowly when it is. */
export function progressText(news: DayNews): string {
  const done = `${Math.round(news.progress * 100)}%`;
  if (news.waiting === 'power') return `Waiting until your Mac is plugged in… ${done}`;
  if (news.waiting === 'battery') return `Making your day slowly while your Mac is on battery… ${done}`;
  if (news.waiting === 'workers') return `Making your day slowly while your workers work… ${done}`;
  return `Making your day… ${done}`;
}

/** Posting on X with the text filled in; the video is attached by hand. */
export function xPostUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** Settings, both off unless turned on: render yesterday's clip after the standup, and show ticket titles in it. */
export function isDayPrerender(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  return storage?.getItem(PRERENDER_KEY) === 'true';
}

export function setDayPrerender(on: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  save(storage, PRERENDER_KEY, on);
}

export function isDayTitles(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  return storage?.getItem(TITLES_KEY) === 'true';
}

export function setDayTitles(on: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  save(storage, TITLES_KEY, on);
}

function save(storage: Pick<Storage, 'setItem'> | null, key: string, on: boolean): void {
  try {
    storage?.setItem(key, String(on));
  } catch {
    // Storage blocked
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Seconds from the day's midnight to `at` by the clock on the wall, so a clock change doesn't move the hours. */
function secondsSince(start: Date, at: Date): number {
  const days = Math.round((Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
  return Math.max(0, days * 86_400 + at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds());
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
