import type { Store } from '../state/store.js';

export interface SoundPrefs {
  music: boolean;
  alerts: boolean;
}

const PREFS_KEY = 'agent-corp.sound';
const DEFAULT_PREFS: SoundPrefs = { music: true, alerts: true };

export function loadSoundPrefs(storage?: Pick<Storage, 'getItem'>): SoundPrefs {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    return {
      music: typeof saved.music === 'boolean' ? saved.music : DEFAULT_PREFS.music,
      alerts: typeof saved.alerts === 'boolean' ? saved.alerts : DEFAULT_PREFS.alerts,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveSoundPrefs(prefs: SoundPrefs, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const BAR_SECONDS = 4;
const MUSIC_VOLUME = 0.05;
const CHIME_GAP_MS = 1500;
const CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
];
const MELODY = [72, 74, 76, 79, 81];

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let prefs = loadSoundPrefs();
let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let scheduler: number | undefined;
let nextBarAt = 0;
let bar = 0;
let lastChimeAt = 0;
let ducked = false;

export function soundPrefs(): SoundPrefs {
  return { ...prefs };
}

export function setSoundPrefs(patch: Partial<SoundPrefs>): void {
  prefs = { ...prefs, ...patch };
  saveSoundPrefs(prefs);
  applyMusic();
}

function applyMusic(): void {
  if (prefs.music) startMusic();
  else stopMusic();
}

/** Hooks up sounds that accompany notices, separately from ambient music. */
export function mountAlertSounds(
  store: Pick<Store, 'onToast'>,
  sounds: { chime: () => void },
): void {
  store.onToast((toast) => {
    if (!prefs.alerts) return;
    if (toast.kind === 'needs_you') sounds.chime();
  });
}

export function mountSound(store: Store): void {
  mountAlertSounds(store, { chime: playChime });

  // Wire up the music toggle button
  const musicToggle = document.getElementById('musicToggle');
  if (musicToggle) {
    const updateIcon = () => {
      musicToggle.classList.toggle('off', !prefs.music);
      musicToggle.setAttribute('aria-pressed', String(prefs.music));
    };
    updateIcon();
    musicToggle.addEventListener('click', () => {
      setSoundPrefs({ music: !prefs.music });
      updateIcon();
    });
  }

  const unlock = () => {
    if (!audio()) return;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (prefs.music) startMusic();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  if (prefs.music) {
    const ac = audio();
    void ac?.resume().then(() => {
      if (ac.state === 'running') unlock();
    });
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== PREFS_KEY) return;
    prefs = loadSoundPrefs();
    if (ctx) applyMusic();
    // Update toggle button when prefs change in another tab
    if (musicToggle) {
      musicToggle.classList.toggle('off', !prefs.music);
      musicToggle.setAttribute('aria-pressed', String(prefs.music));
    }
  });
}

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function startMusic(): void {
  const ac = audio();
  if (!ac || scheduler !== undefined) return;
  musicGain = ac.createGain();
  musicGain.gain.setValueAtTime(0, ac.currentTime);
  musicGain.gain.linearRampToValueAtTime(ducked ? 0 : MUSIC_VOLUME, ac.currentTime + 2);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  musicGain.connect(filter).connect(ac.destination);
  nextBarAt = ac.currentTime + 0.1;
  const tick = () => {
    while (musicGain && nextBarAt < ac.currentTime + 1) {
      scheduleBar(ac, musicGain, nextBarAt, bar++);
      nextBarAt += BAR_SECONDS;
    }
  };
  tick();
  scheduler = window.setInterval(tick, 500);
}

function stopMusic(): void {
  window.clearInterval(scheduler);
  scheduler = undefined;
  if (!ctx || !musicGain) return;
  const gain = musicGain;
  musicGain = null;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
  window.setTimeout(() => gain.disconnect(), 1000);
}

function scheduleBar(ac: AudioContext, out: AudioNode, at: number, index: number): void {
  const chord = CHORDS[index % CHORDS.length] ?? [];
  for (const note of chord) {
    tone(ac, out, freq(note), at, BAR_SECONDS + 0.5, 'triangle', 0.18, 1.2);
  }
  tone(ac, out, freq((chord[0] ?? 48) - 12), at, BAR_SECONDS, 'sine', 0.35, 0.3);
  for (let beat = 0; beat < 8; beat++) {
    if (Math.random() < 0.55) continue;
    const note = MELODY[Math.floor(Math.random() * MELODY.length)] ?? 72;
    tone(ac, out, freq(note), at + beat * (BAR_SECONDS / 8), 1.2, 'sine', 0.12, 0.01);
  }
}

function tone(
  ac: AudioContext,
  out: AudioNode,
  hz: number,
  at: number,
  length: number,
  type: OscillatorType,
  peak: number,
  attack: number,
): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(peak, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

function playChime(): void {
  if (Date.now() - lastChimeAt < CHIME_GAP_MS) return;
  const ac = audio();
  if (!ac) return;
  lastChimeAt = Date.now();
  const now = ac.currentTime;
  tone(ac, ac.destination, freq(84), now, 0.6, 'sine', 0.25, 0.01);
  tone(ac, ac.destination, freq(88), now + 0.14, 0.9, 'sine', 0.25, 0.01);
}

export function setMusicDucked(on: boolean): void {
  ducked = on;
  if (!ctx || !musicGain) return;
  const gain = musicGain.gain;
  gain.cancelScheduledValues(ctx.currentTime);
  gain.setValueAtTime(gain.value, ctx.currentTime);
  gain.linearRampToValueAtTime(on ? 0 : MUSIC_VOLUME, ctx.currentTime + 0.4);
}
