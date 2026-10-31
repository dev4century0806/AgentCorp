/**
 * What an office designer is told (issue #157): the skill, the contract as a
 * table the model can read, an example that passes, the user's answers, and
 * the exact hand-off the office reads back.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANCHOR_BOUNDS, FLOOR_PATTERNS, LOOK_ANCHORS, LOOK_HAIR, LOOK_OUTFITS, OFFICE_BASES, OFFICE_CONTRACT_VERSION, OFFICE_LIMITS, OFFICE_SLOTS, OFFICE_STYLES, PALETTE_KEYS, PART_EFFECTS, PART_SHAPES, PARTICLE_KINDS, } from '../protocol.js';
import { builtinSkillBody, builtinSkillDir } from '../skills/builtin/index.js';
/** The line a designer ends its reply with once office.json is written. */
export const OFFICE_READY = 'OFFICE_READY';
export const OFFICE_FILE = 'office.json';
/** Whether a turn's text ends in the hand-off line. */
export function hasOfficeReady(text) {
    return /^[ \t>*-]*OFFICE_READY[ \t.]*$/m.test(text);
}
/** The read-only files the brief quotes: the example manifest and, once the renderer agent has written it, the note on people. */
function skillFile(name) {
    const path = join(builtinSkillDir('office-designer'), name);
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}
function slotTable() {
    const rows = Object.entries(OFFICE_SLOTS).map(([id, spec]) => `| ${id} | ${spec.kind} | ${spec.max.join(' x ')} | ${spec.about} |`);
    return ['| slot | kind | max w x h x d | about |', '| --- | --- | --- | --- |', ...rows].join('\n');
}
function anchorTable() {
    const rows = LOOK_ANCHORS.map((a) => `| ${a} | ${ANCHOR_BOUNDS[a].join(' x ')} |`);
    return ['| anchor | box w x h x d, centred on the limb pivot |', '| --- | --- |', ...rows].join('\n');
}
function limits() {
    const l = OFFICE_LIMITS;
    return [
        `- name: at most ${l.name} characters; description: at most ${l.description}; tags: at most ${l.tags}, each at most ${l.tag} characters, lower-case letters, digits and dashes`,
        `- decorations: at most ${l.decorations}, each with 1 to ${l.partsPerDecoration} parts, at most ${l.parts} parts in all, and at most one in the \`desk\` slot`,
        `- looks: ${l.looks[0]} to ${l.looks[1]}, each with at most ${LOOK_ANCHORS.length} add-ons and at most ${l.addonParts} add-on parts in all`,
        `- every part name and look name at most ${l.partName} characters`,
        `- a part's size is 0.01 to ${l.partSize} in each direction; its \`at\` is within -${l.partSize} to ${l.partSize}; \`rotate\` is -360 to 360 degrees about the vertical`,
        `- lighting: ambientIntensity 0.1 to 1.5, sunIntensity 0 to 1.5, sunAt within -30 to 30 on each axis; particles density 0 to 1`,
        `- palette lists (books, leaves) have 1 to 8 colours`,
        `- the whole file at most ${Math.round(l.bytes / 1024)} KB`,
    ].join('\n');
}
function enums() {
    return [
        `- version: ${OFFICE_CONTRACT_VERSION}`,
        `- base: ${OFFICE_BASES.join(', ')}`,
        '- furnishing: full, minimal',
        `- floor.pattern: ${FLOOR_PATTERNS.join(', ')}`,
        `- particles.kind: ${PARTICLE_KINDS.join(', ')}`,
        `- part shape: ${PART_SHAPES.join(', ')}`,
        `- part effect: ${PART_EFFECTS.join(', ')}`,
        `- look hairStyle: ${LOOK_HAIR.join(', ')}`,
        `- look outfit: ${LOOK_OUTFITS.join(', ')}`,
        `- add-on anchor: ${LOOK_ANCHORS.join(', ')}`,
        `- palette keys (all optional): ${PALETTE_KEYS.join(', ')}`,
        `- styles people ask for: ${OFFICE_STYLES.join(', ')}`,
    ].join('\n');
}
export function designerBrief(input) {
    const { brief, workdir, current, instruction } = input;
    const file = join(workdir, OFFICE_FILE);
    const parts = [];
    parts.push(current
        ? 'Change an office that already exists in AgentCorp, keeping what the instruction does not touch.'
        : 'Design a new office for AgentCorp.', '', `Write the result as one JSON file at ${file}. It is data the app draws, so nothing in it runs. It must follow the office contract below exactly: the app validates it and refuses anything outside the contract.`, '', '## The brief', '', '```json', JSON.stringify(brief, null, 2), '```');
    if (current) {
        parts.push('', '## The office as it is', '', `Change: ${instruction?.trim() || 'improve it'}`, '', '```json', JSON.stringify(current, null, 2), '```');
    }
    parts.push('', '## How to design it', '', builtinSkillBody('office-designer'));
    parts.push('', '## The contract', '', '### Slots', '', 'Floor and desk slots are measured from the middle of their footprint, with y up from 0 at the floor or desk top. Wall slots are measured from the middle of their area on the wall, with z out of the wall from 0 at its face. Every part, rotation included, must fit inside the slot\'s box.', '', slotTable(), '', '### Add-ons on a person', '', 'Each add-on is fixed to one limb and measured from that limb\'s pivot, centred on all three axes.', '', anchorTable(), '', '### Allowed values', '', enums(), '', '### Limits', '', limits());
    const people = skillFile('people.md');
    if (people)
        parts.push('', '### People: proportions and anchors', '', people);
    const example = skillFile('example.json');
    if (example)
        parts.push('', '### An office that passes', '', '```json', example, '```');
    parts.push('', '## How to hand it in', '', `1. Do not stop to describe a plan or to ask questions: make reasonable choices from the brief and carry on in this one turn.`, `2. Write ${file} (and nothing else).`, '3. Re-check it against the limits and the slot boxes by reading it through. Do not run scripts or shell commands to check it: nobody is there to approve them, so they are refused.', `4. End your reply with this line on its own: ${OFFICE_READY}`, '', `If the office comes back with a list of problems, fix ${OFFICE_FILE} and end your reply with ${OFFICE_READY} again.`);
    return parts.join('\n');
}
/** What the designer hears when its office.json did not pass. */
export function fixBrief(errors, attempt, attempts) {
    return [
        `The office did not pass the contract (attempt ${attempt - 1} of ${attempts}). Fix these in ${OFFICE_FILE}, keeping the rest as it is:`,
        '',
        ...errors.map((e) => `- ${e}`),
        '',
        `Then end your reply with ${OFFICE_READY} on its own line.`,
    ].join('\n');
}
/** What the designer hears when it stopped talking without handing in. */
export function nudgeBrief() {
    return `Carry on without waiting for me: make your own choices, write ${OFFICE_FILE}, and end your reply with ${OFFICE_READY} on its own line.`;
}
/** What a resumed designer hears: carry on, and what it was last asked if that was a fix or a nudge it was cut off on. */
export function resumeBrief(lastAsk) {
    const parts = [
        `You were cut off before you finished. Carry on from where you stopped: check what is already in ${OFFICE_FILE}, finish it so it follows the contract, and end your reply with ${OFFICE_READY} on its own line.`,
    ];
    if (lastAsk)
        parts.push('', 'This is what I had asked when you were cut off:', '', lastAsk);
    return parts.join('\n');
}
/** What a designer hears when its earlier chat could not be reopened: the whole brief again, and that its folder may hold its work so far. */
export function lostSessionBrief(brief) {
    return [
        `You were cut off, and your earlier conversation is gone. ${OFFICE_FILE} in your folder may hold what you had written so far: read it, keep what is good, and finish the job below.`,
        '',
        brief,
    ].join('\n');
}
