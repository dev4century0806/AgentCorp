/**
 * `npm run demo:agent [-- <repo-path>]`
 *
 * The M1 gate: one hard-coded agent runs in a fresh git worktree, edits a
 * file, and every event it emits prints to the console. No 8090, no web UI,
 * no database — just the worktree and runner halves of the server.
 *
 * Defaults to a throwaway repo in /tmp so it is safe to run anywhere. Pass a
 * real repo path to watch it work against actual code.
 *
 * Needs `agent login` to have been run once on this machine.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { createWorktree, planWorktree, removeWorktree } from '../git/worktree.js';
import { run } from '../util.js';
import { AcpRunner } from './acp-runner.js';
import { PrintRunner } from './print-runner.js';
const TICKET = {
    key: 'WO-0000',
    summary: 'AgentCorp smoke test: document the greet helper',
    brief: [
        'You are picking up WO-0000: AgentCorp smoke test.',
        '',
        'Add a short JSDoc comment above the `greet` function in greet.ts explaining what it does.',
        'Change nothing else, do not commit, and tell me when you are done.',
    ].join('\n'),
};
async function makeScratchRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'agent-corp-demo-'));
    writeFileSync(join(dir, 'greet.ts'), 'export function greet(name: string) {\n  return `Hello ${name}`;\n}\n');
    await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['-c', 'user.email=demo@local', '-c', 'user.name=Demo', 'commit', '-qm', 'initial'], {
        cwd: dir,
    });
    // createWorktree branches off origin/<base>, so give the scratch repo an
    // origin that points at itself.
    await run('git', ['remote', 'add', 'origin', dir], { cwd: dir });
    await run('git', ['fetch', '-q', 'origin'], { cwd: dir });
    return dir;
}
async function main() {
    const cfg = loadConfig();
    const given = process.argv[2];
    const repoPath = given ?? (await makeScratchRepo());
    const scratch = !given;
    console.log(`Repo:     ${repoPath}${scratch ? ' (throwaway)' : ''}`);
    const plan = planWorktree(cfg, {
        repoPath,
        key: TICKET.key,
        summary: TICKET.summary,
        baseBranch: scratch ? 'main' : (cfg.repos.default?.baseBranch ?? 'main'),
    });
    console.log(`Worktree: ${plan.worktreePath}`);
    console.log(`Branch:   ${plan.branch}\n`);
    const { reused } = await createWorktree(plan);
    console.log(reused ? 'Reused the existing worktree.\n' : 'Created the worktree.\n');
    const mode = cfg.agents.runnerMode === 'print' ? 'print' : 'acp';
    const runner = mode === 'print'
        ? new PrintRunner({ worktreePath: plan.worktreePath, model: cfg.agents.model })
        : new AcpRunner({ worktreePath: plan.worktreePath, model: cfg.agents.model });
    console.log(`Runner:   ${mode}\n`);
    let ended = false;
    const finished = new Promise((resolve) => {
        runner.onEvent((e) => {
            switch (e.kind) {
                case 'session':
                    console.log(`[session]  chat id ${e.chatId}`);
                    break;
                case 'text_delta':
                    process.stdout.write(e.text);
                    break;
                case 'thinking':
                    break;
                case 'tool_start':
                    console.log(`\n[tool]     ${e.label}`);
                    break;
                case 'tool_end':
                    break;
                case 'permission_request':
                    console.log(`\n[needs you] ${e.request.title}`);
                    if (e.request.detail)
                        console.log(`            ${e.request.detail}`);
                    break;
                case 'turn_end':
                    console.log('\n[turn end]');
                    ended = true;
                    resolve();
                    break;
                case 'error':
                    console.error(`\n[error]    ${e.message}`);
                    ended = true;
                    resolve();
                    break;
                case 'raw':
                    if (process.env.DEMO_VERBOSE)
                        console.log(`[raw]      ${e.line}`);
                    break;
                default:
                    break;
            }
        });
    });
    try {
        await runner.start();
        await runner.prompt(TICKET.brief);
        await Promise.race([
            finished,
            new Promise((resolve) => setTimeout(resolve, 6 * 60_000).unref()),
        ]);
        if (!ended)
            console.log('\nGave up waiting after six minutes.');
        const greet = readFileSync(join(plan.worktreePath, 'greet.ts'), 'utf8');
        const documented = /\/\*\*|\/\//.test(greet);
        console.log(`\n--- greet.ts in the worktree ---\n${greet}`);
        console.log(documented ? 'The agent edited the file.' : 'The file is unchanged.');
    }
    finally {
        await runner.dispose().catch(() => { });
        if (scratch) {
            await removeWorktree(plan, { force: true }).catch(() => { });
            console.log(`\nCleaned up. The throwaway repo is still at ${repoPath} if you want to look.`);
        }
        else {
            console.log(`\nLeft the worktree at ${plan.worktreePath}.`);
        }
    }
}
main().catch((err) => {
    console.error(`\nDemo failed: ${err.message}`);
    process.exit(1);
});
