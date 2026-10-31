import { autoWorkerName } from '../protocol.js';
import { hashString } from '../util.js';
const SHIRTS = ['#4f7fe0', '#c8553d', '#7a5cc4', '#3e9a5c', '#d98a3d', '#2f8f9a', '#b8476e', '#e0c040'];
const HAIRS = ['#2a1d14', '#1c1c1c', '#8a5a3b', '#c9a15a', '#5a3a28', '#b0442a'];
const SKINS = ['#f1c7a0', '#e2a97e', '#c68a5c', '#8d5a3a', '#f5d4b5'];
/**
 * Seeded from the agent id so a worker looks the same after a restart.
 * The three channels are offset so colors don't move together.
 */
export function lookFor(agentId) {
    const h = hashString(agentId);
    return {
        shirt: SHIRTS[h % SHIRTS.length],
        hair: HAIRS[(h >>> 5) % HAIRS.length],
        skin: SKINS[(h >>> 11) % SKINS.length],
    };
}
/** A random unused name, falling back to a numbered worker once the pool runs out. */
export function pickName(taken, random = Math.random) {
    return autoWorkerName(null, taken, random);
}
