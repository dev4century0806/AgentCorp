import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'agentcorp-streamline-'));
process.env.AGENT_CORP_HOME = home;
const { DEFAULT_CONFIG, loadConfig } = await import('./server/dist/config.js');
const { openDb, Repositories } = await import('./server/dist/db/index.js');
const { AgentManager } = await import('./server/dist/agents/manager.js');
const { EventBus } = await import('./server/dist/bus.js');
const { buildServer } = await import('./server/dist/http/server.js');
const { SESSION_HEADER } = await import('./server/dist/session.js');
const { OFFICE_BASES, TRACKERS, WORKER_NAME_MAX } = await import('./server/dist/protocol.js');

test.after(() => rmSync(home, { recursive: true, force: true }));

test('configuration migration removes retired connections and preserves coding settings', () => {
  const config = { configVersion: 2, tracker: 'jira', jira: { enabled: true }, linear: {}, telegram: {}, figma: {}, agents: { maxConcurrent: 7 } };
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  const current = loadConfig();
  const stored = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
  for (const key of ['jira', 'linear', 'telegram', 'figma']) {
    assert.equal(key in current, false);
    assert.equal(key in stored, false);
  }
  assert.equal(current.tracker, 'github');
  assert.equal(stored.tracker, 'github');
  assert.equal(current.agents.maxConcurrent, 7);
});

async function fixture(path) {
  const db = openDb(path);
  const repos = new Repositories(db);
  const bus = new EventBus();
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.port = 0;
  const agents = new AgentManager(cfg, repos, {}, bus);
  // Naming runs through the real manager and database without launching an AI provider.
  agents.makeRunner = () => ({ isStarted: false, isBusy: false, commands: [], dispose: async () => {} });
  agents.restoreFromDb();
  const app = await buildServer({ cfg, repos, bus, agents, pollers: [], factory: {}, factoryPoller: {}, token: 'test-token', health: () => ({}) });
  const request = (method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { [SESSION_HEADER]: 'test-token', ...headers } });
  return { app, agents, repos, db, request, close: async () => { await app.close(); db.close(); } };
}

test('assistant naming validates, normalizes, persists and survives reopening the database', async () => {
  const path = join(home, 'naming.db');
  let f = await fixture(path);
  try {
    assert.deepEqual((await f.request('GET', '/api/assistant')).json(), { name: 'Nova', named: false });
    for (const name of ['', '   ', 'a'.repeat(WORKER_NAME_MAX + 1), null, 7]) {
      assert.equal((await f.request('PUT', '/api/assistant', { name })).statusCode, 400);
      assert.equal((await f.request('GET', '/api/assistant')).json().named, false);
    }
    const update = f.repos.updateAgent;
    f.repos.updateAgent = () => { throw new Error('Simulated database write failure'); };
    assert.equal((await f.request('PUT', '/api/assistant', { name: 'Unsaved' })).statusCode, 400);
    assert.deepEqual((await f.request('GET', '/api/assistant')).json(), { name: 'Nova', named: false });
    f.repos.updateAgent = update;
    const saved = await f.request('PUT', '/api/assistant', { name: '  Luna   Ngân  ' });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json(), { name: 'Luna Ngân', named: true });
    assert.equal(f.repos.builtInPam().name, 'Luna Ngân');
    const live = f.agents.live.values().next().value;
    f.agents.live.set('other', { ...live, record: { ...live.record, id: 'other', name: 'Taken', builtInPam: false } });
    assert.equal((await f.request('PUT', '/api/assistant', { name: 'taken' })).statusCode, 400);
    assert.equal((await f.request('GET', '/api/assistant')).json().name, 'Luna Ngân');
    f.agents.live.delete('other');
  } finally { await f.close(); }
  f = await fixture(path);
  try {
    assert.deepEqual((await f.request('GET', '/api/assistant')).json(), { name: 'Luna Ngân', named: true });
    assert.equal((await f.app.inject({ method: 'PUT', url: '/api/assistant', payload: { name: 'Unauthorized' } })).statusCode, 401);
    assert.equal((await f.request('PUT', '/api/assistant', { name: 'Cross-site' }, { origin: 'https://example.com' })).statusCode, 403);
  } finally { await f.close(); }
});

test('a receptionist session receives the current name after a rename', async () => {
  const f = await fixture(join(home, 'identity.db'));
  try {
    const live = f.agents.live.values().next().value;
    const prompts = [];
    live.runner.isStarted = true;
    live.runner.prompt = async text => { prompts.push(text); };
    await f.request('PUT', '/api/assistant', { name: 'Mira' });
    await f.agents.sendMessage(live.record.id, 'What is your name?');
    await f.request('PUT', '/api/assistant', { name: 'Aria' });
    await f.agents.sendMessage(live.record.id, 'What is your name now?');
    assert.match(prompts[0], /current receptionist name is "Mira"/);
    assert.match(prompts[1], /current receptionist name is "Aria"/);
  } finally { await f.close(); }
});

test('retired routes fail and runtime snapshot excludes progression and remote messaging', async () => {
  const f = await fixture(join(home, 'removal.db'));
  try {
    const routes = [
      ['POST', '/api/game/sync'], ['POST', '/api/day/shared'],
      ['GET', '/api/telegram/verify'], ['POST', '/api/telegram/connect'],
      ['POST', '/api/figma/accounts'], ['GET', '/api/trackers/jira/projects'],
      ['POST', '/api/trackers/jira/connect'], ['POST', '/api/trackers/linear/connect'],
      ['GET', '/api/trackers/linear/projects'], ['PUT', '/api/settings/trackers/jira'],
      ['POST', '/api/supabase/rest/v1/rpc/get_leaderboard'],
      ['POST', '/api/supabase/rest/v1/rpc/get_max_player_progress'],
      ['GET', '/api/supabase/rest/v1/perks'],
    ];
    for (const [method, url] of routes) assert.equal((await f.request(method, url)).statusCode, 404, url);
    const state = (await f.request('GET', '/api/state')).json();
    for (const key of ['game', 'telegramHistory', 'telegramState']) assert.equal(key in state, false, key);
    assert.deepEqual(OFFICE_BASES, ['office']);
    assert.deepEqual(TRACKERS.map(tracker => tracker.id), ['github']);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('game','telegram_messages')").get().n, 0);
  } finally { await f.close(); }
});

test('built interface contains naming controls and no retired UI or game code', () => {
  const html = readFileSync(new URL('./ui/dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /rankChip|ranksDialog|arcadeDialog|telegramBtn|sPerks|\/api\/agents\/pam\/name/);
  const script = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  const code = readFileSync(new URL(`./ui/dist${script}`, import.meta.url), 'utf8');
  assert.match(code, /\/api\/assistant/);
  assert.doesNotMatch(code, /bugBlasterBest|Byte the cat|The Singularity|Coffee Runner|\/api\/telegram|\/api\/figma|halloween-greeted/);
});
