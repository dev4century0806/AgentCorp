/**
 * Settings → Repos: which GitHub account each repo is worked as, and which
 * one the PR watcher reads its PRs as (ASK-138). Workers push with whatever
 * git on this Mac uses. The watcher reads with the account connected for the
 * repo here, or one gh is signed in as; GitHub Issues, a ticket source, has
 * no part in it. When the watcher has no account that can see a repo,
 * nothing reaches the worker, so the row says so in amber and offers
 * Connect to GitHub.
 */
import type { GitHubAccountCheck, RepoChoice, RepoGitHubAccounts } from '@shared';
import { api } from '../net/client.js';
import { ACTION_ICONS, TEXT_ICONS, actionIcon, el, iconText } from './dom.js';
import { subSetting } from './setting-card.js';

/** What a row's buttons do; the list passes its own, a test its fakes. */
export interface RowActions {
  connect(r: RepoGitHubAccounts, button: HTMLButtonElement): void;
  disconnect(login: string, button: HTMLButtonElement): void;
  remove(r: RepoGitHubAccounts, button: HTMLButtonElement): void;
}

/**
 * The office's repos, loaded once the list is built, each with its GitHub
 * accounts and a button to remove it. Check again asks GitHub afresh.
 * `session` is the office user's sign-in, which GitHub's code exchange
 * needs; `onRepos` hears the office's repos after one is removed.
 */
export function githubAccountsList(
  session: () => Promise<string | null>,
  onRepos: (repos: RepoChoice[]) => void,
): { element: HTMLElement; reload: () => void } {
  const wrap = el('div', 'gh-accounts');
  const recheck = el('button', 'btn small', 'Check again');
  recheck.type = 'button';
  const body = el('div', 'gh-accounts-rows');
  const status = el('span', 'msg-line m', 'Checking GitHub…');
  wrap.append(
    subSetting(
      'Repos and their GitHub accounts',
      'Workers push and open PRs as the first account. The PR watcher reads PR comments, checks and conflicts as the second. GitHub Issues is separate.',
      [recheck],
    ),
    status,
    body,
  );
  const say = (text: string, bad = false) => {
    status.className = bad ? 'msg-line why' : 'msg-line m';
    status.textContent = text;
  };
  const load = (refresh: boolean): Promise<void> => {
    recheck.disabled = true;
    say('Checking GitHub…');
    return api
      .githubAccounts(refresh)
      .then(({ repos }) => {
        say('');
        body.replaceChildren(...githubAccountRows(repos, actions));
      })
      .catch((err) => say((err as Error).message, true))
      .finally(() => (recheck.disabled = false));
  };
  // Back from GitHub's tab: the row shows the account just connected.
  let waiting = false;
  window.addEventListener('focus', () => {
    if (!waiting || !wrap.isConnected) return;
    waiting = false;
    load(false);
  });
  const actions: RowActions = {
    connect: (r, button) => {
      button.disabled = true;
      session()
        .then((jwt) => api.connectRepoGitHub(r.github!, jwt, suggestedLogin(r)))
        .then(({ url }) => {
          window.open(url, '_blank', 'noopener');
          waiting = true;
          say(`Approve AgentCorp in the tab that opened, signed in to GitHub as the account that works ${r.github}. This updates when you come back.`);
        })
        .catch((err) => say((err as Error).message, true))
        .finally(() => (button.disabled = false));
    },
    disconnect: (login, button) => {
      button.disabled = true;
      api
        .disconnectRepoGitHub(login)
        .then(() => load(false))
        .catch((err) => {
          say((err as Error).message, true);
          button.disabled = false;
        });
    },
    remove: (r, button) => {
      button.disabled = true;
      api
        .removeRepo(r.path)
        .then(async ({ repos }) => {
          onRepos(repos);
          // After the list, which clears the line as it loads.
          await load(false);
          say(`Removed ${r.name} from the office. Its folder is still on disk; Add repo brings it back.`);
        })
        .catch((err) => {
          say((err as Error).message, true);
          button.disabled = false;
        });
    },
  };
  recheck.addEventListener('click', () => void load(true));
  void load(false);
  return { element: wrap, reload: () => void load(false) };
}

/** One row per repo. */
export function githubAccountRows(repos: RepoGitHubAccounts[], actions: RowActions): HTMLElement[] {
  if (!repos.length) return [el('span', 'm', 'No repos found yet.')];
  return repos.map((r) => repoRow(r, actions));
}

function repoRow(r: RepoGitHubAccounts, actions: RowActions): HTMLElement {
  const row = el('div', 'gh-account-row');
  // The folder name first: two checkouts of one repo are told apart by it.
  const name = el('span', 'gh-account-repo');
  name.title = r.path;
  name.appendChild(el('span', 'mono', r.name));
  if (r.github && r.github.split('/')[1] !== r.name) name.appendChild(el('span', 'm gh-account-remote', r.github));
  row.appendChild(name);
  const remove = actionIcon(`Remove ${r.name} from the office`, ACTION_ICONS.delete);
  remove.addEventListener('click', () => actions.remove(r, remove));
  if (!r.github || !r.workers) {
    row.append(el('span', 'm', 'No GitHub remote'), remove);
    return row;
  }
  const via = r.workers.via === 'gh' ? 'local gh' : r.workers.alias ? `SSH key via ${r.workers.alias}` : 'SSH key';
  const watcher = r.watcher
    ? account('PR watcher', r.watcher, r.watcher.via === 'connected' ? 'connected' : 'gh')
    : iconText(el('span', 'gh-account bad'), TEXT_ICONS.warning, 'PR watcher: no account');
  row.append(account('Workers', r.workers, via), watcher);

  // Only a definite no, or no account at all: an outage or a used-up rate limit is no reason to warn.
  if (!r.watcher || r.watcher.access === false) {
    const connect = el('button', 'btn small primary', 'Connect to GitHub');
    connect.type = 'button';
    const suggested = suggestedLogin(r);
    connect.title = suggested
      ? `Opens GitHub to sign in, as ${suggested} unless you pick another account.`
      : 'Opens GitHub to sign in as an account that can read this repo.';
    connect.addEventListener('click', () => actions.connect(r, connect));
    row.appendChild(connect);
  }
  if (r.watcher?.via === 'connected' && r.watcher.login) {
    const login = r.watcher.login;
    const disconnect = el('button', 'btn small', 'Disconnect');
    disconnect.type = 'button';
    disconnect.title = `Forgets ${login} on this Mac, for every repo that uses it.`;
    disconnect.addEventListener('click', () => actions.disconnect(login, disconnect));
    row.appendChild(disconnect);
  }
  row.appendChild(remove);
  if (!r.watcher) {
    row.appendChild(warning("No GitHub account here can read this repo's PRs, so PR comments, checks and conflicts won't reach workers. Connect to GitHub as one that can."));
  } else if (r.watcher.access === false) {
    const who = r.watcher.login ? ` as ${r.watcher.login}` : '';
    row.appendChild(warning(`The PR watcher can't read this repo${who}, so PR comments, checks and conflicts won't reach workers. Connect to GitHub as an account that can.`));
  }
  return row;
}

/** The workers' login, for GitHub's sign-in page to suggest, unless it is the one that cannot read the repo. */
export function suggestedLogin(r: RepoGitHubAccounts): string | null {
  return r.workers?.access ? r.workers.login : null;
}

function account(role: string, check: GitHubAccountCheck, via: string): HTMLElement {
  const state = check.access === null ? 'unknown' : check.access ? 'ok' : 'bad';
  const login = check.login ?? 'unknown account';
  const notes = [via, check.access === null ? "couldn't check" : null].filter(Boolean).join(', ');
  const line = iconText(el('span', `gh-account ${state}`), check.access ? TEXT_ICONS.check : TEXT_ICONS.warning, `${role}: ${login} (${notes})`);
  line.title =
    check.access === null
      ? "GitHub didn't answer, so whether this account can read the repo is unknown. Check again in a minute."
      : check.access ? `${login} can read this repo.` : `${login} can't read this repo.`;
  return line;
}

function warning(text: string): HTMLElement {
  return iconText(el('span', 'gh-account-warning'), TEXT_ICONS.warning, text);
}
