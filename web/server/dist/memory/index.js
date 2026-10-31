/**
 * Office memory: workers learn lessons and get briefed with them on new tickets.
 */
export { embed, embedBatch, isLoaded, unload, EMBEDDING_MODEL, EMBEDDING_DIM } from './embedder.js';
export { MemoryStore } from './store.js';
export { memoryBriefFor, recallMemories, extractFilePaths } from './brief.js';
