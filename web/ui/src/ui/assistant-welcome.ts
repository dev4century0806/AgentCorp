import { BUILT_IN_PAM_ID, WORKER_NAME_MAX } from '@shared';
import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { el } from './dom.js';
import { settingCard } from './setting-card.js';

function nameForm(store: Store, initial: string, saved?: () => void): HTMLFormElement {
  const form = el('form', 'assistant-name-form');
  const label = el('label', null, 'Tên trợ lý');
  const input = el('input', 'ask-repo');
  input.name = 'assistantName';
  input.type = 'text';
  input.required = true;
  input.maxLength = WORKER_NAME_MAX;
  input.value = initial;
  input.autocomplete = 'off';
  label.appendChild(input);
  const submit = el('button', 'btn primary', saved ? 'Bắt đầu' : 'Lưu tên');
  submit.type = 'submit';
  const status = el('span', 'msg-line');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  form.append(label, submit, status);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      status.textContent = 'Vui lòng nhập tên trợ lý.';
      input.focus();
      return;
    }
    submit.disabled = true;
    input.disabled = true;
    status.textContent = 'Đang lưu…';
    try {
      const assistant = await api.nameAssistant(name);
      store.patch({ agents: store.state.agents.map(agent =>
        agent.builtInPam || agent.id === BUILT_IN_PAM_ID ? { ...agent, name: assistant.name } : agent) });
      input.value = assistant.name;
      // The server is authoritative even when browser storage is unavailable.
      try { localStorage.setItem('agent-corp.assistant-name', assistant.name); } catch {}
      status.textContent = 'Đã lưu tên trợ lý.';
      saved?.();
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      submit.disabled = false;
      input.disabled = false;
    }
  });
  return form;
}

export function assistantNameSection(store: Store): HTMLElement {
  const name = store.state.agents.find(agent => agent.builtInPam)?.name ?? 'Nova';
  return settingCard('Trợ lý lễ tân', 'Đặt tên trợ lý của văn phòng. Tên được lưu trên máy này.', [nameForm(store, name)]);
}

export async function mountAssistantWelcome(store: Store): Promise<void> {
  let assistant;
  try {
    assistant = await api.assistant();
  } catch (error) {
    store.patch({ lastError: (error as Error).message });
    return;
  }
  if (assistant.named) return;
  const dialog = el('dialog', 'assistant-welcome-modal');
  dialog.id = 'assistantWelcomeDialog';
  dialog.setAttribute('aria-labelledby', 'assistantWelcomeTitle');
  const title = el('h2', null, 'Xin chào!');
  title.id = 'assistantWelcomeTitle';
  const form = nameForm(store, assistant.name || 'Nova', () => {
    dialog.close();
    dialog.remove();
  });
  dialog.append(title, el('p', null, 'Bạn muốn gọi tôi là gì?'), form);
  dialog.addEventListener('cancel', event => event.preventDefault());
  document.body.appendChild(dialog);
  dialog.showModal();
  form.querySelector('input')?.focus();
}
