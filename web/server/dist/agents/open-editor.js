import { spawn as nodeSpawn } from 'node:child_process';
export const EDITOR_NAMES = { cursor: 'Cursor', vscode: 'VS Code' };
/** The app macOS knows each editor by, for `open -a`. */
const MAC_APPS = { cursor: 'Cursor', vscode: 'Visual Studio Code' };
/**
 * How long a launcher has to fail before it counts as started. `cursor` and
 * `code` hand the folder to the app and exit 0 well within this; a shim that
 * finds no editor, like the Cursor Agent CLI's `~/.local/bin/cursor`, exits 1
 * straight away.
 */
const SETTLE_MS = 1_500;
/**
 * The ways to open a folder in an editor, in the order to try them: its shell
 * command first, then, on macOS, the app itself, which works whatever PATH the
 * office was started with.
 */
export function editorLaunches(editor, command, path, platform = process.platform) {
    const launches = [{ command, args: [path] }];
    if (platform === 'darwin')
        launches.push({ command: '/usr/bin/open', args: ['-a', MAC_APPS[editor], path] });
    return launches;
}
/** Starts one launcher, resolving null once it is under way, or why it failed. */
function tryLaunch(launch, spawn, settleMs) {
    return new Promise((resolve) => {
        let child;
        try {
            // Detached: the editor outlives the request.
            child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore' });
        }
        catch (err) {
            resolve(err.message);
            return;
        }
        const timer = setTimeout(() => {
            child.unref();
            resolve(null);
        }, settleMs);
        timer.unref();
        child.once('error', (err) => {
            clearTimeout(timer);
            resolve(err.code === 'ENOENT' ? 'not found' : err.message);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolve(code === 0 ? null : `exited with ${code ?? signal}`);
        });
    });
}
/** Opens `path` in the editor by the first launcher that works; throws with what each one did when none does. */
export async function launchEditor(editor, command, path, deps = {}) {
    const spawn = deps.spawn ?? nodeSpawn;
    const failures = [];
    for (const launch of editorLaunches(editor, command, path, deps.platform)) {
        const failed = await tryLaunch(launch, spawn, deps.settleMs ?? SETTLE_MS);
        if (!failed)
            return launch;
        const shown = launch.command === '/usr/bin/open' ? `open -a ${MAC_APPS[editor]}` : launch.command;
        failures.push(`\`${shown}\` ${failed}`);
    }
    throw new Error(`Could not open ${EDITOR_NAMES[editor]}: ${failures.join('; ')}. ` +
        `Install ${EDITOR_NAMES[editor]}'s shell command from its command palette, or set editors.${editor} in config.json.`);
}
