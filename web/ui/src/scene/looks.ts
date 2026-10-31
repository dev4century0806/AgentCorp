import type { AgentLook, OfficeManifest } from '@shared';

/**
 * Which of a generated office's looks a worker wears. The same one every time:
 * it comes from the worker's id, so a worker keeps its face across restarts,
 * as the built-in colours do. the assistant, who works the front desk, is the first.
 */

/**
 * The 32-bit FNV-1a hash the server and the app already use to colour workers
 * (state/look.ts `hashString`). Repeated here because scene modules may not
 * import from state/, so the website can draw them too; looks.test.ts keeps
 * the two equal.
 */
export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The position in `looks` for a worker. */
export function lookIndex(agentId: string, builtInPam: boolean, count: number): number {
  if (builtInPam || count <= 1) return 0;
  return hashId(agentId) % count;
}

export function lookFor(manifest: Pick<OfficeManifest, 'looks'>, agentId: string, builtInPam = false): { look: AgentLook; index: number } {
  const index = lookIndex(agentId, builtInPam, manifest.looks.length);
  return { look: manifest.looks[index] as AgentLook, index };
}
