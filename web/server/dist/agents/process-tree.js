import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { truncate } from './events.js';
const run = promisify(execFile);
/** A process on its way out, which `ps` shows by its name in brackets, e.g. `(zsh)`. */
const EXITING = /^\(.*\)$/;
/** How the CLI wraps every shell command it runs: `zsh -c …`, or Codex's `zsh -lc …`. */
const TOOL_SHELL = /^(?:\S*\/)?(?:zsh|bash|sh) -l?c /;
/**
 * The runners whose shells are not the office process's own children. Cursor's
 * `agent acp` is the CLI itself. Claude Code's adapter starts `claude`;
 * Copilot's loader starts the `copilot` binary; Codex's adapter starts
 * `node codex.js app-server`, which starts the `codex` binary.
 */
export const CLI_SHAPES = {
    claude: { program: 'claude' },
    copilot: { program: 'copilot', bare: true },
    codex: { program: 'codex', bare: true },
};
/** How far below the office's process the CLI is looked for. */
const CLI_DEPTH = 3;
/**
 * A bare child this close to the CLI's own start started with it: an MCP
 * server from the user's own CLI config, kept up all session, not a command.
 */
const STARTED_WITH_CLI_S = 5;
/**
 * What a worker's CLI is running right now.
 *
 * Each shell command the CLI runs gets a `-c` shell of its own, so the
 * commands are those shells and what they started. Anything else below the
 * CLI is an MCP server it keeps up for the whole session, which is not work
 * in progress, except under a CLI whose shells replace themselves with the
 * command they run.
 *
 * `shape` is for a pid that is an ACP adapter rather than the CLI, from
 * CLI_SHAPES.
 */
export async function runningCommands(pid, shape) {
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,etime=,%cpu=,command='], {
        // A decimal comma would not parse.
        env: { ...process.env, LC_ALL: 'C' },
        maxBuffer: 16 * 1024 * 1024,
    });
    return commandsUnder(parsePs(stdout), pid, shape);
}
export function parsePs(text) {
    const rows = [];
    for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(.+)$/.exec(line);
        if (!m)
            continue;
        rows.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            seconds: etimeSeconds(m[3] ?? ''),
            cpu: Number(m[4]),
            command: (m[5] ?? '').trim(),
        });
    }
    return rows;
}
export function commandsUnder(rows, pid, shape) {
    const children = new Map();
    for (const row of rows) {
        const siblings = children.get(row.ppid);
        if (siblings)
            siblings.push(row);
        else
            children.set(row.ppid, [row]);
    }
    const seen = new Set();
    const tree = (row) => {
        if (seen.has(row.pid))
            return [];
        seen.add(row.pid);
        return [row, ...(children.get(row.pid) ?? []).flatMap(tree)];
    };
    const cli = shape ? findCli(children, pid, shape.program) : null;
    const below = children.get(cli?.pid ?? pid) ?? [];
    const cpu = (row) => Math.round(tree(row).reduce((sum, r) => sum + r.cpu, 0));
    const shells = below
        .filter((shell) => TOOL_SHELL.test(shell.command))
        .map((shell) => {
        const first = children.get(shell.pid)?.find((row) => !EXITING.test(row.command));
        return { command: first ? typed(first.command) : 'a shell command', seconds: shell.seconds, cpu: cpu(shell) };
    });
    const bare = cli && shape?.bare
        ? below
            .filter((row) => !TOOL_SHELL.test(row.command) && !EXITING.test(row.command) && row.seconds < cli.seconds - STARTED_WITH_CLI_S)
            .map((row) => ({ command: typed(row.command), seconds: row.seconds, cpu: cpu(row) }))
        : [];
    return [...shells, ...bare];
}
/** The CLI's own process below `pid`, found by its program's name, or null when it is not there. */
function findCli(children, pid, program) {
    let level = children.get(pid) ?? [];
    for (let depth = 0; depth < CLI_DEPTH && level.length; depth++) {
        const cli = level.find((row) => basename(row.command.split(' ')[0] ?? '') === program);
        if (cli)
            return cli;
        level = level.filter((row) => !TOOL_SHELL.test(row.command)).flatMap((row) => children.get(row.pid) ?? []);
    }
    return null;
}
/** "`git push origin HEAD` has been running for 3m 10s and is busy (87% CPU)". */
export function describeCommand(c) {
    const state = c.cpu > 0 ? `is busy (${c.cpu}% CPU)` : 'is using no CPU, so it may be waiting on the network or for input';
    return `\`${c.command}\` has been running for ${duration(c.seconds)} and ${state}`;
}
function duration(seconds) {
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
/** `ps` elapsed time, `[[dd-]hh:]mm:ss`. */
function etimeSeconds(etime) {
    const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime];
    const [s = 0, m = 0, h = 0] = (clock ?? '').split(':').map(Number).reverse();
    return Number(days) * 86_400 + h * 3_600 + m * 60 + s;
}
/** `/Library/Developer/CommandLineTools/usr/bin/git push` reads as `git push`. */
function typed(command) {
    const [program = '', ...args] = command.split(' ');
    return truncate([basename(program), ...args].join(' '), 80);
}
