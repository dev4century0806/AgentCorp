import { RunError, run } from '../util.js';
/** How long the picker may stay open before the office stops waiting for it. */
const WAIT_MS = 10 * 60_000;
/**
 * Opens the Mac's own folder picker and returns the folder chosen, or null
 * if the picker was cancelled. The server runs on the user's Mac, so the
 * picker opens there, in front of the app they are using: their browser or
 * the desktop app. Nobody has to type a path.
 */
export async function chooseFolder(prompt) {
    if (process.platform === 'win32') {
        const desc = (prompt || 'Select Folder').replace(/["`$]/g, '');
        const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "${desc}"; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }`;
        try {
            const { stdout } = await run('powershell', ['-NoProfile', '-Command', psCommand], { timeoutMs: WAIT_MS });
            const path = stdout.trim();
            return path || null;
        } catch {
            return null;
        }
    }
    if (process.platform !== 'darwin') {
        throw new Error('Picking a folder only works on Windows and macOS. Type the path instead.');
    }
    const script = [
        'tell application (path to frontmost application as text)',
        '  activate',
        `  set chosen to choose folder with prompt ${appleScriptString(prompt)}`,
        'end tell',
        'POSIX path of chosen',
    ].join('\n');
    try {
        const { stdout } = await run('osascript', ['-e', script], { timeoutMs: WAIT_MS });
        const path = stdout.trim().replace(/\/+$/, '');
        return path || null;
    }
    catch (err) {
        // Cancel is not a failure: AppleScript reports it as error -128.
        if (err instanceof RunError && /-128|User canceled/i.test(`${err.result.stderr} ${err.message}`))
            return null;
        throw err;
    }
}
function appleScriptString(text) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
