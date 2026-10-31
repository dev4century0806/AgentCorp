/**
 * Settings → Voice input (issue #329). Off until turned on. Turning it on asks
 * macOS for the microphone first, so its prompt comes when the user expects
 * one, then downloads the speech model with a progress bar and Cancel.
 * Turning it off offers to delete the model.
 */
import type { VoiceSettings } from '@shared';
import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { el } from './dom.js';
import { settingCard, subSetting } from './setting-card.js';
import { currentDictateKey, dictateKeyLabel } from './shortcuts.js';
import { MIC_DENIED_STEPS, micAccess } from './voice.js';

/** The model is about this big, for the copy; the bar uses the real size. */
const MODEL_SIZE = '~80 MB';

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function onOffTabs(label: string, on: boolean, pick: (on: boolean) => void): HTMLElement {
  const tabs = el('div', 'tabs source-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', label);
  for (const value of [true, false]) {
    const btn = el('button', 'tab', value ? 'On' : 'Off');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(on === value));
    btn.addEventListener('click', () => {
      if (on !== value) pick(value);
    });
    tabs.appendChild(btn);
  }
  return tabs;
}

export function voiceSection(store: Store): HTMLElement {
  // Drawn afresh into this as the model downloads; the card inside carries the id Settings scrolls to.
  const card = el('div', 'voice-card');
  /** After Off: whether to ask about deleting the model, until Delete or Keep is picked. */
  let askDelete = false;
  let note: { text: string; why: boolean } | null = null;
  let busy = false;

  const act = async (work: () => Promise<unknown>): Promise<void> => {
    busy = true;
    note = null;
    draw(store.state.voice);
    try {
      await work();
    } catch (err) {
      note = { text: (err as Error).message, why: true };
    } finally {
      busy = false;
      draw(store.state.voice);
    }
  };

  const turnOn = (): Promise<void> =>
    act(async () => {
      askDelete = false;
      // The mic first, so the macOS prompt comes now, not at the first word.
      const mic = await micAccess(true);
      if (mic === 'denied' || mic === 'restricted') {
        note = { text: MIC_DENIED_STEPS, why: true };
        return;
      }
      await api.saveVoice({ enabled: true });
      if (store.state.voice.model.status === 'none') await api.downloadVoiceModel();
    });

  const turnOff = (): Promise<void> =>
    act(async () => {
      const voice = store.state.voice;
      if (voice.model.status === 'downloading') await api.cancelVoiceModel();
      await api.saveVoice({ enabled: false });
      askDelete = voice.model.status === 'ready';
    });

  const draw = (voice: VoiceSettings): void => {
    const key = currentDictateKey();
    const how = key ? `Hold ${dictateKeyLabel(key)} to dictate, or click the mic beside Send.` : 'Click the mic beside Send to dictate.';
    const top = settingCard('Voice input', `${how} Downloads an ${MODEL_SIZE} speech model; audio never leaves your Mac.`, [
      onOffTabs('Voice input', voice.enabled, (on) => void (on ? turnOn() : turnOff())),
    ]);
    top.id = 'voiceCard';
    const parts: HTMLElement[] = [];
    const { model } = voice;

    if (voice.enabled && model.status === 'downloading') {
      const bar = el('progress');
      bar.max = model.total || 1;
      bar.value = model.total ? model.received : 0;
      bar.setAttribute('aria-label', 'Speech model download');
      const cancel = el('button', 'btn small', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => void turnOff());
      const row = el('div', 'voice-progress');
      const pct = model.total ? `${Math.floor((model.received / model.total) * 100)}%` : '';
      row.append(bar, el('span', 'm', model.total ? `${megabytes(model.received)} of ${megabytes(model.total)} · ${pct}` : 'Starting…'), cancel);
      parts.push(subSetting('Downloading the speech model', [row]));
    }

    if (voice.enabled && model.status === 'none') {
      const retry = el('button', 'btn small primary', model.error ? 'Try again' : 'Download');
      retry.type = 'button';
      retry.addEventListener('click', () => void act(() => api.downloadVoiceModel()));
      parts.push(subSetting(
        model.error ? 'The speech model didn’t download' : 'The speech model isn’t downloaded',
        model.error ?? `Voice input needs it, ${MODEL_SIZE}, once for this Mac.`,
        [retry],
      ));
    }

    if (voice.enabled) {
      parts.push(subSetting(
        'Clean up with AI',
        voice.rewrite
          ? 'Your coding agent’s cheapest model rewrites the transcript into a clear message, keeping every instruction and detail. It uses your agent’s quota. Show original brings the words back as spoken.'
          : 'You get the transcript as spoken. On, your coding agent’s cheapest model rewrites it into a clear message, using your agent’s quota.',
        [onOffTabs('Clean up with AI', voice.rewrite, (on) => void act(() => api.saveVoice({ rewrite: on })))],
      ));
    }

    if (!voice.enabled && model.status === 'ready') {
      if (askDelete) {
        const del = el('button', 'btn small danger', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => void act(async () => {
          askDelete = false;
          await api.deleteVoiceModel();
        }));
        const keep = el('button', 'btn small', 'Keep');
        keep.type = 'button';
        keep.addEventListener('click', () => {
          askDelete = false;
          draw(store.state.voice);
        });
        parts.push(subSetting('Delete the speech model too?', `It frees ${MODEL_SIZE}. Keep it to turn voice input back on without downloading it again.`, [del, keep]));
      } else {
        const del = el('button', 'voice-link', 'Delete speech model');
        del.type = 'button';
        del.addEventListener('click', () => void act(() => api.deleteVoiceModel()));
        parts.push(subSetting('Speech model', `Still on this Mac, ${MODEL_SIZE}.`, [del]));
      }
    }

    if (note) {
      const line = el('span', note.why ? 'msg-line why' : 'msg-line m', note.text);
      line.setAttribute('role', 'status');
      parts.push(line);
    }
    for (const button of [top, ...parts].flatMap((n) => [...n.querySelectorAll('button')])) button.disabled = busy;
    top.append(...parts);
    card.replaceChildren(top);
  };

  draw(store.state.voice);
  const stop = store.onVoice((voice) => {
    if (!card.isConnected) return void stop();
    draw(voice);
  });
  return card;
}
