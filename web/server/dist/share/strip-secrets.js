/**
 * Strip secrets from text before sharing.
 *
 * Scans for common secret patterns (API keys, tokens, connection strings)
 * and replaces them with a placeholder. Returns the cleaned text and a list
 * of what was removed.
 */
import { SECRET_PATTERNS } from '../protocol.js';
/** The placeholder that replaces stripped secrets. */
const PLACEHOLDER = '[REDACTED]';
/**
 * Strips secrets from the given text.
 *
 * @param text The text to scan.
 * @returns The cleaned text and a list of what was stripped.
 */
export function stripSecrets(text) {
    const stripped = [];
    let result = text;
    for (const { pattern, kind } of SECRET_PATTERNS) {
        // Create a fresh regex each time to avoid issues with global state
        const regex = new RegExp(pattern, 'gi');
        result = result.replace(regex, (match, ...args) => {
            // Skip very short matches (likely false positives)
            if (match.length < 16)
                return match;
            // The offset is the second-to-last argument before the whole string
            const offset = typeof args[args.length - 2] === 'number' ? args[args.length - 2] : 0;
            stripped.push({ kind, position: offset });
            return PLACEHOLDER;
        });
    }
    // Deduplicate by position (multiple patterns may match the same secret)
    const seen = new Set();
    const unique = stripped.filter((s) => {
        if (seen.has(s.position))
            return false;
        seen.add(s.position);
        return true;
    });
    return { text: result, stripped: unique };
}
/**
 * Strip secrets from a persona's instructions.
 */
export function stripPersonaSecrets(instructions) {
    return stripSecrets(instructions);
}
/**
 * Strip secrets from a skill's instructions and any code content.
 */
export function stripSkillSecrets(instructions) {
    return stripSecrets(instructions);
}
/**
 * Get a human-readable summary of what was stripped.
 */
export function describeStripped(stripped) {
    // Group by kind
    const byKind = new Map();
    for (const s of stripped) {
        byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    }
    return [...byKind.entries()].map(([kind, count]) => count === 1 ? kind : `${count} ${kind}s`);
}
