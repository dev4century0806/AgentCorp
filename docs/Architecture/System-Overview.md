# System Architecture Overview

## 1. Architectural Model

AgentCorp uses a hybrid local web-native architecture consisting of three core tiers:

```text
+--------------------------------------------------------------------------+
|                               BROWSER CLIENT                             |
|   +----------------------------+      +------------------------------+   |
|   |  Three.js WebGL Scene |      |  Reactive TypeScript DOM UI  |   |
|   |  (Virtual Office, Desks)   |      |  (HUD Chat, Settings, Modal) |   |
|   +----------------------------+      +------------------------------+   |
+-------------------------------------▲------------------------------------+
                                      │ (HTTP REST + Bidirectional WS Events)
+-------------------------------------▼------------------------------------+
|                         LOCAL SERVER (FASTIFY 5.X)                       |
|   - HTTP Routes: /api/state, /api/agents, /api/settings, /api/obsidian   |
|   - WebSocket Service: Same-origin cookie auth, full snapshots & events  |
|   - Event Bus: Cross-process agent status synchronization                |
|   - SQLite Database (better-sqlite3 + sqlite-vec): Entity & vector store |
|   - Local Embedder (all-MiniLM-L6-v2): 384-d semantic embedding model    |
+-------------------------------------▲------------------------------------+
                                      │ (STDIO JSON-RPC / HTTP REST API)
+-------------------------------------▼------------------------------------+
|                        AI RUNNERS & EXECUTION ENGINES                    |
|   - Claude Code ACP Runner (@agentclientprotocol/claude-agent-acp)       |
|   - OpenAI Codex ACP Runner (@agentclientprotocol/codex-acp)             |
|   - GitHub Copilot Runner (@github/copilot)                              |
|   - Cursor Agent Runner (agent acp)                                      |
|   - Local Ollama Runner (Qwen3.5 HTTP /api/chat & /api/generate)         |
+--------------------------------------------------------------------------+
```

---

## 2. Layer Breakdown

### 2.1. Frontend Layer
- **Runtime Assets:** `web/ui/dist/`
- **Source Code:** `web/ui/`
- **Architectural Patterns:**
  - Written in vanilla TypeScript with high-performance DOM manipulation (no heavy UI frameworks).
  - **Scene Engine (`web/ui/scene/`):** Renders the isometric office viewport onto an HTML5 `<canvas>`. Handles pixel coordinates, desk depth-sorting, character animations (typing, thinking, sleeping), and visual decorations.
  - **DOM UI Engine (`web/ui/`):** Manages HUD overlays, worker chat panels, runner configuration cards, idea backlog, and ticket boards.
  - **Reactive State Store (`state/store.ts`):** Lightweight reactive store. When incoming WebSocket snapshots arrive, subscribed UI components trigger localized re-renders.

### 2.2. Backend Server Layer
- **Source Location:** `web/server/dist/`
- **Core Components:**
  - **HTTP Server (`http/server.js`):** Built with Fastify 5.x. Serves frontend static assets and exposes REST APIs for worker lifecycle, office layout, settings, and file operations.
  - **WebSocket Service (`http/ws.js`):** Validates the `session-token` cookie on `/ws`. Emits an initial `snapshot` (workers, desks, system status, config) and streams live event deltas.
  - **Database Service (`db/`):** Single-file SQLite database at `data/office/office.db` powered by `better-sqlite3` and the `sqlite-vec` vector extension for low-latency nearest-neighbor search.
  - **Semantic Embedder (`memory/embedder.js`):** Uses `@huggingface/transformers` with local `Xenova/all-MiniLM-L6-v2` weights to generate 384-dimensional vector embeddings without external internet access.

### 2.3. Agent Execution & ACP Protocol Layer
- **Source Location:** `web/server/dist/agents/`
- **Agent Client Protocol (ACP):**
  - Coding tools (Claude Code, Codex, Copilot) operate as supervised child processes over `stdio`.
  - Fastify coordinates communication via JSON-RPC 2.0 (`jsonrpc.js`).
  - Agent permission requests (`session/request_permission`) are mediated by AgentCorp as a supervisor.
- **Environment Isolation (`web/start.mjs`):**
  - Sets `USERPROFILE` to `data/home` to isolate credentials, history, and working directories from the host user environment.
