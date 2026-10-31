/**
 * Suggesting the details of an office from a one-line idea (issue #157):
 * the prompt a one-shot runner gets, and reading its answer back into
 * something `validateOfficeBrief` accepts, whatever the model actually wrote.
 */
import { DETAIL_FIELDS, OFFICE_STYLES, PROMPT_LIMIT, RUNNER_CHOICES, validateOfficeBrief, } from '../protocol.js';
import { OfficeError } from './store.js';
/** Each suggested sentence is kept short, well under the brief's own limit. */
export const SUGGEST_LIMIT = 300;
const ABOUT = {
    theme: 'what the office is, in a phrase and a sentence: the world it belongs to',
    scene: 'the room itself: walls, floor, light, time of day, mood',
    people: 'how the sixteen workers look: clothes, hats, hair, something they hold or wear',
    decor: 'the things placed about the room: on the floor, on the walls, one small thing on every desk',
    notes: 'anything else: the palette, effects or particles to use, and what to avoid',
};
const EMPTY_DETAILS = { theme: 'office', scene: '', people: '', decor: '', notes: '', style: OFFICE_STYLES[0] };
/** A valid prompt, or a 400. */
export function checkPrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim())
        throw new OfficeError('Say what the office should be, in a line.');
    if (prompt.length > PROMPT_LIMIT)
        throw new OfficeError(`Keep the idea to ${PROMPT_LIMIT} characters or fewer.`);
    const checked = validateOfficeBrief({ prompt, details: EMPTY_DETAILS });
    if (!checked.ok)
        throw new OfficeError('The idea must be plain words, with no markup, links or code.');
    return prompt.trim();
}
export function checkRunner(runner, fallback) {
    if (runner === undefined || runner === null)
        return fallback;
    if (typeof runner !== 'string' || !RUNNER_CHOICES.includes(runner)) {
        throw new OfficeError(`runner must be one of ${RUNNER_CHOICES.join(', ')}.`);
    }
    return runner;
}
function checkStyle(style) {
    if (style === undefined || style === null)
        return null;
    if (typeof style !== 'string' || !OFFICE_STYLES.includes(style)) {
        throw new OfficeError(`style must be one of ${OFFICE_STYLES.join(', ')}.`);
    }
    return style;
}
function checkField(field) {
    if (field === undefined || field === null)
        return null;
    if (typeof field !== 'string' || !DETAIL_FIELDS.includes(field)) {
        throw new OfficeError(`field must be one of ${DETAIL_FIELDS.join(', ')}.`);
    }
    return field;
}
/** Checks a request, so the prompt is only ever built from clean input. */
export function planSuggestion(req, defaultRunner) {
    const r = (req && typeof req === 'object' ? req : {});
    const prompt = checkPrompt(r.prompt);
    const style = checkStyle(r.style);
    const field = checkField(r.field);
    let current = null;
    if (field) {
        const checked = validateOfficeBrief({ prompt, details: r.current });
        if (!checked.ok)
            throw new OfficeError('Send the current answers along with the field to suggest again.', 400, checked.errors);
        current = checked.value.details;
    }
    return { prompt, style, field, current, runner: checkRunner(r.runner, defaultRunner) };
}
/** The question the one-shot runner is asked. */
export function suggestPrompt(plan) {
    const lines = [
        'You are helping someone describe a small themed 3D office for a game: sixteen cartoon workers at desks in one room, drawn from simple shapes.',
        'From their idea, suggest the details a designer needs. Be concrete and vivid; invent specifics that fit the idea.',
        '',
        `Idea: ${plan.prompt}`,
    ];
    if (plan.style)
        lines.push(`Style: ${plan.style}. Keep this style; write "style": "${plan.style}".`);
    else
        lines.push(`Pick the style that fits best from: ${OFFICE_STYLES.join(', ')}.`);
    if (plan.field && plan.current) {
        lines.push('', 'The current answers are:', JSON.stringify(plan.current, null, 2), '', `Suggest a fresh, different "${plan.field}" that fits the other answers. You may repeat the others as they are.`);
    }
    lines.push('', 'Answer with ONLY a JSON object, no code fences and no words around it, with exactly these keys:', `{${[...DETAIL_FIELDS, 'style'].map((k) => `"${k}": "..."`).join(', ')}}`, '', ...DETAIL_FIELDS.map((k) => `- ${k}: ${ABOUT[k]}`), `- style: one of ${OFFICE_STYLES.join(', ')}`, '', `Each of ${DETAIL_FIELDS.join(', ')} is one or two short sentences of plain words, at most ${SUGGEST_LIMIT} characters, with no markup, links, code, quotes or backticks.`);
    return lines.join('\n');
}
/** The first {...} block in the answer, with any code fences removed, parsed if it can be. */
function parseAnswer(text) {
    const stripped = text.replace(/```[a-z]*\s*/gi, '').trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    const block = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
    try {
        const parsed = JSON.parse(block);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            return parsed;
    }
    catch {
        // Fall through to picking the fields out one at a time.
    }
    const out = {};
    for (const key of [...DETAIL_FIELDS, 'style']) {
        const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(block);
        if (m) {
            try {
                out[key] = JSON.parse(`"${m[1]}"`);
            }
            catch {
                out[key] = m[1];
            }
        }
    }
    return out;
}
/** One sentence of plain text, within the limit, or '' when the model gave nothing usable. */
function clean(v) {
    if (typeof v !== 'string')
        return '';
    let text = v
        .replace(/<[^>]*>/g, '')
        .replace(/[`<>{}$]/g, '')
        .replace(/\b(?:javascript|data):/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length > SUGGEST_LIMIT) {
        const cut = text.slice(0, SUGGEST_LIMIT);
        const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        text = (sentence > SUGGEST_LIMIT / 2 ? cut.slice(0, sentence + 1) : cut.replace(/\s+\S*$/, '')).trim();
    }
    return text;
}
/**
 * Reads the model's answer into details the brief validator accepts. A field
 * the validator would still refuse is blanked; a theme it refuses falls back
 * to the idea itself, since a brief must have one.
 */
export function readSuggestion(text, plan) {
    const raw = parseAnswer(text);
    const offered = typeof raw.style === 'string' ? raw.style.trim().toLowerCase() : null;
    // A given style wins; re-suggesting one field keeps the style with the rest; otherwise the model's pick, if it is one.
    const style = plan.style ??
        (plan.field && plan.current ? plan.current.style : offered && OFFICE_STYLES.includes(offered) ? offered : OFFICE_STYLES[0]);
    const details = { ...EMPTY_DETAILS, style };
    for (const k of DETAIL_FIELDS) {
        const fresh = plan.field ? k === plan.field : true;
        details[k] = fresh ? clean(raw[k]) : plan.current?.[k] ?? '';
    }
    if (!details.theme)
        details.theme = plan.current?.theme || clean(plan.prompt) || 'An office';
    // Anything the validator still refuses is dropped rather than sent back to be refused later.
    const checked = validateOfficeBrief({ prompt: plan.prompt, details });
    if (!checked.ok) {
        for (const k of DETAIL_FIELDS) {
            if (checked.errors.some((e) => e.startsWith(`brief.details.${k}:`)))
                details[k] = k === 'theme' ? 'An office' : '';
        }
    }
    return details;
}
/** The whole flow: check, ask, read. `ask` is the one-shot runner, or a fake in tests. */
export async function suggestDetails(req, defaultRunner, ask) {
    const plan = planSuggestion(req, defaultRunner);
    let answer;
    try {
        answer = await ask(plan.runner, suggestPrompt(plan));
    }
    catch (err) {
        throw new OfficeError(`Could not get suggestions: ${err.message}`);
    }
    return readSuggestion(answer, plan);
}
