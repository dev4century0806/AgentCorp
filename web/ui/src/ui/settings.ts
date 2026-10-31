import {
  type Editor,
  type RepoChoice,
  TRACKERS,
  type TrackerId,
  type TrackerProjectSetting,
  type TrackerSettings,
  type Settings,
  type MessageStyle,
} from '@shared';
import { api } from '../net/client.js';
import { assistantNameSection } from './assistant-welcome.js';
import { type Store } from '../state/store.js';
import { $, clear, el } from './dom.js';
import { setupControls } from './setup.js';
import { githubAccountsList } from './github-accounts.js';
import { settingCard, settingLine, subSetting } from './setting-card.js';
import { setSoundPrefs, soundPrefs, type SoundPrefs } from './sound.js';
import { versionSection } from './update.js';
import { showLibrary } from './library.js';
import { buildFeedbackUrl, getAppVersion, getMacOsVersion, runnerDisplayName } from './feedback.js';
import { accessToken, openTermsOfService, resetAvatar, saveUsername, sendFeedback, signedInAvatarUrl, signedInEmail, signedInUsername, uploadAvatar, usernameAvailable } from './auth.js';
import { avatarImg } from './avatar.js';
import { AVATAR_TYPES, avatarFileError, encodeAvatar, encodedAvatarError } from './avatar-upload.js';
import { bindUsernameAvailability, normalizeUsername } from './username.js';
import { isStandupEnabled, setStandupEnabled } from './standup.js';
import { onboardingSection } from './tour-settings.js';
import { bindLive, officesSection } from './offices.js';
import { runnersCard } from './runners.js';
import { connectionStatus, type ConnectionStatus } from './connection-status.js';
import { shortcutsSection } from './shortcuts.js';
import { hasDesktop } from './voice-logic.js';
import { voiceSection } from './voice-settings.js';

let ticketSourceTab: 'tracker' | 'factory' = 'tracker';

export function mountSettings(store: Store): void {
  const panel = $<HTMLElement>('settingsPanel');
  const body = $<HTMLElement>('settingsBody');
  let wasOpen = false;
  // The error is part of it, so a source that stops answering shows that here too.
  const trackerKey = (h: Store['state']['health']) => JSON.stringify([h.tracker.id, h.tracker.status, h.tracker.error]);
  const factoryKey = (h: Store['state']['health']) => JSON.stringify([h.factory, h.factoryError]);
  let lastTrackerHealth = trackerKey(store.state.health);
  let lastFactoryHealth = factoryKey(store.state.health);
  let lastModelMenu = JSON.stringify(store.state.health.modelMenu);
  let tab: SettingsTab = 'general';
  window.addEventListener('open-workspace-tickets', (e) => {
    // Opened from a source's error card: on that source's own settings.
    const source = (e as CustomEvent<{ source?: string } | null>).detail?.source;
    if (source) ticketSourceTab = source === '8090' ? 'factory' : 'tracker';
    tab = 'workspace';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    void load().then(() => {
      const card = document.getElementById('ticketsFromCard');
      card?.classList.add('settings-focus');
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
  window.addEventListener('open-workspace-repos', () => {
    tab = 'workspace';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    void load().then(() => {
      const card = document.getElementById('reposCard');
      card?.classList.add('settings-focus');
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
  window.addEventListener('open-runner-settings', () => {
    tab = 'workspace';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    void load().then(() => {
      const card = document.getElementById('runnersCard');
      card?.classList.add('settings-focus');
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
  window.addEventListener('open-standup-settings', () => {
    tab = 'general';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    void load().then(() => {
      const card = document.getElementById('standupCard');
      card?.classList.add('settings-focus');
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
  window.addEventListener('open-voice-settings', () => {
    tab = 'general';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    void load().then(() => {
      const card = document.getElementById('voiceCard');
      card?.classList.add('settings-focus');
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
  window.addEventListener('open-profile-settings', () => {
    tab = 'profile';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    void load();
  });
  window.addEventListener('open-library', () => {
    tab = 'library';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
  });
  window.addEventListener('open-library-mcps', () => {
    tab = 'library';
    showTab();
    store.patch({ settingsOpen: true, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, memoryOpen: false });
    // The library component will need to switch to MCPs tab
    window.dispatchEvent(new CustomEvent('library-show-mcps'));
  });

  $('openSettings').addEventListener('click', () => {
    const opening = !store.state.settingsOpen;
    // Settings opens on the tab it was left on, the Memory tab included.
    store.patch({ settingsOpen: opening, ticketPanelOpen: false, workersOpen: false, ideasOpen: false, messagesOpen: false, memoryOpen: opening && tab === 'memory' });
  });
  $('closeSettings').addEventListener('click', () => store.patch({ settingsOpen: false, memoryOpen: false }));

  const showTab = (): void => {
    $('sGeneral').setAttribute('aria-selected', String(tab === 'general'));
    $('sLibrary').setAttribute('aria-selected', String(tab === 'library'));
    $('sWorkspace').setAttribute('aria-selected', String(tab === 'workspace'));
    $('sMemory').setAttribute('aria-selected', String(tab === 'memory'));
    $('sShortcuts').setAttribute('aria-selected', String(tab === 'shortcuts'));
    $('sProfile').setAttribute('aria-selected', String(tab === 'profile'));
    $('settingsSub').textContent = TAB_SUB[tab];
    body.classList.toggle('library-body', tab === 'library');
    // The Memory tab draws itself into its own view; see memory.ts.
    body.hidden = tab === 'memory';
  };
  showTab();

  const load = async () => {
    clear(body);
    if (tab === 'memory') return;
    if (tab === 'library') {
      const host = el('div', 'library-host');
      body.appendChild(host);
      showLibrary(host);
      return;
    }
    if (tab === 'profile') {
      body.appendChild(profileSection());
      return;
    }
    if (tab === 'shortcuts') {
      body.appendChild(shortcutsSection());
      return;
    }
    body.appendChild(el('div', 'empty', 'Loading…'));
    try {
      render(store, body, await api.settings(), tab, load);
    } catch (err) {
      clear(body);
      body.appendChild(el('div', 'error-box', (err as Error).message));
    }
  };

  for (const [id, next] of [['sGeneral', 'general'], ['sLibrary', 'library'], ['sWorkspace', 'workspace'], ['sMemory', 'memory'], ['sShortcuts', 'shortcuts'], ['sProfile', 'profile']] as const) {
    $(id).addEventListener('click', () => {
      if (tab === next) return;
      tab = next;
      showTab();
      void load();
      // The store says whether the Memory tab is up, so the book beside a worker's name can open it.
      if (next === 'memory') store.openMemory(null);
      else if (store.state.memoryOpen) store.patch({ memoryOpen: false });
    });
  }

  store.subscribe((state) => {
    panel.hidden = !state.settingsOpen;
    // Opened on the Memory tab from elsewhere, as by the book beside a worker's name.
    if (state.settingsOpen && state.memoryOpen && tab !== 'memory') {
      tab = 'memory';
      showTab();
      clear(body);
    }
    const trackerHealth = trackerKey(state.health);
    const trackerChanged = trackerHealth !== lastTrackerHealth;
    lastTrackerHealth = trackerHealth;
    const factoryHealth = factoryKey(state.health);
    const factoryChanged = factoryHealth !== lastFactoryHealth;
    lastFactoryHealth = factoryHealth;
    const menu = JSON.stringify(state.health.modelMenu);
    const menuChanged = menu !== lastModelMenu;
    lastModelMenu = menu;
    // The library does not read these, and a reload would drop focus from a skill being typed.
    const healthChanged = tab !== 'library' && (trackerChanged || factoryChanged || menuChanged);
    if (state.settingsOpen && (!wasOpen || healthChanged)) void load();
    wasOpen = state.settingsOpen;
  });
}

type SettingsTab = 'general' | 'workspace' | 'memory' | 'library' | 'profile' | 'shortcuts';

const TAB_SUB: Record<SettingsTab, string> = {
  general: 'The IDE, permissions, what new hires start as, sound, feedback, updates, and account',
  workspace: 'Coding agents, repositories and ticket sources for the office',
  memory: 'Lessons workers learn, kept per repo, to read, correct and add to',
  library: 'Skills, agents and MCPs your workers can use',
  profile: 'Your public username and picture, and the account you are signed in with',
  shortcuts: 'The keys that open panels, turn the room and switch chats',
};

function render(store: Store, body: HTMLElement, settings: Settings, tab: SettingsTab, reload: () => Promise<void>): void {
  clear(body);
  if (tab === 'workspace') {
    const cols = el('div', 'settings-cols workspace-settings');
    const runners = runnersCard(store);
    bindLive(store, runners.node, runners.redraw);
    cols.appendChild(runners.node);
    cols.appendChild(obsidianSection(store));
    cols.appendChild(reposSection(store, settings));
    cols.appendChild(trackerSection(store, settings, reload));
    body.appendChild(cols);
    return;
  }
  const cols = el('div', 'settings-list');
  cols.appendChild(assistantNameSection(store));
  cols.appendChild(onboardingSection(store));
  cols.appendChild(editorSection(settings, reload));
  cols.appendChild(messageStyleSection(settings, reload));
  cols.appendChild(permissionsSection(settings, reload));
  cols.appendChild(autoReviewSection(settings, reload));
  cols.appendChild(prFooterSection(settings, reload));
  cols.appendChild(newWorkersSection(store, settings));
  cols.appendChild(soundSection());
  cols.appendChild(standupSection());
  // The microphone is the desktop app's; the browser office has no voice input.
  if (hasDesktop()) cols.appendChild(voiceSection(store));
  const version = versionSection();
  if (version) cols.appendChild(version);
  cols.appendChild(feedbackSection());
  cols.appendChild(settingCard('Local workspace', 'This workspace opens on this computer without a cloud account.'));
  body.appendChild(cols);
}

function profileSection(): HTMLElement {
  const card = el('div', 'ticket settings-card');
  card.appendChild(el('b', null, 'Profile'));
  card.appendChild(avatarSetting());

  card.appendChild(el('span', 'settings-label', 'Username'));
  card.appendChild(el('span', 'm', 'Use 3–20 letters, numbers, or underscores.'));
  const form = el('form', 'settings-row');
  const input = el('input', 'ask-repo');
  input.type = 'text';
  input.autocomplete = 'username';
  input.minLength = 3;
  input.maxLength = 20;
  input.pattern = '[A-Za-z0-9_]+';
  input.required = true;
  input.value = signedInUsername();
  input.setAttribute('aria-label', 'Username');
  const save = el('button', 'btn small primary', 'Save');
  save.type = 'submit';
  form.append(input, save);
  card.appendChild(form);
  const status = el('span', 'msg-line m');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  card.appendChild(status);
  const availability = bindUsernameAvailability(input, status, save, {
    current: signedInUsername(),
    allowUnchanged: false,
    check: usernameAvailable,
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = normalizeUsername(input.value);
    save.disabled = true;
    const error = await saveUsername(username);
    status.className = error ? 'msg-line why' : 'msg-line m';
    status.textContent = error ?? 'Saved. Your profile name is updated.';
    if (!error) availability.setCurrent(username);
    else save.disabled = false;
  });

  card.appendChild(el('span', 'settings-label', 'Email'));
  card.appendChild(el('span', 'm', signedInEmail() ?? 'unknown'));
  const terms = el('button', 'btn ghost small', 'Terms of Service');
  terms.type = 'button';
  terms.addEventListener('click', () => openTermsOfService('terms'));
  card.appendChild(terms);
  return card;
}

/**
 * The profile picture: the current one (the default blocky bot until one is
 * uploaded), Upload/Change and Reset to default. A picked image is checked,
 * cropped to its centre square and shown before anything is sent.
 */
function avatarSetting(): HTMLElement {
  const box = el('div', 'avatar-setting');
  box.appendChild(el('span', 'settings-label', 'Picture'));
  box.appendChild(el('span', 'm', 'Shown beside your username. PNG, JPEG or WebP, cropped to a square.'));
  const row = el('div', 'avatar-edit');
  const frame = el('div', 'avatar-frame');
  const actions = el('div', 'avatar-actions');
  row.append(frame, actions);
  box.appendChild(row);
  const status = el('span', 'msg-line m');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  box.appendChild(status);

  const picker = el('input');
  picker.type = 'file';
  picker.accept = AVATAR_TYPES.join(',');
  picker.hidden = true;
  picker.setAttribute('aria-label', 'Choose a profile picture');
  box.appendChild(picker);

  const say = (text: string, error = false): void => {
    status.className = error ? 'msg-line why' : 'msg-line m';
    status.textContent = text;
  };
  const action = (label: string, cls: string, run: () => void): HTMLButtonElement => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  };

  let preview: { blob: Blob; url: string } | null = null;
  const dropPreview = (): void => {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  };

  const draw = (): void => {
    const current = signedInAvatarUrl();
    const img = preview ? avatarImg(null, signedInUsername(), 72) : avatarImg(current, signedInUsername(), 72);
    if (preview) img.src = preview.url;
    img.alt = preview ? 'Preview of your new picture' : 'Your profile picture';
    frame.replaceChildren(img);
    if (preview) {
      actions.replaceChildren(
        action('Save picture', 'btn small primary', () => void save()),
        action('Cancel', 'btn small ghost', () => {
          dropPreview();
          say('');
          draw();
        }),
      );
      return;
    }
    const pick = action(current ? 'Change' : 'Upload', 'btn small', () => picker.click());
    const reset = action('Reset to default', 'btn small ghost', () => void resetToDefault());
    reset.hidden = !current;
    actions.replaceChildren(pick, reset);
  };

  const busy = (on: boolean): void => {
    for (const b of actions.querySelectorAll('button')) b.disabled = on;
  };

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    const problem = avatarFileError(file);
    if (problem) return say(problem, true);
    busy(true);
    say('Resizing…');
    try {
      const blob = await encodeAvatar(file);
      const tooBig = encodedAvatarError(blob);
      if (tooBig) {
        busy(false);
        return say(tooBig, true);
      }
      dropPreview();
      preview = { blob, url: URL.createObjectURL(blob) };
      say('This is how it will look. Save it to use it.');
      draw();
    } catch (err) {
      busy(false);
      say((err as Error).message, true);
    }
  });

  const save = async (): Promise<void> => {
    if (!preview) return;
    busy(true);
    say('Uploading…');
    try {
      await uploadAvatar(preview.blob);
      dropPreview();
      say('Saved. Your picture is updated.');
      draw();
    } catch (err) {
      busy(false);
      say((err as Error).message, true);
    }
  };

  const resetToDefault = async (): Promise<void> => {
    busy(true);
    say('Resetting…');
    try {
      await resetAvatar();
      say('Back to the default bot.');
      draw();
    } catch (err) {
      busy(false);
      say((err as Error).message, true);
    }
  };

  draw();
  return box;
}

function feedbackSection(): HTMLElement {
  const bugButton = el('button', 'btn small', 'Report a bug');
  bugButton.type = 'button';
  const featureButton = el('button', 'btn small', 'Request a feature');
  featureButton.type = 'button';

  const openExternal = (url: string): void => {
    const desktop = (window as unknown as { desktop?: { openExternal?: (externalUrl: string) => Promise<void> } }).desktop;
    if (desktop?.openExternal) {
      void desktop.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openFeedbackUrl = async (template: 'bug_report' | 'feature_request'): Promise<void> => {
    const version = await getAppVersion();
    const macos = getMacOsVersion();
    // Runner is stored in localStorage by the store
    const runner = localStorage.getItem('runner') ?? '';
    const url = buildFeedbackUrl({
      template,
      version,
      runner: runnerDisplayName(runner),
      macos,
    });
    openExternal(url);
  };

  bugButton.addEventListener('click', () => void openFeedbackUrl('bug_report'));
  featureButton.addEventListener('click', () => void openFeedbackUrl('feature_request'));
  const card = settingCard(
    'Feedback and bug reports',
    'Report bugs and request features publicly so others can follow along. No logs or sensitive info.',
    [bugButton, featureButton],
  );

  // Private feedback form
  card.appendChild(subSetting('Private feedback', 'For anything with logs or sensitive details. Sends privately to dev@agentcorp.local.'));

  const input = el('textarea', 'ask-input');
  input.rows = 5;
  input.placeholder = 'What happened? What did you expect to happen?';
  input.setAttribute('aria-label', 'Private feedback or bug report');
  card.appendChild(input);

  const attachRow = el('label', 'settings-check');
  const attach = el('input');
  attach.type = 'checkbox';
  attach.checked = true;
  attachRow.append(attach, document.createTextNode('Attach logs'));

  const status = el('span', 'msg-line m');
  status.setAttribute('role', 'status');
  const send = async (): Promise<void> => {
    sendButton.disabled = true;
    try {
      const message = input.value.trim();
      if (!message) throw new Error('Write some feedback first.');
      const diagnostics = attach.checked ? (await api.diagnostics()).report : '';
      await sendFeedback(message, diagnostics);
      input.value = '';
      status.className = 'msg-line m';
      status.textContent = attach.checked
        ? 'Thanks — your feedback and attached logs were sent.'
        : 'Thanks — your feedback was sent.';
    } catch (err) {
      status.className = 'msg-line why';
      status.textContent = `Could not send feedback: ${(err as Error).message}`;
    } finally {
      sendButton.disabled = false;
    }
  };

  const sendButton = el('button', 'btn small primary', 'Send feedback');
  sendButton.type = 'button';
  sendButton.addEventListener('click', () => void send());
  card.append(settingLine(attachRow, [], [sendButton]), status);
  return card;
}

const EDITORS: Array<{ value: Editor; label: string }> = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
];

function editorSection(settings: Settings, reload: () => Promise<void>): HTMLElement {
  return settingCard(
    'IDE',
    "VS Code or Cursor. A worker's Open in IDE button opens its worktree in this one.",
    choiceTabs('IDE', EDITORS, settings.editor, api.saveEditor, reload),
  );
}

/** What a new hire starts as. Saved the moment a dropdown changes. */
const MESSAGE_STYLES: Array<{ value: MessageStyle; label: string }> = [
  { value: 'technical', label: 'Technical' },
  { value: 'plain', label: 'Plain' },
];

function messageStyleSection(settings: Settings, reload: () => Promise<void>): HTMLElement {
  return settingCard(
    'Message style',
    settings.messageStyle === 'plain'
      ? 'Plain: workers and their steps are described in everyday words, for people who do not read code. The exact command is always one click away, and stays visible on anything you are asked to approve.'
      : 'Technical: steps show the exact commands and files. Plain describes them in everyday words instead, for people who do not read code.',
    choiceTabs('Message style', MESSAGE_STYLES, settings.messageStyle, async (style) => {
      const saved = await api.saveMessageStyle(style);
      return saved;
    }, reload),
  );
}

function newWorkersSection(store: Store, settings: Settings): HTMLElement {
  const status = el('span', 'msg-line m');
  const controls = setupControls(settings.workerDefaults, store.state.health.modelMenu, async (setup) => {
    try {
      const saved = await api.saveWorkerDefaults(setup);
      store.patch({ workerDefaults: saved });
      status.className = 'msg-line m';
      status.textContent = 'Saved.';
    } catch (err) {
      status.className = 'msg-line why';
      status.textContent = (err as Error).message;
    }
  });
  return settingCard(
    'New workers',
    "What a new hire starts as. You can change it when hiring, and any worker's own from the Workers list.",
    [controls.node, status],
  );
}

type Approval = 'ask' | 'auto';

const APPROVALS: Array<{ value: Approval; label: string }> = [
  { value: 'ask', label: 'Off' },
  { value: 'auto', label: 'Everyone on full auto' },
];

function permissionsSection(settings: Settings, reload: () => Promise<void>): HTMLElement {
  return settingCard(
    'Override: everyone on full auto',
    settings.autoApprove
      ? "Every worker goes ahead with everything without asking, whatever their own permission level: installs, git push, deletes and network calls included. Each one is still written in their chat."
      : "Off: each worker follows their own permission level. Turning it on puts everyone on full auto at once, whatever their own level says.",
    choiceTabs(
      'Permissions',
      APPROVALS,
      settings.autoApprove ? 'auto' : 'ask',
      (value) => api.saveAutoApprove(value === 'auto'),
      reload,
    ),
  );
}

type OnOff = 'on' | 'off';

const ON_OFF_CHOICES: Array<{ value: OnOff; label: string }> = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

function autoReviewSection(settings: Settings, reload: () => Promise<void>): HTMLElement {
  return settingCard(
    'Automatic review',
    settings.autoReview
      ? 'When a worker opens a PR with a large diff, sensitive files or changed tests, the office hires a reviewer to check it before it reaches you.'
      : "Workers' PRs go straight to you. You can still ask for a review from a worker's panel.",
    choiceTabs(
      'Automatic review',
      ON_OFF_CHOICES,
      settings.autoReview ? 'on' : 'off',
      (value) => api.saveAutoReview(value === 'on'),
      reload,
    ),
  );
}

function prFooterSection(settings: Settings, reload: () => Promise<void>): HTMLElement {
  return settingCard(
    'PR footer',
    settings.prFooter
      ? 'Every PR a worker opens ends with "Created by AgentCorp", so reviewers know where it came from.'
      : "Workers' PRs end without the office footer, for repos that don't allow one.",
    choiceTabs(
      'PR footer',
      ON_OFF_CHOICES,
      settings.prFooter ? 'on' : 'off',
      (value) => api.savePrFooter(value === 'on'),
      reload,
    ),
  );
}

function soundSection(): HTMLElement {
  const card = settingCard('Sound', 'Background music, and a chime when a worker needs you. Saved in this browser only.');
  card.appendChild(subSetting('Background music', [], [onOffTabs('Background music', 'music')]));
  card.appendChild(subSetting('Chime when a worker needs you', [], [onOffTabs('Chime when a worker needs you', 'alerts')]));
  return card;
}

function standupSection(): HTMLElement {
  const card = settingCard(
    'Morning standup',
    "Your assistant greets you with a standup the first time you open the office each day: what got done, what's blocked, and what's next. Saved in this browser only.",
    [onOff('Morning standup', isStandupEnabled(), setStandupEnabled)],
  );
  card.id = 'standupCard';

  return card;
}

/** Tabs for a setting saved in this browser: one of a few, saved the moment one is picked. */
function localTabs<T>(label: string, options: ReadonlyArray<{ value: T; label: string }>, current: T, save: (value: T) => void): HTMLElement {
  const tabs = el('div', 'tabs source-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', label);
  for (const option of options) {
    const btn = el('button', 'tab', option.label);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(current === option.value));
    btn.addEventListener('click', () => {
      save(option.value);
      for (const tab of tabs.querySelectorAll('button')) {
        tab.setAttribute('aria-selected', String(tab === btn));
      }
    });
    tabs.appendChild(btn);
  }
  return tabs;
}

const ON_OFF = [{ value: true, label: 'On' }, { value: false, label: 'Off' }];

/** An On/Off pair of tabs for a setting saved in this browser. */
function onOff(label: string, current: boolean, save: (on: boolean) => void): HTMLElement {
  return localTabs(label, ON_OFF, current, save);
}

function onOffTabs(name: string, key: keyof SoundPrefs): HTMLElement {
  const tabs = el('div', 'tabs source-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', name);
  for (const on of [true, false]) {
    const btn = el('button', 'tab', on ? 'On' : 'Off');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(soundPrefs()[key] === on));
    btn.addEventListener('click', () => {
      setSoundPrefs({ [key]: on });
      for (const tab of tabs.querySelectorAll('button')) {
        tab.setAttribute('aria-selected', String(tab === btn));
      }
    });
    tabs.appendChild(btn);
  }
  return tabs;
}

/** Tabs for a setting that is one of a few, saved the moment one is picked. */
function choiceTabs<T extends string>(
  name: string,
  options: Array<{ value: T; label: string }>,
  current: T,
  save: (value: T) => Promise<unknown>,
  reload: () => Promise<void>,
): HTMLElement[] {
  const tabs = el('div', 'tabs source-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', name);
  const status = el('span', 'msg-line m');

  for (const option of options) {
    const btn = el('button', 'tab', option.label);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(current === option.value));
    btn.addEventListener('click', async () => {
      if (current === option.value) return;
      for (const tab of tabs.querySelectorAll('button')) tab.disabled = true;
      try {
        await save(option.value);
        await reload();
      } catch (err) {
        status.className = 'msg-line why';
        status.textContent = (err as Error).message;
        for (const tab of tabs.querySelectorAll('button')) tab.disabled = false;
      }
    });
    tabs.appendChild(btn);
  }

  return [tabs, status];
}

/**
 * Where tickets come from: the selected tracker is picked here as the default
 * for new tickets, with its sign-in and settings underneath. Connected trackers
 * can all supply the Hire panel. Trackers not supported yet are shown, faded,
 * so it is clear they are coming.
 */
function trackerSection(store: Store, settings: Settings, reload: () => Promise<void>): HTMLElement {
  const { active, settings: tracker } = settings.tracker;
  const name = TRACKERS.find((t) => t.id === active)?.name ?? active;
  const card = el('div', 'ticket settings-card');
  card.id = 'ticketsFromCard';
  const head = el('div', 'row');
  head.appendChild(el('b', null, 'Tickets from'));
  const on = !!tracker && tracker.connected && tracker.enabled;
  const trackerHealth = store.state.health.trackers[active] ??{ status: 'disabled', error: null };
  connectionLabel(card, head, connectionStatus(on, trackerHealth));

  const tabs = el('div', 'tabs source-tabs tracker-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Ticket tracker');
  const picked = el('span', 'msg-line m');
  const content = el('div', 'ticket-source-content');
  const renderSource = (): void => {
    clear(content);
    if (ticketSourceTab === 'factory') {
      content.appendChild(factorySection(store, settings, reload));
      return;
    }
    if (!tracker) {
      content.appendChild(el('span', 'm', `${name} is not supported yet. Pick another tracker for now.`));
      return;
    }
    trackerSettings(store, content, tracker, name, reload);
  };
  for (const t of TRACKERS) {
    const btn = el('button', 'tab', t.name);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(ticketSourceTab === 'tracker' && t.id === active));
    if (!t.available) {
      btn.disabled = true;
      btn.classList.add('soon');
      btn.title = `${t.name} is coming soon`;
      btn.appendChild(el('span', 'soon-tag', 'Soon'));
    }
    btn.addEventListener('click', async () => {
      if (!t.available) return;
      if (t.id === active) {
        if (ticketSourceTab === 'tracker') return;
        ticketSourceTab = 'tracker';
        for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b === btn));
        renderSource();
        return;
      }
      ticketSourceTab = 'tracker';
      for (const b of tabs.querySelectorAll('button')) b.disabled = true;
      try {
        await api.saveTracker(t.id);
        await reload();
      } catch (err) {
        picked.className = 'msg-line why';
        picked.textContent = (err as Error).message;
        for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.disabled = b.classList.contains('soon');
      }
    });
    tabs.appendChild(btn);
  }
  const factoryTab = el('button', 'tab', '8090');
  factoryTab.type = 'button';
  factoryTab.setAttribute('role', 'tab');
  factoryTab.setAttribute('aria-selected', String(ticketSourceTab === 'factory'));
  factoryTab.addEventListener('click', () => {
    ticketSourceTab = 'factory';
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b === factoryTab));
    renderSource();
  });
  tabs.appendChild(factoryTab);
  card.appendChild(tabs);
  card.appendChild(picked);
  card.appendChild(content);
  renderSource();
  return card;
}

/** A ticket source's status pill in its card's heading, and under it why it can't be reached. */
function connectionLabel(card: HTMLElement, head: HTMLElement, status: ConnectionStatus): void {
  const pill = el('span', `pill ${status.pill}`, status.label);
  if (status.error) pill.title = status.error;
  head.appendChild(pill);
  card.appendChild(head);
  if (status.error) card.appendChild(el('span', 'msg-line connection-error', status.error));
}

/** Opens Settings directly on the ticket-source controls for the first-day guide. */
export function openWorkspaceTickets(_store: Store): void {
  window.dispatchEvent(new CustomEvent('open-workspace-tickets'));
}

export function openWorkspaceRepos(_store: Store): void {
  window.dispatchEvent(new CustomEvent('open-workspace-repos'));
}

/** Opens Settings on the morning standup switch, for the guide's last step. */
export function openStandupSettings(_store: Store): void {
  window.dispatchEvent(new CustomEvent('open-standup-settings'));
}

/** Opens Settings directly on the Library (Toolkit) tab. */
export function openLibrary(_store: Store): void {
  window.dispatchEvent(new CustomEvent('open-library'));
}

/** Opens Settings directly on the Library MCPs tab. */
export function openLibraryMcps(_store: Store): void {
  window.dispatchEvent(new CustomEvent('open-library-mcps'));
}

function trackerSettings(
  store: Store,
  card: HTMLElement,
  tracker: TrackerSettings,
  name: string,
  reload: () => Promise<void>,
): void {
  const id = tracker.id;
  const on = tracker.connected && tracker.enabled;
  const noun = tracker.projectNoun;

  const status = el('span', 'msg-line m');
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.className = bad ? 'msg-line why' : 'msg-line m';
  };

  if (!on) {
    if (!tracker.connected) {
      card.appendChild(
        el('span', 'm', `Signs in through ${tracker.signInWith} in your browser. Nothing to install and no token to paste.`),
      );
    }
    const connect = el('button', 'btn small primary', `Connect ${name}`);
    connect.addEventListener('click', async () => {
      connect.disabled = true;
      try {
        if (tracker.connected) {
          await api.saveTrackerSettings(id, { enabled: true });
          await reload();
          return;
        }
        const { url } = await api.connectTracker(id, await accessToken());
        if (url) {
          window.open(url, '_blank', 'noopener');
          say('Approve AgentCorp in the tab that opened. This updates once you do.');
        } else {
          await api.saveTrackerSettings(id, { enabled: true });
          await reload();
        }
      } catch (err) {
        say((err as Error).message, true);
      } finally {
        connect.disabled = false;
      }
    });
    card.appendChild(connect);
    card.appendChild(status);
    return;
  }

  if (tracker.site) card.appendChild(el('span', 'm', tracker.site.replace(/^https?:\/\//, '')));
  if (tracker.connectedNote) card.appendChild(el('span', 'm', tracker.connectedNote));

  const projects: TrackerProjectSetting[] = tracker.projects.map((p) => ({ ...p }));
  card.appendChild(label(`${capitalize(noun)}s to follow, and the repo each one works in`));
  card.appendChild(projectChecklist(store, id, noun, projects, tracker.id === 'github'));

  let query: HTMLTextAreaElement | null = null;
  if (tracker.queryLanguage) {
    card.appendChild(label(`Which issues (${tracker.queryLanguage})`));
    query = el('textarea', 'ask-input mono');
    query.rows = 3;
    query.value = tracker.query ?? '';
    query.placeholder = tracker.defaultQuery ?? '';
    card.appendChild(query);
    card.appendChild(el('span', 'm', `Leave empty to use the ${noun}s above.`));
  }

  card.appendChild(label(tracker.statusesAreLabels ? 'Hire adds the label' : 'Hire moves the issue to'));
  const inProgress = textInput(tracker.inProgressStatuses.join(', '));
  card.appendChild(inProgress);
  card.appendChild(label(tracker.statusesAreLabels ? 'Mark done swaps it for the label' : 'Mark done moves it to the first of'));
  const review = textInput(tracker.reviewStatuses.join(', '));
  card.appendChild(review);

  const actions = el('div', 'row');
  const save = el('button', 'btn small primary', 'Save');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api.saveTrackerSettings(id, {
        projects,
        ...(query ? { query: query.value.trim() || null } : {}),
        inProgressStatuses: splitList(inProgress.value),
        reviewStatuses: splitList(review.value),
      });
      await reload();
    } catch (err) {
      say((err as Error).message, true);
      save.disabled = false;
    }
  });
  const disconnect = el('button', 'btn small', 'Off');
  disconnect.addEventListener('click', async () => {
    disconnect.disabled = true;
    try {
      await api.disconnectTracker(id);
      await reload();
    } catch (err) {
      say((err as Error).message, true);
      disconnect.disabled = false;
    }
  });
  actions.appendChild(disconnect);
  actions.appendChild(save);
  card.appendChild(actions);
  card.appendChild(status);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function obsidianSection(store: Store): HTMLElement {
  const card = el('div', 'ticket settings-card');
  card.id = 'obsidianCard';

  const pill = el('span', 'pill pill-ok', 'Ready');
  const titleLine = settingLine(
    el('b', null, 'Obsidian Semantic Memory'),
    'Local vector memory with sqlite-vec and all-MiniLM-L6-v2. Workers search notes and ADRs automatically.',
    [pill],
  );
  card.appendChild(titleLine);

  const statusLine = el('div', 'setting-status-line');
  statusLine.style.margin = '8px 0';
  statusLine.style.fontSize = '12px';
  statusLine.style.color = 'var(--text-muted, #888)';
  statusLine.textContent = 'Checking status...';

  const inputRow = el('div', 'setting-input-row');
  inputRow.style.display = 'flex';
  inputRow.style.gap = '8px';
  inputRow.style.alignItems = 'center';
  inputRow.style.marginTop = '10px';

  const pathInput = el('input', 'text-input') as HTMLInputElement;
  pathInput.type = 'text';
  pathInput.placeholder = 'D:\\Path\\To\\Your\\Obsidian\\Vault';
  pathInput.style.flex = '1';
  pathInput.style.padding = '6px 10px';
  pathInput.style.borderRadius = '4px';
  pathInput.style.border = '1px solid rgba(255,255,255,0.15)';
  pathInput.style.background = 'rgba(0,0,0,0.2)';
  pathInput.style.color = '#fff';

  const syncBtn = el('button', 'btn') as HTMLButtonElement;
  syncBtn.textContent = 'Sync Vault';
  syncBtn.style.padding = '6px 14px';
  syncBtn.style.cursor = 'pointer';

  inputRow.append(pathInput, syncBtn);
  card.appendChild(inputRow);
  card.appendChild(statusLine);

  async function refresh() {
    try {
      const st = await api.obsidianStatus();
      if (st.vaultPath && !pathInput.value) {
        pathInput.value = st.vaultPath;
      }
      statusLine.textContent = `Indexed notes: ${st.count ?? 0} chunks | Vault: ${st.vaultPath || 'Not configured'}`;
      pill.textContent = st.enabled ? 'Active' : 'Standby';
      pill.className = st.enabled ? 'pill pill-ok' : 'pill pill-off';
    } catch (err) {
      statusLine.textContent = `Error: ${(err as Error).message}`;
    }
  }

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    statusLine.textContent = 'Vectorizing Markdown files into SQLite...';
    try {
      const res = await api.obsidianSync(pathInput.value.trim() || undefined);
      statusLine.textContent = `Sync completed! Indexed ${res.newChunksIndexed} new chunks (${res.totalNotesInIndex} total).`;
      pill.textContent = 'Active';
      pill.className = 'pill pill-ok';
    } catch (err) {
      statusLine.textContent = `Sync failed: ${(err as Error).message}`;
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Vault';
    }
  });

  void refresh();
  return card;
}

function reposSection(store: Store, settings: Settings): HTMLElement {
  const card = el('div', 'ticket settings-card');
  card.id = 'reposCard';
  const head = el('div', 'row repos-head');
  head.appendChild(el('b', null, 'Repos'));
  const count = el('span', 'pill pill-off', `${store.state.repos.length} found`);
  head.appendChild(count);
  const add = el('button', 'btn small primary', 'Add repo…');
  add.type = 'button';
  head.appendChild(add);
  card.appendChild(head);
  const status = el('span', 'msg-line m');
  const say = (text: string, bad = false) => {
    status.className = bad ? 'msg-line why' : 'msg-line m';
    status.textContent = text;
  };
  const showRepos = (repos: RepoChoice[]) => {
    store.patch({ repos });
    count.textContent = `${repos.length} found`;
  };
  // Picked in the Mac's own folder picker, so nobody types a path.
  add.addEventListener('click', () => {
    add.disabled = true;
    api
      .chooseFolder('Pick a repo to add to the office')
      .then(async ({ path }) => {
        if (!path) return;
        const { repo, repos } = await api.addRepo(path);
        showRepos(repos);
        list.reload();
        say(`Added ${repo.name}.`);
      })
      .catch((err) => say((err as Error).message, true))
      .finally(() => (add.disabled = false));
  });

  card.appendChild(label('Clone new repos into (a repo named like owner/repo, or by its GitHub link, lands here)'));
  const cloneInto = textInput(settings.repos.cloneInto);
  cloneInto.setAttribute('aria-label', 'Folder new clones go into');
  // Saved as soon as it changes, on Enter or leaving the box, or when a folder is picked: no Save to forget.
  let saved = settings.repos.cloneInto;
  const saveCloneInto = async () => {
    const value = cloneInto.value.trim();
    if (value === saved) return;
    const before = saved;
    saved = value;
    try {
      // The folders the office looks in are kept as they are; only where clones go is set here.
      const result = await api.saveRepoRoots(settings.repos.roots, value || null);
      saved = result.cloneInto;
      cloneInto.value = result.cloneInto;
      showRepos(result.repos);
      say(`Saved. New clones go into ${result.cloneInto}.`);
    } catch (err) {
      // Let the same value be tried again.
      saved = before;
      say((err as Error).message, true);
    }
  };
  cloneInto.addEventListener('change', () => void saveCloneInto());
  cloneInto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void saveCloneInto();
  });
  card.appendChild(withPicker(cloneInto, 'Choose…', 'Pick the folder new clones go into', (path) => {
    cloneInto.value = path;
    void saveCloneInto();
  }, (message) => say(message, true)));
  card.appendChild(status);
  const list = githubAccountsList(accessToken, showRepos);
  card.appendChild(list.element);
  return card;
}

/**
 * A folder field with a button that opens the Mac's own folder picker, so
 * nobody has to type a path. `onPick` gets the folder chosen; a cancel does nothing.
 */
function withPicker(
  input: HTMLInputElement,
  text: string,
  prompt: string,
  onPick: (path: string) => void,
  onError: (message: string) => void,
): HTMLElement {
  const row = el('div', 'field-row');
  const pick = el('button', 'btn small', text);
  pick.type = 'button';
  pick.addEventListener('click', () => {
    pick.disabled = true;
    api
      .chooseFolder(prompt)
      .then(({ path }) => {
        if (path) onPick(path);
      })
      .catch((err) => onError((err as Error).message))
      .finally(() => (pick.disabled = false));
  });
  row.append(input, pick);
  return row;
}

function factorySection(store: Store, settings: Settings, reload: () => Promise<void>): HTMLElement {
  const card = el('div', 'ticket settings-card');
  const on = settings.factory.enabled && settings.factory.connected;
  const head = el('div', 'row');
  head.appendChild(el('b', null, '8090 Software Factory'));
  const { factory, factoryError } = store.state.health;
  connectionLabel(card, head, connectionStatus(on, { status: factory, error: factoryError }));

  const status = el('span', 'msg-line m');
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.className = bad ? 'msg-line why' : 'msg-line m';
  };

  if (!on) {
    if (!settings.factory.connected) {
      card.appendChild(el('span', 'm', 'Signs in through 8090 in your browser. Nothing to install and no token to paste.'));
    }
    const connect = el('button', 'btn small primary', 'Connect');
    connect.addEventListener('click', async () => {
      connect.disabled = true;
      try {
        if (settings.factory.connected) {
          await api.saveFactory(true);
          await reload();
          return;
        }
        const { url } = await api.connectFactory();
        if (url) {
          window.open(url, '_blank', 'noopener');
          say('Approve AgentCorp in the tab that opened. This updates once you do.');
        } else {
          await api.saveFactory(true);
          await reload();
        }
      } catch (err) {
        say((err as Error).message, true);
      } finally {
        connect.disabled = false;
      }
    });
    card.appendChild(connect);
    card.appendChild(status);
    return card;
  }

  const disconnect = el('button', 'btn small', 'Off');
  disconnect.addEventListener('click', async () => {
    disconnect.disabled = true;
    try {
      await api.disconnectFactory();
      await reload();
    } catch (err) {
      say((err as Error).message, true);
      disconnect.disabled = false;
    }
  });
  card.appendChild(disconnect);
  card.appendChild(status);
  return card;
}

function projectChecklist(
  store: Store,
  tracker: TrackerId,
  noun: string,
  projects: TrackerProjectSetting[],
  github: boolean,
): HTMLElement {
  const wrap = el('div', 'project-picks');
  const filter = textInput('');
  filter.placeholder = `Filter ${noun}s`;
  filter.setAttribute('aria-label', `Filter ${noun}s`);
  const list = el('div', 'project-pick-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', `${capitalize(noun)}s`);
  const status = el('span', 'msg-line');
  const loading = el('div', 'project-pick-wait');
  const loadingText = el('div', 'project-pick-wait-text');
  loadingText.append(el('span', null, `Loading ${noun}s…`), el('span', 'm', 'This can take a while if you have a lot of them.'));
  loading.append(el('span', 'spinner'), loadingText);
  list.appendChild(loading);
  wrap.append(filter, list, status);

  let choices: Array<{ key: string; name: string }> = [];
  const byKey = new Map(projects.map((p) => [p.key.toLowerCase(), p]));

  const writeBack = (): void => {
    projects.length = 0;
    for (const project of byKey.values()) projects.push(project);
  };

  const draw = (): void => {
    const q = filter.value.trim().toLowerCase();
    clear(list);
    const rows = new Map<string, { key: string; name: string }>();
    for (const choice of choices) rows.set(choice.key.toLowerCase(), choice);
    for (const project of byKey.values()) {
      if (!rows.has(project.key.toLowerCase())) rows.set(project.key.toLowerCase(), { key: project.key, name: project.key });
    }
    const shown = [...rows.values()].filter((row) => {
      const picked = byKey.has(row.key.toLowerCase());
      if (picked) return true;
      return !q || row.key.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
    });
    shown.sort((a, b) => Number(byKey.has(b.key.toLowerCase())) - Number(byKey.has(a.key.toLowerCase())) || a.key.localeCompare(b.key));
    if (!shown.length) {
      list.appendChild(el('span', 'm', q ? `No ${noun} matches.` : `No ${noun}s found.`));
      return;
    }
    for (const row of shown) {
      const key = row.key.toLowerCase();
      const line = el('label', 'project-pick');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = byKey.has(key);
      box.addEventListener('change', () => {
        if (box.checked) byKey.set(key, byKey.get(key) ?? { key: row.key, repo: null });
        else byKey.delete(key);
        writeBack();
        const picked = byKey.size;
        status.className = 'msg-line m';
        status.textContent = picked
          ? `${picked} checked.`
          : github
            ? 'Nothing checked, so every open issue you can access shows up.'
            : `Nothing checked, so every open issue assigned to you shows up.`;
        draw();
      });
      line.append(box, el('span', 'mono', row.name === row.key ? row.key : `${row.key} — ${row.name}`));
      if (box.checked) {
        const project = byKey.get(key)!;
        line.appendChild(repoSelect(store, project.repo, noun, (repo) => (project.repo = repo)));
      }
      list.appendChild(line);
    }
  };

  filter.addEventListener('input', () => draw());
  void api.trackerProjects(tracker, '').then(({ projects: found }) => {
    choices = found;
    const picked = byKey.size;
    status.textContent = picked
      ? `${picked} checked.`
      : github
        ? 'Nothing checked, so every open issue you can access shows up.'
        : `Nothing checked, so every open issue assigned to you shows up.`;
    draw();
  }).catch((err) => {
    status.textContent = (err as Error).message;
    status.className = 'msg-line why';
    draw();
  });
  return wrap;
}

function repoSelect(store: Store, selected: string | null, noun: string, onChange: (repo: string | null) => void): HTMLElement {
  const select = el('select', 'dropdown ask-repo');
  select.setAttribute('aria-label', `Repo for this ${noun}`);
  const none = el('option', null, 'Pick at hire time');
  none.value = '';
  select.appendChild(none);
  const paths = new Set(store.state.repos.map((r) => r.path));
  if (selected && !paths.has(selected)) {
    const opt = el('option', null, selected);
    opt.value = selected;
    select.appendChild(opt);
  }
  for (const r of store.state.repos) {
    const opt = el('option', null, r.name);
    opt.value = r.path;
    select.appendChild(opt);
  }
  select.value = selected ?? '';
  select.addEventListener('change', () => onChange(select.value || null));
  return select;
}

function textInput(value: string): HTMLInputElement {
  const input = el('input', 'ask-path');
  input.type = 'text';
  input.value = value;
  return input;
}

function label(text: string): HTMLElement {
  return el('span', 'settings-label', text);
}

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
