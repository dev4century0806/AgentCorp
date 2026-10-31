import {
  DETAIL_FIELDS,
  DETAIL_LIMIT,
  OFFICE_ATTEMPTS,
  OFFICE_ID,
  NO_EFFORT_MODELS,
  PROMPT_LIMIT,
  type DesignerLogEntry,
  type ModelMenu,
  type OfficeBrief,
  type OfficeDetails,
  type OfficeGeneration,
  type OfficeStyle,
  type OfficeSummary,
} from '@shared';

/** Pure logic for generated offices: forms, card text and queries. Nothing here touches the page. */

export type DetailField = (typeof DETAIL_FIELDS)[number];

export const STYLE_LABELS: Record<OfficeStyle, string> = {
  cozy: 'Cozy',
  sleek: 'Sleek',
  retro: 'Retro',
  spooky: 'Spooky',
  playful: 'Playful',
  realistic: 'Realistic',
};

export const FIELD_LABELS: Record<DetailField, { label: string; hint: string; required: boolean }> = {
  theme: { label: 'Theme', hint: 'The idea, in a phrase or two', required: true },
  scene: { label: 'Scene and mood', hint: 'Time of day, light, atmosphere', required: false },
  people: { label: 'People', hint: 'Who works here and what they wear', required: false },
  decor: { label: 'Furniture and decorations', hint: 'What fills the room', required: false },
  notes: { label: 'Anything else', hint: 'Colours, things to avoid', required: false },
};

export function validatePrompt(prompt: string): string | null {
  const text = prompt.trim();
  if (!text) return 'Describe the office you want first.';
  if (text.length > PROMPT_LIMIT) return `Keep the description under ${PROMPT_LIMIT} characters.`;
  return null;
}

/** Problems with the reviewed answers, keyed by field. Empty when the form can be sent. */
export function validateDetails(details: OfficeDetails): Partial<Record<DetailField, string>> {
  const problems: Partial<Record<DetailField, string>> = {};
  for (const field of DETAIL_FIELDS) {
    const value = details[field].trim();
    if (FIELD_LABELS[field].required && !value) problems[field] = `${FIELD_LABELS[field].label} is required.`;
    else if (value.length > DETAIL_LIMIT) problems[field] = `Keep this under ${DETAIL_LIMIT} characters.`;
  }
  return problems;
}

export function briefFrom(prompt: string, details: OfficeDetails): OfficeBrief {
  const trimmed = { ...details };
  for (const field of DETAIL_FIELDS) trimmed[field] = details[field].trim();
  return { prompt: prompt.trim(), details: trimmed };
}

/** Marks a style chip on, or off when it is already on. */
export function toggleStyle(current: OfficeStyle | null, chosen: OfficeStyle): OfficeStyle | null {
  return current === chosen ? null : chosen;
}

export interface GenerationText {
  tone: 'running' | 'failed' | 'done';
  title: string;
  line: string;
}

/** What a generation's card says. `name` is the office it edits, if any. */
export function generationText(gen: OfficeGeneration, name?: string | null): GenerationText {
  const edit = gen.officeId !== null;
  const subject = name ? `“${name}”` : edit ? 'your office' : 'your office';
  if (gen.state === 'running') {
    const attempt = Math.min(Math.max(gen.attempt, 1), OFFICE_ATTEMPTS);
    return {
      tone: 'running',
      title: edit ? `Updating ${subject}…` : 'Building…',
      line: `Attempt ${attempt} of ${OFFICE_ATTEMPTS}`,
    };
  }
  if (gen.state === 'failed' && gen.resumable) {
    return { tone: 'failed', title: edit ? `Updating ${subject} was cut off` : 'Cut off', line: 'Resume it to carry on where it stopped.' };
  }
  if (gen.state === 'failed') {
    return { tone: 'failed', title: edit ? `Couldn't update ${subject}` : "Couldn't build", line: "The designer couldn't finish it." };
  }
  return { tone: 'done', title: edit ? `Updated ${subject}` : 'Built', line: 'Ready to use.' };
}

export type ListingStatus = 'pending' | 'public' | 'rejected';

export const LISTING_CHIPS: Record<ListingStatus, string> = { pending: 'In review', public: 'Public', rejected: 'Rejected' };

/** The chip an office wears, or null when it is not published. Unknown statuses read as in review. */
export function listingChip(office: Pick<OfficeSummary, 'listingId'>, statuses: ReadonlyMap<string, ListingStatus>): string | null {
  if (!office.listingId) return null;
  return LISTING_CHIPS[statuses.get(office.listingId) ?? 'pending'] ?? LISTING_CHIPS.pending;
}

/** The saved office installed from this listing, if any. */
export function installedFrom(offices: readonly OfficeSummary[], listingId: string): OfficeSummary | undefined {
  return offices.find((o) => o.source.kind === 'installed' && o.source.listingId === listingId);
}

/** The user's own offices apart from those installed from the showcase, each in the order given. */
export function splitOffices<T extends Pick<OfficeSummary, 'source'>>(offices: readonly T[]): { own: T[]; installed: T[] } {
  const own: T[] = [];
  const installed: T[] = [];
  for (const o of offices) (o.source.kind === 'installed' ? installed : own).push(o);
  return { own, installed };
}

export function byline(office: Pick<OfficeSummary, 'source'>): string | null {
  return office.source.kind === 'installed' ? `by @${office.source.creator}` : null;
}

/** Generations the picker lists: those still going or failed. Finished ones are the office's own card. */
export function visibleGenerations(generations: readonly OfficeGeneration[]): OfficeGeneration[] {
  return generations.filter((g) => g.state !== 'done');
}

/** Saved offices that still need their picture taken, once each. */
export function needsThumbnail(offices: readonly OfficeSummary[], handled: ReadonlySet<string>): OfficeSummary[] {
  return offices.filter((o) => !o.hasThumbnail && !handled.has(o.id));
}

/** Generations that finished since last time, with the office they made. */
export function newlyDone(generations: readonly OfficeGeneration[], seen: ReadonlySet<string>): OfficeGeneration[] {
  return generations.filter((g) => g.state === 'done' && g.resultId !== null && !seen.has(g.id));
}

/**
 * Reports each generation that finishes while the page is open, once. What the
 * server already holds when the list first loads is old news: a reload must not
 * announce an office as ready again. Until the list has loaded there is nothing to say.
 */
export function finishedWatcher(): (state: { officesLoaded: boolean; generations: readonly OfficeGeneration[] }) => OfficeGeneration[] {
  const seen = new Set<string>();
  let primed = false;
  return (state) => {
    if (!state.officesLoaded) return [];
    const fresh = newlyDone(state.generations, seen);
    for (const g of fresh) seen.add(g.id);
    const first = !primed;
    primed = true;
    return first ? [] : fresh;
  };
}

export const GALLERY_SORTS = ['trending', 'new', 'featured'] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];
export const GALLERY_PAGE = 24;

export function normalizeTag(tag: string): string | null {
  const t = tag.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return t ? t.slice(0, 20) : null;
}

export interface GalleryQuery {
  sort: GallerySort;
  tag: string | null;
  page: number;
  /** Offices per page; the gallery's page size unless a shorter list asks for fewer. */
  limit?: number;
}

/** How many of the newest public offices the office style picker shows. */
export const PICKER_SHOWCASE = 3;

/** The arguments of get_public_offices for one page of the gallery. */
export function galleryParams(q: GalleryQuery): { p_sort: GallerySort; p_tag: string | null; p_limit: number; p_offset: number } {
  const limit = q.limit ?? GALLERY_PAGE;
  return { p_sort: q.sort, p_tag: q.tag ? normalizeTag(q.tag) : null, p_limit: limit, p_offset: Math.max(0, q.page) * limit };
}

/** What a showcase card in the picker says about the office: already installed here, or published from here. */
export function showcaseBadge(
  listingId: string,
  offices: readonly Pick<OfficeSummary, 'source' | 'listingId'>[],
): 'Installed' | 'Yours' | null {
  if (offices.some((o) => o.source.kind === 'installed' && o.source.listingId === listingId)) return 'Installed';
  if (offices.some((o) => o.listingId === listingId)) return 'Yours';
  return null;
}

/** `?office=<id>` on the page address, or null. Listing ids follow OFFICE_ID. */
export function officeIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('office')?.trim().toLowerCase() ?? '';
  return OFFICE_ID.test(id) ? id : null;
}

/** The base64 body of a PNG data URL, which is what the publish function takes. */
export function pngBase64(dataUrl: string): string | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? m[1]! : null;
}

export function publishNote(result: { status: ListingStatus; reason?: string }): string {
  if (result.status === 'rejected') return result.reason ? `Not published: ${result.reason}` : 'Not published: it did not pass review.';
  if (result.status === 'public') return 'Published. It is on the showcase now.';
  return 'Submitted for review. It appears on the showcase once approved.';
}

/* ---------- how long it takes, and whose tokens ---------- */

/** What making an office costs, said where the user starts each step. */
export function tokenNote(runner: string): string {
  return `Runs on your ${runner}, using your own tokens.`;
}
export const SUGGEST_NOTE = 'Suggesting details takes about 20 seconds.';
export const BUILD_NOTE = 'Building usually takes 5 to 15 minutes. Higher effort and a stronger model take longer, and so does another pass if the check sends it back.';
export const BUILD_TRADEOFF = 'A stronger model and higher effort build a better office but use more tokens.';

/* ---------- the designer's model and effort ---------- */

export interface DesignerSetup {
  model: string | null;
  effort: string | null;
}

export const DESIGNER_SETUP_KEY = 'agent-corp.office-designer-setup';

type SetupStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The strongest model on the menu, the first that is not the runner's default, at high effort when it has one. */
export function defaultDesignerSetup(menu: ModelMenu): DesignerSetup {
  const model = menu.models.find((m) => m.value)?.value ?? null;
  const high = menu.efforts.some((e) => e.value === 'high') ? 'high' : null;
  return { model, effort: model && NO_EFFORT_MODELS.has(model) ? null : high };
}

/** The last model and effort chosen for a designer, or the default when none was saved or the menu no longer has it. */
export function loadDesignerSetup(menu: ModelMenu, store: SetupStore | undefined = globalThis.localStorage): DesignerSetup {
  const fallback = defaultDesignerSetup(menu);
  try {
    const saved = JSON.parse(store?.getItem(DESIGNER_SETUP_KEY) ?? 'null') as Partial<DesignerSetup> | null;
    if (!saved || typeof saved !== 'object' || !menu.models.some((m) => m.value === saved.model)) return fallback;
    const model = saved.model ?? null;
    if (model && NO_EFFORT_MODELS.has(model)) return { model, effort: null };
    const effort = menu.efforts.some((e) => e.value === saved.effort) ? (saved.effort ?? null) : fallback.effort;
    return { model, effort };
  } catch {
    return fallback;
  }
}

export function saveDesignerSetup(setup: DesignerSetup, store: SetupStore | undefined = globalThis.localStorage): void {
  try {
    store?.setItem(DESIGNER_SETUP_KEY, JSON.stringify({ model: setup.model, effort: setup.effort }));
  } catch {
    return;
  }
}

export type StepState = 'done' | 'now' | 'todo';
export interface BuildStep {
  label: string;
  state: StepState;
}

/**
 * The steps of a build as far as the office can tell them apart: the designer
 * starting, designing, fixing what the contract check found (only once the
 * check has sent it back), and the office being ready.
 */
export function buildSteps(gen: Pick<OfficeGeneration, 'state' | 'attempt' | 'started'>): BuildStep[] {
  const done = gen.state === 'done';
  const started = done || gen.started;
  const fixing = gen.attempt > 1;
  const steps: BuildStep[] = [
    { label: 'Starting the designer', state: started ? 'done' : 'now' },
    { label: 'Designing the room and the crew', state: done || fixing ? 'done' : started ? 'now' : 'todo' },
  ];
  if (fixing) {
    const attempt = Math.min(gen.attempt, OFFICE_ATTEMPTS);
    steps.push({ label: `Fixing what the check found (try ${attempt} of ${OFFICE_ATTEMPTS})`, state: done ? 'done' : 'now' });
  }
  steps.push({ label: 'Checked and saved', state: done ? 'done' : 'todo' });
  return steps;
}

/** "45 s", "3 min 05 s": how long since `since`. */
export function elapsed(since: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * A designer's log after an `offices.log` event: what was held up to `from`,
 * then the entries sent. Null when `from` is past what is held, so some were
 * missed and the whole log must be fetched again.
 */
export function applyLog(held: readonly DesignerLogEntry[], from: number, entries: readonly DesignerLogEntry[]): DesignerLogEntry[] | null {
  if (from > held.length) return null;
  return [...held.slice(0, from), ...entries];
}

/** What the build window waits past after a resume: the failure it resumed from, until the store has heard otherwise. */
export function failureKey(gen: Pick<OfficeGeneration, 'state' | 'errors'>): string {
  return JSON.stringify([gen.state, gen.errors]);
}

/** A building card's clock: how long it has been, and how long it usually takes. */
export function buildClock(startedAt: string, now: number): string {
  return `${elapsed(startedAt, now)} · usually 5 to 15 min`;
}
