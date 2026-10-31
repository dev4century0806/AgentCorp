import { DEFAULT_LOOK, QUESTS, RUNNER_CHOICES, SIGN_IN, displayKey, runnerLabel, trackerName, type QuestId, type RunnerChoice, type Ticket, type TrackerId } from '@shared';
import { api, type SignInState } from '../net/client.js';
import { portrait } from '../scene/portrait.js';
import { officeView } from '../scene/office.js';
import { QUEST_SPOTS, agentReady, firstDayShown, stepStates, ticketsToShow, type StepState } from '../scene/quests.js';
import type { Store } from '../state/store.js';
import { accessToken } from './auth.js';
import { $, clear, el, iconSvg, searchClear, TEXT_ICONS } from './dom.js';
import { commandLine } from './runners.js';

/** the assistant's reception look, matching her permanent figure in the room. */
const GUIDE_LOOK = { ...DEFAULT_LOOK, hair: 'shoulder', hat: 'headset', outfit: 'cardigan', shirtColor: '#b8476e', hairColor: '#c9a15a' } as const;

/** Where tickets can come from, as the first task's step offers them. */
type TicketSystem = TrackerId | '8090';
const SYSTEMS: Array<{ id: TicketSystem; name: string; signInWith: string }> = [
  { id: 'github', name: 'GitHub Issues', signInWith: 'GitHub' },
  { id: '8090', name: '8090', signInWith: '8090' },
];

/** The most tickets listed at once; searching narrows the rest. */
const LIST_LIMIT = 30;

/**
 * The first day, as one card from the assistant: sign in to a coding agent, add your
 * code, then pick a first task (a ticket, or one described by hand) and hire
 * a worker for it. Each step shows done as soon as the office sees it done,
 * so someone already signed in starts further down.
 *
 * After the hire, the card follows the new worker until it is under way,
 * then says how to hire more, and goes once that is read.
 */
export function mountOnboarding(store: Store): void {
  const box = $<HTMLElement>('guide');
  const fail = (err: unknown): void => store.patch({ lastError: (err as Error).message });

  /** Quests seen done on the last update, to celebrate the ones that just finished. */
  /** A Claude Code sign-in started from the card, while it waits for the browser. */
  let signing: SignInState | null = null;
  let askedSignIn = false;
  /** The ticket system whose browser sign-in was started from the card. */
  let connecting: TicketSystem | null = null;
  /** Its sign-in page, linked on the card in case the browser did not open it. */
  let connectUrl: string | null = null;
  let connectError: string | null = null;
  /** Writing a task by hand rather than picking a ticket. */
  let describing = false;
  let search = '';
  let found: Ticket[] = [];
  let searching = false;
  /** Why the trackers' search came back empty-handed, when it failed rather than found nothing. */
  let searchErrors: string[] = [];
  let searchSeq = 0;
  let searchTimer = 0;
  let picked: string | null = null;
  /** The repo picked for each ticket key, and for a described task under ''. */
  const repoFor = new Map<string, string>();
  let task = '';
  /** The worker hired from the card, followed until it is under way. */
  let hiredId: string | null = null;
  /**
   * While a hire from the card is in flight, the workers there were before it.
   * The new one walks in well before the hire request answers, and the card
   * follows it from that moment.
   */
  let hiringFrom: Set<string> | null = null;
  let drawn = '';
  /** Where the ticket list is drawn, so typing a search redraws only the list. */
  let listHost: HTMLElement | null = null;

  const openExternal = (url: string): void => {
    const desktop = (window as unknown as { desktop?: { openExternal?: (externalUrl: string) => Promise<void> } }).desktop;
    if (desktop?.openExternal) void desktop.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const dismiss = (): void => {
    hiredId = null;
    hiringFrom = null;
    $('openTickets').classList.remove('guide-pulse');
    store.patch({ onboarding: { ...store.state.onboarding, tourDismissed: true, tourReplay: null } });
    api.setTourDismissed(true).catch(fail);
  };

  const button = (row: HTMLElement, label: string, onClick: () => void, cls = 'btn small'): HTMLButtonElement => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    row.appendChild(b);
    return b;
  };

  /** A line saying how something went, or why it did not. */
  const note = (into: HTMLElement): ((text: string, bad?: boolean) => void) => {
    const line = el('span', 'guide-hint ok');
    into.appendChild(line);
    return (text, bad = false) => {
      line.textContent = text;
      line.className = bad ? 'guide-hint' : 'guide-hint ok';
    };
  };

  /** Adds a folder to the ones searched for repos, and returns the repos that brought in. */
  const addFolder = async (folder: string): Promise<string[]> => {
    const [{ repos: settings }, { repos: before }] = await Promise.all([api.settings(), api.repos()]);
    const known = new Set(before.map((r) => r.path));
    const result = await api.saveRepoRoots([...settings.roots, folder]);
    store.patch({ repos: result.repos });
    return result.repos.filter((r) => !known.has(r.path)).map((r) => r.path);
  };

  /**
   * Ways to bring code in: the folders on this Mac that hold git repos, one
   * click each, the Mac's own folder picker, and a GitHub repo to clone.
   * `onAdded` gets the first repo it brought in.
   */
  const codePicker = (into: HTMLElement, onAdded?: (path: string) => void): void => {
    const row = el('div', 'actions');
    const say = el('span', 'guide-hint ok', 'Looking for your code…');
    const tell = (text: string, bad = false): void => {
      say.textContent = text;
      say.className = bad ? 'guide-hint' : 'guide-hint ok';
    };
    const add = (folder: string, b: HTMLButtonElement): void => {
      b.disabled = true;
      tell(`Looking through ${folder}…`);
      addFolder(folder)
        .then((added) => {
          if (!added.length) {
            tell(`No new repos in ${folder}. Pick a repo, or a folder with repos in it.`, true);
            return;
          }
          if (b !== choose) b.remove();
          tell(`Added ${added.length} ${added.length === 1 ? 'repo' : 'repos'}.`);
          onAdded?.(added[0]!);
        })
        .catch((err) => tell((err as Error).message, true))
        .finally(() => (b.disabled = false));
    };
    const choose = el('button', 'btn small', 'Choose a folder…');
    choose.type = 'button';
    choose.addEventListener('click', () => {
      choose.disabled = true;
      tell('Pick the folder in the window that opened.');
      api
        .chooseFolder('Pick the folder your code lives in')
        .then(({ path }) => (path ? add(path, choose) : tell('No folder picked.')))
        .catch((err) => tell((err as Error).message, true))
        .finally(() => (choose.disabled = false));
    });
    api
      .codeFolders()
      .then(({ folders }) => {
        tell(folders.length ? 'Found on your Mac. Add a whole folder at once:' : 'Pick the folder your repos are in.');
        for (const f of folders) {
          const b = button(row, `Add ${f.label} · ${f.repos} ${f.repos === 1 ? 'repo' : 'repos'}`, () => add(f.path, b), 'btn small primary');
        }
        row.appendChild(choose);
      })
      .catch(() => {
        tell('Pick the folder your repos are in.');
        row.appendChild(choose);
      });

    // A repo that is not on this Mac yet: cloned from GitHub.
    const clone = el('form', 'guide-code');
    const where = el('input', 'ask-path');
    where.type = 'text';
    where.placeholder = 'owner/repo, a GitHub link, or a folder path';
    where.setAttribute('aria-label', 'Repo to add');
    const go = el('button', 'btn small', 'Add');
    go.type = 'submit';
    clone.append(where, go);
    clone.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = where.value.trim();
      if (!q) return;
      go.disabled = true;
      tell('Looking it up…');
      api
        .lookupRepo(q)
        .then(async (repo) => {
          if (repo.kind === 'path') {
            try {
              const added = await api.addRepo(q);
              store.patch({ repos: added.repos });
              return added.repo.path;
            } catch (err) {
              // Not a repo itself: maybe a folder of repos, like the suggestions above. If it holds none, it is not kept.
              const { repos: settings } = await api.settings();
              const paths = await addFolder(q);
              if (paths.length) return paths[0]!;
              await api.saveRepoRoots(settings.roots).catch(() => undefined);
              throw err;
            }
          }
          if (repo.alreadyCloned) return repo.target;
          tell(`Cloning ${repo.name}… this can take a moment.`);
          const cloned = await api.cloneRepo(q);
          store.patch({ repos: cloned.repos });
          return cloned.repo.path;
        })
        .then((path) => {
          where.value = '';
          tell('Added.');
          onAdded?.(path);
        })
        .catch((err) => tell((err as Error).message, true))
        .finally(() => (go.disabled = false));
    });
    into.append(say, row, clone);
  };

  /** Step 1, while it is the one to do: the agent to use, and how to sign it in. */
  const agentStep = (into: HTMLElement): void => {
    const { runner, health } = store.state;
    const agent = health.runners[runner];
    const pick = el('select', 'dropdown');
    pick.setAttribute('aria-label', 'Coding agent');
    for (const id of RUNNER_CHOICES) {
      const o = el('option', null, runnerLabel(id));
      o.value = id;
      pick.appendChild(o);
    }
    pick.value = runner;
    pick.addEventListener('change', () => {
      const mode = pick.value as RunnerChoice;
      // The last agent's answer no longer applies: show the new one being checked until the office hears back.
      const { health } = store.state;
      store.patch({ runner: mode, health: { ...health, runners: { ...health.runners, [mode]: { status: 'checking', error: null, version: null } } } });
      // Saving the pick turns the agent on, so the worker hired at the end of the first day can go to it.
      api.saveRunner(mode).then((saved) => store.patch({ enabledRunners: saved.enabledRunners })).catch(fail);
    });
    into.appendChild(el('p', 'guide-say', "The office stays dark until a coding agent is signed in. Sign one in and I'll turn the lights on."));
    const head = el('div', 'guide-row');
    head.append(el('span', 'm', 'Agent'), pick);
    into.appendChild(head);

    if (agent.status === 'checking') {
      const wait = el('div', 'guide-wait');
      wait.append(el('span', 'spinner'), el('span', null, `Checking ${runnerLabel(runner)}…`));
      into.appendChild(wait);
      return;
    }
    if (runner === 'claude') {
      claudeSignIn(into);
      return;
    }
    // Other agents sign in from a terminal; the office looks again when asked.
    into.appendChild(el('span', 'guide-hint ok', `Sign in to ${runnerLabel(runner)} from a terminal, then check again.`));
    into.appendChild(commandLine(SIGN_IN[runner]));
    const row = el('div', 'actions');
    const again = button(row, 'Check again', () => {
      again.disabled = true;
      api.checkQuests().then((o) => store.patch({ onboarding: o })).catch(fail).finally(() => (again.disabled = false));
    }, 'btn small primary');
    into.appendChild(row);
    if (agent.error) into.appendChild(el('span', 'guide-hint', agent.error));
  };

  /** Claude Code's sign-in: a button, then the page link, a box for a code, and the terminal as a fallback. */
  const claudeSignIn = (into: HTMLElement): void => {
    if (!askedSignIn) {
      // Picks up a sign-in already waiting, say from before a reload.
      askedSignIn = true;
      api.signInState().then((s) => {
        if (s?.running) {
          signing = s;
          draw();
        }
      }).catch(() => undefined);
    }
    const actions = el('div', 'actions');
    into.appendChild(actions);
    if (!signing?.running) {
      const go = button(actions, 'Sign in to Claude Code', () => {
        go.disabled = true;
        go.textContent = 'Opening the sign-in…';
        api
          .startSignIn()
          .then((s) => {
            signing = s;
            draw();
          })
          .catch((err) => {
            fail(err);
            go.disabled = false;
            go.textContent = 'Sign in to Claude Code';
          });
      }, 'btn small primary');
      if (signing?.error) into.appendChild(el('span', 'guide-hint', signing.error));
      else if (store.state.health.runners.claude.error) into.appendChild(el('span', 'guide-hint', store.state.health.runners.claude.error));
    } else {
      if (signing.url) {
        const link = el('a', 'btn small primary', 'Open the sign-in page');
        (link as HTMLAnchorElement).href = signing.url;
        (link as HTMLAnchorElement).target = '_blank';
        (link as HTMLAnchorElement).rel = 'noreferrer';
        actions.appendChild(link);
      }
      button(actions, 'Cancel', () => {
        api.cancelSignIn().catch(fail);
        signing = null;
        draw();
      });
      // If the page shows a code instead of finishing by itself, it goes here.
      const paste = el('form', 'guide-code');
      const input = el('input', 'ask-path');
      input.type = 'text';
      input.placeholder = 'Got a code? Paste it here';
      input.setAttribute('aria-label', 'Code from the sign-in page');
      const send = el('button', 'btn small', 'Send');
      send.type = 'submit';
      paste.append(input, send);
      paste.addEventListener('submit', (e) => {
        e.preventDefault();
        send.disabled = true;
        api
          .sendSignInCode(input.value)
          .then((s) => {
            if (s) signing = s;
            input.value = '';
            send.textContent = 'Sent';
          })
          .catch(fail)
          .finally(() => (send.disabled = false));
      });
      into.appendChild(paste);
      if (signing.note) into.appendChild(el('span', 'guide-hint', signing.note));
    }
    // For anyone who would rather use a terminal. Tucked away: the button is the way in.
    const other = el('details', 'guide-terminal');
    other.appendChild(el('summary', null, 'Sign in from a terminal instead'));
    other.appendChild(commandLine(SIGN_IN.claude));
    into.appendChild(other);
  };

  /** Step 2, while it is the one to do: bring in code. */
  const codeStep = (into: HTMLElement): void => {
    codePicker(into);
  };

  /** The ticket systems that are connected and feeding the board. */
  const connectedSystems = (): TicketSystem[] => {
    const { health } = store.state;
    const trackers = (Object.keys(health.trackers) as TrackerId[]).filter((id) => health.trackers[id]?.status === 'ok');
    return health.factory === 'ok' ? [...trackers, '8090'] : trackers;
  };

  /** Starts a ticket system's browser sign-in. */
  const connect = async (id: TicketSystem): Promise<void> => {
    // In a browser, a window opened after the requests below is no longer the click's and may be blocked:
    // open it now, and send it to the sign-in page once that is known. The desktop app opens links itself.
    const desktop = (window as unknown as { desktop?: { openExternal?: unknown } }).desktop?.openExternal;
    const tab = desktop ? null : window.open('about:blank', '_blank');
    connecting = id;
    connectUrl = null;
    connectError = null;
    draw();
    try {
      let url: string | null;
      if (id === '8090') {
        ({ url } = await api.connectFactory());
        if (!url) await api.saveFactory(true);
      } else {
        await api.saveTracker(id);
        ({ url } = await api.connectTracker(id, await accessToken()));
        if (!url) await api.saveTrackerSettings(id, { enabled: true });
      }
      if (url && tab) {
        tab.opener = null;
        tab.location.href = url;
      } else if (url) openExternal(url);
      else tab?.close();
      connectUrl = url;
      draw();
    } catch (err) {
      tab?.close();
      connecting = null;
      connectError = (err as Error).message;
      draw();
    }
  };

  /** Step 3 before any ticket system is connected: where the tickets live. */
  const systemPicker = (into: HTMLElement): void => {
    into.appendChild(el('span', 'm', 'Where are your tickets?'));
    const grid = el('div', 'guide-systems');
    for (const s of SYSTEMS) {
      const b = el('button', 'guide-system');
      b.type = 'button';
      b.append(el('b', null, s.name), el('span', 'm', `Sign in with ${s.signInWith}`));
      b.disabled = connecting !== null;
      b.addEventListener('click', () => void connect(s.id));
      grid.appendChild(b);
    }
    into.appendChild(grid);
    if (connecting) {
      const name = SYSTEMS.find((s) => s.id === connecting)?.name ?? connecting;
      const wait = el('div', 'guide-wait');
      wait.append(el('span', 'spinner'), el('span', null, `Approve AgentCorp for ${name} in your browser. Your tickets show up here when you're back.`));
      into.appendChild(wait);
      const row = el('div', 'actions');
      if (connectUrl) {
        const link = el('a', 'btn small', 'Open the sign-in page');
        (link as HTMLAnchorElement).href = connectUrl;
        (link as HTMLAnchorElement).target = '_blank';
        (link as HTMLAnchorElement).rel = 'noreferrer';
        row.appendChild(link);
      }
      button(row, 'Pick another', () => {
        connecting = null;
        draw();
      }, 'guide-skip');
      into.appendChild(row);
    } else {
      into.appendChild(el('span', 'guide-hint ok', 'Opens your browser to sign in. Nothing to install and no token to paste.'));
    }
    if (connectError) into.appendChild(el('span', 'guide-hint', connectError));
    const tracker = store.state.health.tracker;
    if (tracker.status === 'error' && tracker.error) into.appendChild(el('span', 'guide-hint', `${trackerName(tracker.id)}: ${tracker.error}`));
  };

  /**
   * The repo a worker will work in: every repo the office knows, and a way
   * to add one that is missing without leaving the card.
   */
  const repoPicker = (into: HTMLElement, key: string, suggested: string | null): void => {
    const ADD = '__add';
    const row = el('div', 'guide-row');
    const select = el('select', 'dropdown');
    select.setAttribute('aria-label', 'Repo');
    const none = el('option', null, 'Pick a repo');
    none.value = '';
    select.appendChild(none);
    for (const r of store.state.repos) {
      const o = el('option', null, r.name);
      o.value = r.path;
      select.appendChild(o);
    }
    const add = el('option', null, 'Add another repo…');
    add.value = ADD;
    select.appendChild(add);
    const only = store.state.repos.length === 1 ? store.state.repos[0]!.path : null;
    const current = repoFor.get(key) ?? suggested ?? only ?? '';
    select.value = store.state.repos.some((r) => r.path === current) ? current : '';
    if (select.value) repoFor.set(key, select.value);
    row.append(el('span', 'm', 'Repo'), select);
    into.appendChild(row);

    const adding = el('div', 'guide-stack guide-add-repo');
    adding.hidden = true;
    into.appendChild(adding);
    select.addEventListener('change', () => {
      if (select.value === ADD) {
        select.value = repoFor.get(key) ?? '';
        if (!adding.hidden) return;
        adding.hidden = false;
        codePicker(adding, (path) => {
          repoFor.set(key, path);
          drawList();
        });
        return;
      }
      if (select.value) repoFor.set(key, select.value);
      else repoFor.delete(key);
    });
  };

  /** The hire button and what it says when something is missing. */
  const hireRow = (into: HTMLElement, hire: (say: (text: string, bad?: boolean) => void, go: HTMLButtonElement) => void): void => {
    const row = el('div', 'actions');
    const go = button(row, 'Hire your first worker', () => hire(say, go), 'btn small primary');
    into.appendChild(row);
    const say = note(into);
  };

  /** Hands the first task to a worker, then follows the worker. */
  const startHire = (
    req: Parameters<typeof api.hire>[0],
    say: (text: string, bad?: boolean) => void,
    go: HTMLButtonElement,
  ): void => {
    go.disabled = true;
    say('Hiring…');
    hiringFrom = new Set(store.state.agents.map((a) => a.id));
    // The card starts empty if it is opened again from Settings.
    task = '';
    picked = null;
    api
      .hire(req)
      .then((agent) => {
        // The chat is not opened here: it would sit under the card. The card's button opens it and ends the first day.
        hiringFrom = null;
        if (store.state.onboarding.tourDismissed) return;
        hiredId = agent.id;
        draw();
      })
      .catch((err) => {
        hiringFrom = null;
        say((err as Error).message, true);
        go.disabled = false;
      });
  };

  /** Step 3 with a ticket system connected: search, a list, the repo, and Hire. */
  const ticketStep = (into: HTMLElement): void => {
    const input = el('input', 'ask-path guide-search');
    input.type = 'search';
    input.placeholder = 'Search tickets by key or title';
    input.setAttribute('aria-label', 'Search tickets');
    input.value = search;
    input.addEventListener('input', () => {
      search = input.value;
      found = [];
      searchErrors = [];
      window.clearTimeout(searchTimer);
      const q = search.trim();
      searching = q.length >= 2;
      drawList();
      if (!searching) return;
      const seq = ++searchSeq;
      searchTimer = window.setTimeout(() => {
        api
          .searchTickets(q)
          .then(({ tickets, errors }) => {
            if (seq !== searchSeq) return;
            found = tickets;
            searchErrors = errors ?? [];
          })
          .catch((err) => {
            if (seq === searchSeq) searchErrors = [(err as Error).message];
          })
          .finally(() => {
            if (seq !== searchSeq) return;
            searching = false;
            drawList();
          });
      }, 300);
    });
    into.appendChild(searchClear(input));
    listHost = el('div', 'guide-stack');
    into.appendChild(listHost);
    drawList();
  };

  /** The ticket list, the picked ticket's repo, and Hire: redrawn on its own as a search is typed. */
  const drawList = (): void => {
    if (!listHost) return;
    const host = listHost;
    clear(host);
    const board = store.state.tickets;
    const { heading, tickets } = ticketsToShow(board, found, search);
    host.appendChild(el('span', 'm', searching ? `${heading} · searching…` : heading));
    for (const error of searchErrors) host.appendChild(el('span', 'guide-hint', error));
    if (!tickets.length) {
      host.appendChild(
        el(
          'span',
          'guide-hint ok',
          search.trim()
            ? searching ? 'Looking…' : 'No open tickets match. Try other words, or a ticket key.'
            : 'Nothing is assigned to you. Search for any ticket above.',
        ),
      );
      return;
    }
    const list = el('div', 'guide-tickets');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', heading);
    if (picked && !tickets.some((t) => t.key === picked)) picked = null;
    for (const t of tickets.slice(0, LIST_LIMIT)) {
      const row = el('label', 'guide-ticket');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'guide-ticket';
      radio.checked = t.key === picked;
      radio.addEventListener('change', () => {
        picked = t.key;
        drawList();
      });
      row.append(
        radio,
        el('span', 'guide-ticket-key', displayKey(t.key)),
        el('span', 'guide-ticket-title', t.summary),
        el('span', 'm', t.assignedToMe ? 'You' : (t.assignees[0] ?? 'Unassigned')),
      );
      list.appendChild(row);
    }
    host.appendChild(list);
    if (tickets.length > LIST_LIMIT) host.appendChild(el('span', 'guide-hint ok', `Showing ${LIST_LIMIT} of ${tickets.length}. Search to narrow it down.`));

    const ticket = tickets.find((t) => t.key === picked);
    if (!ticket) return;
    repoPicker(host, ticket.key, ticket.repo);
    hireRow(host, (say, go) => {
      const repo = repoFor.get(ticket.key);
      if (!repo) {
        say(`Pick a repo for ${displayKey(ticket.key)} first.`, true);
        return;
      }
      startHire({ ticketKey: ticket.key, repo }, say, go);
    });
  };

  /** Step 3 without a ticket: what to do, in a sentence or two. */
  const describeStep = (into: HTMLElement): void => {
    const text = el('textarea', 'ask-input');
    text.rows = 3;
    text.placeholder = 'Fix the flaky login test';
    text.setAttribute('aria-label', 'What should the worker do?');
    text.value = task;
    text.addEventListener('input', () => (task = text.value));
    into.appendChild(text);
    repoPicker(into, '', null);
    hireRow(into, (say, go) => {
      if (!task.trim()) {
        say('Say what the worker should do first.', true);
        return;
      }
      const repo = repoFor.get('');
      if (!repo) {
        say('Pick a repo first.', true);
        return;
      }
      startHire({ task: task.trim(), repo }, say, go);
    });
  };

  /** One step of the card: its title, and its controls while it is the one to do. */
  const step = (n: number, id: QuestId, state: StepState, doneText: string, body: (into: HTMLElement) => void): HTMLElement => {
    const quest = QUESTS.find((q) => q.id === id)!;
    const section = el('section', `guide-step ${state}`);
    const head = el('div', 'guide-step-head');
    const num = head.appendChild(el('span', 'guide-step-num', state === 'done' ? '' : String(n)));
    if (state === 'done') num.innerHTML = iconSvg(TEXT_ICONS.check, 'guide-step-check');
    head.appendChild(el('b', null, state === 'done' ? doneText : quest.title));
    section.appendChild(head);
    if (state === 'now') {
      const inner = el('div', 'guide-stack');
      body(inner);
      section.appendChild(inner);
    }
    return section;
  };

  /** The card once the first worker is hired: follow them, then say how to hire more. */
  const afterHire = (): void => {
    const agent = store.state.agents.find((a) => a.id === hiredId);
    const name = agent?.name ?? 'Your worker';
    box.appendChild(el('b', 'guide-title', agent?.status === 'needs_you' ? `${name} needs your OK` : `${name} is on it`));
    box.appendChild(
      el(
        'p',
        'guide-say',
        agent?.status === 'needs_you'
          ? 'Answer in their chat to let them carry on.'
          : 'When they need your OK, it shows up in their chat.',
      ),
    );
    box.appendChild(el('p', 'guide-say', 'Got more work? Click Hire at the top any time to start another worker. Workers run in parallel.'));
    // One way on: the chat, where every new worker asks before starting. Close in the corner is for looking around first.
    if (!agent) return;
    const actions = el('div', 'actions');
    button(actions, `Open ${agent.name}'s chat`, () => {
      dismiss();
      store.patch({ selectedAgentId: agent.id });
    }, 'btn small primary');
    box.appendChild(actions);
  };

  const draw = (): void => {
    const state = store.state;
    const { onboarding, health, runner } = state;
    const panelOpen = state.settingsOpen || state.ticketPanelOpen || state.workersOpen || state.ideasOpen || state.memoryOpen;
    const hired = hiredId ? state.agents.find((a) => a.id === hiredId) : undefined;
    const showing = state.loaded && !panelOpen && !onboarding.tourDismissed && (hiredId !== null || firstDayShown(onboarding));
    const steps = stepStates({
      agent: agentReady(onboarding, health.runners[runner].status),
      code: state.repos.length > 0,
      hired: false,
    });
    const systems = connectedSystems();
    const key = JSON.stringify([
      showing, steps, onboarding, runner, health.runners[runner], health.tracker.id, health.tracker.status,
      health.tracker.error, systems, signing,
      connecting, connectUrl, connectError, describing, state.repos.length, hiredId, hired?.status, hired?.name,
    ]);
    if (key === drawn) return;
    drawn = key;
    box.hidden = !showing;
    $('openTickets').classList.toggle('guide-pulse', showing && hiredId !== null);
    listHost = null;
    if (!showing) return;
    clear(box);
    box.classList.add('first-day');

    const head = el('div', 'guide-head');
    const pic = el('img', 'guide-pic');
    pic.alt = '';
    const url = portrait(GUIDE_LOOK, 'guide');
    if (url) pic.src = url;
    const who = el('div', 'guide-who');
    who.append(el('b', null, `${store.state.agents.find(a => a.builtInPam)?.name ?? 'Assistant'} · Reception`), el('span', 'm', hiredId ? 'Your first worker is on the way' : 'Three steps to your first worker'));
    head.append(pic, who);
    const skip = el('button', 'guide-skip', hiredId ? 'Close' : "I'll do this later");
    skip.type = 'button';
    skip.title = hiredId ? 'Close this. Their chat is a click on them in the office.' : 'Close this for now. You can open it again in Settings.';
    skip.addEventListener('click', dismiss);
    head.appendChild(skip);
    box.appendChild(head);

    if (hiredId) {
      afterHire();
      return;
    }

    box.appendChild(step(1, 'power', steps.power, `${runnerLabel(runner)} is signed in. Lights on!`, agentStep));
    const repoCount = state.repos.length;
    box.appendChild(step(2, 'code', steps.code, `${repoCount} ${repoCount === 1 ? 'repo' : 'repos'} ready`, codeStep));
    if (steps.code === 'done' && steps.power !== 'now') {
      // More code can always be added, even once some is in.
      const more = el('details', 'guide-terminal guide-more');
      more.appendChild(el('summary', null, 'Add more code'));
      codePicker(more);
      box.lastElementChild?.appendChild(more);
    }
    box.appendChild(
      step(3, 'hire', steps.hire, '', (into) => {
        const pickTicket = (): void => {
          describing = false;
          draw();
        };
        if (describing) {
          describeStep(into);
          const row = el('div', 'actions');
          button(row, 'Pick a ticket instead', pickTicket, 'guide-skip');
          into.appendChild(row);
          return;
        }
        if (systems.length) ticketStep(into);
        else systemPicker(into);
        const row = el('div', 'actions');
        button(row, systems.length ? 'Describe a task instead' : 'No ticket system? Describe a task instead', () => {
          describing = true;
          draw();
        }, 'guide-skip');
        into.appendChild(row);
      }),
    );
  };

  // While a sign-in waits on the browser, look in on it now and then, so one that fails says so.
  window.setInterval(() => {
    if (!signing?.running) return;
    api.signInState().then((s) => {
      if (!s || (s.running && s.note === signing?.note)) return;
      signing = s;
      draw();
    }).catch(() => undefined);
  }, 1500);

  let lastTickets: unknown = null;
  store.subscribe((state) => {
    if (!state.loaded) return;
    // The worker being hired has walked in: follow them now, not when the hire request answers.
    if (hiringFrom && !hiredId) {
      const arrived = state.agents.find((a) => !a.builtInPam && !hiringFrom!.has(a.id));
      if (arrived) {
        hiredId = arrived.id;
        hiringFrom = null;
      }
    }
    // A ticket system that finished connecting is no longer being waited on.
    if (connecting && connectedSystems().length) connecting = null;
    draw();
    // New tickets on the board reach the list without disturbing a search being typed.
    if (state.tickets !== lastTickets) {
      lastTickets = state.tickets;
      drawList();
    }
  });
}
