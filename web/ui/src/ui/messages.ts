import type { UserMessage, Persona, SharePackageData } from '@shared';
import { $, clear, el, setRichText, escapeHtml, iconSvg, iconText, TEXT_ICONS } from './dom.js';
import { htmlText, sanitizeHtml } from './sanitize.js';
import type { Store } from '../state/store.js';
import type { InboxMessage, SharePreview } from './auth.js';

/** How long ago a message was sent, in human-readable form. */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface MessagesApi {
  getMessages: () => Promise<InboxMessage[]>;
  getUnreadCount: () => Promise<number>;
  markRead: (id: string) => Promise<boolean>;
  deleteMessage: (id: string) => Promise<boolean>;
  getSharePreview: (messageId: string) => Promise<SharePreview | null>;
  downloadShare: (shareId: string) => Promise<unknown>;
  blockSender: (userId: string) => Promise<void>;
  /** Called after downloading an agent. Returns the saved persona. */
  saveDownloadedAgent: (data: SharePackageData) => Promise<Persona>;
  /** Called after downloading a skill. */
  saveDownloadedSkill: (data: SharePackageData) => Promise<void>;
}

/** The one-line preview of a message body shown in the list: text, never tags. */
export function messageSnippet(body: string, format: 'text' | 'html' = 'text'): string {
  const line = (format === 'html' ? htmlText(body) : body).replace(/\s+/g, ' ').trim();
  return line.length > 100 ? line.slice(0, 100) + '…' : line;
}

/** Where a downloaded share ended up, shown under the Download button. */
export function downloadedNote(packageType: 'agent' | 'skill'): string {
  return packageType === 'agent'
    ? 'Saved to your agents. Find it in Settings → Toolkit → Agents, or pick it as the agent when you hire a worker.'
    : 'Saved to your general skills. Find it in Settings → Toolkit → Skills; every worker can use it from their next session.';
}

export function mountMessages(store: Store, api: MessagesApi): void {
  const panel = $<HTMLElement>('messagesPanel');
  const list = $<HTMLElement>('messagesList');
  const sub = $<HTMLElement>('messagesSub');
  const unreadDot = $<HTMLElement>('unreadDot');
  const dialog = $<HTMLDialogElement>('messageDialog');
  const dialogTitle = $<HTMLElement>('messageDialogTitle');
  const dialogMeta = $<HTMLElement>('messageDialogMeta');
  const dialogBody = $<HTMLElement>('messageDialogBody');
  let wasOpen = false;
  let messages: InboxMessage[] = [];
  /** The message shown in the modal, if any. */
  let openId: string | null = null;
  /** Loaded share preview, keyed by message ID. */
  const shareCache = new Map<string, SharePreview | null>();
  /** Loading state for share previews. */
  const loadingShares = new Set<string>();
  /** Messages whose share was downloaded this session, so the note survives a preview reload. */
  const savedShares = new Set<string>();

  const updateUnreadDot = async () => {
    try {
      const count = await api.getUnreadCount();
      unreadDot.hidden = count === 0;
      store.patch({ inboxUnreadCount: count });
    } catch {
      // Silent fail — don't break the UI for a badge.
    }
  };

  const loadMessages = async () => {
    clear(list);
    list.appendChild(el('div', 'empty', 'Loading…'));
    try {
      messages = await api.getMessages();
      render();
      await updateUnreadDot();
    } catch (err) {
      clear(list);
      list.appendChild(el('div', 'error-box', (err as Error).message));
    }
  };

  /** Load the share preview for a share message. */
  const loadSharePreview = async (messageId: string) => {
    if (shareCache.has(messageId) || loadingShares.has(messageId)) return;
    loadingShares.add(messageId);
    try {
      const preview = await api.getSharePreview(messageId);
      shareCache.set(messageId, preview);
    } catch {
      shareCache.set(messageId, null);
    } finally {
      loadingShares.delete(messageId);
      renderDialog();
    }
  };

  const deleteMessage = async (msg: InboxMessage, button: HTMLButtonElement) => {
    button.disabled = true;
    try {
      await api.deleteMessage(msg.id);
      messages = messages.filter((m) => m.id !== msg.id);
      shareCache.delete(msg.id);
      savedShares.delete(msg.id);
      if (openId === msg.id) closeDialog();
      render();
      await updateUnreadDot();
    } catch (err) {
      button.disabled = false;
      store.patch({ lastError: (err as Error).message });
    }
  };

  const deleteButton = (msg: InboxMessage, className: string): HTMLButtonElement => {
    const del = el('button', className, 'Delete');
    del.type = 'button';
    del.setAttribute('aria-label', `Delete message: ${msg.title}`);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteMessage(msg, del);
    });
    return del;
  };

  const openMessage = async (msg: InboxMessage) => {
    openId = msg.id;
    renderDialog();
    if (!dialog.open) dialog.showModal();
    if (!msg.isRead) {
      try {
        await api.markRead(msg.id);
        msg.isRead = true;
        render();
        await updateUnreadDot();
      } catch {
        // Silent fail for mark-read.
      }
    }
  };

  const closeDialog = () => {
    openId = null;
    if (dialog.open) dialog.close();
  };

  const render = () => {
    clear(list);
    const unread = messages.filter((m) => !m.isRead).length;
    sub.textContent = messages.length
      ? `${messages.length} message${messages.length !== 1 ? 's' : ''}${unread ? `, ${unread} unread` : ''}`
      : 'No messages';

    if (!messages.length) {
      list.appendChild(el('div', 'messages-empty', 'Your inbox is empty.'));
      return;
    }

    for (const msg of messages) {
      const isShare = msg.shareId !== null;
      const item = el('div', `message-item${msg.isRead ? '' : ' unread'}${isShare ? ' share-message' : ''}`);
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-haspopup', 'dialog');

      const head = el('div', 'message-head');
      const title = el('h3', `message-title${msg.isRead ? '' : ' unread'}`, msg.title);
      const time = el('span', 'message-time', timeAgo(new Date(msg.createdAt)));
      head.append(title, time, deleteButton(msg, 'message-delete'));
      item.appendChild(head);
      item.appendChild(el('p', 'message-body', messageSnippet(msg.body, msg.bodyFormat)));

      item.addEventListener('click', () => void openMessage(msg));
      item.addEventListener('keydown', (e) => {
        if (e.target !== item) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void openMessage(msg);
        }
      });

      list.appendChild(item);
    }
  };

  /** Fill the modal with the open message's full details. */
  const renderDialog = () => {
    const msg = messages.find((m) => m.id === openId);
    if (!msg) return;
    dialogTitle.textContent = msg.title;
    const from = msg.senderType === 'user' ? (msg.senderUsername ?? 'Someone') : msg.senderType === 'admin' ? 'AgentCorp team' : 'AgentCorp';
    const sent = new Date(msg.createdAt);
    dialogMeta.textContent = `From ${from} · ${timeAgo(sent)}`;
    dialogMeta.title = sent.toLocaleString();

    clear(dialogBody);
    const body = el('div', msg.bodyFormat === 'html' ? 'message-dialog-text html' : 'message-dialog-text');
    if (msg.bodyFormat === 'html') {
      body.appendChild(sanitizeHtml(msg.body));
      // Links open in the system browser; don't let the click reach the dialog.
      for (const a of body.querySelectorAll('a')) a.addEventListener('click', (e) => e.stopPropagation());
    } else {
      setRichText(body, msg.body);
    }
    dialogBody.appendChild(body);

    if (msg.shareId !== null) {
      const preview = shareCache.get(msg.id);
      if (preview === undefined) {
        void loadSharePreview(msg.id);
        dialogBody.appendChild(el('div', 'share-loading', 'Loading preview…'));
      } else if (preview === null) {
        dialogBody.appendChild(el('div', 'share-expired', 'This share has expired or is no longer available.'));
      } else {
        dialogBody.appendChild(renderSharePreview(msg, preview));
      }
    }

    const actions = el('div', 'message-actions');
    // Block button for user messages
    if (msg.senderType === 'user' && msg.senderId) {
      const block = el('button', 'message-block', 'Block sender');
      block.type = 'button';
      block.title = `Block ${msg.senderUsername ?? 'this user'} from sharing with you`;
      block.addEventListener('click', async () => {
        if (!confirm(`Block ${msg.senderUsername ?? 'this user'}? They won't be able to share with you.`)) return;
        block.disabled = true;
        try {
          await api.blockSender(msg.senderId!);
          store.patch({ lastError: null });
          block.textContent = 'Blocked';
        } catch (err) {
          block.disabled = false;
          store.patch({ lastError: (err as Error).message });
        }
      });
      actions.appendChild(block);
    }
    actions.appendChild(deleteButton(msg, 'btn ghost message-dialog-delete'));
    dialogBody.appendChild(actions);
  };

  $('messageDialogClose').addEventListener('click', closeDialog);
  // Esc closes the modal only; without this it would also close the panel (main.ts).
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeDialog();
  });
  dialog.addEventListener('close', () => { openId = null; });
  // A click on the backdrop lands on the dialog itself, outside its box.
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeDialog();
  });

  /** Render the share preview content with download button. */
  const renderSharePreview = (msg: InboxMessage, preview: SharePreview): HTMLElement => {
    const container = el('div', 'share-preview');
    const data = preview.packageData as SharePackageData;

    // Type badge
    const typeBadge = preview.packageType === 'agent'
      ? iconText(el('span', 'share-type agent'), TEXT_ICONS.user, 'Agent')
      : iconText(el('span', `share-type ${preview.packageType}`), TEXT_ICONS.note, 'Skill');
    container.appendChild(typeBadge);

    // Package name
    container.appendChild(el('h4', 'share-name', data.name));

    // Instructions preview
    if (preview.packageType === 'agent' && data.persona?.instructions) {
      const preview = el('div', 'share-instructions');
      preview.appendChild(el('b', null, 'Instructions'));
      const text = el('div', 'share-instructions-text');
      setRichText(text, data.persona.instructions);
      preview.appendChild(text);
      container.appendChild(preview);
    } else if (preview.packageType === 'skill' && data.skill) {
      if (data.skill.description) {
        container.appendChild(el('p', 'share-description m', data.skill.description));
      }
      const previewEl = el('div', 'share-instructions');
      previewEl.appendChild(el('b', null, 'Instructions'));
      const text = el('div', 'share-instructions-text');
      setRichText(text, data.skill.instructions);
      previewEl.appendChild(text);
      container.appendChild(previewEl);

      // Warning for skills with scripts
      if (data.skill.files.length > 0) {
        const warning = el('div', 'share-warning');
        warning.innerHTML = iconSvg(TEXT_ICONS.warning, 'text-icon') + '<b>Contains code:</b> ' + escapeHtml(data.skill.files.join(', '));
        container.appendChild(warning);
      }
    }

    // Stripped secrets warning
    if (preview.strippedSecrets.length > 0) {
      const stripped = el('div', 'share-stripped');
      stripped.innerHTML = iconSvg(TEXT_ICONS.lock, 'text-icon') + '<b>Secrets removed:</b> ' + escapeHtml(preview.strippedSecrets.join(', '));
      container.appendChild(stripped);
    }

    // Expiry info
    const expires = new Date(preview.expiresAt);
    const now = new Date();
    const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 7) {
      container.appendChild(el('div', 'share-expiry', `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`));
    }

    // Download status / button
    const actions = el('div', 'share-actions');
    if (preview.downloadedAt) {
      const downloaded = iconText(el('span', 'share-downloaded'), TEXT_ICONS.check, 'Downloaded ' + timeAgo(new Date(preview.downloadedAt)));
      actions.appendChild(downloaded);
    }

    const download = el('button', 'btn primary share-download',
      preview.downloadedAt ? 'Download again' : 'Download');
    download.type = 'button';
    download.addEventListener('click', async () => {
      download.disabled = true;
      download.textContent = 'Downloading…';
      try {
        const packageData = await api.downloadShare(preview.shareId) as SharePackageData;
        if (preview.packageType === 'agent') await api.saveDownloadedAgent(packageData);
        else await api.saveDownloadedSkill(packageData);
        iconText(download, TEXT_ICONS.check, 'Saved');
        savedShares.add(msg.id);
        // Refresh the preview to show downloaded status
        shareCache.delete(msg.id);
        void loadSharePreview(msg.id);
      } catch (err) {
        download.disabled = false;
        download.textContent = 'Download';
        store.patch({ lastError: (err as Error).message });
      }
    });
    actions.appendChild(download);
    container.appendChild(actions);

    if (savedShares.has(msg.id)) {
      const note = el('p', 'share-saved-note', downloadedNote(preview.packageType) + ' ');
      note.setAttribute('role', 'status');
      const open = el('button', 'share-saved-link', 'Open Toolkit');
      open.type = 'button';
      open.addEventListener('click', () => {
        closeDialog();
        store.patch({ messagesOpen: false });
        // Settings → Toolkit; see openLibrary() in settings.ts.
        window.dispatchEvent(new CustomEvent('open-library'));
      });
      note.appendChild(open);
      container.appendChild(note);
    }

    return container;
  };

  $('openMessages').addEventListener('click', () =>
    store.patch({
      messagesOpen: !store.state.messagesOpen,
      ticketPanelOpen: false,
      workersOpen: false,
      ideasOpen: false,
      settingsOpen: false,
      memoryOpen: false,
    }),
  );
  $('closeMessages').addEventListener('click', () => store.patch({ messagesOpen: false }));

  store.subscribe((state) => {
    panel.hidden = !state.messagesOpen;
    if (state.messagesOpen && !wasOpen) void loadMessages();
    wasOpen = state.messagesOpen;
  });

  // Initial unread check.
  void updateUnreadDot();
  // Poll for new messages periodically.
  setInterval(() => void updateUnreadDot(), 60_000);
}
