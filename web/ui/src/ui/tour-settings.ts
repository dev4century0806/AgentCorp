import { api } from '../net/client.js';
import type { Store } from '../state/store.js';
import { el } from './dom.js';
import { settingCard } from './setting-card.js';

/**
 * The onboarding control in Settings: open the first-day setup again.
 */
export function onboardingSection(store: Store): HTMLElement {
  const restart = el('button', 'btn small primary', 'Show the first-day setup');
  restart.type = 'button';
  restart.addEventListener('click', () => {
    api.restartTour()
      .then((next) => store.patch({ settingsOpen: false, onboarding: next }))
      .catch((err) => store.patch({ lastError: (err as Error).message }));
  });
  return settingCard(
    'Onboarding',
    'Connect a coding agent, add a repository and start your first worker.',
    [restart],
  );
}
