import { execFile } from 'node:child_process';
export class RunError extends Error {
    result;
    constructor(message, result) {
        super(message);
        this.result = result;
        this.name = 'RunError';
    }
}
/**
 * Runs a command with an argument array and no shell, so ticket text and
 * branch names can never be interpreted as shell syntax.
 */
export function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, {
            cwd: opts.cwd,
            timeout: opts.timeoutMs ?? 60_000,
            maxBuffer: 16 * 1024 * 1024,
            env: opts.env ?? process.env,
        }, (err, stdout, stderr) => {
            const result = {
                stdout: stdout.toString(),
                stderr: stderr.toString(),
                code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
            };
            if (err) {
                reject(new RunError(`${cmd} ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim() || err.message}`, result));
            }
            else {
                resolve(result);
            }
        });
    });
}
/** Lowercased, dash-joined, trimmed to `max` characters on a word boundary. */
export function slugify(text, max = 40) {
    const base = text
        .toLowerCase()
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (base.length <= max)
        return base || 'work';
    return (base.slice(0, max).replace(/-[^-]*$/, '') || base.slice(0, max)).replace(/-+$/, '');
}
/** Deterministic 32-bit hash, so a worker's colors survive a restart. */
export function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
export function fillTemplate(template, tokens) {
    return template.replace(/\{(\w+)\}/g, (match, key) => tokens[key] ?? match);
}
