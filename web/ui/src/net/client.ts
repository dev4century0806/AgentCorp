import type {
  Agent,
  AttachmentUpload,
  Editor,
  GeneralAgentInfo,
  HintId,
  HireRequest,
  Idea,
  IdeaUpdate,
  IssueType,
  McpServersInfo,
  McpSyncInfo,
  Memory,
  MemoryInput,
  MemoryMatch,
  TrackerId,
  TrackerProject,
  TrackerSettings,
  TrackerSettingsUpdate,
  Message,
  MessageStyle,
  NewIdea,
  Nudge,
  Onboarding,
  Persona,
  QuestionAnswers,
  RepoAgentsInfo,
  RepoAgentsSyncInfo,
  RepoChoice,
  RepoGitHubAccounts,
  RepoLookup,
  StandupSummary,
  OfficeDay,
  SyncSummaryInfo,
  RunnerChoice,
  RunnerMode,
  ServerEvent,
  Settings,
  Snapshot,
  SyncMatrixInfo,
  WorkerLook,
  WorkerSetup,
  QuestId,
  DesignerLogEntry,
  OfficeGeneration,
  OfficeRecord,
  OfficeSummary,
  OfficeDetails,
  SuggestDetailsRequest,
  GenerateOfficeRequest,
  InstallOfficeRequest,
  VoiceModel,
  VoiceRewrite,
  VoiceSettings,
  VoiceSettingsUpdate,
  VoiceTranscript,
} from '@shared';

/** A Claude Code sign-in started from the office. */
export interface SignInState {
  running: boolean;
  url: string | null;
  error: string | null;
  /** What the sign-in said after a code was pasted, such as that it was wrong. */
  note: string | null;
  command: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      // Claimed only when there is a body to describe. Fastify rejects a
      // bodyless request that says it carries JSON, which is how the first
      // DELETE through here came back 400.
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
    // The session cookie, when Fastify served the page.
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status line.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function toUpload(file: File): Promise<AttachmentUpload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        name: file.name || `pasted-${Date.now()}.${file.type.split('/')[1] ?? 'bin'}`,
        mimeType: file.type,
        data: url.slice(url.indexOf(',') + 1),
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** Where one of an idea's saved files opens. */
export function ideaFileUrl(id: number, file: string): string {
  return `/api/ideas/${id}/files/${encodeURIComponent(file)}`;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
  assistant: () => call<{ name: string; named: boolean }>('/api/assistant'),
  nameAssistant: (name: string) => call<{ name: string; named: boolean }>('/api/assistant', { method: 'PUT', body: JSON.stringify({ name }) }),
  selectAccount: (userId: string) => post<{ ok: true }>('/api/account', { userId }),
  state: () => call<Snapshot>('/api/state'),
  diagnostics: () => call<{ report: string }>('/api/diagnostics'),
  /** the assistant's morning standup: what happened since the given timestamp. */
  standup: (since: string) => call<StandupSummary>(`/api/standup?since=${encodeURIComponent(since)}`),
  /** The office's moments between two times, for the day's timelapse; ticket titles only when asked for. */
  day: (from: string, to: string, titles: boolean) =>
    call<OfficeDay>(`/api/day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${titles ? '&titles=1' : ''}`),
  /** The day's clip is ready: the assistant says so. */
  dayReady: () => post<{ ok: boolean }>('/api/day/ready'),
  /** Repos the office can work in. `refresh` rescans the disk. */
  repos: (refresh = false) => call<{ repos: RepoChoice[] }>(`/api/repos${refresh ? '?refresh=1' : ''}`),
  /** Which GitHub account works each repo and which one watches its PRs. */
  githubAccounts: (refresh = false) => call<{ repos: RepoGitHubAccounts[] }>(`/api/repos/github-accounts${refresh ? '?refresh=1' : ''}`),
  /** GitHub's consent page for reading one repo's PRs, suggesting `login`. Apart from GitHub Issues. */
  connectRepoGitHub: (repo: string, session: string | null, login: string | null) =>
    post<{ url: string }>('/api/repos/github/connect', { repo, session, login }),
  /** Forgets a connected account for every repo that used it. */
  disconnectRepoGitHub: (login: string) => call<{ ok: true }>(`/api/repos/github/${encodeURIComponent(login)}`, { method: 'DELETE' }),
  refreshTickets: () => post<{ tickets: Snapshot['tickets']; health: Snapshot['health'] }>('/api/tickets/refresh'),
  /** Open tickets matching a key or words in the connected trackers, whoever they are assigned to. */
  searchTickets: (q: string) =>
    call<{ tickets: Snapshot['tickets']; errors: string[] }>(`/api/tickets/search?q=${encodeURIComponent(q)}`),
  hire: (req: HireRequest) => post<Agent>('/api/agents', req),
  send: (
    id: string,
    text: string,
    attachments: AttachmentUpload[] = [],
    atMentions: Array<{ workerId: string; workerName: string }> = [],
  ) =>
    post<{ ok: true }>(`/api/agents/${id}/messages`, {
      text,
      ...(attachments.length ? { attachments } : {}),
      ...(atMentions.length ? { atMentions } : {}),
    }),
  permission: (id: string, requestId: string, allow: boolean, scope: 'once' | 'always' = 'once') =>
    post<{ ok: true }>(`/api/agents/${id}/permission`, { requestId, allow, scope }),
  question: (id: string, requestId: string, answers: QuestionAnswers | null) =>
    post<{ ok: true }>(`/api/agents/${id}/question`, { requestId, answers }),
  /** Takes back a standing approval, so the next matching request asks again. */
  revokeGrant: (id: string, grantId: number) =>
    call<{ ok: true }>(`/api/agents/${id}/grants/${grantId}`, { method: 'DELETE' }),
  addIdea: (idea: NewIdea) => post<Idea>('/api/ideas', idea),
  issueTypes: (project: string) =>
    call<{ issueTypes: IssueType[] }>(`/api/tracker/projects/${encodeURIComponent(project)}/issue-types`),
  shapeIdea: (id: number, repo: string | null) => post<Idea>(`/api/ideas/${id}/shape`, { repo }),
  createTicket: (id: number, project: string, issueType: string, startWork = false) =>
    post<Idea>(`/api/ideas/${id}/ticket`, { project, issueType, ...(startWork ? { startWork } : {}) }),
  markIdeaReady: (id: number) => post<Idea>(`/api/ideas/${id}/ready`),
  startIdeaWork: (id: number) => post<Idea>(`/api/ideas/${id}/start-work`),
  updateIdea: (id: number, patch: IdeaUpdate) =>
    call<Idea>(`/api/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  saveLook: (id: string, look: Partial<WorkerLook>) =>
    call<Agent>(`/api/agents/${id}/look`, { method: 'PUT', body: JSON.stringify(look) }),
  saveSetup: (id: string, setup: Partial<WorkerSetup>) =>
    call<Agent>(`/api/agents/${id}/setup`, { method: 'PUT', body: JSON.stringify(setup) }),
  /** Switches a worker's runner engine. Only allowed when not mid-turn. */
  switchRunner: (id: string, runnerMode: RunnerMode) =>
    call<Agent>(`/api/agents/${id}/runner`, { method: 'PUT', body: JSON.stringify({ runnerMode }) }),
  /** `primary` null for no repo, left out to keep it; `extra` the repos read beside it. */
  setRepos: (id: string, repos: { primary?: string | null; extra: string[] }) =>
    call<Agent>(`/api/agents/${id}/repos`, { method: 'PUT', body: JSON.stringify(repos) }),
  savePersonas: (personas: Persona[]) =>
    call<{ personas: Persona[] }>('/api/settings/personas', { method: 'PUT', body: JSON.stringify({ personas }) }),
  saveWorkerDefaults: (setup: Partial<WorkerSetup>) =>
    call<WorkerSetup>('/api/settings/worker-defaults', { method: 'PUT', body: JSON.stringify(setup) }),
  rename: (id: string, name: string) =>
    call<Agent>(`/api/agents/${id}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),
  stop: (id: string) => post<{ ok: true }>(`/api/agents/${id}/stop`),
  /** Checks whether a quiet worker's CLI is still there, and what it is up to. */
  nudge: (id: string) => post<Nudge>(`/api/agents/${id}/nudge`),
  /** A fresh session: the worker keeps its desk and remembers none of this. */
  newConversation: (id: string) => post<{ ok: true }>(`/api/agents/${id}/conversations`),
  openConversation: (id: string, cid: number) =>
    post<{ ok: true }>(`/api/agents/${id}/conversations/${cid}/open`),
  /** A chat as it was saved, including one belonging to a previous worker. */
  conversationMessages: (id: string, cid: number) =>
    call<{ messages: Message[] }>(`/api/agents/${id}/conversations/${cid}/messages`),
  /** Sends the worker home. Nothing is written back to 8090. */
  fire: (id: string, removeWorktree: boolean) =>
    post<{ ok: true }>(`/api/agents/${id}/fire`, { removeWorktree }),
  /** Brings a previous worker back with the same name, look, setup and chats. */
  rehire: (id: string) => post<Agent>(`/api/agents/${id}/rehire`),
  resume: (id: string) => post<{ ok: true }>(`/api/agents/${id}/resume`),
  /** Starts an idle worker's session so it lists its `/` commands. Nothing is sent to it. */
  warm: (id: string) => post<{ ok: true }>(`/api/agents/${id}/warm`),
  startWork: (id: string, approve: boolean) => post<{ ok: true }>(`/api/agents/${id}/start`, { approve }),
  done: (id: string) => post<{ ok: true }>(`/api/agents/${id}/done`),
  requestReview: (id: string) => post<{ ok: true; reviewerId: string | null }>(`/api/agents/${id}/request-review`),
  dismissReviewer: (id: string, outcome: 'approved' | 'dismissed') =>
    post<{ ok: true }>(`/api/agents/${id}/dismiss-reviewer`, { outcome }),
  settings: () => call<Settings>('/api/settings'),
  saveRunner: (mode: RunnerChoice) =>
    call<{ mode: RunnerChoice; enabledRunners: RunnerChoice[] }>('/api/settings/runner', { method: 'PUT', body: JSON.stringify({ mode }) }),
  setRunnerEnabled: (id: RunnerChoice, enabled: boolean) =>
    call<{ runner: RunnerChoice; enabledRunners: RunnerChoice[] }>(`/api/settings/runners/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  checkRunner: (id: RunnerChoice) => post<{ checking: RunnerChoice }>(`/api/runners/${id}/check`),
  saveEditor: (editor: Editor) =>
    call<{ editor: Editor }>('/api/settings/editor', { method: 'PUT', body: JSON.stringify({ editor }) }),
  /** Auto mode. Turning it on also approves whatever is already waiting. */
  saveMessageStyle: (style: MessageStyle) =>
    call<{ style: MessageStyle }>('/api/settings/message-style', { method: 'PUT', body: JSON.stringify({ style }) }),
  saveAutoApprove: (enabled: boolean) =>
    call<{ enabled: boolean }>('/api/settings/auto-approve', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  saveAutoReview: (enabled: boolean) =>
    call<{ enabled: boolean }>('/api/settings/auto-review', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  savePrFooter: (enabled: boolean) =>
    call<{ enabled: boolean }>('/api/settings/pr-footer', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  /** Voice input: the account's switches, and the Mac's speech model. Progress comes as `voice` events. */
  saveVoice: (update: VoiceSettingsUpdate) =>
    call<VoiceSettings>('/api/settings/voice', { method: 'PUT', body: JSON.stringify(update) }),
  downloadVoiceModel: () => call<VoiceModel>('/api/voice/model/download', { method: 'POST' }),
  cancelVoiceModel: () => call<VoiceModel>('/api/voice/model/cancel', { method: 'POST' }),
  deleteVoiceModel: () => call<VoiceModel>('/api/voice/model', { method: 'DELETE' }),
  /** Key-down: the clean-up's session boots while the user speaks. */
  warmVoice: (clip: string) => call<{ ok: true }>('/api/voice/warm', { method: 'POST', body: JSON.stringify({ clip }) }),
  cancelVoice: (clip: string) => call<{ ok: true }>('/api/voice/cancel', { method: 'POST', body: JSON.stringify({ clip }) }),
  /** 16 kHz mono samples in, the transcript out. */
  transcribe: (clip: string, samples: Float32Array) =>
    call<VoiceTranscript>(`/api/voice/transcribe?clip=${encodeURIComponent(clip)}`, {
      method: 'POST',
      body: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer,
      headers: { 'content-type': 'application/octet-stream' },
    }),
  rewriteVoice: (clip: string, raw: string) =>
    call<VoiceRewrite>('/api/voice/rewrite', { method: 'POST', body: JSON.stringify({ clip, raw }) }),
  /** Signing Claude Code in from the office: its sign-in page opens in the browser. */
  signInState: () => call<SignInState>('/api/agent-cli/sign-in'),
  startSignIn: () => post<SignInState>('/api/agent-cli/sign-in'),
  sendSignInCode: (code: string) => post<SignInState>('/api/agent-cli/sign-in/code', { code }),
  cancelSignIn: () => call<{ ok: true }>('/api/agent-cli/sign-in', { method: 'DELETE' }),
  /** Looks again at the first-day quests, asking the agent CLI afresh. */
  checkQuests: () => post<Onboarding>('/api/onboarding/check'),
  skipQuest: (id: QuestId) => post<Onboarding>(`/api/onboarding/skip/${encodeURIComponent(id)}`),
  /** Opens the Mac's own folder picker; `path` is null if it was cancelled. */
  chooseFolder: (prompt: string) => post<{ path: string | null }>('/api/folders/choose', { prompt }),
  /** Folders in the home folder that hold git repos, for the guide to offer. */
  codeFolders: () => call<{ folders: Array<{ path: string; label: string; repos: number }> }>('/api/onboarding/code-folders'),
  setTourDismissed: (dismissed: boolean) =>
    call<Onboarding>('/api/onboarding/tour', { method: 'PUT', body: JSON.stringify({ dismissed }) }),
  restartTour: () => post<Onboarding>('/api/onboarding/restart'),
  /** Claims the one-time reward after the private referral answer is saved. */
  completeReferral: () => post<{ awarded: boolean }>('/api/onboarding/referral'),
  /** Marks a one-time hint as seen. */
  markHintSeen: (id: HintId) => post<Onboarding>(`/api/onboarding/hints/${encodeURIComponent(id)}`),
  /** Switches the office to another tracker. */
  saveTracker: (active: TrackerId) =>
    call<{ active: TrackerId }>('/api/settings/tracker', { method: 'PUT', body: JSON.stringify({ active }) }),
  saveTrackerSettings: (id: TrackerId, patch: TrackerSettingsUpdate) =>
    call<TrackerSettings>(`/api/settings/trackers/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  trackerProjects: (id: TrackerId, q: string) =>
    call<{ projects: TrackerProject[] }>(`/api/trackers/${id}/projects?q=${encodeURIComponent(q)}`),
  saveRepoRoots: (roots: string[], cloneInto?: string | null) =>
    call<{ roots: string[]; cloneInto: string; repos: RepoChoice[] }>('/api/settings/repos', {
      method: 'PUT',
      body: JSON.stringify({ roots, ...(cloneInto !== undefined ? { cloneInto } : {}) }),
    }),
  lookupRepo: (q: string) => call<RepoLookup>(`/api/repos/lookup?q=${encodeURIComponent(q)}`),
  cloneRepo: (repo: string) => post<{ repo: RepoChoice; repos: RepoChoice[] }>('/api/repos/clone', { repo }),
  /** Adds a repo already on this Mac to the office's repos. */
  addRepo: (path: string) => post<{ repo: RepoChoice; repos: RepoChoice[] }>('/api/repos/add', { path }),
  /** Takes a repo out of the office's list; its folder stays on disk. */
  removeRepo: (path: string) => post<{ repos: RepoChoice[] }>('/api/repos/remove', { path }),
  saveFactory: (enabled: boolean) =>
    call<{ enabled: boolean }>('/api/settings/factory', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  /** `session` is the office sign-in's access token, which GitHub's code exchange needs. */
  connectTracker: (id: TrackerId, session: string | null) =>
    post<{ url: string | null }>(`/api/trackers/${id}/connect`, { session }),
  disconnectTracker: (id: TrackerId) => call<{ ok: true }>(`/api/trackers/${id}`, { method: 'DELETE' }),
  connectFactory: () => post<{ url: string | null }>('/api/sources/8090/connect'),
  disconnectFactory: () => call<{ ok: true }>('/api/sources/8090', { method: 'DELETE' }),
  /** Launches the IDE picked in Settings on the agent's worktree. */
  open: (id: string) => post<{ command: string; path: string }>(`/api/agents/${id}/open`),

  /* ---------- Skills Library ---------- */
  skills: (repo?: string) =>
    call<SyncMatrixInfo>(`/api/skills${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`),
  skillsSync: () => post<{ summary: SyncSummaryInfo; agents: RepoAgentsSyncInfo[]; mcp: McpSyncInfo[] }>('/api/skills/sync'),
  skillsSyncRepo: (repo: string) =>
    post<{ summary: SyncSummaryInfo; agents: RepoAgentsSyncInfo[]; mcp: McpSyncInfo[] }>(`/api/skills/sync/${encodeURIComponent(repo)}`),
  mcpServers: (repo: string | null) => call<McpServersInfo>(`/api/user-mcp${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`),
  mcpServerSet: (key: string, patch: { on?: boolean; askFirst?: boolean }) =>
    call<{ ok: true }>('/api/user-mcp', { method: 'PUT', body: JSON.stringify({ key, ...patch }) }),
  repoAgents: (repo: string) => call<RepoAgentsInfo>(`/api/repo-agents/${encodeURIComponent(repo)}`),
  repoAgentHide: (repo: string, id: string, hidden: boolean) =>
    call<{ ok: true }>(`/api/repo-agents/${encodeURIComponent(repo)}/${encodeURIComponent(id)}/hidden`, { method: 'PUT', body: JSON.stringify({ hidden }) }),
  repoAgentCopy: (repo: string, id: string) =>
    post<{ persona: Persona }>(`/api/repo-agents/${encodeURIComponent(repo)}/${encodeURIComponent(id)}/copy`),
  generalAgents: () => call<{ agents: GeneralAgentInfo[] }>('/api/general-agents'),
  generalAgentTool: (personaId: string, toolId: string, on: boolean) =>
    call<{ agents: GeneralAgentInfo[] }>(
      `/api/general-agents/${encodeURIComponent(personaId)}/tools/${encodeURIComponent(toolId)}`,
      { method: 'PUT', body: JSON.stringify({ on }) },
    ),
  skillsGet: (id: string, repo?: string) =>
    call<{
      id: string;
      name: string;
      description: string;
      scope: 'global' | 'repo';
      repo: string | null;
      content: string;
      /** SKILL.md without its frontmatter: the instructions themselves. */
      body: string;
      files: string[];
      fromRepo: boolean;
      required: boolean;
      onlyWhenAsked: boolean;
      modifiedAt: string;
    }>(`/api/skills/${encodeURIComponent(id)}${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`),
  skillsCreate: (id: string, name: string, description: string, scope: 'global' | 'repo', repo?: string, instructions?: string) =>
    post<{ skill: unknown }>('/api/skills', { id, name, description, scope, repo, instructions }),
  skillsUpdate: (id: string, scope: 'global' | 'repo', repo: string | undefined, updates: { name?: string; description?: string; content?: string }) =>
    call<{ skill: unknown }>(`/api/skills/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ...updates, scope, repo }) }),
  skillsSetRepos: (paths: string[]) =>
    call<{ libraryRepos: string[] }>('/api/skills/repos', { method: 'PUT', body: JSON.stringify({ paths }) }),
  skillsDelete: (id: string, scope: 'global' | 'repo', repo?: string) =>
    call<{ ok: true }>(`/api/skills/${encodeURIComponent(id)}?scope=${scope}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`, { method: 'DELETE' }),
  /** Turns a tool on for a skill; a repo skill names its repo. */
  skillsLink: (skillId: string, toolId: string, repo?: string) =>
    post<{ ok: true }>(`/api/skills/${encodeURIComponent(skillId)}/link/${encodeURIComponent(toolId)}${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`),
  skillsUnlink: (skillId: string, toolId: string, repo?: string) =>
    call<{ ok: true }>(`/api/skills/${encodeURIComponent(skillId)}/link/${encodeURIComponent(toolId)}${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`, { method: 'DELETE' }),
  skillsAdopt: (toolId: string, skillId: string, scope: 'global' | 'repo', repo: string | null) =>
    post<{ skill: unknown }>(`/api/skills/adopt/${encodeURIComponent(toolId)}/${encodeURIComponent(skillId)}`, { scope, repo }),
  skillsEdit: (skillId: string, edit: { id: string; description: string; instructions: string; repo?: string }) =>
    post<{ skill: { id: string } }>(`/api/skills/${encodeURIComponent(skillId)}/edit`, edit),
  skillsSettings: (skillId: string, settings: { required?: boolean; onlyWhenAsked?: boolean; repo?: string }) =>
    call<{ skill: unknown }>(`/api/skills/${encodeURIComponent(skillId)}/settings`, { method: 'PUT', body: JSON.stringify(settings) }),
  skillsHealth: () =>
    call<{
      brokenLinks: Array<{ skillId: string; toolId: string }>;
      conflicts: Array<{ skillId: string; toolId: string }>;
      invalidFrontmatter: Array<{ skillId: string; error: string }>;
      missingTools: string[];
    }>('/api/skills/health'),
  skillsHealthFixLink: (skillId: string, toolId: string) =>
    post<{ ok: true }>(`/api/skills/health/fix-link/${encodeURIComponent(skillId)}/${encodeURIComponent(toolId)}`),
  /** Moves a tool's own copy of a skill aside to `<name>-backup` and links the library's in its place. */
  skillsHealthUseLibrary: (skillId: string, toolId: string) =>
    post<{ ok: true }>(`/api/skills/health/fix-conflict/${encodeURIComponent(skillId)}/${encodeURIComponent(toolId)}`, { action: 'rename' }),

  /* ---------- Office Memory ---------- */
  memories: (repo: string) => call<{ memories: Memory[] }>(`/api/memories?repo=${encodeURIComponent(repo)}`),
  memorySearch: (repo: string, query: string) =>
    call<{ matches: MemoryMatch[] }>(`/api/memories/search?repo=${encodeURIComponent(repo)}&query=${encodeURIComponent(query)}`),
  memoryCreate: (repo: string, input: MemoryInput) => post<{ memory: Memory }>('/api/memories', { repo, ...input }),
  memoryUpdate: (id: number, input: MemoryInput) =>
    call<{ memory: Memory }>(`/api/memories/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  memoryDelete: (id: number) => call<{ ok: true }>(`/api/memories/${id}`, { method: 'DELETE' }),
  /** Clears the New badge on these lessons. */
  memoriesSeen: (ids: number[]) => post<{ ok: true }>('/api/memories/seen', { ids }),
  /** The repo's memories as a Markdown file. */
  memoryExport: async (repo: string): Promise<Blob> => {
    const res = await fetch(`/api/memories/export?repo=${encodeURIComponent(repo)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.blob();
  },

  /* Generated offices (issue #157). */
  offices: () => call<{ offices: OfficeSummary[]; generations: OfficeGeneration[] }>('/api/offices'),
  office: (id: string) => call<OfficeRecord>(`/api/offices/${encodeURIComponent(id)}`),
  officeThumbnailUrl: (id: string, version = '') => `/api/offices/${encodeURIComponent(id)}/thumbnail${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  /** A PNG data URL, captured from the office's preview render. */
  saveOfficeThumbnail: (id: string, dataUrl: string) =>
    call<{ ok: true }>(`/api/offices/${encodeURIComponent(id)}/thumbnail`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),
  deleteOffice: (id: string) => call<{ ok: true }>(`/api/offices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  suggestOfficeDetails: (req: SuggestDetailsRequest) => post<{ details: OfficeDetails }>('/api/offices/details', req),
  generateOffice: (req: GenerateOfficeRequest) => post<{ generation: OfficeGeneration }>('/api/offices/generate', req),
  cancelOfficeGeneration: (id: string) => call<{ ok: true }>(`/api/offices/generations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  officeGenerationLog: (id: string) => call<{ entries: DesignerLogEntry[] }>(`/api/offices/generations/${encodeURIComponent(id)}/log`),
  resumeOfficeGeneration: (id: string) => post<{ generation: OfficeGeneration }>(`/api/offices/generations/${encodeURIComponent(id)}/resume`, {}),
  installOffice: (req: InstallOfficeRequest) => post<{ summary: OfficeSummary }>('/api/offices/install', req),
  /** Records the showcase listing an office was published as, or null once unpublished. */
  markOfficePublished: (id: string, listingId: string | null) =>
    post<{ summary: OfficeSummary }>(`/api/offices/${encodeURIComponent(id)}/published`, { listingId }),
  /* ---------- Obsidian Semantic Memory ---------- */
  obsidianStatus: () => call<{ enabled: boolean; vaultPath: string; count?: number }>('/api/obsidian/status'),
  obsidianSync: (vaultPath?: string) => post<{ ok: boolean; vaultPath: string; filesScanned: number; newChunksIndexed: number; totalNotesInIndex: number }>('/api/obsidian/sync', { vaultPath }),
};

export interface SocketHandlers {
  onEvent: (event: ServerEvent) => void;
  onStatus: (connected: boolean) => void;
  /** A gap in `seq` means events were missed, so refetch the snapshot. */
  onGap: () => void;
}

/** Reconnecting WebSocket client with sequence-gap detection. */
export function connect(handlers: SocketHandlers): void {
  let lastSeq = 0;
  let retry = 500;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener('open', () => {
      retry = 500;
      handlers.onStatus(true);
    });

    ws.addEventListener('message', (ev) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(ev.data)) as ServerEvent;
      } catch {
        return;
      }

      if (event.type === 'snapshot') {
        lastSeq = event.seq;
      } else if (lastSeq && event.seq > lastSeq + 1) {
        lastSeq = event.seq;
        handlers.onGap();
        return;
      } else {
        lastSeq = event.seq;
      }
      handlers.onEvent(event);
    });

    const reopen = () => {
      handlers.onStatus(false);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 10_000);
    };
    ws.addEventListener('close', reopen);
    ws.addEventListener('error', () => ws.close());
  };

  open();
}
