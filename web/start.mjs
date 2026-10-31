import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = join(root, 'data', 'home');
mkdirSync(home, { recursive: true });

// Keep the app's generated agent files separate from the user's tool settings.
process.env.USERPROFILE = home;
delete process.env.HOME;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
process.env.AGENT_CORP_HOME = join(root, 'data', 'office');
process.env.AGENT_CORP_CONFIG = join(root, 'data', 'office', 'config.json');
process.env.AGENT_CORP_PORT ??= '4317';
process.env.npm_package_version = '0.1.0';
process.chdir(resolve(root, 'web'));
await import('./server/dist/index.js');
