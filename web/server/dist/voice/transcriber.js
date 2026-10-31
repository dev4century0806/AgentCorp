/**
 * Speech to text for voice input, on this Mac, with Whisper through
 * Transformers.js (issue #329).
 *
 * The model isn't shipped. Turning voice input on downloads it, once per Mac,
 * to STATE_DIR/models/whisper-base.en, which every account shares. The files
 * go into a folder beside it first and it is renamed into place once all of
 * them are there, so a download cut short never looks like a model.
 *
 * Like the embedder (memory/embedder.ts), the model loads on first use and is
 * unloaded after five idle minutes. It is only ever read from disk: an
 * absolute model path with `local_files_only` never reaches the Hub, and
 * leaves the library's global settings, which the embedder uses, alone.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { STATE_DIR } from '../config.js';
/** The model on the Hub. Its folder under STATE_DIR/models is `whisper-<size>`. */
export const WHISPER_MODEL_ID = 'Xenova/whisper-base.en';
export const WHISPER_MODEL_DIR = join(STATE_DIR, 'models', 'whisper-base.en');
/** The 8-bit weights: about 80 MB, against about 290 MB for the full ones. */
const MODEL_DTYPE = 'q8';
/** What Transformers.js reads for a q8 Whisper speech-recognition pipeline. */
export const WHISPER_FILES = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
];
/**
 * Where the files come from, tried in order: `{model}` and `{file}` are
 * filled in. Some networks block huggingface.co (see memory/embedder.ts), so
 * a mirror on our own storage belongs after it once there is one.
 */
export const WHISPER_SOURCES = ['https://huggingface.co/{model}/resolve/main/{file}'];
/** Unload the model after this many ms without a transcription. */
const UNLOAD_AFTER_MS = 5 * 60 * 1000;
/** At most this often, a download says how far it has got. */
const PROGRESS_EVERY_MS = 250;
async function loadWhisper(dir) {
    const { pipeline } = await import('@huggingface/transformers');
    return (await pipeline('automatic-speech-recognition', dir, { dtype: MODEL_DTYPE, local_files_only: true }));
}
/** Thrown by a download Cancel stopped, so the caller can tell it from a failure. */
export class DownloadCancelled extends Error {
    constructor() {
        super('The download was cancelled.');
    }
}
export class Transcriber {
    dir;
    sources;
    fetch;
    load;
    unloadAfterMs;
    onChange;
    asr = null;
    loading = null;
    lastUsed = 0;
    unloadTimer = null;
    inFlight = null;
    received = 0;
    total = 0;
    error = null;
    constructor(options = {}) {
        this.dir = options.dir ?? WHISPER_MODEL_DIR;
        this.sources = options.sources ?? WHISPER_SOURCES;
        this.fetch = options.fetch ?? fetch;
        this.load = options.load ?? loadWhisper;
        this.unloadAfterMs = options.unloadAfterMs ?? UNLOAD_AFTER_MS;
        this.onChange = options.onChange;
    }
    /** Where the files go while they download. */
    get partDir() {
        return `${this.dir}.part`;
    }
    isReady() {
        return WHISPER_FILES.every((file) => existsSync(join(this.dir, file)));
    }
    status() {
        if (this.inFlight)
            return { status: 'downloading', received: this.received, total: this.total, error: null };
        return { status: this.isReady() ? 'ready' : 'none', received: 0, total: 0, error: this.error };
    }
    changed() {
        this.onChange?.(this.status());
    }
    /**
     * Downloads the model, trying each source in turn, and resolves once it is
     * in place. Rejects with DownloadCancelled when cancelled, or with what went
     * wrong at the last source. Calling it again while it runs joins that run.
     */
    download() {
        if (this.inFlight)
            return this.inFlight.done;
        if (this.isReady())
            return Promise.resolve();
        const abort = new AbortController();
        this.received = 0;
        this.total = 0;
        this.error = null;
        const done = this.fetchAll(abort.signal).then(() => {
            this.inFlight = null;
            this.changed();
        }, (err) => {
            this.inFlight = null;
            rmSync(this.partDir, { recursive: true, force: true });
            const cancelled = abort.signal.aborted;
            this.error = cancelled ? null : err.message;
            this.changed();
            throw cancelled ? new DownloadCancelled() : err;
        });
        this.inFlight = { abort, done };
        this.changed();
        return done;
    }
    /** Stops a download in flight and throws its files away. */
    cancel() {
        this.inFlight?.abort.abort();
    }
    /** Removes the model from this Mac. A download in flight is cancelled first. */
    async delete() {
        if (this.inFlight) {
            this.cancel();
            await this.inFlight?.done.catch(() => undefined);
        }
        this.unload();
        rmSync(this.dir, { recursive: true, force: true });
        rmSync(this.partDir, { recursive: true, force: true });
        this.error = null;
        this.changed();
    }
    async fetchAll(signal) {
        let lastError = new Error('There is nowhere to download the speech model from.');
        for (const source of this.sources) {
            if (signal.aborted)
                break;
            try {
                await this.fetchFrom(source, signal);
                return;
            }
            catch (err) {
                if (signal.aborted)
                    break;
                lastError = new Error(`Couldn't download the speech model from ${new URL(source.replace(/\{\w+\}/g, 'x')).host}: ${err.message}`);
            }
        }
        throw signal.aborted ? new DownloadCancelled() : lastError;
    }
    async fetchFrom(source, signal) {
        const part = this.partDir;
        rmSync(part, { recursive: true, force: true });
        this.received = 0;
        this.total = 0;
        const urls = WHISPER_FILES.map((file) => source.replace('{model}', WHISPER_MODEL_ID).replace('{file}', file));
        // Every file's size first, for one progress bar across all of them. A source that won't say is still tried.
        const sizes = await Promise.all(urls.map((url) => this.fetch(url, { method: 'HEAD', signal, redirect: 'follow' }).then((res) => (res.ok ? Number(res.headers.get('content-length')) || 0 : 0), () => 0)));
        this.total = sizes.reduce((sum, n) => sum + n, 0);
        this.changed();
        let told = Date.now();
        for (const [i, url] of urls.entries()) {
            const res = await this.fetch(url, { signal, redirect: 'follow' });
            if (!res.ok || !res.body)
                throw new Error(res.status === 403 ? 'HTTP 403. The network may be blocking it.' : `HTTP ${res.status}`);
            const dest = join(part, WHISPER_FILES[i]);
            mkdirSync(dirname(dest), { recursive: true });
            const file = await open(dest, 'w');
            try {
                const reader = res.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    await file.write(value);
                    this.received += value.byteLength;
                    if (Date.now() - told >= PROGRESS_EVERY_MS) {
                        told = Date.now();
                        this.changed();
                    }
                }
            }
            finally {
                await file.close();
            }
        }
        if (signal.aborted)
            throw new DownloadCancelled();
        rmSync(this.dir, { recursive: true, force: true });
        mkdirSync(dirname(this.dir), { recursive: true });
        renameSync(part, this.dir);
    }
    async ensureLoaded() {
        this.lastUsed = Date.now();
        if (this.asr)
            return this.asr;
        if (!this.loading) {
            if (!this.isReady())
                throw new Error('The speech model is not downloaded. Turn voice input on in Settings to download it.');
            this.loading = this.load(this.dir).then((asr) => {
                this.asr = asr;
                this.loading = null;
                this.scheduleUnload();
                return asr;
            }, (err) => {
                this.loading = null;
                throw err;
            });
        }
        return this.loading;
    }
    scheduleUnload() {
        if (this.unloadTimer)
            clearTimeout(this.unloadTimer);
        this.unloadTimer = setTimeout(() => {
            this.unloadTimer = null;
            if (!this.asr)
                return;
            if (Date.now() - this.lastUsed >= this.unloadAfterMs)
                this.unload();
            else
                this.scheduleUnload();
        }, this.unloadAfterMs);
        this.unloadTimer.unref();
    }
    /**
     * Transcribes 16 kHz mono samples. Clips longer than Whisper's 30 second
     * window are read in overlapping chunks.
     */
    async transcribe(audio) {
        const asr = await this.ensureLoaded();
        const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
        this.lastUsed = Date.now();
        const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
        // Whisper marks silence and noise, such as [BLANK_AUDIO] or (music); none of it is words.
        return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    }
    isLoaded() {
        return this.asr !== null;
    }
    /** Frees the model's memory; the next transcription loads it again. */
    unload() {
        if (this.unloadTimer)
            clearTimeout(this.unloadTimer);
        this.unloadTimer = null;
        const asr = this.asr;
        this.asr = null;
        this.loading = null;
        void Promise.resolve(asr?.dispose?.()).catch(() => undefined);
    }
}
