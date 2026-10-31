import { basename, isAbsolute, relative, resolve } from 'node:path';
/**
 * Human bubble text for a tool call, e.g. "Editing ReportPanel.tsx" or
 * "Running npm test". Falls back to the tool name so an unknown tool still
 * shows something truthful.
 */
export function bubbleForTool(tool, args) {
    const a = (args ?? {});
    const str = (...keys) => {
        for (const k of keys) {
            const v = a[k];
            if (typeof v === 'string' && v.trim())
                return v.trim();
        }
        return null;
    };
    const file = str('path', 'file_path', 'filePath', 'target_file', 'relative_file_path', 'file');
    const name = file ? basename(file) : null;
    switch (normalizeTool(tool)) {
        case 'read':
            return name ? `Reading ${name}` : 'Reading the code';
        case 'edit':
            return name ? `Editing ${name}` : 'Editing files';
        case 'write':
            return name ? `Writing ${name}` : 'Writing a file';
        case 'delete':
            return name ? `Deleting ${name}` : 'Deleting a file';
        case 'shell': {
            const cmd = str('command', 'cmd');
            return cmd ? `Running ${shortCommand(cmd)}` : 'Running a command';
        }
        case 'search': {
            const q = str('query', 'pattern', 'search_term');
            return q ? `Searching for ${truncate(q, 28)}` : 'Searching the repo';
        }
        case 'list':
            return 'Looking around the repo';
        case 'todo':
            return 'Planning the work';
        case 'fetch':
            return 'Reading the docs';
        case 'mcp': {
            const m = /^mcp__([^_]+)__(.+)$/.exec(tool);
            if (!m || m[1] === '8090')
                return 'Checking 8090';
            const server = m[1];
            return `Checking ${server}: ${truncate(m[2], 28)}`;
        }
        default:
            return `Running ${truncate(tool, 28)}`;
    }
}
/** Collapses the many tool spellings across modes into one vocabulary. */
export function normalizeTool(tool) {
    const t = tool.toLowerCase();
    if (t.includes('mcp') || t.includes('work_order') || t.includes('blueprint'))
        return 'mcp';
    if (t.includes('todo'))
        return 'todo';
    // 'execute' is ACP's own name for a shell call, and the only one that turns
    // up on a permission request.
    if (t.includes('terminal') || t.includes('shell') || t.includes('command') || t.includes('bash') || t.includes('execute')) {
        return 'shell';
    }
    if (t.includes('multiedit') || t.includes('search_replace') || t.includes('edit') || t.includes('patch'))
        return 'edit';
    if (t.includes('write') || t.includes('create'))
        return 'write';
    if (t.includes('delete') || t.includes('remove'))
        return 'delete';
    if (t.includes('grep') || t.includes('search') || t.includes('glob') || t.includes('codebase'))
        return 'search';
    if (t.includes('read') || t.includes('view') || t.includes('cat'))
        return 'read';
    if (t.includes('ls') || t.includes('list_dir'))
        return 'list';
    if (t.includes('fetch') || t.includes('web'))
        return 'fetch';
    return t;
}
/* ---------- what kind of job a tool call is ---------- */
const GIT_PROGRAMS = new Set(['git', 'gh', 'glab', 'hub', 'git-lfs']);
const CLOUD_PROGRAMS = new Set([
    'aws', 'sam', 'cdk', 'gcloud', 'gsutil', 'bq', 'az',
    'kubectl', 'helm', 'k9s', 'kustomize', 'minikube', 'eksctl',
    'docker', 'docker-compose', 'podman',
    'terraform', 'tofu', 'terragrunt', 'pulumi', 'ansible', 'ansible-playbook',
    'vercel', 'netlify', 'wrangler', 'fly', 'flyctl', 'heroku', 'firebase', 'supabase', 'railway', 'doctl',
    'serverless', 'sls', 'ssh', 'scp',
]);
const TICKET_PROGRAMS = new Set();
/** Words in front of the program that is actually being run. */
const PREFIXES = new Set(['sudo', 'env', 'time', 'nohup', 'command', 'exec', 'npx', 'bunx', 'pnpx']);
/**
 * What kind of job a tool call is, which decides where in the office the
 * worker goes to do it. Only ever a guess from names: a wrong one sends a
 * worker to the wrong corner for a few seconds, and that is all it costs.
 */
export function activityForTool(tool, input, label) {
    const args = (input ?? {});
    const name = tool.toLowerCase();
    const mcp = mcpCallName(name, args, label);
    if (mcp)
        return activityForMcp(mcp);
    // Cursor's titles name web calls even where its kinds lump them in with
    // code search: a web search arrives as kind 'search'.
    if (/^web[_\s-]?(search|fetch)/.test(name) || /^(web (search|fetch)|fetch mcp resource|list mcp resources)/i.test(label)) {
        return 'research';
    }
    if (/^(update|read) todos/i.test(label))
        return 'thinking';
    switch (normalizeTool(tool)) {
        case 'shell': {
            const command = typeof args['command'] === 'string' ? args['command'] : (/^`([\s\S]+)`$/.exec(label.trim())?.[1] ?? '');
            return activityForCommand(command);
        }
        case 'fetch':
            return 'research';
        // ACP's kind for asking a question and for reflecting.
        case 'think':
        case 'todo':
            return 'thinking';
        default:
            return 'typing';
    }
}
/** "server tool" for an MCP call, however the runner spelled it, or null for anything else. */
function mcpCallName(name, args, label) {
    // Claude Code: mcp__server__tool.
    if (name.startsWith('mcp__'))
        return name.slice(5).replace(/__/g, ' ');
    // Cursor puts both halves in the arguments, over ACP and in print mode alike...
    if (typeof args['toolName'] === 'string') {
        return `${String(args['providerIdentifier'] ?? '')} ${args['toolName']}`.toLowerCase();
    }
    // ...and in the title, as "server: tool", which is all there is when the arguments are missing.
    if (name === 'other' || name === 'mcp') {
        const match = /^([\w.@/-]+): ([\w.-]+)$/.exec(label.trim());
        if (match)
            return `${match[1]} ${match[2]}`.toLowerCase();
    }
    return null;
}
/**
 * The tool says more than the server does: Atlassian serves Jira issues and
 * Confluence pages, and 8090 serves work orders and the specs behind them.
 */
function activityForMcp(name) {
    if (/work_?order|issue|ticket|jql|sprint|epic|backlog/.test(name))
        return 'tickets';
    if (/blueprint|requirement|resource|confluence|page|doc|wiki|spec|search|fetch|knowledge|skill/.test(name)) {
        return 'research';
    }
    if (/github|gitlab|bitbucket/.test(name))
        return 'git';
    if (/supabase|aws|gcp|azure|vercel|netlify|cloudflare|heroku|railway|firebase|datadog|sentry|grafana|kubernetes|docker|terraform/.test(name)) {
        return 'cloud';
    }
    if (/8090|factory/.test(name))
        return 'tickets';
    return 'research';
}
/** Where a shell command's work happens, from the first program in it that says. */
function activityForCommand(command) {
    for (const { program, sub } of programsIn(command)) {
        if (GIT_PROGRAMS.has(program))
            return sub === 'issue' ? 'tickets' : 'git';
        if (CLOUD_PROGRAMS.has(program))
            return 'cloud';
        if (TICKET_PROGRAMS.has(program))
            return 'tickets';
    }
    return 'typing';
}
/**
 * Each program a command runs, with the word after it. Looser than
 * `pipelinePrograms` on purpose: this only picks a spot in the room, so a
 * quoted `;` splitting one segment in two does no harm here.
 */
function programsIn(command) {
    const found = [];
    for (const segment of command.split(/&&|\|\||\$\(|[;|&\n(){}`]/)) {
        const words = segment.trim().split(/\s+/).filter(Boolean);
        let i = 0;
        while (i < words.length) {
            const word = words[i] ?? '';
            if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word.startsWith('-') || PREFIXES.has(basename(word)))
                i++;
            else if ((word === 'pnpm' || word === 'yarn') && words[i + 1] === 'dlx')
                i += 2;
            else
                break;
        }
        const program = words[i];
        if (program)
            found.push({ program: basename(program), sub: words[i + 1] ?? '' });
    }
    return found;
}
function shortCommand(cmd) {
    const firstLine = cmd.split('\n')[0] ?? cmd;
    return truncate(firstLine.replace(/\s+/g, ' ').trim(), 32);
}
export function truncate(s, max) {
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
/**
 * Shortens a tool label without orphaning a backtick.
 *
 * ACP titles a shell call "`npm test`", and cutting one of those to length
 * mid-command leaves an opening marker with no closing one. The chat renders
 * a matched pair as code and anything else as plain text, so the stray marker
 * showed up as a backtick character sitting in the middle of the panel.
 */
export function truncateLabel(text, max) {
    const trimmed = text.trim();
    const code = /^`([^`]+)`$/.exec(trimmed);
    if (!code)
        return truncate(trimmed, max);
    // Two of the budget go on the backticks themselves.
    return `\`${truncate(code[1] ?? '', Math.max(1, max - 2))}\``;
}
/**
 * The standing instructions ask agents to prefix anything they need from Operator
 * with QUESTION:, which is how a turn that ended in a question becomes
 * `needs_you` rather than `idle`.
 */
export function extractQuestion(text) {
    const m = /^[ \t>*-]*QUESTION:\s*(.+)$/im.exec(text);
    return m?.[1]?.trim() ?? null;
}
let textQuestionSeq = 0;
/** How the id of a question read out of an agent's reply starts. */
const TEXT_QUESTION = 'text-question-';
/**
 * Whether a question was read out of an agent's reply rather than asked by
 * its runner. The agent ended its turn on it, so nothing is waiting on the
 * answer: it has to be sent to the agent as a message.
 */
export function isTextQuestion(request) {
    return request.id.startsWith(TEXT_QUESTION);
}
/**
 * What can come before an option's letter: an indent, any `>` quotes, then a
 * `-`, `*`, `+` or `•` bullet or a `#` heading. A `*` bullet has a space
 * after it, which is what tells the bullet in `* A) Patch` from the italics
 * in `*A)* Patch`.
 */
const OPTION_LEAD = /^[ \t]*(?:>[ \t]*)*(?:[-+•][ \t]*|\*[ \t]+|#{1,6}[ \t]+)?/;
/**
 * An option's letter: `(A)`, `[A]` or a bare `A`, maybe after "Option" or
 * "Choice". `[A](…)` is a link and `[x]` a ticked box, so neither is one.
 */
const OPTION_LETTER = /^(?:(?:option|choice)[ \t]+)?(?:\(([a-z])\)|\[(?!x\])([a-z])\](?!\()|([a-z])(?![a-z\d'’]))/i;
/** A short note between an option's letter and its text, as in `B (recommended):`. */
const OPTION_NOTE = /^[ \t]*\(([^()\n]{1,40})\)/;
/**
 * What ends a bare letter: `)`, `.`, `:` or a dash. A hyphen needs a space
 * before it and a space or the closing bold after it, so "A-list" is a word.
 */
const OPTION_SEPARATOR = /^(?:[ \t]*[:.)]|[ \t]+--?(?=[ \t*_])|[ \t]*[—–])/;
/** A comma, semicolon or "or" at the end of an option, joining it to the next. */
const OPTION_JOINER = /(?:[ \t]*[,;]|[ \t]+(?:\*{1,2}|_{1,2})?or(?:\*{1,2}|_{1,2})?)+[ \t]*$/i;
/** The start of an item in a numbered list: `1.`, `2)` or `**3.**`, indented or not. */
const NUMBERED_ITEM = /^[ \t]*(?:\*\*)?\d+[.)](?:\*\*)?[ \t]/;
/**
 * Parses a plain text question with choices like:
 *   QUESTION: Do you want me to:
 *   - (A) First option description
 *   - (B) Second option description
 *
 * A numbered list after the QUESTION: line is one question per item, each
 * with the choices under it, so the choices under item 2 are shown under
 * item 2 rather than under whatever line followed QUESTION:.
 *
 * Returns a QuestionRequest if choices are found, null otherwise.
 */
export function extractQuestionWithChoices(text) {
    // [ \t]* rather than \s*: on an empty QUESTION: line, \s* ran on into the
    // next line and made the first numbered question the title.
    const questionMatch = /^[ \t>*-]*QUESTION:[ \t]*(.*)$/im.exec(text);
    if (!questionMatch)
        return null;
    const lead = questionMatch[1].trim();
    const afterQuestion = text.slice(questionMatch.index + questionMatch[0].length);
    // Need at least 2 choices to make it worthwhile
    const asked = textQuestions(afterQuestion, lead).filter((q) => q.choices.length >= 2);
    if (!asked.length)
        return null;
    const title = (asked.length === 1 ? lead || asked[0].ask : lead || 'The agent has a few questions') || 'The agent has a question';
    return {
        id: `${TEXT_QUESTION}${++textQuestionSeq}-${Date.now().toString(36)}`,
        title,
        questions: asked.map((q, i) => ({
            key: asked.length === 1 ? 'choice' : `choice-${i + 1}`,
            header: null,
            text: q.ask && q.ask !== title ? q.ask : null,
            multiple: false,
            options: q.choices.map((c) => ({
                value: c.key,
                label: `(${c.key}) ${c.label}`,
                description: null,
            })),
            otherKey: null,
        })),
        createdAt: new Date().toISOString(),
    };
}
/**
 * The questions in what follows a QUESTION: line, each with its choices.
 *
 * A choice belongs to the numbered item it sits under: indented beneath it,
 * or straight after an item that asks something. A numbered item that only
 * lists context ("1. The parser") owns no choices that aren't indented under
 * it, and a blank line followed by an outdented line ends the item. Every
 * other choice is the QUESTION: line's own question; when that line is empty,
 * the line above its first choice asks it. A letter that comes round again
 * starts the next question, so no question offers two (A)s.
 */
function textQuestions(text, lead) {
    const asked = [{ ask: lead || null, choices: [] }];
    const open = (ask) => {
        const question = { ask, choices: [] };
        asked.push(question);
        return question;
    };
    let loose = asked[0];
    let item = null;
    let gap = false;
    let above = null;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
            gap = true;
            continue;
        }
        const indent = /^[ \t]*/.exec(line)[0].length;
        if (item && gap && indent <= item.indent)
            item = null;
        gap = false;
        if (NUMBERED_ITEM.test(line)) {
            const ask = questionLine(line);
            const asks = !!ask?.includes('?');
            item = { indent, asks, question: open(ask) };
            above = asks ? line : null;
            continue;
        }
        const choice = readChoice(line);
        if (!choice) {
            above = line;
            continue;
        }
        const { key } = choice;
        const under = item && (item.asks || indent > item.indent) ? item : null;
        let owner = under?.question ?? loose;
        if (owner.choices.some((c) => c.key === key)) {
            // Two (A)s would make the pick ambiguous, and the answer would name the first.
            owner = open(above ? questionLine(above) : null);
            if (under)
                under.question = owner;
            else
                loose = owner;
        }
        else if (!owner.ask && !owner.choices.length && above) {
            owner.ask = questionLine(above);
        }
        owner.choices.push(choice);
        above = null;
    }
    return asked;
}
/**
 * One option line, or null when the line is not one.
 *
 * Agents mark options every which way: `- **B (recommended):** Commit it`,
 * `**(a) Live preview.** More`, `### Option C — Wait`. The letter has to be
 * marked by brackets, a separator or bold, so a sentence that happens to
 * start with "I" or "A" is not taken for one. Bold that only marks the letter
 * goes with it. Bold that runs on into the text, as a heading's does, stays
 * on what is left of that text. A note goes in front of the text, so
 * `B (recommended): Commit` reads "Recommended: Commit".
 */
function readChoice(line) {
    let rest = line.replace(OPTION_LEAD, '');
    const open = /^(?:\*{1,3}|_{1,3})(?=\S)/.exec(rest)?.[0] ?? '';
    rest = rest.slice(open.length);
    const letter = OPTION_LETTER.exec(rest);
    if (!letter)
        return null;
    rest = rest.slice(letter[0].length);
    // The bold or italics can close after the letter, the note or the
    // separator, which come in either order: `**A** (recommended):`,
    // `**B (recommended):**`, `A) (recommended)`.
    const escaped = open.replace(/\*/g, '\\*');
    const close = open ? new RegExp(`^${escaped}(?![*_])`) : null;
    const take = (pattern) => {
        const m = pattern?.exec(rest) ?? null;
        if (m)
            rest = rest.slice(m[0].length);
        return m;
    };
    let closed = false;
    let separated = false;
    let note = null;
    let noteInBold = false;
    for (;;) {
        if (!closed && take(close)) {
            closed = true;
            noteInBold = note !== null;
            continue;
        }
        const noted = note === null ? take(OPTION_NOTE) : null;
        if (noted) {
            note = noted[1].trim();
            continue;
        }
        if (!separated && take(OPTION_SEPARATOR)) {
            separated = true;
            continue;
        }
        break;
    }
    // Brackets mark a letter by themselves; a bare one needs more.
    if (letter[3] && !separated && !closed)
        return null;
    const text = /^[ \t]+(\S.*)$/.exec(rest)?.[1];
    if (!text)
        return null;
    // The chat only renders `*`, so `__` and `_` become `**` and `*`.
    const bold = open.replace(/_/g, '*');
    const said = note ? `${note.replace(/[a-z]/i, (c) => c.toUpperCase())}:` : '';
    const front = said ? `${said} ` : '';
    let label = noteInBold ? `${bold}${said}${bold} ${text}` : `${front}${text}`;
    if (open && !closed) {
        // A bold heading: the bold opened before the letter and closes in the
        // text, so it goes back in front. Bold that never closes is dropped.
        const end = new RegExp(`(?<=[^\\s*_])${escaped}(?![\\w*])`).exec(text);
        if (end)
            label = `${bold}${front}${text.slice(0, end.index)}${bold}${text.slice(end.index + open.length)}`;
    }
    label = label.replace(OPTION_JOINER, '').trim();
    // Bold over the whole option only marked it as one, and the button's text is bold already.
    label = /^(\*{1,3})([^*]+)\1$/.exec(label)?.[2] ?? label;
    return label ? { key: (letter[1] ?? letter[2] ?? letter[3]).toUpperCase(), label } : null;
}
/** A question's own words: no list marker or bold, and nothing after its question mark. */
function questionLine(line) {
    const plain = line.replace(/^[ \t>*-]*(?:\d+[.)])?/, '').replace(/\*\*/g, '').trim();
    return (/^[^?]*\?/.exec(plain)?.[0] ?? plain).trim() || null;
}
export function endsWithQuestion(text) {
    const last = text.trim().split('\n').pop() ?? '';
    return /\?[\s*_)"'”`]*$/.test(last);
}
export function extractWorkPlan(text) {
    const m = /^[ \t>*-]*START_WORK:[ \t]*/im.exec(text);
    if (!m)
        return null;
    return text.slice(m.index + m[0].length).trim() || null;
}
/**
 * The path or branch on a plan's `WORKTREE:` line: where the worker says the
 * work already lives, so the office puts it there rather than on a new branch.
 */
export function extractWorktreeHint(plan) {
    const m = /^[ \t>*-]*WORKTREE:[ \t]*(.+)$/im.exec(plan);
    if (!m)
        return null;
    return m[1].trim().replace(/^[`'"]+|[`'".,;]+$/g, '').trim() || null;
}
/** Every GitHub pull request URL in the text, once each, in order. */
export function githubPullUrls(text) {
    const urls = [...text.matchAll(/https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g)].map((m) => m[0]);
    return [...new Set(urls)];
}
/** What follows a `TICKET_DRAFT:` line, the hand-off a shaping Planner ends with. */
export function extractTicketDraft(text) {
    const m = /^[ \t>*-]*TICKET_DRAFT:[ \t]*/im.exec(text);
    if (!m)
        return null;
    return text.slice(m.index + m[0].length).trim() || null;
}
/**
 * Reads a hand-off of the form
 *
 *     Title: Reputation Center: saved filters — frontend
 *     Type: User Story
 *     Labels: reputation-center
 *     Priority: Low
 *     ---
 *     ## Summary …
 *
 * Lenient on purpose: a missing header falls back (the title to `fallbackTitle`),
 * and with no `---` at all the whole text is the description, so a Planner's
 * draft is never lost to its formatting.
 */
export function parseTicketDraft(raw, fallbackTitle) {
    const body = raw.replace(/^```[a-z]*\n/i, '').replace(/\n```\s*$/, '');
    const split = /^-{3,}[ \t]*$/m.exec(body);
    const head = split ? body.slice(0, split.index) : '';
    const description = (split ? body.slice(split.index + split[0].length) : body).trim();
    const field = (name) => {
        const m = new RegExp(`^[ \\t*-]*${name}[ \\t*]*:[ \\t*]*(.*)$`, 'im').exec(head);
        const value = m?.[1]?.replace(/^\*+|\*+$/g, '').trim();
        return value ? value : null;
    };
    return {
        title: field('Title') ?? fallbackTitle,
        type: field('Type') ?? 'User Story',
        labels: (field('Labels') ?? '').split(',').map((l) => l.trim()).filter(Boolean),
        priority: field('Priority'),
        description,
    };
}
let permissionSeq = 0;
export function makePermissionRequest(args) {
    return {
        id: `perm-${++permissionSeq}-${Date.now().toString(36)}`,
        title: args.title,
        detail: args.detail ?? null,
        options: args.options?.length
            ? args.options
            : [
                { id: 'allow', label: 'Approve', kind: 'allow' },
                { id: 'deny', label: 'Deny', kind: 'deny' },
            ],
        rule: args.rule ?? null,
        ...(args.readOnly ? { readOnly: true } : {}),
        ...(args.plain ? { plain: args.plain } : {}),
        createdAt: new Date().toISOString(),
    };
}
/* ---------- standing approvals ---------- */
/**
 * Programs never covered by a standing approval, whatever their arguments:
 * they reach the network, need root, or hide what they really run. The spec
 * forbids waving through installs, pushes and network calls, and a program
 * that can run another program can do any of the three.
 */
const ASK_EVERY_TIME = new Set([
    'curl', 'wget', 'nc', 'netcat', 'telnet', 'ssh', 'scp', 'sftp', 'rsync', 'ftp',
    'gh', 'glab', 'hub', 'aws', 'gcloud', 'az', 'kubectl', 'docker', 'heroku',
    'pip', 'pip3', 'pipx', 'gem', 'brew', 'apt', 'apt-get', 'yum', 'conda', 'port', 'npx', 'bunx',
    'sudo', 'su', 'doas', 'eval', 'exec', 'source', 'bash', 'sh', 'zsh', 'fish', 'env', 'xargs',
    // Interpreters, which run whatever they are handed. `awk 'BEGIN{system(...)}'`
    // is a shell by another name, and so is `perl -e`, `python -c` and
    // `find -exec`. A grant on the program name would cover all of it.
    'awk', 'gawk', 'mawk', 'perl', 'python', 'python2', 'python3', 'ruby', 'node', 'deno',
    'osacompile', 'find', 'watch', 'nohup', 'time', 'timeout', 'script',
    'rm', 'rmdir', 'mv', 'dd', 'truncate', 'shred', 'chmod', 'chown', 'ln',
    'kill', 'killall', 'pkill', 'launchctl', 'crontab', 'defaults', 'osascript', 'open', 'security',
]);
/**
 * Subcommands withheld from the programs that do many different jobs. This is
 * what lets `npm test` be granted while `npm install` never can be.
 */
const ASK_EVERY_TIME_SUB = new Set([
    'git push', 'git clone', 'git fetch', 'git pull', 'git remote', 'git config',
    'git submodule', 'git reset', 'git clean', 'git filter-branch', 'git worktree',
    'npm install', 'npm i', 'npm ci', 'npm add', 'npm update', 'npm uninstall',
    'npm publish', 'npm link', 'npm exec', 'npm audit',
    'pnpm install', 'pnpm add', 'pnpm update', 'pnpm remove', 'pnpm dlx',
    'yarn install', 'yarn add', 'yarn upgrade', 'yarn remove', 'yarn dlx',
    'bun install', 'bun add', 'bun remove', 'bun x',
    'cargo install', 'cargo add', 'cargo publish',
    'go get', 'go install',
    'uv add', 'uv pip', 'uv sync', 'poetry add', 'poetry install', 'bundle install',
]);
/** Programs whose first argument changes the job enough to be keyed on it. */
const MULTI_TOOL = new Set([
    'git', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'pip', 'uv', 'poetry',
    'bundle', 'docker', 'make', 'dotnet', 'mvn', 'gradle', 'nx', 'turbo',
]);
/** Subcommands that hand off to something else, whose name is the real job. */
const RUN_SUBCOMMANDS = new Set(['run', 'run-script', 'exec', 'x', 'dlx']);
const FILE_PATH_KEYS = ['path', 'file_path', 'filePath', 'target_file', 'relative_file_path', 'file'];
/** How a standing approval for a non-shell tool reads in the panel. */
const TOOL_LABELS = {
    read: 'reading files here',
    edit: 'editing files here',
    write: 'writing files here',
    search: 'searching this repo',
    list: 'listing folders here',
    todo: 'keeping its to-do list',
};
/**
 * What a standing approval for this tool call would cover, or null when the
 * call has to reach Operator however many times it is made.
 *
 * Shell calls are keyed on the programs in the pipeline rather than on the
 * whole command, so approving `rg foo` also covers `rg bar` — the repetition
 * is the thing being fixed. Withheld either way: anything that leaves the
 * worktree, pushes, installs, talks to the network, needs root, or runs a
 * command the text does not name.
 */
export function ruleForToolCall(args) {
    const kind = normalizeTool(args.tool);
    const input = (args.rawInput ?? {});
    // Deleting is the one thing git cannot give back, a fetch is a network call
    // whatever it claims to be fetching, and an 8090 write needs Operator by spec.
    if (kind === 'delete' || kind === 'fetch' || kind === 'mcp')
        return null;
    if (kind === 'shell') {
        const fromInput = input['command'] ?? input['cmd'];
        const raw = typeof fromInput === 'string' ? fromInput : commandFromTitle(args.title);
        if (!raw?.trim())
            return null;
        if (escapesWorktree(raw, args.worktreePath))
            return null;
        const programs = pipelinePrograms(raw);
        if (!programs)
            return null;
        if (programs.some(askEveryTime))
            return null;
        const unique = [...new Set(programs)].sort();
        return { key: `${SHELL_KEY}${unique.join('+')}`, label: unique.join(', ') };
    }
    const label = TOOL_LABELS[kind];
    if (!label)
        return null;
    // A file tool's paths have to be inside the worktree for the same reason a
    // command's do. "Editing files here" has to mean here.
    const paths = [
        ...(args.locations ?? []),
        ...FILE_PATH_KEYS.map((k) => input[k]).filter((v) => typeof v === 'string'),
    ];
    if (paths.some((p) => !isInside(p, args.worktreePath)))
        return null;
    return { key: `tool:${kind}`, label };
}
/** Commands that only read, whatever their arguments (bar the ones refused below). */
const READ_ONLY_PROGRAMS = new Set([
    'rg', 'grep', 'egrep', 'fgrep', 'ls', 'cat', 'head', 'tail', 'wc', 'find', 'tree', 'pwd', 'cd',
    'sort', 'uniq', 'cut', 'tr', 'file', 'stat', 'du', 'basename', 'dirname', 'realpath', 'diff', 'jq',
    'echo', 'printf', 'nl',
    'git log', 'git show', 'git diff', 'git status', 'git blame', 'git grep', 'git ls-files', 'git rev-parse',
    'git rev-list', 'git shortlog', 'git describe', 'git branch',
]);
/** `git branch` lists and shows; these flags make it delete, rename, copy or rewrite one. */
const GIT_BRANCH_WRITES = /\bgit\s+branch\b[^|;&]*\s(-[a-zA-Z]*[dDmMcCfu]|--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track|no-track))\b/;
/**
 * A connected tool that only looks things up, such as Jira's getJiraIssue or
 * searchJiraIssuesUsingJql, Linear's get_issue or list_issues, or Figma's
 * figma_get_nodes or figma_render.
 */
const MCP_LOOKUP = /^mcp__github__(get|list|search)_[a-z_]+$/;
const WRITING_ARGS = {
    sort: /^(-[a-zA-Z]*o|--output|--compress-program)/,
    tree: /^-[a-zA-Z]*o/,
    file: /^(-[a-zA-Z]*C|--compile)/,
    rg: /^--pre(=|$)/,
    git: /^(--output(=|$)|--open-files-in-pager|-O)/,
};
function segmentWrites(segment) {
    const words = segment.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^['"]|['"]$/g, ''));
    const [program = '', ...rest] = words;
    if (program.includes('/') || program.includes('='))
        return true;
    const writing = WRITING_ARGS[program];
    if (writing && rest.some((w) => writing.test(w)))
        return true;
    const operands = rest.filter((w) => !w.startsWith('-'));
    if (program === 'uniq' && operands.length > 1)
        return true;
    if (program === 'git' && rest[0] === 'branch' && operands.length > 1 && !rest.some((w) => w === '--list' || w === '-l'))
        return true;
    return false;
}
/**
 * Whether a tool call only reads, inside the given folders: a read, search
 * or list tool, or a command made only of read-only programs. Anything that
 * could write is refused: an output redirect, `find -delete` or `-exec`, a
 * substitution, or a path outside the folders. When in doubt it says no, and
 * the request goes to Operator as usual.
 */
export function isReadOnlyCall(args, roots) {
    const kind = normalizeTool(args.tool);
    const input = (args.rawInput ?? {});
    const inside = (p) => roots.some((root) => isInside(p, root));
    if (args.title && MCP_LOOKUP.test(args.title.trim()))
        return true;
    if (kind === 'read' || kind === 'search' || kind === 'list') {
        const paths = [
            ...(args.locations ?? []),
            ...FILE_PATH_KEYS.map((k) => input[k]).filter((v) => typeof v === 'string'),
        ];
        return paths.every(inside);
    }
    if (kind !== 'shell')
        return false;
    const fromInput = input['command'] ?? input['cmd'];
    const command = typeof fromInput === 'string' ? fromInput : commandFromTitle(args.title);
    if (!command?.trim())
        return false;
    // Writing output somewhere; only the harmless stderr and /dev/null forms pass.
    if (/>/.test(command.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, '')))
        return false;
    if (/(^|\s)-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)(\s|$)/.test(command))
        return false;
    if (/(?:^|[\s'"=:])~/.test(command))
        return false;
    if (command.includes('$'))
        return false;
    if (/(?:^|[\s'"=(/])\.\.(?:\/|\s|$)/.test(command))
        return false;
    if (GIT_BRANCH_WRITES.test(command))
        return false;
    if ((splitSegments(command) ?? []).some(segmentWrites))
        return false;
    const programs = pipelinePrograms(command);
    if (!programs || !programs.every((p) => READ_ONLY_PROGRAMS.has(p)))
        return false;
    for (const match of command.matchAll(/(?:^|[\s'"=(])(\/[^\s'";|&()<>]*)/g)) {
        const path = match[1] ?? '';
        if (path === '/dev/null')
            continue;
        if (!inside(path))
            return false;
    }
    return true;
}
export function writesOutside(args, root) {
    const kind = normalizeTool(args.tool);
    if (kind !== 'edit' && kind !== 'write' && kind !== 'delete')
        return false;
    const input = (args.rawInput ?? {});
    const paths = [
        ...(args.locations ?? []),
        ...FILE_PATH_KEYS.map((k) => input[k]).filter((v) => typeof v === 'string'),
    ];
    return !paths.length || paths.some((p) => !isInside(p, root));
}
export const NO_WORKTREE_YET = 'You have no worktree yet, so nothing can change outside your notes folder. If code has to change, end your turn with START_WORK: and your plan.';
const SHELL_KEY = 'shell:';
/**
 * The standing approvals that answering "always" leaves behind: one for each
 * program in a shell command, so each can be taken back on its own, and the
 * rule itself for anything else.
 */
export function grantsFor(rule) {
    if (!rule.key.startsWith(SHELL_KEY))
        return [rule];
    return keyPrograms(rule.key).map((program) => ({ key: `${SHELL_KEY}${program}`, label: program }));
}
/**
 * Whether standing approvals already cover a rule. A command is covered once
 * every program in it has been approved, in whatever commands they were
 * approved: after `git status` and `cd x && git log`, `cd y && git status`
 * has nothing new to ask about. Each program passed the never-approve lists
 * on its own, and the rule is only there because this command did too.
 */
export function isCovered(rule, granted) {
    if (granted.has(rule.key))
        return true;
    if (!rule.key.startsWith(SHELL_KEY))
        return false;
    return keyPrograms(rule.key).every((program) => granted.has(`${SHELL_KEY}${program}`));
}
/** The programs in a shell key. A doubled `+` belongs to a name like `g++`. */
function keyPrograms(key) {
    return key.slice(SHELL_KEY.length).split(/\+(?=[^+])/);
}
/**
 * The command out of an ACP title like "`wc -l package.json`".
 *
 * A permission request arrives with no rawInput, so the title is the only
 * place the command appears. Strict on purpose: a title that is not entirely
 * one backticked span is prose, and reading a command out of prose would put
 * a standing approval on something nobody has actually looked at. A truncated
 * title is refused for the same reason — the part cut off the end could be
 * another program in the pipeline.
 */
function commandFromTitle(title) {
    const match = /^`([^`]+)`$/.exec((title ?? '').trim());
    const command = match?.[1]?.trim();
    if (!command || /(…|\.\.\.)$/.test(command))
        return null;
    return command;
}
/**
 * Whether this key is withheld from standing approval.
 *
 * The bare program is checked as well as the whole key, because a program can
 * be on both lists above — `pip`, `docker` — and without this, appending a
 * subcommand to the key would slip it past both sets. `pip install` did.
 */
function askEveryTime(key) {
    if (ASK_EVERY_TIME.has(key) || ASK_EVERY_TIME_SUB.has(key))
        return true;
    const program = key.split(' ')[0] ?? '';
    return ASK_EVERY_TIME.has(program) || ASK_EVERY_TIME_SUB.has(`${program} ${key.split(' ')[1] ?? ''}`);
}
/**
 * Every program a shell command would run, or null when the command does not
 * say. A substitution, a heredoc or a nested subshell can run anything at
 * all, so there is no honest key to put on it.
 */
function pipelinePrograms(command) {
    if (/\$\(|`|\$\{|<</.test(command))
        return null;
    const segments = splitSegments(command);
    if (!segments)
        return null;
    const programs = [];
    for (const segment of segments) {
        const words = segment.trim().split(/\s+/).filter(Boolean);
        // FOO=bar cmd — step past the assignments to reach the program.
        let i = 0;
        while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] ?? ''))
            i++;
        const program = words[i];
        if (!program)
            continue;
        if (/^[-(){}]/.test(program))
            return null;
        const name = basename(program);
        if (!MULTI_TOOL.has(name)) {
            programs.push(name);
            continue;
        }
        const sub = words[i + 1];
        if (!sub || sub.startsWith('-')) {
            programs.push(name);
            continue;
        }
        // `npm run` is keyed down to the script, because package.json decides
        // what that actually does. Granting `npm run build` should not also grant
        // whatever `npm run deploy` turns out to be — and if a flag gets in the
        // way of naming the script at all (`uv run --with requests python`), the
        // command does not say what it runs and so cannot be granted.
        if (RUN_SUBCOMMANDS.has(sub)) {
            const script = words[i + 2];
            if (!script || script.startsWith('-'))
                return null;
            programs.push(`${name} ${sub} ${script}`);
            continue;
        }
        programs.push(`${name} ${sub}`);
    }
    return programs.length ? programs : null;
}
/**
 * Whether anything in this text reaches outside the worktree. "Agents run
 * only inside their worktree" is the one boundary the office really enforces,
 * so a standing approval must never be able to cover a way out of it.
 */
/**
 * Splits a command on its separators, leaving quoted text alone.
 *
 * A regex split cut straight through quotes, so the awk in
 * `git status --porcelain | awk '$1 ~ /^(AA|AU|DD)$/ {print $2}'` was read as
 * four more programs — which is where the unreadable entries in the approvals
 * list came from. Over-splitting was at least safe, since every fragment is
 * checked against the never-grant list, but a grant keyed on fragments of
 * someone's awk script covers nothing anybody could recognise, and so could
 * never be matched again or sensibly taken back.
 */
function splitSegments(command) {
    const segments = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < command.length; i++) {
        const c = command[i] ?? '';
        if (quote) {
            // Only double quotes honour a backslash. Inside single quotes it is an
            // ordinary character, and treating it as an escape would swallow the
            // closing quote and make the rest of the command look quoted.
            if (c === '\\' && quote === '"') {
                current += c + (command[++i] ?? '');
                continue;
            }
            if (c === quote)
                quote = null;
            current += c;
            continue;
        }
        if (c === '\\') {
            current += c + (command[++i] ?? '');
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            current += c;
            continue;
        }
        // `2>&1`, `>&2` and `&>file` redirect output rather than run anything in
        // the background, so the `&` stays with the command it belongs to.
        if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>')) {
            current += c;
            continue;
        }
        if (c === ';' || c === '\n' || c === '|' || c === '&') {
            if ((c === '|' && command[i + 1] === '|') || (c === '&' && command[i + 1] === '&'))
                i++;
            segments.push(current);
            current = '';
            continue;
        }
        current += c;
    }
    // An unbalanced quote means nobody can say where the command ends, which is
    // reason enough not to put a standing approval on it.
    if (quote !== null)
        return null;
    segments.push(current);
    return segments;
}
function escapesWorktree(text, worktreePath) {
    if (/(?:^|[\s'"=:])~/.test(text))
        return true;
    if (/(?:^|[\s'"=(/])\.\.(?:\/|\s|$)/.test(text))
        return true;
    for (const match of text.matchAll(/(?:^|[\s'"=(><])(\/[^\s'";|&()<>]*)/g)) {
        const path = match[1] ?? '';
        if (path.startsWith('/dev/'))
            continue; // 2>/dev/null and friends
        if (!isInside(path, worktreePath))
            return true;
    }
    return false;
}
/** Resolves relative paths against the worktree, so both forms are checked. */
function isInside(path, root) {
    const rel = relative(root, resolve(root, path));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
/**
 * The part of a finished tool's output worth putting in the chat.
 *
 * The CLI says nothing at all while a command runs — a forty-second test run
 * is one `in_progress` and then silence until the whole of stdout arrives at
 * once — so this is the only chance to show what it printed. A tail rather
 * than the lot: the panel is a chat, and a worker that cats a lockfile should
 * not push the conversation off the top of it.
 */
export function toolOutputTail(raw, ok, maxLines = 8, maxChars = 600) {
    if (typeof raw === 'string')
        return tail(raw, maxLines, maxChars);
    if (!raw || typeof raw !== 'object')
        return '';
    const o = raw;
    const stdout = typeof o['stdout'] === 'string' ? o['stdout'] : '';
    const stderr = typeof o['stderr'] === 'string' ? o['stderr'] : '';
    // A failure explains itself in stderr, and a success almost never does.
    const text = ok ? stdout || stderr : stderr || stdout;
    const code = o['exitCode'];
    const failed = typeof code === 'number' && code !== 0;
    const body = tail(text, maxLines, maxChars);
    if (!body)
        return failed ? `exit ${String(code)}` : '';
    return failed ? `exit ${String(code)}\n${body}` : body;
}
function tail(text, maxLines, maxChars) {
    const lines = text.replace(/\s+$/, '').split('\n');
    if (!lines.some((l) => l.trim()))
        return '';
    // One line over the limit is kept rather than elided, because the notice
    // saying a line was dropped costs the line it saves.
    const kept = (lines.length <= maxLines + 1 ? lines : lines.slice(-maxLines)).map((l) => truncate(l, 200));
    const dropped = lines.length - kept.length;
    if (dropped > 0)
        kept.unshift(`… ${dropped} earlier line${dropped > 1 ? 's' : ''}`);
    const out = kept.join('\n');
    return out.length <= maxChars ? out : `… ${out.slice(out.length - maxChars)}`;
}
