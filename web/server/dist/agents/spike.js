/**
 * `npm run spike`
 *
 * Runs the same prompt through both runners against a throwaway git repo and
 * prints what each one exposed. This is the harness behind
 * docs/spike-acp-vs-print.md; re-run it after a Cursor CLI update to check
 * whether the conclusions still hold.
 *
 * Needs `agent login` to have been run once on this machine.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../util.js';
import { AcpRunner } from './acp-runner.js';
import { PrintRunner } from './print-runner.js';
const PROMPT = 'Add a one-line JSDoc comment above the greet function in greet.ts, then tell me you are done. ' +
    'Do not change anything else.';
const SECOND_PROMPT = 'What file did you just change? Answer in one short sentence.';
async function scratchRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'agent-corp-spike-'));
    writeFileSync(join(dir, 'greet.ts'), 'export function greet(name: string) {\n  return `Hello ${name}`;\n}\n');
    writeFileSync(join(dir, 'README.md'), '# Spike scratch repo\n');
    await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['-c', 'user.email=spike@local', '-c', 'user.name=Spike', 'commit', '-qm', 'scratch'], {
        cwd: dir,
    });
    return dir;
}
function observe(runner, obs) {
    runner.onEvent((e) => {
        obs.events.set(e.kind, (obs.events.get(e.kind) ?? 0) + 1);
        switch (e.kind) {
            case 'session':
                obs.chatId = e.chatId;
                break;
            case 'text_delta':
                obs.text += e.text;
                break;
            case 'tool_start':
                console.log(`    tool  ${e.tool}: ${e.label}`);
                break;
            case 'permission_request':
                obs.permissions.push(e.request.title);
                console.log(`    ASK   ${e.request.title}`);
                break;
            case 'error':
                obs.error = e.message;
                console.log(`    ERR   ${e.message}`);
                break;
            default:
                break;
        }
    });
}
/** Resolves when a turn ends or the runner errors. */
function nextTurnEnd(runner, timeoutMs = 5 * 60_000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), timeoutMs);
        timer.unref();
        runner.onEvent((e) => {
            if (e.kind === 'turn_end') {
                clearTimeout(timer);
                resolve('end');
            }
            else if (e.kind === 'error') {
                clearTimeout(timer);
                resolve('error');
            }
        });
    });
}
async function tryMode(mode) {
    const dir = await scratchRepo();
    const started = Date.now();
    const obs = {
        mode,
        events: new Map(),
        chatId: null,
        text: '',
        permissions: [],
        fileChanged: false,
        secondTurnAnswered: false,
        error: null,
        elapsedMs: 0,
    };
    console.log(`\n--- ${mode} mode, in ${dir} ---`);
    const runner = mode === 'acp' ? new AcpRunner({ worktreePath: dir }) : new PrintRunner({ worktreePath: dir });
    observe(runner, obs);
    try {
        await runner.start();
        const done = nextTurnEnd(runner);
        await runner.prompt(PROMPT);
        const outcome = await done;
        console.log(`    turn 1: ${outcome}`);
        const before = obs.text.length;
        const done2 = nextTurnEnd(runner, 3 * 60_000);
        await runner.prompt(SECOND_PROMPT);
        const outcome2 = await done2;
        obs.secondTurnAnswered = outcome2 === 'end' && obs.text.length > before;
        console.log(`    turn 2: ${outcome2} (multi-turn ${obs.secondTurnAnswered ? 'works' : 'did not answer'})`);
        const greet = join(dir, 'greet.ts');
        obs.fileChanged = existsSync(greet) && /\/\*\*|\/\//.test(readFileSync(greet, 'utf8'));
    }
    catch (err) {
        obs.error ??= err.message;
        console.log(`    FAILED: ${obs.error}`);
    }
    finally {
        await runner.dispose().catch(() => { });
        obs.elapsedMs = Date.now() - started;
    }
    return obs;
}
function report(results) {
    console.log('\n================ spike summary ================\n');
    for (const r of results) {
        console.log(`${r.mode}:`);
        console.log(`  chat id captured   ${r.chatId ? `yes (${r.chatId})` : 'no'}`);
        console.log(`  edited the file    ${r.fileChanged ? 'yes' : 'no'}`);
        console.log(`  multi-turn chat    ${r.secondTurnAnswered ? 'yes' : 'no'}`);
        console.log(`  permission asks    ${r.permissions.length ? r.permissions.join('; ') : 'none seen'}`);
        console.log(`  events             ${[...r.events].map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`);
        console.log(`  elapsed            ${(r.elapsedMs / 1000).toFixed(1)}s`);
        if (r.error)
            console.log(`  error              ${r.error}`);
        console.log('');
    }
    console.log('Write anything surprising into docs/spike-acp-vs-print.md.');
}
async function main() {
    try {
        const { stdout } = await run('agent', ['--version'], { timeoutMs: 15_000 });
        console.log(`Cursor CLI ${stdout.trim()}`);
    }
    catch (err) {
        console.error(`\nThe \`agent\` CLI is not usable: ${err.message}`);
        process.exit(1);
    }
    const results = [];
    for (const mode of ['acp', 'print']) {
        results.push(await tryMode(mode));
    }
    report(results);
    if (results.every((r) => r.error)) {
        console.error('\nBoth modes failed. If this says authentication, run `agent login` first.');
        process.exit(1);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
