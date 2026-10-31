# ADR-002: Local AI Runner Integration via Ollama (Qwen3.5 on RTX 3050)

## 1. Context
- The original application supported only cloud-based commercial runners (Claude Code CLI, OpenAI Codex CLI, GitHub Copilot CLI, Cursor).
- The user requires a zero-cost local LLM engine to:
  - Serve as a fast preliminary indexer and file locator across the codebase.
  - Enable conversational interaction without consuming external API tokens or hitting vendor rate limits.
- Target hardware: Laptop equipped with an **NVIDIA GeForce RTX 3050 (6GB VRAM) and 16GB system RAM**.

## 2. Decision
- **Integrate Ollama (`http://127.0.0.1:11434`) as an AgentCorp Runner:**
  - Implemented `web/server/dist/agents/ollama-runner.js` implementing the standard `BaseRunner` interface.
  - Queries Ollama's `/api/tags` endpoint to dynamically enumerate installed local models.
  - Parses streaming reasoning chunks (`<think>...</think>`) and supports effort-based thinking parameter configurations.
- **Model Sizing for 6GB VRAM:**
  - **Primary Recommendation — Qwen3.5 4B (Q4_K_M ~2.8 GB):** Fits entirely within the 6GB VRAM buffer, achieving >60 tokens/sec with minimal latency.
  - **Complex Reasoning Fallback — Qwen3.5 9B (Q4_K_M ~5.6 GB):** Utilizes VRAM with minimal RAM spillover for deep algorithmic or architectural queries.

## 3. Consequences
- **Positive:**
  - 100% free token usage for daily workflows.
  - Zero external data egress; total code privacy.
  - Hardware acceleration on the local RTX 3050 GPU.
- **Trade-offs:**
  - Ollama must be running (`ollama serve`) prior to server startup, or runner status will display an error badge.
