/**
 * Local embedding service using Transformers.js with all-MiniLM-L6-v2.
 *
 * Lazy-loads the model on first use to avoid startup impact.
 * The model is ~23MB and generates 384-dimensional embeddings.
 *
 * The app ships the model in packages/server/models (scripts/fetch-model.mjs
 * puts it there), so it never has to reach huggingface.co, which some networks
 * block. Without that folder it downloads the model from the Hub as before.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Dynamic import to avoid loading ONNX runtime until needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder = null;
let loadPromise = null;
let lastUsed = 0;
let unloadTimer = null;
/** The model on the Hub, and its folder under MODELS_DIR. */
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
/** The 8-bit weights, onnx/model_quantized.onnx: a quarter of the full model's size. */
const MODEL_DTYPE = 'q8';
/** The model we use for embeddings. Stored with each vector for re-embedding on model change. */
export const EMBEDDING_MODEL = `${MODEL_ID}@${MODEL_DTYPE}`;
/** Where the shipped model lives: packages/server/models from src/ and dist/ alike, app/server/models in the desktop app. */
export const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'models');
/** Embedding vector dimension for all-MiniLM-L6-v2. */
export const EMBEDDING_DIM = 384;
/** Unload the model after this many ms of inactivity. */
const UNLOAD_AFTER_MS = 5 * 60 * 1000; // 5 minutes
async function ensureLoaded() {
    if (embedder) {
        lastUsed = Date.now();
        return;
    }
    if (loadPromise) {
        await loadPromise;
        return;
    }
    loadPromise = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers');
        if (existsSync(join(MODELS_DIR, MODEL_ID, 'config.json'))) {
            env.localModelPath = MODELS_DIR;
            env.allowRemoteModels = false;
        }
        embedder = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE });
        lastUsed = Date.now();
        scheduleUnload();
    })();
    await loadPromise;
    loadPromise = null;
}
function scheduleUnload() {
    if (unloadTimer)
        clearTimeout(unloadTimer);
    unloadTimer = setTimeout(() => {
        if (Date.now() - lastUsed >= UNLOAD_AFTER_MS && embedder) {
            embedder = null;
        }
        else if (embedder) {
            scheduleUnload();
        }
    }, UNLOAD_AFTER_MS);
    unloadTimer.unref();
}
/**
 * Generate an embedding for a text string.
 * Lazy-loads the model on first call.
 *
 * @returns A Float32Array of dimension EMBEDDING_DIM (384)
 */
export async function embed(text) {
    await ensureLoaded();
    if (!embedder)
        throw new Error('Embedder not loaded');
    // The pipeline returns a Tensor; we need to extract the pooled embedding
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    // output.data is the raw Float32Array
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const data = output.data;
    // For sentence embeddings, we get a single vector
    if (data.length === EMBEDDING_DIM) {
        return data;
    }
    // If batched or unexpected shape, take the first embedding
    return new Float32Array(data.slice(0, EMBEDDING_DIM));
}
/**
 * Generate embeddings for multiple texts in a batch.
 * More efficient than calling embed() repeatedly.
 */
export async function embedBatch(texts) {
    if (texts.length === 0)
        return [];
    if (texts.length === 1)
        return [await embed(texts[0])];
    await ensureLoaded();
    if (!embedder)
        throw new Error('Embedder not loaded');
    const results = [];
    // Process in smaller batches to avoid memory issues
    const batchSize = 32;
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        for (const text of batch) {
            results.push(await embed(text));
        }
    }
    return results;
}
/** Whether the embedder is currently loaded. */
export function isLoaded() {
    return embedder !== null;
}
/** Force unload the model to free memory. */
export function unload() {
    if (unloadTimer) {
        clearTimeout(unloadTimer);
        unloadTimer = null;
    }
    embedder = null;
    loadPromise = null;
}
