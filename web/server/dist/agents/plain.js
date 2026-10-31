import { normalizeTool } from './events.js';
/**
 * Plain mode: what a worker is doing, said for someone who does not read code.
 *
 * Each tool call gets a sentence next to its technical label, worked out here
 * from the call itself — the command it runs, the file it opens, the ticket it
 * reads — so the office can show either, and switch between them, without the
 * exact command ever being lost. Built from rules rather than a model: it is
 * instant and free, and the rare call nothing here recognises falls back to
 * "Working in the code", which is true and harmless.
 */
export function plainStep(tool, input, label = '') {
    const args = (input && typeof input === 'object' ? input : {});
    const str = (...keys) => {
        for (const k of keys) {
            const v = args[k];
            if (typeof v === 'string' && v.trim())
                return v.trim();
        }
        return '';
    };
    const file = str('path', 'file_path', 'filePath', 'target_file', 'relative_file_path', 'file');
    const mcp = /mcp__(\w+?)__(\w+)/.exec(`${tool} ${label}`);
    if (mcp)
        return /^(get|list|read|search|lookup)/i.test(mcp[2]) ? 'Looking something up' : 'Using a connected tool';
    switch (normalizeTool(tool)) {
        case 'read':
            return capital(file ? `reading ${fileName(file)}` : 'reading the code');
        case 'edit':
            return capital(file ? `editing ${fileName(file)}` : 'editing the code');
        case 'write':
            return capital(file ? `writing ${fileName(file)}` : 'writing a file');
        case 'delete':
            return capital(file ? `deleting ${fileName(file)}` : 'deleting a file');
        case 'search': {
            const found = terms(str('pattern', 'query', 'search_term'));
            return capital(found.length ? `searching the code for ${quoted(found)}` : 'searching the code');
        }
        case 'list':
            return 'Looking through the files';
        case 'fetch':
            return 'Reading a web page';
        case 'todo':
            return 'Updating its to-do list';
        case 'shell':
            return shellSentence(str('command', 'cmd') || commandFromLabel(label));
    }
    if (/toolsearch/i.test(tool))
        return 'Getting its tools ready';
    if (/skill/i.test(tool))
        return 'Loading a skill';
    // A label that is a backticked command is a shell call by another name.
    const fromLabel = commandFromLabel(label);
    if (fromLabel)
        return shellSentence(fromLabel);
    return FALLBACK;
}
const FALLBACK = 'Working in the code';
/** "`git status`" -> "git status"; anything else -> "". */
function commandFromLabel(label) {
    const m = /^`([^`]+)`/.exec(label.trim());
    return m?.[1] ?? '';
}
function capital(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}
/* ---------- names ---------- */
/** Words in code names that mean little to someone outside it, and what to say instead. */
const PLAIN_WORDS = {
    component: 'screen',
    service: 'logic',
    controller: 'request handler',
    utils: 'helpers',
    util: 'helper',
    dto: 'data shape',
    impl: 'logic',
};
/** "getTwitterShares" -> "twitter shares"; "REDDIT_SHARES" -> "reddit shares". */
function words(id) {
    return id
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .replace(/\b(get|set|is|has)\s+(?=\w)/gi, '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => PLAIN_WORDS[w] ?? w)
        .join(' ');
}
const SPECIAL_FILES = {
    'CLAUDE.md': 'the instructions for AI agents',
    'AGENTS.md': 'the instructions for AI agents',
    'README.md': 'the README',
    'package.json': 'the list of building blocks',
    'package-lock.json': 'the list of building blocks',
    'pnpm-lock.yaml': 'the list of building blocks',
    '.nvmrc': 'the Node version file',
    '.node-version': 'the Node version file',
};
/** "apps/api/…/get-chart-data.service.spec.ts" -> "the chart data logic tests". */
export function fileName(path) {
    const clean = path.replace(/["']/g, '');
    const base = clean.split('/').filter(Boolean).pop() ?? clean;
    const special = SPECIAL_FILES[base];
    if (special)
        return special;
    if (base.startsWith('.'))
        return 'a settings file';
    const isTest = /\.(spec|test)\.[a-z0-9]+$/i.test(base);
    const stem = base.replace(/\.[a-z0-9]+$/i, '').replace(/\.(spec|test)$/i, '');
    if (stem === 'index') {
        const dir = clean.split('/').filter(Boolean).slice(-2, -1)[0];
        return dir ? `the ${words(dir)} module` : 'an index file';
    }
    const name = words(stem);
    return name ? `the ${name}${isTest ? ' tests' : ''}` : 'a file';
}
/** Which part of the project a path is in, when that says something; else null. */
function area(path) {
    const p = path.replace(/["']/g, '');
    if (!p || p.includes('$') || /^\/(etc|tmp|var|usr|dev)\b/.test(p))
        return null;
    if (/apps\/api\b/.test(p))
        return 'the API';
    if (/apps\/(root|web)\b/.test(p))
        return 'the web app';
    const dir = p.split('/').filter((s) => s && !s.startsWith('-') && !/^\.+$/.test(s)).pop();
    return dir && !/[.*]/.test(dir) ? `the ${words(dir)} folder` : null;
}
/** Search terms out of a pattern: "REDDIT_SHARES\|getTwitterSharesObject" -> ["reddit shares", "twitter shares object"]. */
function terms(pattern) {
    return [
        ...new Set(pattern
            .replace(/^["']|["']$/g, '')
            .split(/\\\||\|/)
            .map((t) => t.replace(/\\[bswd]|[\\^$()[\]{}*+?.]/g, ' ').trim())
            .map(words)
            .map((t) => t.replace(/\s+/g, ' ').trim())
            .filter((t) => /[a-z]{2,}/.test(t) && !/[:;=<>"']/.test(t))),
    ].slice(0, 3);
}
function quoted(list) {
    const q = list.map((t) => `"${t}"`);
    return q.length > 1 ? `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}` : (q[0] ?? '');
}
/* ---------- commands ---------- */
/** Programs that only shape another command's output, or set things up, and say nothing on their own. */
const QUIET = new Set([
    'cd', 'head', 'tail', 'sort', 'uniq', 'wc', 'echo', 'printf', 'true', 'xargs', 'tr', 'cut', 'awk', 'nl',
    'export', 'which', 'sleep', 'for', 'do', 'done', 'if', 'then', 'fi', 'while', 'until', 'seq', 'ps', 'lsof',
]);
/** A whole shell line as one sentence: its first two steps, and "and more" past that. */
export function shellSentence(line) {
    if (!line.trim())
        return FALLBACK;
    if (/\b(for|until|while)\b.*\bsleep\b/.test(line))
        return 'Waiting for the app to be ready';
    if (/^(ps|lsof)\b/.test(line.trim()) && !/&&|;\s*(?!lsof|ps)\w/.test(line))
        return 'Checking what is running';
    const steps = splitCommands(line)
        .map((w) => {
        let i = 0;
        while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]))
            i++;
        return w.slice(i);
    })
        .filter((w) => w.length && !QUIET.has(w[0]) && !/^(EOF|\)|\})/.test(w[0]))
        .map(step)
        .filter((s) => !!s);
    const unique = [...new Set(steps)];
    if (!unique.length)
        return FALLBACK;
    const [first, second, ...more] = unique;
    return capital(second ? `${first}, then ${second}${more.length ? ', and more' : ''}` : first);
}
/** The commands in a line, each as its words; quoted words kept whole. */
function splitCommands(line) {
    const out = [];
    let cur = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            cur += c;
            if (c === quote)
                quote = null;
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            cur += c;
            continue;
        }
        if (c === '\\') {
            cur += c + (line[++i] ?? '');
            continue;
        }
        if (c === ';' || c === '|' || c === '&' || c === '\n') {
            if (cur.trim())
                out.push(cur.trim());
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.trim())
        out.push(cur.trim());
    return out.map((seg) => (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).filter((w) => !/^\d>/.test(w) && w !== '/dev/null'));
}
/** One command as a phrase, "" for one that only filters, or null for one nothing here knows. */
function step(w) {
    const prog = w[0].split('/').pop();
    const rest = w.slice(1);
    const args = rest.filter((a) => !a.startsWith('-'));
    const flags = rest.filter((a) => a.startsWith('-')).join(' ');
    const firstPath = args.find((a) => /[/.]/.test(a) && !/^["']/.test(a));
    const all = rest.join(' ');
    switch (prog) {
        case 'grep':
        case 'rg':
        case 'egrep': {
            // -v leaves things out and -q only checks; neither is a search worth naming.
            if (/(^|\s)-[a-zA-Z]*[vq]/.test(flags))
                return '';
            const found = terms(args[0] ?? '');
            const where = args[1] ? area(args[1]) : null;
            return found.length ? `searching ${where ?? 'the code'} for ${quoted(found)}` : 'searching the code';
        }
        case 'sed': {
            // The first word is the script; files, if any, come after it. With none,
            // sed is only reshaping text in a pipe, which is not worth naming.
            const file = args.slice(1).at(-1);
            if (!file)
                return '';
            if (/-i/.test(flags))
                return /\/d['"]?$/.test(args[0] ?? '') ? `removing a line from ${fileName(file)}` : `changing text in ${fileName(file)}`;
            return `reading part of ${fileName(file)}`;
        }
        case 'cat':
        case 'less': {
            const into = /(?:^|\s)>>?\s*([^\s<]+)/.exec(w.join(' '));
            if (into)
                return `writing ${fileName(into[1])}`;
            return firstPath ? `reading ${fileName(firstPath)}` : 'reading a file';
        }
        case 'ls':
        case 'tree':
            return `looking at the files in ${area(firstPath ?? '') ?? 'this folder'}`;
        case 'find': {
            const at = rest.indexOf('-name');
            const name = at >= 0 ? rest[at + 1] : undefined;
            return name ? `finding files named like ${name.replace(/["'*]/g, '')}` : `looking through the files in ${area(args[0] ?? '') ?? 'the project'}`;
        }
        case 'git':
            return gitStep(rest);
        case 'npm':
        case 'pnpm':
        case 'yarn':
        case 'npx':
        case 'bun':
            return packageStep(rest);
        case 'next':
        case 'vite':
            return /dev|start/.test(all) ? 'starting the app' : /build/.test(all) ? 'building the app' : 'working on the app';
        case 'tsc':
            return 'checking the code for type errors';
        case 'jest':
        case 'vitest':
            return 'running the tests';
        case 'playwright':
            return 'running the browser tests';
        case 'eslint':
            return 'checking the code style';
        case 'prettier':
        case 'oxfmt':
            return 'tidying the code formatting';
        case 'gh':
            return /pr create/.test(all) ? 'opening a pull request' : /pr (view|checks|status|diff)/.test(all) ? 'checking the pull request' : 'talking to GitHub';
        case 'curl':
        case 'wget':
            return 'fetching something from the web';
        case 'pkill':
        case 'kill':
            return 'stopping the app it started';
        case 'mkdir':
            return 'creating a folder';
        case 'rm':
            return firstPath ? `deleting ${fileName(firstPath)}` : 'deleting files';
        case 'mv':
            return 'moving files';
        case 'cp':
            return 'copying files';
        case 'node':
        case 'python':
        case 'python3':
        case 'tsx':
            return 'running a small script';
        case 'jq':
            return 'reading data from a file';
        default:
            return null;
    }
}
function gitStep(all) {
    // Step past git's own options, such as -C <folder> or -c key=value, to the subcommand.
    let i = 0;
    while (i < all.length && all[i].startsWith('-'))
        i += /^-(C|c)$|^--(git-dir|work-tree)$/.test(all[i]) ? 2 : 1;
    const [sub, ...more] = all.slice(i);
    const at = more.indexOf('-m');
    const message = at >= 0 ? more[at + 1]?.replace(/^["']|["']$/g, '') : undefined;
    switch (sub) {
        case 'log':
            return 'checking the history of changes';
        case 'diff':
            return 'comparing what has changed';
        case 'status':
            return 'checking what has changed';
        case 'show':
            return 'looking at an earlier change';
        case 'branch':
            return 'checking which branch it is on';
        case 'add':
            return 'getting changes ready to save';
        case 'commit':
            return message ? `saving progress: "${message}"` : 'saving progress';
        case 'push':
            return 'uploading the changes to GitHub';
        case 'pull':
        case 'fetch':
            return 'getting the latest changes';
        case 'checkout':
            return more.includes('-b') ? 'starting a new branch' : 'switching branch';
        case 'switch':
            return more.includes('-c') ? 'starting a new branch' : 'switching branch';
        case 'stash':
            return 'setting changes aside';
        case 'grep': {
            const found = terms(more.find((a) => !a.startsWith('-')) ?? '');
            return found.length ? `searching the code for ${quoted(found)}` : 'searching the code';
        }
        case 'mv':
            return 'renaming files';
        case 'rm':
            return 'deleting files';
        case 'ls-files':
            return 'listing the project files';
        case 'rev-parse':
            return 'checking where it is in the project';
        default:
            return 'working with the project history';
    }
}
function packageStep(rest) {
    const all = rest.join(' ');
    const job = rest.filter((a) => !a.startsWith('-') && !['run', 'exec', 'x', 'dlx', '--'].includes(a));
    const [task = '', ...target] = job;
    const what = target.find((t) => /^[\w@/-]+$/.test(t) && !/^\d/.test(t));
    if (/test|vitest|jest/.test(task))
        return `running the tests${what ? ` for ${words(what)}` : ''}`;
    if (task === 'playwright')
        return /--version|--help/.test(all) ? 'checking the browser test tools' : 'running the browser tests';
    if (/^(lint|eslint)$/.test(task))
        return 'checking the code style';
    if (/^(tsc|typecheck|type-check)$/.test(task))
        return 'checking the code for type errors';
    if (task === 'next' || task === 'vite')
        return /dev|start/.test(all) ? 'starting the app' : 'building the app';
    if (/^(dev|start|serve)$/.test(task))
        return 'starting the app';
    if (task === 'build')
        return 'building the app';
    if (/^(oxfmt|prettier|format)$/.test(task))
        return 'tidying the code formatting';
    if (/^(install|i|ci|add)$/.test(task))
        return what ? `installing ${what}` : 'installing what the project needs';
    if (task === 'nx' || task === 'turbo') {
        return /test/.test(all) ? 'running the tests' : /lint/.test(all) ? 'checking the code style' : /type/.test(all) ? 'checking the code for type errors' : 'running a project task';
    }
    return task ? `running ${words(task)}` : 'running a project task';
}
