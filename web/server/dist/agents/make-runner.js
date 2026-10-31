import { AcpRunner, claudeAgent, codexAgent, copilotAgent, cursorAgent } from './acp-runner.js';
import { PrintRunner } from './print-runner.js';
import { OllamaRunner } from './ollama-runner.js';
/** The one place a runner mode becomes a process: workers, the Telegram Operator and one-shot prompts all come here. */
export function runnerFor(mode, opts) {
    switch (mode) {
        case 'claude':
            return new AcpRunner(opts, claudeAgent(opts));
        case 'copilot':
            return new AcpRunner(opts, copilotAgent(opts));
        case 'codex':
            return new AcpRunner(opts, codexAgent(opts));
        case 'ollama':
            return new OllamaRunner(opts);
        case 'print':
            return new PrintRunner(opts);
        case 'acp':
            return new AcpRunner(opts, cursorAgent(opts));
    }
}
