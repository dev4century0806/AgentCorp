import { displayKey, draftTemplate, IDEA_LANES, projectOf, trackerInfo, trackerName, type Idea, type IdeaLane, type IdeaUpdate } from '@shared';
import { api, ideaFileUrl, toUpload } from '../net/client.js';
import type { Store } from '../state/store.js';
import { attachTray, savedFileChips, wireFileDrop, type AttachTray } from './attach.js';
import { mountVoice } from './voice.js';
import { $, ago, attachButton, autoGrow, clear, ClampWatch, el, searchClear, showMore } from './dom.js';
import { ideaThread, type IdeaThread } from './idea-thread.js';
import { draftGaps } from './idea-thread-text.js';
import { IDEAS_SIZE, mountPanelResize } from './panel-resize.js';
import { repoChip, repoField, repoName } from './repo-field.js';
import { onShortcut } from './shortcuts.js';

const TITLE_MAX = 120;

/** What each lane holds, said where the lane is empty. */
const EMPTY: Record<IdeaLane, string> = {
  inbox: 'Nothing new. Add an idea above.',
  shaping: 'Ideas you are talking through with a Planner land here.',
  ready: 'Ideas with an approved ticket draft, ready to become a ticket.',
  ticket: 'Ideas that became tickets.',
};

/**
 * The Idea board: a box to add an idea, the four lanes an idea moves through
 * on its way to the tracker, and the archive.
 *
 * The add box is built once and kept, so a half-typed idea survives every
 * redraw. The lanes are redrawn when the ideas change, except while a card is
 * being edited.
 */
export function mountIdeasPanel(store: Store): void {
  const panel = $<HTMLElement>('ideasPanel');
  const list = $<HTMLElement>('ideasList');
  mountPanelResize(panel, $<HTMLElement>('ideasResize'), IDEAS_SIZE);

  // Opened from the corkboard in the room, or with its shortcut (I to start with).
  onShortcut('ideas', () =>
    store.patch({ ideasOpen: !store.state.ideasOpen, ticketPanelOpen: false, settingsOpen: false, workersOpen: false, messagesOpen: false, memoryOpen: false }),
  );
  $('closeIdeas').addEventListener('click', () => store.patch({ ideasOpen: false }));

  const fail = (err: unknown): void => store.patch({ lastError: (err as Error).message });
  /** The tracker new tickets go to: whichever one the office is set to. */
  const tracker = () => store.state.health.tracker.id;

  // ---- the add box ----
  const add = el('div', 'ticket ask idea-add');
  add.appendChild(el('b', null, 'New idea'));
  const title = el('input', 'setup-name');
  title.type = 'text';
  title.maxLength = TITLE_MAX;
  title.placeholder = 'e.g. Saved filters on the reputation landing page';
  title.setAttribute('aria-label', 'Idea title');
  const notes = el('textarea', 'ask-input');
  notes.rows = 4;
  notes.placeholder = 'Notes: the problem, who has it, anything you already know';
  notes.setAttribute('aria-label', 'Idea notes');
  const fitNotes = autoGrow(notes);
  // Which repos it belongs to, if whoever writes it knows, and the files that explain it.
  const addRepos = repoField(store, []);
  const addFiles = fileField(add, notes, (message) => store.patch({ lastError: message }));
  const addBtn = el('button', 'btn small primary', 'Add idea');
  addBtn.type = 'button';
  const save = async (): Promise<void> => {
    if (!title.value.trim()) {
      title.focus();
      return;
    }
    addBtn.disabled = true;
    try {
      const attachments = await Promise.all(addFiles.tray.files.map(toUpload));
      await api.addIdea({
        title: title.value,
        notes: notes.value,
        repos: addRepos.value(),
        ...(attachments.length ? { attachments } : {}),
      });
      title.value = '';
      notes.value = '';
      voice.sent();
      fitNotes();
      addRepos.reset();
      addFiles.tray.clear();
      title.focus();
    } catch (err) {
      fail(err);
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn.addEventListener('click', () => void save());
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  });
  // Enter makes a new line in the notes; Cmd or Ctrl + Enter adds the idea.
  notes.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  });
  const addRow = el('div', 'row');
  addRow.append(addBtn, addFiles.button, addFiles.picker);
  add.append(title, notes, addRepos.node, addFiles.list, addRow);
  const voice = mountVoice(store, notes, { in: add, before: addRow });

  const lanes = el('div', 'idea-lanes');
  list.append(add, lanes);

  // ---- the lanes ----
  // The card being edited, and whether it is the idea or its ticket draft.
  let editing: { id: number; what: 'idea' | 'draft' | 'ticket' | 'shape'; startWork?: boolean } | null = null;
  // The talk on each shaping card, kept across redraws so a half-typed reply is not lost.
  const threads = new Map<number, IdeaThread>();
  let showArchived = false;
  let showClosed = false;
  let drawn = '';
  // Notes and drafts read in full, as "<id>:notes" or "<id>:draft", kept across redraws.
  const shownWhole = new Set<string>();
  // The notes cut short on the cards drawn now; reset before each redraw.
  const clamps = new ClampWatch();
  const keepShown = (key: string, on: boolean): void => {
    if (on) shownWhole.add(key);
    else shownWhole.delete(key);
  };

  /**
   * Expand: the card being edited takes the panel's whole height, and the rest
   * of the board steps aside until it is saved or cancelled. Classes only, so
   * nothing typed into the card is redrawn away.
   */
  let expanded = false;
  const expand = (node: HTMLElement | null, on: boolean): void => {
    expanded = on && !!node;
    panel.classList.toggle('idea-focus', expanded);
    for (const n of panel.querySelectorAll('.focused, .has-focus')) n.classList.remove('focused', 'has-focus');
    if (expanded && node) {
      node.classList.add('focused');
      node.closest('.idea-lane')?.classList.add('has-focus');
      list.scrollTop = 0;
    }
  };
  /** The Expand button on a card; `fit` is told when its room changes. */
  const expandButton = (node: HTMLElement, fit: () => void = () => undefined): HTMLButtonElement => {
    const b = el('button', 'btn small ghost idea-expand', 'Expand');
    b.type = 'button';
    b.title = 'Use the whole height of the panel';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      expand(node, !expanded);
      b.textContent = expanded ? 'Collapse' : 'Expand';
      b.setAttribute('aria-pressed', String(expanded));
      fit();
      // Back among the lanes, it stays in view.
      if (!expanded) node.scrollIntoView({ block: 'nearest' });
    });
    return b;
  };

  const change = (idea: Idea, patch: IdeaUpdate): void => {
    api.updateIdea(idea.id, patch).catch(fail);
  };
  const markReady = (idea: Idea): void => {
    api.markIdeaReady(idea.id).catch(fail);
  };
  const startWork = (idea: Idea): void => {
    api.startIdeaWork(idea.id).catch(fail);
  };
  const edit = (idea: Idea, what: 'idea' | 'draft' | 'ticket' | 'shape', startWork = false): void => {
    editing = { id: idea.id, what, ...(startWork ? { startWork } : {}) };
    expand(null, false);
    draw(true);
  };
  const stopEditing = (): void => {
    editing = null;
    expand(null, false);
    draw(true);
  };

  /**
   * One card. Each lane offers one main next step, so it is always clear what
   * to click: Inbox writes a ticket draft, Ready creates the ticket.
   */
  const card = (idea: Idea): HTMLElement => {
    const node = el('div', `ticket idea-card lane-${idea.lane}${idea.archived ? ' archived' : ''}`);
    if (editing?.id === idea.id) {
      if (editing.what === 'ticket') return ticketForm(idea, node, editing.startWork === true);
      if (editing.what === 'shape') return shapeForm(idea, node);
      return editing.what === 'draft' ? draftEditor(idea, node) : ideaEditor(idea, node);
    }

    const head = el('div', 'row');
    head.appendChild(el('b', null, idea.title));
    if (idea.ticketKey && idea.ticketUrl) {
      const link = el('a', 'btn small ghost', idea.ticketKey);
      (link as HTMLAnchorElement).href = idea.ticketUrl;
      (link as HTMLAnchorElement).target = '_blank';
      (link as HTMLAnchorElement).rel = 'noreferrer';
      head.appendChild(link);
    }
    node.appendChild(head);
    if (idea.notes) {
      const text = el('span', 'idea-notes', idea.notes);
      const key = `${idea.id}:notes`;
      node.append(text, showMore(text, shownWhole.has(key), (on) => keepShown(key, on), clamps));
    }
    if (idea.repos.length) {
      const tags = el('div', 'idea-repo-row');
      tags.setAttribute('aria-label', 'Related repos');
      for (const path of idea.repos) tags.appendChild(repoChip(store, path));
      node.appendChild(tags);
    }
    if (idea.attachments.length) node.appendChild(savedFileChips(idea.attachments, (a) => ideaFileUrl(idea.id, a.file)));
    if (idea.draft && idea.lane !== 'ticket') {
      const d = el('div', 'idea-draft');
      d.appendChild(el('span', 'setup-label', 'Ticket draft'));
      d.appendChild(el('span', 'idea-draft-title', idea.draft.title));
      const type = trackerInfo(tracker()).issueTypes ? idea.draft.type : null;
      const meta = [type, idea.draft.priority, ...idea.draft.labels].filter(Boolean).join(' · ');
      if (meta) d.appendChild(el('span', 'm', meta));
      const gaps = draftGaps(idea.draft, idea);
      if (gaps.length) d.appendChild(el('span', 'm idea-missing', `Missing: ${gaps.join(', ')}`));
      // The whole draft, read in place without opening the editor.
      if (idea.draft.description) {
        const key = `${idea.id}:draft`;
        const body = el('pre', 'idea-draft-body', idea.draft.description);
        const toggle = el('button', 'link-button show-more');
        toggle.type = 'button';
        const show = (on: boolean): void => {
          body.hidden = !on;
          toggle.textContent = on ? 'Hide the draft' : 'Read the draft';
          toggle.setAttribute('aria-expanded', String(on));
        };
        show(shownWhole.has(key));
        toggle.addEventListener('click', () => {
          show(body.hidden);
          keepShown(key, !body.hidden);
        });
        d.append(toggle, body);
      }
      node.appendChild(d);
    }
    const planner = idea.lane === 'shaping' ? store.state.agents.find((a) => a.id === idea.plannerId) : undefined;
    if (idea.lane === 'shaping') {
      const asking = planner?.status === 'needs_you';
      const busy = planner?.status === 'working' || planner?.status === 'starting';
      node.appendChild(
        el(
          'span',
          asking ? 'idea-asking' : 'm',
          planner
            ? asking
              ? `${planner.name} needs an answer in the chat.`
              : busy
                ? `${planner.name} is reading and thinking.`
                : idea.draft
                  ? `${planner.name} is waiting. Reply to revise the draft, or mark it ready.`
                  : `${planner.name} is waiting for your reply.`
            : 'A Planner is starting.',
        ),
      );
      if (planner) {
        let thread = threads.get(idea.id);
        if (!thread) {
          thread = ideaThread(store, idea.id, () => store.state.ideas.find((i) => i.id === idea.id)?.plannerId ?? null);
          threads.set(idea.id, thread);
        }
        thread.refresh();
        node.appendChild(thread.node);
      }
    }
    if (idea.lane === 'ticket') {
      const worker = idea.workerId ? store.state.agents.find((a) => a.id === idea.workerId) : undefined;
      if (worker) node.appendChild(el('span', 'm idea-worker', `${worker.name} is on it (${worker.status.replace('_', ' ')}).`));
    }

    const actions = el('div', 'actions');
    const button = (label: string, onClick: () => void, cls = 'btn small ghost'): HTMLButtonElement => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      actions.appendChild(b);
      return b;
    };
    if (idea.archived) {
      button('Restore', () => change(idea, { archived: false }));
    } else if (idea.lane === 'shaping') {
      if (planner) {
        if (idea.draft) button('Mark ready', () => markReady(idea), 'btn small primary');
        button(planner.status === 'needs_you' ? 'Answer' : 'Open chat', () => store.selectAgent(planner.id), idea.draft ? 'btn small ghost' : 'btn small primary');
        button('Stop shaping', () => {
          api.fire(planner.id, false).catch(fail);
        });
      }
    } else if (idea.lane === 'inbox') {
      button('Shape with Planner', () => edit(idea, 'shape'), 'btn small primary');
      button(idea.draft ? 'Edit ticket draft' : 'Write ticket draft', () => edit(idea, 'draft'));
      button('Edit idea', () => edit(idea, 'idea'));
      button('Archive', () => change(idea, { archived: true }));
    } else if (idea.lane === 'ready') {
      button('Create ticket', () => edit(idea, 'ticket'), 'btn small primary');
      button('Create ticket and start work', () => edit(idea, 'ticket', true), 'btn small primary');
      button('Edit draft', () => edit(idea, 'draft'));
      button('Back to Inbox', () => change(idea, { lane: 'inbox' }));
      button('Archive', () => change(idea, { archived: true }));
    } else if (idea.lane === 'ticket') {
      const worker = idea.workerId ? store.state.agents.find((a) => a.id === idea.workerId) : undefined;
      if (worker) button('Open worker', () => store.selectAgent(worker.id), 'btn small primary');
      else if (!idea.ticketClosedAt) button('Start work', () => startWork(idea), 'btn small primary');
      button('Archive', () => change(idea, { archived: true }));
    }
    node.appendChild(actions);
    node.appendChild(el('span', 'm idea-updated', `Updated ${ago(idea.updatedAt)}`));
    return node;
  };

  /**
   * Create a ticket in the active tracker: pick the project and type, see the
   * ticket exactly as it will be made, then confirm. Nothing reaches the
   * tracker before the confirm.
   */
  const ticketForm = (idea: Idea, node: HTMLElement, startWork: boolean): HTMLElement => {
    node.classList.add('editing');
    const draft = idea.draft;
    if (!draft) {
      // Only Ready ideas have the button, and Ready takes a draft.
      setTimeout(stopEditing);
      return node;
    }
    const source = tracker();
    const info = trackerInfo(source);
    const name = info.name;
    const noun = info.projectNoun;
    const top = el('div', 'row');
    top.append(el('b', null, startWork ? `Create ${name} ticket and start work` : `Create ${name} ticket`), expandButton(node));
    node.appendChild(top);

    const meta = el('div', 'setup');
    const project = el('select', 'dropdown');
    project.setAttribute('aria-label', `${name} ${noun}`);
    const type = el('select', 'dropdown');
    type.setAttribute('aria-label', 'Issue type');
    for (const [label, input] of [[noun.charAt(0).toUpperCase() + noun.slice(1), project], ['Issue type', type]] as const) {
      const row = el('label', 'setup-field');
      row.append(el('span', 'setup-label', label), input);
      // A tracker without issue types still fills the picker with its one kind, out of sight.
      if (input === type && !info.issueTypes) row.hidden = true;
      meta.appendChild(row);
    }
    node.appendChild(meta);
    const status = el('span', 'm');
    node.appendChild(status);

    // The ticket as it will be made.
    const preview = el('div', 'idea-preview');
    preview.appendChild(el('span', 'setup-label', 'Preview'));
    preview.appendChild(el('b', null, draft.title));
    const facts = el('span', 'm');
    preview.appendChild(facts);
    preview.appendChild(el('pre', 'idea-preview-body', draft.description || '(no description)'));
    node.appendChild(preview);

    const actions = el('div', 'actions');
    const ok = el('button', 'btn small primary', startWork ? 'Create ticket and start work' : 'Create ticket');
    ok.type = 'button';
    ok.disabled = true;
    const verb = startWork ? 'Create ticket and start work' : 'Create ticket';
    const cancel = el('button', 'btn small', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', stopEditing);
    actions.append(ok, cancel);
    node.appendChild(actions);
    cancelOnEscape(node);

    const describe = (): void => {
      const bits = [
        info.issueTypes ? type.value || draft.type : null,
        draft.priority && info.priorities.length ? `${draft.priority} priority` : null,
        ...draft.labels,
        'assigned to you',
      ];
      facts.textContent = bits.filter(Boolean).join(' · ');
      ok.textContent = project.value ? `${verb} in ${project.value}` : verb;
      ok.disabled = !project.value || !type.value;
    };

    const loadTypes = async (): Promise<void> => {
      clear(type);
      ok.disabled = true;
      if (!project.value) return;
      if (info.issueTypes) status.textContent = `Loading the issue types in ${project.value}…`;
      try {
        const { issueTypes } = await api.issueTypes(project.value);
        clear(type);
        for (const t of issueTypes) {
          const o = el('option', null, t.name);
          o.value = t.name;
          type.appendChild(o);
        }
        // The draft's type first, then the last one used, then a story.
        const names = issueTypes.map((t) => t.name);
        const want = [draft.type, store.state.ticketTarget.issueType, 'User Story', 'Story'].find((n) => n && names.includes(n));
        type.value = want ?? names[0] ?? '';
        status.textContent = '';
      } catch (err) {
        status.textContent = `Could not load the issue types: ${(err as Error).message}`;
      }
      describe();
    };

    // Projects in a useful order: the last one used, then those the board's
    // tickets come from, then the rest. A search finds any other.
    const fill = (projects: Array<{ key: string; name: string }>, keep: string | null): void => {
      const last = store.state.ticketTarget.project;
      const onBoard = [...new Set(store.state.tickets.filter((t) => t.source === source).map((t) => projectOf(displayKey(t.key))))]
        .filter(Boolean);
      const byKey = new Map(projects.map((p) => [p.key, p]));
      const first = [last, ...onBoard].filter((k): k is string => !!k);
      const ordered = [
        ...first.map((k) => byKey.get(k) ?? { key: k, name: k }),
        ...projects.filter((p) => !first.includes(p.key)),
      ].filter((p, i, all) => all.findIndex((q) => q.key === p.key) === i);
      clear(project);
      for (const p of ordered) {
        const o = el('option', null, p.name === p.key ? p.key : `${p.name} (${p.key})`);
        o.value = p.key;
        project.appendChild(o);
      }
      const want = keep && ordered.some((p) => p.key === keep) ? keep : ordered[0]?.key;
      project.value = want ?? '';
    };

    const loadProjects = async (q = ''): Promise<void> => {
      status.textContent = q ? `Searching ${name} for "${q}"…` : `Loading your ${name} ${noun}s…`;
      const before = project.value;
      try {
        const { projects } = await api.trackerProjects(source, q);
        fill(projects, q ? (projects[0]?.key ?? before) : before || null);
        status.textContent = q && !projects.length ? `No ${noun} matches "${q}".` : '';
        if (project.value !== before || !type.options.length) await loadTypes();
        else describe();
      } catch (err) {
        status.textContent = `Could not load your ${name} ${noun}s: ${(err as Error).message}`;
      }
    };

    const search = el('input', 'setup-name');
    search.type = 'search';
    search.placeholder = `Find another ${noun}`;
    search.setAttribute('aria-label', `Find a ${name} ${noun}`);
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void loadProjects(search.value.trim()), 300);
    });
    meta.after(searchClear(search));

    project.addEventListener('change', () => void loadTypes());
    type.addEventListener('change', describe);
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      cancel.disabled = true;
      status.textContent = startWork ? `Creating the ticket in ${project.value} and hiring a worker…` : `Creating the ticket in ${project.value}…`;
      try {
        const made = await api.createTicket(idea.id, project.value, type.value, startWork);
        store.patch({ ticketTarget: { project: project.value, issueType: type.value } });
        status.textContent = `Created ${made.ticketKey}.`;
        stopEditing();
      } catch (err) {
        status.textContent = `${name} did not create the ticket: ${(err as Error).message}`;
        cancel.disabled = false;
        describe();
      }
    });

    describe();
    void loadProjects();
    return node;
  };

  /**
   * Shape with Planner: pick the repo the Planner works in, which starts as the
   * idea's first, then start. It reads the idea's other repos too, and gets
   * the idea's files. It reads only; nothing in any repo changes.
   */
  const shapeForm = (idea: Idea, node: HTMLElement): HTMLElement => {
    node.classList.add('editing');
    node.appendChild(el('b', null, 'Shape with Planner'));
    node.appendChild(
      el('span', 'm', 'A Planner reads the code and writes the ticket draft. It changes nothing, and reading needs no approval from you.'),
    );
    const row = el('label', 'setup-field');
    row.appendChild(el('span', 'setup-label', 'Repo to read'));
    const repo = el('select', 'dropdown');
    repo.setAttribute('aria-label', 'Repo to read');
    // The idea's other repos, which the Planner reads beside the one picked.
    const also = el('div', 'setup-field');
    const showAlso = (): void => {
      clear(also);
      const others = repo.value ? idea.repos.filter((p) => p !== repo.value) : [];
      also.hidden = !others.length;
      also.appendChild(el('span', 'setup-label', 'Also reads'));
      const chips = el('div', 'idea-repo-row');
      for (const path of others) chips.appendChild(repoChip(store, path));
      also.appendChild(chips);
    };
    const fillRepos = (): void => {
      const before = repo.value;
      clear(repo);
      // The idea's own repos first, then the rest of the office's.
      const known = store.state.repos;
      const paths = [...idea.repos, ...known.map((r) => r.path).filter((p) => !idea.repos.includes(p))];
      for (const path of paths) {
        const r = known.find((k) => k.path === path);
        const o = el('option', null, r?.isDefault ? `${r.name} (default)` : repoName(store, path));
        o.value = path;
        o.title = path;
        repo.appendChild(o);
      }
      const none = el('option', null, 'No repo: work from the idea alone');
      none.value = '';
      repo.appendChild(none);
      const want = before || idea.repos[0] || known.find((r) => r.isDefault)?.path || known[0]?.path || '';
      repo.value = want;
      showAlso();
    };
    fillRepos();
    if (!store.state.repos.length) void store.loadRepos().then(fillRepos);
    repo.addEventListener('change', showAlso);
    row.appendChild(repo);
    node.append(row, also);
    if (idea.attachments.length) {
      const count = idea.attachments.length === 1 ? 'its file' : `its ${idea.attachments.length} files`;
      node.appendChild(el('span', 'm', `The Planner gets the idea's notes and ${count} with its first message.`));
    }
    editorButtons(node, 'Start shaping', () => api.shapeIdea(idea.id, repo.value || null));
    return node;
  };

  /** Escape cancels the edit rather than closing the panel. */
  const cancelOnEscape = (node: HTMLElement): void => {
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        stopEditing();
      }
    });
  };

  const editorButtons = (node: HTMLElement, label: string, save: () => Promise<unknown>): HTMLElement => {
    const actions = el('div', 'actions');
    const ok = el('button', 'btn small primary', label);
    ok.type = 'button';
    const cancel = el('button', 'btn small', 'Cancel');
    cancel.type = 'button';
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        await save();
        stopEditing();
      } catch (err) {
        ok.disabled = false;
        fail(err);
      }
    });
    cancel.addEventListener('click', stopEditing);
    actions.append(ok, cancel);
    node.appendChild(actions);
    cancelOnEscape(node);
    return actions;
  };

  /** Edit idea: its words, its repos, and its files, which can be taken off or added to. */
  const ideaEditor = (idea: Idea, node: HTMLElement): HTMLElement => {
    node.classList.add('editing');
    const t = textField('Idea title', idea.title, TITLE_MAX);
    const n = el('textarea', 'ask-input');
    n.rows = 6;
    n.value = idea.notes;
    n.setAttribute('aria-label', 'Idea notes');
    autoGrow(n, () => 420);
    const repos = repoField(store, idea.repos);
    // Files taken off go when it is saved, and so do new ones, counting toward the same 25 MB.
    let removed: string[] = [];
    const kept = savedFileChips(
      idea.attachments,
      (a) => ideaFileUrl(idea.id, a.file),
      (a) => (removed = [...removed, a.file]),
    );
    const keptBytes = (): number => idea.attachments.filter((a) => !removed.includes(a.file)).reduce((sum, a) => sum + a.size, 0);
    const added = fileField(node, n, (message) => store.patch({ lastError: message }), keptBytes);
    node.append(t, n, repos.node, kept, added.list);
    const actions = editorButtons(node, 'Save', async () => {
      const attachments = await Promise.all(added.tray.files.map(toUpload));
      return api.updateIdea(idea.id, {
        title: t.value,
        notes: n.value,
        repos: repos.value(),
        ...(removed.length ? { removeAttachments: removed } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
    });
    actions.append(added.button, added.picker);
    setTimeout(() => t.focus());
    return node;
  };

  /**
   * The ticket draft, in the team's template, pre-filled from the idea the
   * first time. Saving it moves the idea to Ready.
   */
  const draftEditor = (idea: Idea, node: HTMLElement): HTMLElement => {
    node.classList.add('editing');
    const d = idea.draft ?? draftTemplate(idea.title, idea.notes);
    const top = el('div', 'row');
    top.appendChild(el('b', null, idea.draft ? 'Edit ticket draft' : 'Write ticket draft'));
    node.appendChild(top);

    const field = (label: string, input: HTMLElement): HTMLElement => {
      const row = el('label', 'setup-field');
      row.append(el('span', 'setup-label', label), input);
      node.appendChild(row);
      return row;
    };
    const title = textField('Ticket title', d.title, 255);
    title.placeholder = 'Area: what — part';
    field('Title', title);

    const info = trackerInfo(tracker());
    const meta = el('div', 'setup');
    const type = textField('Issue type', d.type, 60);
    const priority = el('select', 'dropdown');
    const choices = info.priorities.length ? info.priorities : [];
    // A draft from another tracker keeps its priority until it is changed.
    for (const p of ['', ...choices, ...(d.priority && !choices.includes(d.priority) ? [d.priority] : [])]) {
      const o = el('option', null, p || 'Not set');
      o.value = p;
      priority.appendChild(o);
    }
    priority.value = d.priority ?? '';
    for (const [label, input] of [['Type', type], ['Priority', priority]] as const) {
      const row = el('label', 'setup-field');
      row.append(el('span', 'setup-label', label), input);
      if (input === type && !info.issueTypes) row.hidden = true;
      if (input === priority && !info.priorities.length) row.hidden = true;
      meta.appendChild(row);
    }
    node.appendChild(meta);

    const labels = textField('Labels', d.labels.join(', '), 300);
    labels.placeholder = 'e.g. reputation-center';
    field('Labels, comma separated', labels);

    const desc = el('textarea', 'ask-input idea-description');
    desc.rows = 12;
    desc.value = d.description;
    desc.setAttribute('aria-label', 'Ticket description');
    field('Description', desc).classList.add('idea-description-field');
    // Expanded, it grows to the whole draft, so the panel is the only thing that scrolls.
    const fit = autoGrow(desc, () => (expanded ? Number.POSITIVE_INFINITY : 480));
    top.appendChild(expandButton(node, fit));

    editorButtons(node, 'Save draft', () =>
      api.updateIdea(idea.id, {
        draft: {
          title: title.value,
          type: type.value,
          labels: labels.value.split(','),
          priority: priority.value || null,
          description: desc.value,
        },
        lane: 'ready',
      }),
    );
    setTimeout(() => title.focus());
    return node;
  };

  const draw = (force = false): void => {
    const { state } = store;
    panel.hidden = !state.ideasOpen;
    if (panel.hidden) {
      drawn = '';
      editing = null;
      expand(null, false);
      // Out of sight, and redrawn in full when the panel opens again.
      clamps.reset();
      return;
    }
    // The office's repos can arrive after the add box is built.
    addRepos.refresh();
    // A Planner's status shows on its idea's card, so it is part of what is drawn.
    const planners = state.ideas
      .filter((i) => i.plannerId)
      .map((i) => state.agents.find((a) => a.id === i.plannerId))
      .map((a) => (a ? [a.id, a.name, a.status] : null));
    const workers = state.ideas
      .filter((i) => i.workerId)
      .map((i) => state.agents.find((a) => a.id === i.workerId))
      .map((a) => (a ? [a.id, a.name, a.status] : null));
    const key = JSON.stringify([state.ideas, showArchived, showClosed, editing, planners, workers, tracker()]);
    if (!force && (key === drawn || editing !== null)) return;
    drawn = key;

    // A talk that ended, with its idea marked Ready or its Planner gone, leaves nothing to keep.
    for (const id of threads.keys()) {
      if (!state.ideas.some((i) => i.id === id && i.lane === 'shaping')) threads.delete(id);
    }
    // A closed ticket's idea leaves the board; an archived one shows only under archived.
    const live = state.ideas.filter((i) => !i.archived && !i.ticketClosedAt);
    const closed = state.ideas.filter((i) => !i.archived && i.ticketClosedAt);
    const archived = state.ideas.filter((i) => i.archived);
    const ready = live.filter((i) => i.lane === 'ready').length;
    $('ideasSub').textContent = live.length
      ? `${live.length} ${live.length === 1 ? 'idea' : 'ideas'}${ready ? `, ${ready} ready` : ''}`
      : 'Nothing on the board yet';

    clamps.reset();
    clear(lanes);
    for (const lane of IDEA_LANES) {
      const inLane = live.filter((i) => i.lane === lane.value);
      const label = lane.value === 'ticket' ? `In ${trackerName(tracker())}` : lane.label;
      const section = el('section', 'idea-lane');
      section.setAttribute('aria-label', label);
      const h = el('h3', 'idea-lane-head');
      h.append(el('span', null, label), el('span', 'count', String(inLane.length)));
      section.appendChild(h);
      if (inLane.length) for (const idea of inLane) section.appendChild(card(idea));
      else section.appendChild(el('span', 'm idea-empty', EMPTY[lane.value]));
      lanes.appendChild(section);
    }

    if (closed.length) {
      const toggle = el('button', 'btn small ghost idea-archive-toggle idea-closed-toggle', showClosed ? 'Hide closed' : `Show closed (${closed.length})`);
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(showClosed));
      toggle.addEventListener('click', () => {
        showClosed = !showClosed;
        draw(true);
      });
      lanes.appendChild(toggle);
      if (showClosed) for (const idea of closed) lanes.appendChild(card(idea));
    }

    if (archived.length) {
      const toggle = el('button', 'btn small ghost idea-archive-toggle', showArchived ? 'Hide archived' : `Show archived (${archived.length})`);
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(showArchived));
      toggle.addEventListener('click', () => {
        showArchived = !showArchived;
        draw(true);
      });
      lanes.appendChild(toggle);
      if (showArchived) for (const idea of archived) lanes.appendChild(card(idea));
    }
  };

  store.subscribe(() => {
    draw();
    for (const thread of threads.values()) thread.refresh();
  });
}

function textField(label: string, value: string, max: number): HTMLInputElement {
  const input = el('input', 'setup-name');
  input.type = 'text';
  input.maxLength = max;
  input.value = value;
  input.setAttribute('aria-label', label);
  return input;
}

/**
 * The attach button, paste and drop, as the Ask box has them: files wait as chips
 * in `list` until the idea is saved. `used` counts files already on the idea
 * toward the same limit.
 */
function fileField(
  zone: HTMLElement,
  typed: HTMLElement,
  onError: (message: string) => void,
  used?: () => number,
): { tray: AttachTray; list: HTMLElement; button: HTMLButtonElement; picker: HTMLInputElement } {
  const list = el('div', 'attach-list');
  const tray = attachTray(list, { onError, ...(used ? { used } : {}) });
  wireFileDrop(zone, typed, (dropped) => tray.add(dropped));
  const picker = el('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', () => {
    tray.add(picker.files ?? []);
    picker.value = '';
  });
  const button = attachButton();
  button.title = 'Attach files, such as a PRD or screenshots, or paste or drop them here';
  button.addEventListener('click', () => picker.click());
  return { tray, list, button, picker };
}
