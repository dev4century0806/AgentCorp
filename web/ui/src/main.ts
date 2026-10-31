import { api, connect } from './net/client.js';
import { Store, loadRoom, userOfficeId } from './state/store.js';
import { colourOf, markColour } from './state/colour.js';
import { mountOffice } from './scene/office.js';
import { mountHud } from './ui/hud.js';
import { mountTicketPanel } from './ui/tickets.js';
import { mountToasts } from './ui/toasts.js';
import { mountTooltips } from './ui/tooltip.js';
import { mountWorkerPanel } from './ui/worker.js';
import { mountSettings } from './ui/settings.js';
import { mountIdeasPanel } from './ui/ideas.js';
import { mountWorkersPanel } from './ui/workers.js';
import { mountSound } from './ui/sound.js';
import { mountAssistantWelcome } from './ui/assistant-welcome.js';
import { checkForUpdateBeforeSignIn, mountUpdate } from './ui/update.js';
import { mountViews } from './ui/cards.js';
import { mountOnboarding } from './ui/onboarding.js';
import { requireSignIn, getInboxMessages, getInboxUnreadCount, markMessageRead, deleteInboxMessage, getSharePreview, downloadShare, blockSender } from './ui/auth.js';
import type { SharePackageData, Persona } from '@shared';
import { mountQuitConfirm } from './ui/quit.js';
import { mountMessages } from './ui/messages.js';
import { mountLibrary } from './ui/library.js';
import { mountStandup } from './ui/standup.js';
import { mountMemoryPanel } from './ui/memory.js';
import { mountMemoryIndicator } from './ui/memory-indicator.js';
import { mountOffices } from './ui/offices.js';
import { officeManifest } from './state/offices.js';
import { mountShortcuts } from './ui/shortcuts.js';

const startup = {
  set(progress: number, status: string): void {
    document.getElementById('startupBar')?.style.setProperty('width', `${progress}%`);
    const label = document.getElementById('startupStatus');
    if (label) label.textContent = status;
    const percent = document.getElementById('startupPercent');
    if (percent) percent.textContent = `${progress}%`;
  },
  done(): void {
    this.set(100, 'Ready');
    document.getElementById('startup')?.classList.add('done');
  },
};

// index.html has marked the page before its first paint, from the room kept. From here it follows the room picked.
markColour(colourOf(loadRoom()));

startup.set(12, 'Starting the office…');
mountUpdate();
startup.set(24, 'Checking for updates…');
await checkForUpdateBeforeSignIn();
startup.set(36, 'Checking sign-in…');
await requireSignIn();
startup.set(48, 'Building the office…');

const store = new Store();
// Keep the room colour consistent with the current view.
let colour = colourOf(store.state.room);
store.subscribe((state) => {
  if (colourOf(state.room) === colour) return;
  colour = colourOf(state.room);
  markColour(colour);
});
mountHud();
mountOffice(store);
mountTicketPanel(store);
mountWorkerPanel(store);
mountMemoryIndicator(store);
mountMemoryPanel(store, api);
mountToasts(store);
mountTooltips();
mountSettings(store);
mountShortcuts();
mountWorkersPanel(store);
mountIdeasPanel(store);
mountSound(store);
mountLibrary(store);
mountQuitConfirm();
mountMessages(store, {
  getMessages: getInboxMessages,
  getUnreadCount: getInboxUnreadCount,
  markRead: markMessageRead,
  deleteMessage: deleteInboxMessage,
  getSharePreview,
  downloadShare,
  blockSender,
  saveDownloadedAgent: async (data: SharePackageData): Promise<Persona> => {
    if (!data.persona) throw new Error('Invalid agent package');
    // Save the persona to the office
    const personas = [...store.state.personas, data.persona];
    const result = await api.savePersonas(personas);
    store.patch({ personas: result.personas });
    return result.personas[result.personas.length - 1]!;
  },
  saveDownloadedSkill: async (data: SharePackageData): Promise<void> => {
    if (!data.skill) throw new Error('Invalid skill package');
    // Create the skill in the library
    await api.skillsCreate(
      data.skill.id,
      data.skill.name,
      data.skill.description,
      'global',
      undefined,
      data.skill.instructions
    );
  },
});
mountViews(store);
mountOffices(store);
mountOnboarding(store);
mountStandup(store);
startup.set(78, 'Connecting to the office server…');

// Esc closes the top panel: the worker first, then the hire panel.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // A modal dialog owns Esc. When its focused button was just disabled, focus is on the page and the key lands here,
  // which would close the panel behind the dialog along with it.
  if (document.querySelector('dialog[open]')) return;
  else if (store.state.settingsOpen) store.patch({ settingsOpen: false, memoryOpen: false });
  else if (store.state.messagesOpen) store.patch({ messagesOpen: false });
  else if (store.state.selectedAgentId) store.patch({ selectedAgentId: null, lastError: null });
  else if (store.state.workersOpen) store.patch({ workersOpen: false });
  else if (store.state.ideasOpen) store.patch({ ideasOpen: false });
  else if (store.state.ticketPanelOpen) store.patch({ ticketPanelOpen: false });
});

// Number keys select workers by desk order.
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
  if (!/^[1-9]$/.test(e.key)) return;
  const index = Number(e.key) - 1;
  const agent = store.agentsByDesk()[index];
  if (agent) store.selectAgent(agent.id);
});

async function refetch(): Promise<void> {
  try {
    store.applySnapshot(await api.state());
  } catch (err) {
    store.patch({ connected: false, lastError: (err as Error).message });
  }
}


connect({
  onEvent: (event) => store.apply(event),
  onStatus: (connected) => store.patch({ connected }),
  onGap: () => void refetch(),
});

// First paint comes from REST so the board is there before the socket settles.
startup.set(88, 'Loading workers and tickets…');
await refetch();
// The generated offices, and the manifest of the one the room is set to, so the first frame the user sees is that room.
await store.loadOffices();
const chosenOffice = userOfficeId(store.state.room);
const chosenSummary = chosenOffice ? store.state.offices.find((o) => o.id === chosenOffice) : undefined;
if (chosenOffice && chosenSummary) await officeManifest(chosenOffice, chosenSummary.updatedAt);
// Load the server snapshot before sending the startup batch. Otherwise a
startup.done();
mountAssistantWelcome(store);

// Repos change when Tom clones something, not when an agent does anything, so
// they are fetched once rather than carried on the event stream.
void store.loadRepos();
