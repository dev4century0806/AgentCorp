import { homedir } from 'node:os';
import { basename, dirname, join, resolve, isAbsolute } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PORT, RUNNER_CHOICES } from './protocol.js';
const HOME = homedir();
/** `AGENT_CORP_HOME` configures the primary workspace and storage root. */
export const STATE_DIR = process.env.AGENT_CORP_HOME
    ? resolve(process.env.AGENT_CORP_HOME.replace(/^~(?=\/|$)/, HOME))
    : join(HOME, '.agent-corp');
export const DB_PATH = join(STATE_DIR, 'office.db');
/** One folder per signed-in Supabase user: their database, and for all but the shared folder's owner, the rest. */
export function accountDir(userId) {
    return join(STATE_DIR, 'accounts', userId);
}
/** Local office data is separated by the signed-in Supabase user. */
export function accountDbPath(userId) {
    return join(accountDir(userId), 'office.db');
}
let activeAccount = null;
/** Points config, tokens, notes, uploads and skills at this user's folder. */
export function setActiveAccount(userId) {
    activeAccount = userId;
}
/** Names the user who kept the shared folder; see `adoptSharedState`. */
const OWNER_FILE = join(STATE_DIR, 'accounts', '.shared-owner');
let sharedOwner;
function sharedFolderOwner() {
    if (sharedOwner === undefined) {
        sharedOwner = existsSync(OWNER_FILE) ? readFileSync(OWNER_FILE, 'utf8').trim() || null : null;
    }
    return sharedOwner;
}
/**
 * Offices from before the split kept one config and one set of tokens for
 * everyone. The first user to sign in afterwards keeps that folder as their
 * own, so their repos, connections, notes and skills stay where they are and
 * every path saved to them keeps working: workers' folders, skill links in
 * ~/.claude, and the conversations Claude Code files by folder. Everyone
 * after them gets a folder of their own. Returns whether this user took it.
 */
export function adoptSharedState(userId) {
    if (sharedFolderOwner() !== null)
        return false;
    mkdirSync(dirname(OWNER_FILE), { recursive: true });
    writeFileSync(OWNER_FILE, userId + '\n', 'utf8');
    sharedOwner = userId;
    return true;
}
/**
 * The signed-in user's folder. Before anyone has signed in it is the shared
 * one, which is all the sign-in screen needs.
 */
export function activeStateDir() {
    if (!activeAccount || activeAccount === sharedFolderOwner())
        return STATE_DIR;
    return accountDir(activeAccount);
}
export function authDir() {
    return join(activeStateDir(), 'auth');
}
/** Where repo-less workers such as the assistant keep their notes. */
export function notesRoot() {
    return join(activeStateDir(), 'notes');
}
/** Where files attached to a worker's brief are saved. */
export function uploadsRoot() {
    return join(activeStateDir(), 'uploads');
}
/** Where generated and installed offices are kept, one folder each (issue #157). */
export function officesRoot() {
    return join(activeStateDir(), 'offices');
}
/** The line that ends every PR description a worker writes, while `agents.prFooter` is on. */
export const PR_FOOTER = 'Created by AgentCorp';
/**
 * AgentCorp default workspace configuration.
 */
export const DEFAULT_CONFIG = {
    port: DEFAULT_PORT,
    factory: {
        enabled: false,
        mcpUrl: '',
        webBaseUrl: '',
        headers: {},
        pollSeconds: 90,
        filter: {
            assignee: null,
            statuses: ['ready', 'in_progress'],
            phase: null,
            project: null,
            limit: 40,
        },
    },
    github: {
        enabled: false,
        apiUrl: 'https://api.github.com',
        host: 'github.com',
        pollSeconds: 90,
        repos: [],
        inProgressStatuses: ['in progress'],
        reviewStatuses: ['in review'],
        limit: 100,
    },
    tracker: 'github',
    repos: {
        default: { path: '~/Develop/my-app', baseBranch: 'main' },
        byProject: {
            'my-app': { path: '~/Develop/my-app', baseBranch: 'main' },
        },
        roots: ['~/Develop', '~/Development', '~/code', '~/src', '~/projects'],
        known: [],
        hidden: [],
        cloneInto: null,
    },
    worktrees: {
        root: '~/git/worktrees',
        dirTemplate: '{root}/{repoName}/{key}-{slug}',
        branchTemplate: '{key}-{slug}',
    },
    agents: {
        runnerMode: 'auto',
        maxConcurrent: 16,
        model: null,
        effort: null,
        permission: 'standard',
        standingInstructions: [
            'Work only inside this worktree. Never touch files outside it.',
            'Verify your change in the browser before opening a PR.',
            'Start any question for Operator with "QUESTION:" on its own line so the office knows to raise your hand.',
            'When you say you will go with a default, go with it in the same turn. Only stop to wait on a "QUESTION:" line or a "START_WORK:" plan.',
            'When the PR is open, print the PR URL on its own line.',
            'Do not run `git push --force`, and do not install packages without asking first.',
        ],
        registerFactoryMcp: true,
        idleAfterSeconds: 60,
        adoptExistingWorktrees: true,
        adoptStatuses: ['in_progress'],
        resumeOnStart: true,
        autoApprove: false,
        autoReview: true,
        prFooter: true,
        review: {
            enabled: true,
            maxConcurrent: 2,
            largeDiffThreshold: 500,
            sensitivePatterns: [
                '**/auth/**',
                '**/payment*/**',
                '**/migrations/**',
                '**/.env*',
                '**/secrets/**',
                '**/config/prod*',
            ],
            reviewTestChanges: true,
            reviewerRunner: 'different',
        },
    },
    messageStyle: 'technical',
    ideas: { lastProject: null, lastIssueType: null },
    personas: [
        {
            id: 'frontend-engineer',
            name: 'Frontend Engineer',
            permission: 'standard',
            model: 'sonnet',
            effort: null,
            look: { hair: 'bun', hat: 'headphones', face: 'none', outfit: 'hoodie', shirtColor: null, hairColor: null },
            instructions: 'You are the frontend specialist. Reuse the existing components and design tokens, check the change in the browser at desktop and phone widths, and put before and after screenshots in the PR.',
            description: 'UI work: components, styling and layout, checked in the browser at desktop and phone widths.',
        },
        {
            id: 'backend-engineer',
            name: 'Backend Engineer',
            permission: 'standard',
            model: 'opus',
            effort: 'high',
            look: { hair: 'crop', hat: 'wizard', face: 'beard', outfit: 'tee', shirtColor: null, hairColor: null },
            instructions: 'You take the hardest problems. Plan before you code, split the work into steps, and prove each step with a test before moving on.',
            description: 'Hard backend problems: plans the change, splits it into steps and proves each one with a test.',
        },
        {
            id: 'hacker',
            name: 'Hacker',
            permission: 'auto',
            model: 'sonnet',
            effort: 'max',
            look: { hair: 'mohawk', hat: 'none', face: 'beard', outfit: 'hoodie', shirtColor: '#4f7fe0', hairColor: '#8a5a3b' },
            instructions: 'You move fast. Get a working version end to end first, then tighten it. You may install packages and run whatever you need without asking, but stay inside your worktree, never touch credentials or production systems, and list every shortcut you took in the PR.',
            description: 'A quick working version end to end, tightened afterwards, with every shortcut listed.',
        },
        {
            id: 'planner',
            name: 'Planner',
            permission: 'ask',
            model: 'opus',
            effort: 'high',
            look: { hair: 'crop', hat: 'none', face: 'none', outfit: 'labcoat', shirtColor: null, hairColor: null },
            instructions: 'Investigate before you change anything. Read the relevant code and its history, write down what you found and why, and cite file paths and line numbers. A clear written finding beats a speculative fix.',
            description: 'Investigates before changing anything: reads the code and its history and writes up findings with file and line references.',
        },
        {
            id: 'qa',
            name: 'QA',
            permission: 'standard',
            model: 'sonnet',
            effort: null,
            look: { hair: 'crop', hat: 'cap', face: 'none', outfit: 'tie', shirtColor: null, hairColor: null },
            instructions: 'You write and repair tests. Add the tests the ticket is missing, fix flaky ones by finding the cause rather than retrying, and follow the conventions of the existing test files. Change application code only when a test proves it is wrong, and say so in the PR.',
            description: 'Writes missing tests and fixes flaky ones by finding the cause, following the existing test conventions.',
        },
    ],
    editors: {
        preferred: 'cursor',
        cursor: 'cursor',
        vscode: 'code',
    },
    prWatch: {
        enabled: true,
        pollSeconds: 60,
        maxFixAttempts: 3,
        triggers: {
            failedChecks: true,
            conflicts: true,
            reviewComments: true,
        },
    },
    voice: {
        enabled: false,
        rewrite: false,
    },
    ollama: {
        enabled: true,
        url: 'http://127.0.0.1:11434',
        defaultModel: 'qwen3.5:4b',
    },
    obsidian: {
        enabled: false,
        vaultPath: '',
    },
};
/** Expands a leading `~` and resolves to an absolute path. */
export function expandPath(p) {
    if (p === '~')
        return HOME;
    if (p.startsWith('~/'))
        return join(HOME, p.slice(2));
    return isAbsolute(p) ? p : resolve(p);
}
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function deepMerge(base, override) {
    if (override === undefined)
        return base;
    if (!isPlainObject(override) || !isPlainObject(base))
        return override;
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
        out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
}
export function configPath() {
    return process.env.AGENT_CORP_CONFIG
        ? expandPath(process.env.AGENT_CORP_CONFIG)
        : join(activeStateDir(), 'config.json');
}
/**
 * Raised, with a step in `migrateConfig`, whenever a default changes that
 * existing config.json files already have written into them.
 */
const CONFIG_VERSION = 3;
/**
 * Reads the signed-in user's config.json over the defaults. A missing file is fine
 * on first launch; it gets written so there is something to edit. A file from
 * an older office is brought up to date first.
 */
export function loadConfig() {
    mkdirSync(activeStateDir(), { recursive: true });
    const path = configPath();
    // A copy, since a user switch reloads into this object and must never change the defaults.
    let cfg = structuredClone(DEFAULT_CONFIG);
    if (existsSync(path)) {
        let file;
        try {
            file = JSON.parse(readFileSync(path, 'utf8'));
        }
        catch (err) {
            throw new Error(`config.json at ${path} is not valid JSON: ${err.message}`);
        }
        if (migrateConfig(file))
            writeConfigFile(path, file);
        cfg = deepMerge(cfg, file);
    }
    else {
        writeConfigFile(path, { configVersion: CONFIG_VERSION, ...DEFAULT_CONFIG });
    }
    if (process.env.AGENT_CORP_PORT) {
        const port = Number(process.env.AGENT_CORP_PORT);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(`AGENT_CORP_PORT must be a port number, got "${process.env.AGENT_CORP_PORT}"`);
        }
        cfg = { ...cfg, port };
    }
    if (cfg.agents.maxConcurrent < 1) {
        throw new Error('agents.maxConcurrent must be at least 1');
    }
    cfg.tracker = 'github';
    for (const key of ['jira', 'linear', 'telegram', 'figma']) delete cfg[key];
    return cfg;
}
/**
 * Swaps the signed-in user's config.json into the object every service
 * already holds, so a user switch reaches them all. The port stays: the
 * office is already listening on it.
 */
export function reloadConfig(into) {
    const next = loadConfig();
    Object.assign(into, next, { port: into.port });
}
/**
 * First launch writes every default into config.json, so a default changed
 * later never reaches an existing install by itself. Each step here moves an
 * older file on, once. Returns whether the file changed.
 */
function migrateConfig(file) {
    if (!isPlainObject(file))
        return false;
    const from = typeof file.configVersion === 'number' ? file.configVersion : 1;
    if (from >= CONFIG_VERSION)
        return false;
    const agents = file.agents;
    // 4 was the default until the limit became one running worker per desk.
    if (from < 2 && isPlainObject(agents) && agents.maxConcurrent === 4)
        agents.maxConcurrent = 16;
    if (from < 3) {
        for (const key of ['jira', 'linear', 'telegram', 'figma']) delete file[key];
        file.tracker = 'github';
    }
    file.configVersion = CONFIG_VERSION;
    return true;
}
function writeConfigFile(path, file) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2) + '\n', 'utf8');
}
/**
 * Adds a repo to `repos.known` in config.json so a path typed once stays in
 * the picker. Writes through the file on disk rather than the merged config,
 * to avoid persisting the whole default tree into the user's config file.
 */
export function rememberRepo(rule) {
    const path = configPath();
    let file = {};
    if (existsSync(path)) {
        try {
            file = JSON.parse(readFileSync(path, 'utf8'));
        }
        catch {
            return; // Never clobber a file we could not read.
        }
    }
    const repos = isPlainObject(file.repos) ? { ...file.repos } : {};
    const known = Array.isArray(repos.known) ? repos.known : [];
    const already = known.some((r) => expandPath(r.path) === expandPath(rule.path));
    if (already)
        return;
    repos.known = [...known, rule];
    file.repos = repos;
    writeConfigFile(path, file);
}
/** Saves a setting that is one value, such as the message style or the persona list. */
export function saveConfigValue(key, value) {
    editConfigFile((file) => {
        file[key] = value;
    });
}
/**
 * Saves only the given fields of a section and keeps the rest of it as the
 * file has it. Writing the whole section would pin every default in it, and
 * would undo anything written to the file since the office started.
 */
export function saveConfigFields(key, fields) {
    editConfigFile((file) => {
        const section = file[key];
        file[key] = { ...(isPlainObject(section) ? section : {}), ...fields };
    });
}
function editConfigFile(change) {
    const path = configPath();
    let file = {};
    if (existsSync(path)) {
        try {
            file = JSON.parse(readFileSync(path, 'utf8'));
        }
        catch {
            throw new Error(`config.json at ${path} is not valid JSON, so settings were not saved.`);
        }
    }
    change(file);
    writeConfigFile(path, file);
}
export function resolveRunnerMode(cfg) {
    return cfg.agents.runnerMode === 'auto' ? 'claude' : cfg.agents.runnerMode;
}
/** The default agent for new hires, as Settings offers it: print mode is Cursor. */
export function resolveRunnerChoice(cfg) {
    const mode = resolveRunnerMode(cfg);
    return mode === 'print' ? 'acp' : mode;
}
/** The agents turned on. Before the first full check has set the list, every agent counts as on. */
export function enabledRunners(cfg) {
    const saved = cfg.agents.enabledRunners;
    return Array.isArray(saved) ? RUNNER_CHOICES.filter((id) => saved.includes(id)) : [...RUNNER_CHOICES];
}
/** config.json is edited by hand too, so anything but 'vscode' means Cursor. */
export function resolveEditor(cfg) {
    return cfg.editors.preferred === 'vscode' ? 'vscode' : 'cursor';
}
/** Picks the repo for a ticket: project rule first, then the default. */
export function resolveRepo(cfg, project) {
    if (project) {
        const rule = cfg.repos.byProject[project];
        if (rule)
            return { ...rule, path: expandPath(rule.path) };
    }
    if (cfg.repos.default) {
        return { ...cfg.repos.default, path: expandPath(cfg.repos.default.path) };
    }
    return null;
}
