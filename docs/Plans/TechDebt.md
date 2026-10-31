# Technical Debt & Refactoring Plan

This document catalogs technical debt items, architectural trade-offs, and structured remediation paths for AgentCorp.

---

## 1. Frontend build (implemented 2026-10-31)

`web/build-ui.mjs` and `web/tsconfig.json` now provide `npm run build` and `npm run typecheck`. The build emits hashed assets and shared server contracts from source. Restart the server after a server-module change. Hot reload remains optional future work.

---

## 2. Backend JavaScript Modularity (Resolved)

### Current State
- `web/server/dist/` contains production ES Module JavaScript output.
- All new capabilities have been strictly modularized into isolated units:
  - `agents/ollama-runner.js` (Ollama local inference & auto-reviewer)
  - `memory/obsidian-indexer.js` (Vault chunking, vector embedding, SQLite-vec query)
  - `memory/graph-navigator.js` (AST subgraph query engine, < 20ms)
  - `memory/backup.js` (Online atomic SQLite backup engine)
  - `git/choose-folder.js` (Native Windows Forms FolderBrowserDialog bridge)
- Core runtime paths are covered by automated integration test suite (`smoke.test.mjs`).

---

## 3. Node.js Native Module ABI Compatibility

### Current State
- `better-sqlite3` and `sqlite-vec` depend on native C++ binaries compiled for Node.js 24 Windows x64.
- Switching to Node.js 18 or 20 without rebuilding triggers `NODE_MODULE_VERSION` ABI mismatch errors.

### Remediation Path
- Provide pre-packaged `npm.cmd rebuild` commands in `docs/Handoffs/Environment-Setup.md` for zero-friction recompilation across alternate Node runtimes.

---

## 4. WebSocket Disconnection & Stream Resilience

### Current State
- When an AI agent streams tokens over WebSocket, refreshing the page (F5) leaves the background runner child process active until turn completion.

### Remediation Path
- Implement an activity watchdog: if no WebSocket client reconnects to the worker's active session within 15 seconds, dispatch a cancellation signal to the runner subprocess.
