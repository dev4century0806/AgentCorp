const DEFAULT_PORT = 4317;
const STREAM_LOG_LIMIT = 2e3;
const BUILT_IN_PAM_ID = "built-in-pam";
const SUPABASE_URL = "http://127.0.0.1:4317/api/supabase";
const SUPABASE_PUBLISHABLE_KEY = "ac_local_auth_key";
const HANDOFF_HEADINGS = ["Handoff from ", "Recap of the last chat with "];
function isHandoffNote(message) {
  return message.role === "brief" && HANDOFF_HEADINGS.some((h) => message.text.startsWith(h));
}
function runnerLabel(mode) {
  switch (mode) {
    case "acp":
      return "Cursor";
    case "claude":
      return "Claude Code";
    case "copilot":
      return "Copilot";
    case "codex":
      return "Codex";
    case "ollama":
      return "Local AI (Ollama)";
    case "print":
      return "print mode";
  }
}
const RUNNER_CHOICES = ["claude", "acp", "copilot", "codex", "ollama"];
const SIGN_IN = {
  claude: "claude",
  acp: "agent login",
  copilot: "npx @github/copilot login",
  codex: "npx @openai/codex login",
  ollama: "ollama serve"
};
function hireableRunners(enabled, runners) {
  return RUNNER_CHOICES.filter((id) => enabled.includes(id) && runners[id]?.status === "ok");
}
const PERMISSION_LEVELS = [
  { value: "ask", label: "Ask first", hint: "Asks before every edit and command" },
  { value: "standard", label: "Standard", hint: "Edits its own worktree, asks for commands, installs and pushes" },
  { value: "auto", label: "Full auto", hint: "Approves everything itself" }
];
const MODEL_CHOICES = [
  { value: null, label: "Default", hint: "Claude Code's recommended model" },
  { value: "fable", label: "Fable", hint: "Hardest and longest-running tasks" },
  { value: "opus", label: "Opus", hint: "Everyday complex tasks" },
  { value: "sonnet", label: "Sonnet", hint: "Routine tasks, faster" },
  { value: "haiku", label: "Haiku", hint: "Quick, simple tasks. No effort setting" }
];
const EFFORT_CHOICES = [
  { value: null, label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" }
];
const CLAUDE_MODEL_MENU = { models: [...MODEL_CHOICES], efforts: [...EFFORT_CHOICES] };
const NO_EFFORT_MODELS = /* @__PURE__ */ new Set(["haiku"]);
const DEFAULT_LOOK = {
  hair: "crop",
  hat: "none",
  face: "none",
  outfit: "tee",
  shirtColor: null,
  hairColor: null
};
const LOOK_CHOICES = {
  hair: [
    { value: "crop", label: "Crop" },
    { value: "bun", label: "Top bun" },
    { value: "mohawk", label: "Mohawk" },
    { value: "shoulder", label: "Shoulder-length" }
  ],
  hat: [
    { value: "none", label: "None" },
    { value: "cap", label: "Cap" },
    { value: "headphones", label: "Headphones" },
    { value: "headset", label: "Phone headset" },
    { value: "wizard", label: "Wizard hat" },
    { value: "crown", label: "Crown" }
  ],
  face: [
    { value: "none", label: "None" },
    { value: "beard", label: "Beard" }
  ],
  outfit: [
    { value: "tee", label: "T-shirt" },
    { value: "hoodie", label: "Hoodie" },
    { value: "tie", label: "Shirt and tie" },
    { value: "labcoat", label: "Lab coat" },
    { value: "cardigan", label: "Cardigan and blouse" }
  ],
  // The office's own palette (scene/boxkit.ts), so a chosen colour sits
  // among the automatic ones rather than standing out from them.
  shirtColor: [
    { value: null, label: "Automatic" },
    { value: "#4f7fe0", label: "Blue" },
    { value: "#2f8f9a", label: "Teal" },
    { value: "#3e9a5c", label: "Green" },
    { value: "#e0c040", label: "Yellow" },
    { value: "#d98a3d", label: "Orange" },
    { value: "#c8553d", label: "Red" },
    { value: "#b8476e", label: "Pink" },
    { value: "#7a5cc4", label: "Purple" }
  ],
  hairColor: [
    { value: null, label: "Automatic" },
    { value: "#1c1c1c", label: "Black" },
    { value: "#2a1d14", label: "Dark brown" },
    { value: "#5a3a28", label: "Chestnut" },
    { value: "#8a5a3b", label: "Brown" },
    { value: "#b0442a", label: "Auburn" },
    { value: "#c9a15a", label: "Blond" }
  ]
};
function cleanLook(raw) {
  const given = raw && typeof raw === "object" ? raw : {};
  const pick = (key) => LOOK_CHOICES[key].find((c) => c.value === given[key])?.value ?? DEFAULT_LOOK[key];
  return {
    hair: pick("hair"),
    hat: pick("hat"),
    face: pick("face"),
    outfit: pick("outfit"),
    shirtColor: pick("shirtColor"),
    hairColor: pick("hairColor")
  };
}
const PERSONA_DESCRIPTION_MAX = 300;
const WORKER_NAMES = [
  "Ada",
  "Bo",
  "Cy",
  "Dee",
  "Eve",
  "Finn",
  "Gus",
  "Hana",
  "Ivo",
  "Jun",
  "Kai",
  "Lu",
  "Mo",
  "Nia",
  "Oz",
  "Pia",
  "Rex",
  "Sol",
  "Tov",
  "Ula",
  "Vik",
  "Wren",
  "Xan",
  "Yan",
  "Zia"
];
const WORKER_NAME_MAX = 24;
function autoWorkerName(persona, taken, random = Math.random) {
  const used = new Set([...taken].map((n) => (n.split(" - ").pop() ?? n).toLowerCase()));
  const free = WORKER_NAMES.filter((n) => !used.has(n.toLowerCase()));
  const first = free[Math.floor(random() * free.length)] ?? `Worker ${used.size + 1}`;
  return persona ? `${persona} - ${first}` : first;
}
const PERSONA_NAME_MAX = 17;
const IDEA_LANES = [
  { value: "inbox", label: "Inbox" },
  { value: "shaping", label: "Shaping" },
  { value: "ready", label: "Ready" },
  { value: "ticket", label: "Ticketed" }
];
const SHAPING_BRIEF_OPENING = "Talk this idea from the Idea board through with the operator";
const TICKET_FOOTER = "_Drafted with AI assistance (AgentCorp); reviewed by the reporter._";
function draftTemplate(title, notes) {
  return {
    title,
    type: "User Story",
    labels: [],
    priority: null,
    description: [
      "## Summary",
      "",
      notes.trim() || "What to build and why, with routes, related tickets and PRs.",
      "",
      "## Scope",
      "",
      "* **<Part>:** what it does.",
      "",
      "## Acceptance criteria",
      "",
      "* A statement someone can test.",
      "",
      TICKET_FOOTER
    ].join("\n")
  };
}
function agentSetup(a) {
  return { permission: a.permission, model: a.chosenModel, effort: a.effort };
}
function asAgentSetup(s) {
  return { permission: s.permission, chosenModel: s.model, effort: s.effort };
}
const TRACKERS = [
  { id: "github", name: "GitHub Issues", available: true, projectNoun: "repo", issueTypes: false, priorities: [] }
];
function trackerInfo(id) {
  return TRACKERS.find((t) => t.id === id) ?? TRACKERS[0];
}
function trackerName(id) {
  return TRACKERS.find((t) => t.id === id)?.name ?? id;
}
function ticketId(source, key) {
  return `${source}:${key}`;
}
function splitTicketId(id) {
  const m = /^(github|8090):(.+)$/.exec(id);
  return m ? { source: m[1], key: m[2] } : null;
}
function displayKey(id) {
  if (id === "PAM") return "Reception";
  return splitTicketId(id)?.key ?? id;
}
function pathKey(key) {
  return key.replace(/[/#]/g, "-");
}
function projectOf(key) {
  const github = /^(.+)#\d+$/.exec(key);
  return github ? github[1] : key.split("-")[0] ?? key;
}
function waitingOnAgents(count) {
  return `Waiting on ${count} background agent${count === 1 ? "" : "s"}`;
}
const INTER_WORKER_LIMITS = {
  /** Max review rounds before handing to the user. */
  maxReviewRounds: 2,
  /** Max messages per worker per minute. */
  rateLimit: 10,
  /** Max file size for handoffs (same as user uploads). */
  maxFileSize: 10 * 1024 * 1024
};
const TRACKING_EVENTS = [
  "app_installed",
  "app_opened",
  "sign_in_completed",
  "tracker_connected",
  "worker_hired",
  "plan_approved",
  "plan_declined",
  "worker_started",
  "message_sent",
  "permission_answered",
  "work_completed",
  "xp_awarded",
  "worker_fired",
  "worker_errored",
  "resume",
  "limit_reached",
  "quit_with_workers_running",
  "idea_created",
  "idea_shaped",
  "idea_ticketed",
  "office_style_changed",
  "message_style_changed",
  "attachment_sent",
  "ide_opened",
  "rehire",
  "update_checked",
  "update_installed",
  "feedback_sent",
  "pr_opened"
];
const TRACKING_RUNNERS = ["claude", "acp", "copilot", "codex", "print"];
const TRACKING_KINDS = ["ticket", "ask", "research"];
const TRACKING_SOURCES = ["github", "8090", "none"];
const TRACKING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
const TRACKING_RESULTS = [
  "in_progress",
  "plan_declined",
  "fired",
  "error",
  "done",
  "allowed",
  "denied",
  "always",
  "success",
  "failure"
];
const TRACKING_CHOICES = [
  "office",
  "future",
  "garage",
  "scranton",
  "imperial",
  "mono",
  "cards",
  "technical",
  "plain",
  "current",
  "available",
  "installed",
  "error",
  "with_logs",
  "without_logs",
  "cursor",
  "vscode"
];
const BUILTIN_PERSONAS = ["frontend-engineer", "backend-engineer", "hacker", "planner", "qa"];
const TRACKING_PLATFORMS = ["mac", "windows", "linux", "other"];
const TRACKING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING_SETUP_VALUE = /^[a-z0-9][a-z0-9._:/+-]{0,79}$/i;
const TRACKING_WORKER = /^[a-z0-9-]{1,40}$/;
function oneOf(values, value) {
  return typeof value === "string" && values.includes(value) ? value : null;
}
function sanitizeTrackingFact(raw) {
  if (!raw || typeof raw !== "object") return null;
  const given = raw;
  const name = oneOf(TRACKING_EVENTS, given.name);
  const id = typeof given.id === "string" && TRACKING_UUID.test(given.id) ? given.id.toLowerCase() : null;
  const occurredAt = typeof given.occurredAt === "string" ? new Date(given.occurredAt) : null;
  if (!name || !id || !occurredAt || Number.isNaN(occurredAt.getTime())) return null;
  const count = typeof given.count === "number" && Number.isInteger(given.count) && given.count >= 1 && given.count <= 1e3 ? given.count : 1;
  const persona = oneOf(BUILTIN_PERSONAS, given.persona) ?? (given.persona ? "custom" : null);
  return {
    id,
    workerId: typeof given.workerId === "string" && TRACKING_WORKER.test(given.workerId) ? given.workerId : null,
    name,
    occurredAt: occurredAt.toISOString(),
    runner: oneOf(TRACKING_RUNNERS, given.runner),
    workerKind: oneOf(TRACKING_KINDS, given.workerKind),
    source: oneOf(TRACKING_SOURCES, given.source),
    permission: oneOf(["ask", "standard", "auto"], given.permission),
    model: typeof given.model === "string" && TRACKING_SETUP_VALUE.test(given.model) ? given.model.toLowerCase() : null,
    effort: typeof given.effort === "string" && TRACKING_SETUP_VALUE.test(given.effort) ? given.effort.toLowerCase() : null,
    persona: persona === "custom" || persona ? persona : null,
    result: oneOf(TRACKING_RESULTS, given.result),
    choice: oneOf(TRACKING_CHOICES, given.choice),
    count,
    hasPr: typeof given.hasPr === "boolean" ? given.hasPr : null
  };
}
const VOICE_SAMPLE_RATE = 16e3;
const VOICE_MIN_SECONDS = 0.5;
const VOICE_MAX_SECONDS = 120;
export * from "./office-contract.js";
const QUESTS = [
  { id: "power", title: "Sign in to your coding agent" },
  { id: "code", title: "Add your code" },
  { id: "hire", title: "Pick your first task" }
];
const SECRET_PATTERNS = [
  // API keys (various formats)
  { pattern: "\\b(sk|pk|api|key|token)[-_]?[a-z0-9]{20,}", kind: "API key" },
  { pattern: "\\b[a-zA-Z0-9]{32,64}\\b", kind: "API key or token" },
  // Bearer/Auth tokens
  { pattern: "bearer\\s+[a-zA-Z0-9._~+/=-]+", kind: "Bearer token" },
  { pattern: "authorization:\\s*[^\\s\\n]+", kind: "Authorization header" },
  // Common service keys
  { pattern: "ghp_[a-zA-Z0-9]{36}", kind: "GitHub PAT" },
  { pattern: "gho_[a-zA-Z0-9]{36}", kind: "GitHub OAuth token" },
  { pattern: "github_pat_[a-zA-Z0-9_]{22,}", kind: "GitHub PAT" },
  { pattern: "sk-[a-zA-Z0-9]{32,}", kind: "OpenAI/Anthropic key" },
  { pattern: "xox[baprs]-[a-zA-Z0-9-]+", kind: "Slack token" },
  { pattern: "AKIA[A-Z0-9]{16}", kind: "AWS access key" },
  { pattern: '[a-zA-Z0-9/+=]{40}(?=\\s|$|")', kind: "AWS secret key" },
  { pattern: "SG\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+", kind: "SendGrid key" },
  { pattern: "sq0csp-[a-zA-Z0-9_-]+", kind: "Square OAuth secret" },
  { pattern: "AIza[a-zA-Z0-9_-]{35}", kind: "Google API key" },
  // Connection strings
  { pattern: `postgres(ql)?:\\/\\/[^\\s"']+`, kind: "PostgreSQL connection string" },
  { pattern: `mysql:\\/\\/[^\\s"']+`, kind: "MySQL connection string" },
  { pattern: `mongodb(\\+srv)?:\\/\\/[^\\s"']+`, kind: "MongoDB connection string" },
  { pattern: `redis:\\/\\/[^\\s"']+`, kind: "Redis connection string" },
  // Environment variable assignments with secrets
  { pattern: "\\b(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)s?=\\S+", kind: "Environment variable" },
  // Private keys
  { pattern: "-----BEGIN\\s+(RSA\\s+)?PRIVATE\\s+KEY-----[\\s\\S]*?-----END\\s+(RSA\\s+)?PRIVATE\\s+KEY-----", kind: "Private key" },
  // JWT tokens (three base64 segments)
  { pattern: "eyJ[a-zA-Z0-9_-]*\\.eyJ[a-zA-Z0-9_-]*\\.[a-zA-Z0-9_-]*", kind: "JWT token" }
];
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;
function skillNameProblem(name) {
  if (!name) return "Give the skill a name.";
  if (name.length > SKILL_NAME_MAX) return `Keep the name to ${SKILL_NAME_MAX} characters.`;
  if (!SKILL_NAME_PATTERN.test(name)) return "Use lowercase letters, numbers and single hyphens, like draft-ticket.";
  return null;
}
function skillMatrixKey(skill) {
  return skill.scope === "repo" && skill.repo ? `${skill.repo}/${skill.id}` : skill.id;
}
function repoPersonaId(repo, agentId) {
  return `repo:${repo}/${agentId}`;
}
function isRepoPersonaId(id) {
  return !!id?.startsWith("repo:");
}
const MODEL_FAMILIES = ["fable", "opus", "sonnet", "haiku"];
function nearestModel(wanted, menu) {
  const w = wanted?.trim().toLowerCase();
  if (!w || w === "inherit") return null;
  const offered = menu.models.filter((m) => !!m.value);
  const exact = offered.find((m) => m.value.toLowerCase() === w);
  if (exact) return exact.value;
  const family = MODEL_FAMILIES.find((f) => w.includes(f));
  if (family) return offered.find((m) => `${m.value} ${m.label}`.toLowerCase().includes(family))?.value ?? null;
  return offered.find((m) => m.value.toLowerCase().startsWith(w) || w.startsWith(m.value.toLowerCase()))?.value ?? null;
}
const OFFICE_EVENT_KINDS = ["hire", "question", "approval", "pr", "done"];
const DAY_MOMENTS_MAX = 600;
const DAY_WORKERS_MAX = 16;
const DAY_SECONDS_MAX = 2 * 86400;
const MOMENT_LETTER = { hire: "h", question: "q", approval: "a", pr: "p", done: "d" };
const MOMENT_KIND = new Map(Object.entries(MOMENT_LETTER).map(([kind, letter]) => [letter, kind]));
function encodeDayMoments(moments) {
  return [...moments].sort((a, b) => a.at - b.at).slice(0, DAY_MOMENTS_MAX).map((m) => `${MOMENT_LETTER[m.kind]}${m.worker === null ? "_" : m.worker.toString(16)}${Math.round(m.at).toString(36)}`).join(".");
}
function decodeDayMoments(value) {
  const out = [];
  for (const part of (value ?? "").split(".")) {
    const m = /^([a-z])([0-9a-f_])([0-9a-z]{1,4})$/.exec(part);
    const kind = m ? MOMENT_KIND.get(m[1]) : void 0;
    if (!m || !kind) continue;
    const at = parseInt(m[3], 36);
    if (at > DAY_SECONDS_MAX) continue;
    out.push({ kind, worker: m[2] === "_" ? null : parseInt(m[2], 16), at });
    if (out.length === DAY_MOMENTS_MAX) break;
  }
  return out.sort((a, b) => a.at - b.at);
}
export {
  BUILTIN_PERSONAS,
  BUILT_IN_PAM_ID,
  CLAUDE_MODEL_MENU,
  DAY_MOMENTS_MAX,
  DAY_WORKERS_MAX,
  DEFAULT_LOOK,
  DEFAULT_PORT,
  EFFORT_CHOICES,
  HANDOFF_HEADINGS,
  IDEA_LANES,
  INTER_WORKER_LIMITS,
  LOOK_CHOICES,
  MODEL_CHOICES,
  NO_EFFORT_MODELS,
  OFFICE_EVENT_KINDS,
  PERMISSION_LEVELS,
  PERSONA_DESCRIPTION_MAX,
  PERSONA_NAME_MAX,
  QUESTS,
  RUNNER_CHOICES,
  SECRET_PATTERNS,
  SHAPING_BRIEF_OPENING,
  SIGN_IN,
  SKILL_NAME_MAX,
  SKILL_NAME_PATTERN,
  STREAM_LOG_LIMIT,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  TICKET_FOOTER,
  TRACKERS,
  TRACKING_CHOICES,
  TRACKING_EFFORTS,
  TRACKING_EVENTS,
  TRACKING_KINDS,
  TRACKING_PLATFORMS,
  TRACKING_RESULTS,
  TRACKING_RUNNERS,
  TRACKING_SOURCES,
  VOICE_MAX_SECONDS,
  VOICE_MIN_SECONDS,
  VOICE_SAMPLE_RATE,
  WORKER_NAMES,
  WORKER_NAME_MAX,
  agentSetup,
  asAgentSetup,
  autoWorkerName,
  cleanLook,
  decodeDayMoments,
  displayKey,
  draftTemplate,
  encodeDayMoments,
  hireableRunners,
  isHandoffNote,
  isRepoPersonaId,
  nearestModel,
  pathKey,
  projectOf,
  repoPersonaId,
  runnerLabel,
  sanitizeTrackingFact,
  skillMatrixKey,
  skillNameProblem,
  splitTicketId,
  ticketId,
  trackerInfo,
  trackerName,
  waitingOnAgents
};
