import type { Idea } from '@shared';
import { api, toUpload } from '../net/client.js';
import type { Store } from '../state/store.js';
import { attachTray, wireFileDrop } from './attach.js';
import { mountVoice } from './voice.js';
import { attachButton, autoGrow, clear, el } from './dom.js';
import { threadLines } from './idea-thread-text.js';

/** A card's talk with its Planner. The node is kept across redraws, so a half-typed reply survives them. */
export interface IdeaThread {
  node: HTMLElement;
  /** Redraws the lines if they changed; called on every store update. */
  refresh(): void;
}

/**
 * The discussion on a shaping idea's card: short messages both ways, tap-to-reply
 * buttons when the Planner offered answers, and a reply box that takes files.
 * It uses the same message API as the chat, so the Planner's chat shows the same
 * conversation. Files sent are also kept on the idea, under its own uploads, so
 * they outlast the Planner.
 */
export function ideaThread(store: Store, ideaId: number, plannerId: () => string | null): IdeaThread {
  const node = el('div', 'idea-thread');
  const log = el('div', 'idea-thread-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Discussion with the Planner');
  const quick = el('div', 'idea-quick');
  quick.setAttribute('aria-label', 'Quick replies');
  const typing = el('span', 'm idea-typing');
  typing.hidden = true;

  const reply = el('textarea', 'ask-input idea-reply');
  reply.rows = 2;
  reply.placeholder = 'Reply, or drop a file here';
  reply.setAttribute('aria-label', 'Reply to the Planner');
  const fit = autoGrow(reply, () => 140);
  const files = el('div', 'attach-list');
  const idea = (): Idea | undefined => store.state.ideas.find((i) => i.id === ideaId);
  const tray = attachTray(files, {
    onError: (message) => store.patch({ lastError: message }),
    used: () => (idea()?.attachments ?? []).reduce((sum, a) => sum + a.size, 0),
  });
  wireFileDrop(node, reply, (dropped) => tray.add(dropped));
  const picker = el('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', () => {
    tray.add(picker.files ?? []);
    picker.value = '';
  });
  const attach = attachButton();
  attach.addEventListener('click', () => picker.click());
  const send = el('button', 'btn small primary', 'Send');
  send.type = 'button';
  const row = el('div', 'row idea-reply-row');
  row.append(send, attach, picker);
  node.append(log, typing, quick, reply, files, row);
  const voice = mountVoice(store, reply, { in: node, before: row });

  const say = async (text: string, withFiles = false): Promise<void> => {
    const id = plannerId();
    if (!id) return;
    const body = text.trim();
    const dropped = withFiles ? [...tray.files] : [];
    if (!body && !dropped.length) return;
    send.disabled = true;
    try {
      const uploads = await Promise.all(dropped.map(toUpload));
      // Kept on the idea first, so the files are still there when the Planner is gone.
      if (uploads.length) await api.updateIdea(ideaId, { attachments: uploads });
      await api.send(id, body, uploads);
      if (withFiles) {
        reply.value = '';
        voice.sent();
        fit();
        tray.clear();
      }
    } catch (err) {
      store.patch({ lastError: (err as Error).message });
    } finally {
      send.disabled = false;
    }
  };
  send.addEventListener('click', () => void say(reply.value, true));
  // Enter makes a new line; Cmd or Ctrl + Enter sends.
  reply.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void say(reply.value, true);
    }
  });

  let drawn = '';
  const refresh = (): void => {
    const id = plannerId();
    const planner = id ? store.state.agents.find((a) => a.id === id) : undefined;
    const busy = planner?.status === 'working' || planner?.status === 'starting';
    const { lines, options } = threadLines(id ? store.messagesFor(id) : [], id ? store.state.streaming.get(id) : undefined);
    const shownOptions = busy ? [] : options;
    typing.hidden = !busy;
    typing.textContent = `${planner?.name ?? 'The Planner'} is thinking…`;
    send.disabled = !id;
    const sig = JSON.stringify([lines.map((l) => [l.key, l.text.length, l.files]), shownOptions]);
    if (sig === drawn) return;
    drawn = sig;

    const stuck = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    clear(log);
    log.hidden = !lines.length;
    for (const line of lines) {
      const bubble = el('div', `idea-line ${line.who}`);
      bubble.appendChild(el('span', 'idea-line-text', line.text));
      if (line.files.length) bubble.appendChild(el('span', 'm', line.files.join(', ')));
      log.appendChild(bubble);
    }
    if (stuck) log.scrollTop = log.scrollHeight;

    clear(quick);
    quick.hidden = !shownOptions.length;
    for (const option of shownOptions) {
      const b = el('button', 'btn small idea-quick-option', option);
      b.type = 'button';
      b.addEventListener('click', () => void say(option));
      quick.appendChild(b);
    }
  };
  refresh();
  return { node, refresh };
}
