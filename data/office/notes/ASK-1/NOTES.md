# ASK-1 — AgentCorp Architecture & System Capabilities

Reviewed: 2026-10-30, Asia/Saigon.

## Request and Scope

Initial system assessment and architectural documentation for the local AgentCorp virtual office environment.

## Findings and Architecture

| Capability | Specification |
| --- | --- |
| Platform Interface | 2D isometric pixel-art canvas rendering AI agents, animated furniture, and office zones. |
| Supported Runners | Ollama (local private LLM execution), Codex ACP, Copilot, and Claude Code. |
| Task Integration | Local ticket creation, ad-hoc `ASK-n` jobs, and project repository associations. |
| Offline Persistence | SQLite database (`office.db`), localized JSON configurations, and vector embeddings (`sqlite-vec`). |
| Network Isolation | Strict local loopback binding (`127.0.0.1:4317`) with authenticated sessions. |

## Verification Limits

- Local execution verified on Windows with Node.js runtime.
- Dynamic model selection tested and verified with local Ollama runners.
