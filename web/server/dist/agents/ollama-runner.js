import { BaseRunner } from './runner.js';
import { searchObsidianVault } from '../memory/obsidian-indexer.js';

export class OllamaRunner extends BaseRunner {
    mode = 'ollama';
    sessionId = null;
    abortController = null;
    history = [];

    constructor(opts) {
        super(opts);
        this._model = opts.model || 'qwen3.5:4b';
    }

    async start() {
        this.sessionId = this._chatId || `ollama-${Date.now()}`;
        this._started = true;
        this.emit({ kind: 'session', chatId: this.sessionId });
    }

    async switchSession(chatId) {
        if (this._busy)
            await this.cancel();
        this.sessionId = chatId;
        this._chatId = chatId;
        this.history = [];
        return true;
    }

    async applySetup(setup) {
        await super.applySetup(setup);
        if (setup.model)
            this._model = setup.model;
    }

    async prompt(text, files = []) {
        if (!this._started)
            await this.start();

        this._busy = true;
        const currentAbort = new AbortController();
        this.abortController = currentAbort;

        try {
            // Retrieve relevant context from Obsidian Vault if available
            let vaultContext = '';
            try {
                const matches = await searchObsidianVault(text, 3);
                if (matches && matches.length > 0) {
                    vaultContext = '\n\n[Architecture & Obsidian Rules Context]:\n' +
                        matches.map((m) => `### ${m.title}\n${m.content}`).join('\n\n');
                }
            } catch {
                // If vault indexing is not set up, continue cleanly
            }

            let modelName = this.opts?.model || this._model || 'qwen3.5:4b';
            if (modelName === 'Default' || /^(6\.1|6|5\.6)\s*(Sol|Terra|Luna|Astra)|sonnet|opus|haiku|fable/i.test(modelName)) {
                modelName = 'qwen3.5:4b';
            }
            const effort = this.opts?.effort || 'default';
            const skipThinking = effort === 'instant' || effort === 'low';
            const systemPrompt = `You are an expert AI software engineer in AgentCorp.${vaultContext}\nWork accurately, explain your thought process clearly, and provide exact code when requested.${skipThinking ? ' Output your answer directly without long thinking tags.' : ''}`;

            if (this.history.length === 0) {
                this.history.push({ role: 'system', content: systemPrompt });
            }

            this.history.push({ role: 'user', content: text });

            const payload = {
                model: modelName,
                messages: this.history,
                stream: true,
                options: {
                    temperature: skipThinking ? 0.3 : 0.7,
                },
            };

            const response = await fetch('http://127.0.0.1:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: currentAbort.signal,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Ollama error (${response.status}): ${errText || response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let assistantReply = '';
            let inThinking = false;
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const json = JSON.parse(trimmed);
                        if (json.message?.thinking) {
                            this.emit({ kind: 'thinking', text: json.message.thinking });
                        }
                        if (json.message?.content) {
                            let content = json.message.content;

                            // Handle <think> tags if model embeds them in content
                            if (content.includes('<think>')) {
                                inThinking = true;
                                content = content.replace('<think>', '');
                            }
                            if (content.includes('</think>')) {
                                inThinking = false;
                                const parts = content.split('</think>');
                                if (parts[0]) this.emit({ kind: 'thinking', text: parts[0] });
                                if (parts[1]) {
                                    assistantReply += parts[1];
                                    this.emit({ kind: 'text_delta', text: parts[1] });
                                }
                                continue;
                            }

                            if (inThinking) {
                                this.emit({ kind: 'thinking', text: content });
                            } else {
                                assistantReply += content;
                                this.emit({ kind: 'text_delta', text: content });
                            }
                        }
                    } catch {
                        // ignore malformed lines
                    }
                }
            }

            this.history.push({ role: 'assistant', content: assistantReply });

            // If acting as a code reviewer, automatically report findings through the office protocol
            if (this.opts?.reviewingId && typeof this.opts?.onToolCall === 'function') {
                const isApproved = !/changes_requested|severity:\s*["']?error["']?/i.test(assistantReply) || /outcome:\s*["']?approved["']?/i.test(assistantReply);
                const outcome = isApproved ? 'approved' : 'changes_requested';
                const findings = [];
                if (!isApproved) {
                    findings.push({
                        file: 'worktree',
                        severity: 'warning',
                        message: assistantReply.slice(0, 300),
                    });
                }
                this.emit({ kind: 'tool_start', callId: 'rev-auto', tool: 'send_findings', label: `Code Review: ${outcome}` });
                try {
                    await this.opts.onToolCall('send_findings', {
                        outcome,
                        findings,
                        note: `Automated Local AI Code Review (${this._model} on RTX 3050).`,
                    });
                    this.emit({ kind: 'tool_end', callId: 'rev-auto', tool: 'send_findings', ok: true });
                } catch {
                    this.emit({ kind: 'tool_end', callId: 'rev-auto', tool: 'send_findings', ok: false });
                }
            }

            this._busy = false;
            if (this.abortController === currentAbort) {
                this.abortController = null;
            }
            this.emit({ kind: 'turn_end', text: 'end_turn' });
        } catch (err) {
            if (err.name !== 'AbortError') {
                this.emit({ kind: 'error', message: err.message });
            }
        } finally {
            this._busy = false;
            if (this.abortController === currentAbort) {
                this.abortController = null;
            }
        }
    }

    async cancel() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this._busy = false;
    }

    async dispose() {
        await this.cancel();
        this._started = false;
    }
}
