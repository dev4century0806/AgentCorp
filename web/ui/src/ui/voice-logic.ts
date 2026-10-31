/**
 * Voice input's rules, kept apart from the DOM and the microphone so they can
 * be tested: when a clip starts, stops or is dropped, and how its text goes
 * into a composer and is swapped for the cleaned-up version (issue #329).
 */
import { VOICE_MAX_SECONDS, VOICE_MIN_SECONDS } from '@shared';

/** Voice input is for the desktop app; the browser office hides it. */
export function hasDesktop(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { desktop?: unknown }).desktop;
}

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'cleaning';

/** Started by holding the dictation key, or by clicking the mic. */
export type ClipStart = 'hold' | 'click';

/** One recording, from the mic opening to 16 kHz mono samples. */
export interface Recording {
  /** Resolves once the mic is open; rejects when it can't be, such as when access is denied. */
  start(): Promise<void>;
  /** Stops and resolves with the samples. */
  stop(): Promise<Float32Array>;
  /** Stops and throws the audio away. */
  abort(): void;
}

export interface ClipDeps {
  now(): number;
  record(): Recording;
  newId(): string;
  /** Whether the clean-up is on, read when a clip starts. */
  rewriteOn(): boolean;
  warm(clip: string): void;
  cancel(clip: string): void;
  transcribe(clip: string, samples: Float32Array): Promise<string>;
  rewrite(clip: string, raw: string): Promise<string | null>;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  phase(phase: VoicePhase): void;
  /** The transcript is in: put it in the composer. */
  raw(clip: string, raw: string): void;
  /** The cleaned version is in: swap it for the transcript. */
  cleaned(clip: string, cleaned: string): void;
  /** The mic would not open, or the transcription failed. */
  failed(err: Error): void;
}

/**
 * One composer's clips, one at a time. Held clips under VOICE_MIN_SECONDS are
 * dropped as accidents; any clip stops by itself at VOICE_MAX_SECONDS. A
 * failed rewrite keeps the transcript, without a word.
 */
export class Clips {
  private current: { id: string; how: ClipStart; at: number; rec: Recording; opening: Promise<void>; timer: unknown; rewrite: boolean } | null = null;
  private _phase: VoicePhase = 'idle';

  constructor(private readonly deps: ClipDeps) {}

  get phase(): VoicePhase {
    return this._phase;
  }

  get how(): ClipStart | null {
    return this.current?.how ?? null;
  }

  private set(phase: VoicePhase): void {
    this._phase = phase;
    this.deps.phase(phase);
  }

  begin(how: ClipStart): void {
    if (this._phase !== 'idle') return;
    const id = this.deps.newId();
    const rewrite = this.deps.rewriteOn();
    // The clean-up's CLI boots while the user speaks.
    if (rewrite) this.deps.warm(id);
    const rec = this.deps.record();
    const timer = this.deps.setTimer(() => void this.finish(), VOICE_MAX_SECONDS * 1000);
    const opening = rec.start();
    const clip = { id, how, at: this.deps.now(), rec, opening, timer, rewrite };
    this.current = clip;
    this.set('listening');
    opening.catch((err: Error) => {
      // Once the clip has stopped, finish() says what went wrong instead.
      if (this.current !== clip || this._phase !== 'listening') return;
      this.drop();
      this.deps.failed(err);
    });
  }

  /** Throws the clip away: another key was pressed with the dictation key, or the window lost focus. */
  abort(): void {
    if (this._phase !== 'listening') return;
    this.drop();
  }

  private drop(): void {
    const clip = this.current;
    if (!clip) return;
    this.current = null;
    this.deps.clearTimer(clip.timer);
    clip.rec.abort();
    this.deps.cancel(clip.id);
    this.set('idle');
  }

  /** The key was let go, the mic clicked again, or the two minutes ran out. */
  async finish(): Promise<void> {
    const clip = this.current;
    if (!clip || this._phase !== 'listening') return;
    if (clip.how === 'hold' && this.deps.now() - clip.at < VOICE_MIN_SECONDS * 1000) {
      this.drop();
      return;
    }
    this.deps.clearTimer(clip.timer);
    this.set('transcribing');
    let raw: string;
    try {
      await clip.opening;
      raw = await this.deps.transcribe(clip.id, await clip.rec.stop());
    } catch (err) {
      this.current = null;
      this.deps.cancel(clip.id);
      this.set('idle');
      this.deps.failed(err as Error);
      return;
    }
    if (this.current !== clip) return;
    if (!raw) {
      this.current = null;
      this.set('idle');
      return;
    }
    this.deps.raw(clip.id, raw);
    if (clip.rewrite) {
      this.set('cleaning');
      const cleaned = await this.deps.rewrite(clip.id, raw).catch(() => null);
      if (cleaned && cleaned !== raw) this.deps.cleaned(clip.id, cleaned);
    }
    this.current = null;
    this.set('idle');
  }
}

/** Where a clip's text sits in a composer, and both versions of it. */
export interface Dictated {
  start: number;
  end: number;
  raw: string;
  cleaned: string | null;
  showing: 'raw' | 'cleaned';
}

/**
 * Puts text in at the cursor, or over the selection, with a space either side
 * where it would otherwise run into a word.
 */
export function insertDictation(value: string, selStart: number, selEnd: number, text: string): { value: string; dictated: Dictated; caret: number } {
  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const start = before.length + lead.length;
  const end = start + text.length;
  return {
    value: before + lead + text + trail + after,
    dictated: { start, end, raw: text, cleaned: null, showing: 'raw' },
    caret: end + trail.length,
  };
}

/**
 * Swaps the dictated part for the other version, and only that part. Null
 * when it has been edited since, so the user's changes are never undone.
 */
export function swapDictation(value: string, d: Dictated, to: 'raw' | 'cleaned'): { value: string; dictated: Dictated } | null {
  const now = d.showing === 'raw' ? d.raw : d.cleaned;
  const next = to === 'raw' ? d.raw : d.cleaned;
  if (now === null || next === null || value.slice(d.start, d.end) !== now) return null;
  return {
    value: value.slice(0, d.start) + next + value.slice(d.end),
    dictated: { ...d, end: d.start + next.length, showing: to },
  };
}

/**
 * Whether holding the dictation key may start a clip: always in the composer's
 * own box, and elsewhere within its reach (the worker chat's is the whole chat
 * window) unless a dialog is up or another field has focus, so it never cuts
 * in on typing somewhere else.
 */
export function mayHold(at: { inBox: boolean; within: boolean; dialog: boolean; otherField: boolean }): boolean {
  return at.inBox || (at.within && !at.dialog && !at.otherField);
}

/** What the composer says while a clip is under way. */
export function phaseText(phase: VoicePhase, how: ClipStart | null): string {
  if (phase === 'listening') return how === 'click' ? 'Listening… click the mic to stop.' : 'Listening… let go to stop.';
  if (phase === 'transcribing') return 'Transcribing…';
  if (phase === 'cleaning') return 'Cleaning up…';
  return '';
}
