# Component Map & Source File Index

This document maps all core files in AgentCorp, detailing their functional ownership to enable immediate navigation.

---

## 1. Root & Lifecycle Entry Points

| File Path | Description |
| :--- | :--- |
| `Start-Local.ps1` | PowerShell launcher for the local web runtime at `http://127.0.0.1:4317/`. |
| `scripts/Sync-Graphify.ps1` | PowerShell helper to synchronize the AST knowledge graph (`graphify-out/`). |
| `web/start.mjs` | Official Node.js bootstrapper: configures isolated paths (`data/office`, `data/home`) and starts Fastify. |
| `web/package.json` | Backend dependencies (`fastify`, `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`, `@agentclientprotocol/*`). |
| `web/smoke.test.mjs` | Smoke test validating HTTP endpoints, WebSocket authentication, and state snapshots. |
| `web/smoke.test.mjs` | Integration test suite verifying HTTP, WebSocket snapshot, and authentication integrity. |

---

## 2. Backend Subsystems (`web/server/dist/`)

### 2.1. Core System & Protocols
- **`index.js`**: Backend entrypoint: initializes Event Bus, mounts SQLite database, binds event listeners, and starts Fastify.
- **`config.js`**: Global configuration loader (`config.json`): resolves state directory (`STATE_DIR`), accounts, repositories, and git worktrees.
- **`protocol.js`**: Common protocol constants and types shared between client and server (`RUNNER_CHOICES`, `MODEL_CHOICES`, `PERMISSION_LEVELS`, `LOOK_CHOICES`).
- **`bus.js`**: Internal Event Bus distributing events between Agent Manager and WebSocket broadcasters.

### 2.2. Agent & Runner Subsystem (`agents/`)
- **`manager.js`**: Core lifecycle controller for AI workers: hiring, firing, messaging, desk presence, query handling, and permission mediation.
- **`make-runner.js`**: Runner factory (`runnerFor`): instantiates appropriate runner based on selected engine (`claude`, `codex`, `copilot`, `acp`, `ollama`).
- **`acp-runner.js`**: ACP (Agent Client Protocol) adapter communicating over stdio JSON-RPC with Claude Code and Codex CLI.
- **`runner-settings.js`**: Enable/disable logic for AI coding runners in office settings.
- **`sign-in.js`**: Coordinates CLI authentication and Web OAuth bridge processes.
- **`ollama-runner.js`**: Local AI runner communicating with Ollama server (`http://127.0.0.1:11434`) running Qwen3.5 with thinking stream parsing.

### 2.3. HTTP & WebSocket Networking (`http/`)
- **`server.js`**: REST route handlers (`/api/state`, `/api/agents`, `/api/settings`, `/api/repos`, `/api/agent-cli/sign-in`, `/api/obsidian/status`, `/api/obsidian/sync`). Serves static assets from `web/ui/dist`.
- **`ws.js`**: WebSocket service mounted at `/ws`. Validates session token cookies and broadcasts real-time state deltas.

### 2.4. Semantic Vector Memory (`memory/`)
- **`embedder.js`**: Embedder service using `@huggingface/transformers` with local `Xenova/all-MiniLM-L6-v2` (384-dimensional vectors). Automatically unrefs idle timer after 5 minutes.
- **`store.js`**: Manages vector tables in SQLite using `sqlite-vec`. Executes Cosine k-NN similarity queries.
- **`brief.js`**: Extracts relevant contextual memories and architectural notes into agent work briefs.
- **`obsidian-indexer.js`**: Markdown chunking, vector embedding, and SQLite sync for Obsidian vaults.

---

## 3. Frontend Subsystems (`web/ui/`)

### 3.1. Isometric Scene Engine (`scene/`)
- **`office.ts`**: Scene controller: loads sprite sheets, instantiates desks, and drives the main canvas rendering loop.
- **`view.ts`**: Isometric coordinate transformation, mouse-to-world projection, zoom, and pan handling.
- **`person.ts`**: Character pixel-art renderer: walking, desk seating, keyboard typing animations, thought balloons, and expressions.
- **`desks.ts`**: Desk positioning, ownership, and occupancy management.

### 3.2. UI Components & HUD (`ui/`)
- **`worker.ts`**: Worker panel: conversation history, reasoning steps, tool invocations, permission approval dialogs, and work/chat mode toggle.
- **Runner UI module**: Runner settings: status badges (Ready / Not signed in / Checking), runner toggles, and Web Auth [Connect] buttons.
- **`settings.ts`**: Office settings: repository configuration, integrations, persona rules, and audio levels.
- **`hud.ts`**: Header status bar: office name, active worker count, XP progress, and rank indicators.

### 3.3. Networking & State (`net/` & `state/`)
- **`client.ts`**: HTTP API client and WebSocket connection manager.
- **`store.ts`**: Reactive state store dispatching updates across all UI components.
