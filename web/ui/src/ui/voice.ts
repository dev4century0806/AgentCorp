/**
 * Voice input in a composer (issue #329): hold the dictation key, or click the
 * mic, to speak. The clip is transcribed on this Mac, its text goes in at the
 * cursor, and the cleaned-up version swaps in when it's ready, with Show
 * original to swap back. Desktop app only; the browser office has no mic button.
 * The rules are in voice-logic.ts.
 */
import { VOICE_SAMPLE_RATE } from '@shared';
import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { BUTTON_ICONS, el, iconSvg } from './dom.js';
import { currentDictateKey, dictateKeyLabel, takesKeys, watchDictateKey } from './shortcuts.js';
import { Clips, hasDesktop, insertDictation, mayHold, phaseText, swapDictation, type Dictated, type Recording } from './voice-logic.js';

/** How to give the app the microphone again once it was refused. */
export const MIC_DENIED_STEPS =
  'Microphone access is off for AgentCorp. Open System Settings → Privacy & Security → Microphone, turn on AgentCorp, then try again.';

type MicStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

/** Where macOS stands on the microphone, asking for it when `ask` and it hasn't been asked yet. */
export async function micAccess(ask: boolean): Promise<MicStatus> {
  const desktop = (window as unknown as { desktop?: { micAccess?: (ask: boolean) => Promise<MicStatus | null> } }).desktop;
  if (!desktop?.micAccess) return 'granted';
  return (await desktop.micAccess(ask)) ?? 'unknown';
}

/** Opens Settings → General on the Voice input card. */
export function openVoiceSettings(): void {
  window.dispatchEvent(new CustomEvent('open-voice-settings'));
}

/** Resamples a recording to 16 kHz mono, as the transcriber takes it. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  if (!data.byteLength) return new Float32Array();
  // Decoding in a 16 kHz context resamples; rendering into one channel mixes down.
  const decoded = await new OfflineAudioContext(1, 1, VOICE_SAMPLE_RATE).decodeAudioData(data);
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * VOICE_SAMPLE_RATE)), VOICE_SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

function micRecording(): Recording {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let aborted = false;
  const chunks: Blob[] = [];
  const release = (): void => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (aborted) return release();
      recorder = new MediaRecorder(stream);
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size) chunks.push(e.data);
      });
      recorder.start();
    },
    stop() {
      return new Promise<Float32Array>((resolve, reject) => {
        const rec = recorder;
        if (!rec || rec.state === 'inactive') {
          release();
          resolve(new Float32Array());
          return;
        }
        rec.addEventListener('stop', () => {
          release();
          toSamples(new Blob(chunks, { type: rec.mimeType })).then(resolve, reject);
        }, { once: true });
        rec.stop();
      });
    },
    abort() {
      aborted = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** A composer's voice input. */
export interface VoiceInput {
  /** The message went: Show original, and any note about the last clip, go with it. */
  sent(): void;
}

/** The off-hint shows once per launch, not on every press. */
let hintedOff = false;

/**
 * Adds voice input to a composer: the mic is a small icon in the text box's
 * lower right, and the line that says what it's doing goes before `before`
 * in `statusIn`. Holding the dictation key works while `input` has focus, or,
 * given `within`, wherever it says (see mayHold); a clip started there moves
 * focus to `input`, so the text goes in at its cursor. Text is put in with an
 * input event, so the composer's own listeners see it.
 */
export function mountVoice(
  store: Store,
  input: HTMLTextAreaElement,
  status: { in: HTMLElement; before?: Node | null },
  opts: { within?: () => boolean } = {},
): VoiceInput {
  if (!hasDesktop()) return { sent: () => undefined };
  const mic = el('button', 'voice-mic');
  mic.type = 'button';
  mic.innerHTML = iconSvg(BUTTON_ICONS.mic);
  mic.setAttribute('aria-label', 'Dictate');
  mic.setAttribute('aria-pressed', 'false');
  watchDictateKey((key) => {
    mic.title = key ? `Dictate: click, or hold ${dictateKeyLabel(key)}` : 'Dictate';
  });

  const statusLine = el('div', 'voice-status');
  statusLine.setAttribute('role', 'status');
  statusLine.setAttribute('aria-live', 'polite');
  statusLine.hidden = true;
  const line = el('span', 'm');
  const toggle = el('button', 'voice-link', 'Show original');
  toggle.type = 'button';
  const settings = el('button', 'voice-link', 'Open Settings');
  settings.type = 'button';
  settings.addEventListener('click', openVoiceSettings);
  statusLine.append(line, toggle, settings);
  // The box and its mic sit in a wrapper, so the mic can be pinned to the box's corner.
  // A composer that already wrapped its box, to pin icons of its own there, keeps that one.
  let field = input.parentElement?.classList.contains('voice-field') ? input.parentElement : null;
  if (!field) {
    field = el('div', 'voice-field');
    input.before(field);
    field.append(input);
  }
  field.append(mic);
  status.in.insertBefore(statusLine, status.before ?? null);

  /** What the line is showing: a clip under way, a note, or the cleaned version with its toggle. */
  let showing: 'phase' | 'note' | 'toggle' | null = null;
  const show = (kind: NonNullable<typeof showing>, text: string, extra: { why?: boolean; settings?: boolean } = {}): void => {
    showing = kind;
    line.textContent = text;
    line.className = extra.why ? 'msg-line why' : 'm';
    toggle.hidden = kind !== 'toggle';
    settings.hidden = !extra.settings;
    statusLine.hidden = false;
  };
  const hide = (): void => {
    showing = null;
    statusLine.hidden = true;
  };

  let dictated: Dictated | null = null;
  const put = (value: string, d: Dictated, caret: number): void => {
    input.value = value;
    dictated = d;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  toggle.addEventListener('click', () => {
    if (!dictated) return;
    const next = swapDictation(input.value, dictated, dictated.showing === 'raw' ? 'cleaned' : 'raw');
    if (!next) return hide();
    put(next.value, next.dictated, next.dictated.end);
    toggle.textContent = next.dictated.showing === 'raw' ? 'Show cleaned up' : 'Show original';
    input.focus();
  });
  // An edit to the dictated part ends the toggle: swapping would undo it.
  input.addEventListener('input', () => {
    if (!dictated) return;
    const shown = dictated.showing === 'raw' ? dictated.raw : dictated.cleaned;
    if (input.value.slice(dictated.start, dictated.end) === shown) return;
    dictated = null;
    if (showing === 'toggle') hide();
  });

  const clips = new Clips({
    now: () => performance.now(),
    record: micRecording,
    newId: () => crypto.randomUUID(),
    rewriteOn: () => store.state.voice.rewrite,
    warm: (clip) => void api.warmVoice(clip).catch(() => undefined),
    cancel: (clip) => void api.cancelVoice(clip).catch(() => undefined),
    transcribe: async (clip, samples) => (await api.transcribe(clip, samples)).raw,
    rewrite: async (clip, raw) => (await api.rewriteVoice(clip, raw)).cleaned,
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    phase: (phase) => {
      mic.classList.toggle('recording', phase === 'listening');
      mic.setAttribute('aria-pressed', String(phase === 'listening'));
      mic.disabled = phase === 'transcribing' || phase === 'cleaning';
      if (phase !== 'idle') show('phase', phaseText(phase, clips.how));
      else if (showing === 'phase') hide();
    },
    raw: (_clip, raw) => {
      const at = insertDictation(input.value, input.selectionStart, input.selectionEnd, raw);
      put(at.value, at.dictated, at.caret);
    },
    cleaned: (_clip, cleaned) => {
      if (!dictated) return;
      const next = swapDictation(input.value, { ...dictated, cleaned }, 'cleaned');
      if (!next) return;
      const caretAtEnd = input.selectionStart === dictated.end;
      put(next.value, next.dictated, caretAtEnd ? next.dictated.end : Math.min(input.selectionStart, next.value.length));
      toggle.textContent = 'Show original';
      // Set after the phase goes idle, so it stays up.
      queueMicrotask(() => show('toggle', 'Cleaned up with AI.'));
    },
    failed: (err) => {
      const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
      if (denied) return show('note', MIC_DENIED_STEPS, { why: true });
      if (err.name === 'NotFoundError') return show('note', 'No microphone was found. Plug one in, or pick one in System Settings → Sound → Input.', { why: true });
      show('note', err.message, { why: true });
    },
  });

  let holding = false;
  // The mic shows only while voice input is on. Turned off mid-clip, the clip goes.
  let seen = false;
  mic.hidden = !store.state.voice.enabled;
  const stopWatching = store.onVoice((voice) => {
    if (mic.isConnected) seen = true;
    else if (seen) return void stopWatching();
    mic.hidden = !voice.enabled;
    if (!voice.enabled) {
      holding = false;
      clips.abort();
    }
  });

  /** Whether voice input can take a clip now; says why not when it can't. */
  const ready = (): boolean => {
    const voice = store.state.voice;
    if (!voice.enabled) {
      // Only the key can get here: the mic is hidden while voice input is off.
      if (!hintedOff) {
        hintedOff = true;
        show('note', 'Voice input is off. Turn it on in Settings → Voice input to dictate.', { settings: true });
      }
      return false;
    }
    if (voice.model.status !== 'ready') {
      const pct = voice.model.total ? ` (${Math.floor((voice.model.received / voice.model.total) * 100)}%)` : '';
      show('note', voice.model.status === 'downloading' ? `The speech model is still downloading${pct}.` : 'The speech model isn’t downloaded. Turn voice input on again in Settings to download it.', { settings: voice.model.status !== 'downloading' });
      return false;
    }
    return true;
  };

  mic.addEventListener('click', () => {
    if (clips.phase === 'listening') return void clips.finish();
    if (clips.phase !== 'idle' || !ready()) return;
    if (showing === 'note') hide();
    clips.begin('click');
    input.focus();
  });

  /** Whether a hold may start a clip here, by where focus is. */
  const mayStart = (): boolean => {
    const active = document.activeElement;
    return mayHold({
      inBox: active === input,
      within: opts.within?.() ?? false,
      dialog: !!document.querySelector('dialog[open], [role="dialog"]:not([hidden])'),
      otherField: active instanceof HTMLElement && takesKeys(active),
    });
  };
  // With `within`, the keys are caught on the window, before anything else sees them; otherwise in the box.
  const keys: EventTarget = opts.within ? window : input;
  const capture = !!opts.within;
  keys.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const key = currentDictateKey();
    if (key && e.code === key) {
      if (e.repeat || holding || clips.phase !== 'idle' || !mayStart()) return;
      // Only on its own: Shift or Command held with Option is a shortcut, not dictation.
      const others = [e.shiftKey, e.ctrlKey && !key.startsWith('Control'), e.metaKey && !key.startsWith('Meta'), e.altKey && !key.startsWith('Alt')];
      if (others.some(Boolean) || !ready()) return;
      if (showing === 'note') hide();
      holding = true;
      clips.begin('hold');
      input.focus();
      return;
    }
    // Another key with the dictation key down is a character or a shortcut, such as Option+E: it types, and the clip goes.
    if (holding) {
      holding = false;
      clips.abort();
      return;
    }
    if (e.key === 'Escape' && clips.phase === 'listening') {
      e.preventDefault();
      e.stopPropagation();
      clips.abort();
    }
  }, capture);
  // Focus stays in the composer while the key is held; leaving it, or the window, drops the clip.
  keys.addEventListener('keyup', (e) => {
    if (!holding || (e as KeyboardEvent).code !== currentDictateKey()) return;
    holding = false;
    void clips.finish();
  }, capture);
  input.addEventListener('blur', () => {
    if (!holding) return;
    holding = false;
    clips.abort();
  });

  return {
    sent: () => {
      dictated = null;
      // A clip still under way keeps its line; anything else said about the last one goes.
      if (showing !== 'phase') hide();
    },
  };
}
