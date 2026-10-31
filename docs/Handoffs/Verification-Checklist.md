# Verification & Sanity Checklist

Whenever taking over the project, making major edits, or setting up a new environment, complete this verification checklist to guarantee full operational readiness.

---

## 1. Automated Test Suites

Open PowerShell in the `web/` directory and execute:

### Step 1: Core Unit & Bus Tests
```powershell
node --test web/server/dist/bus.test.js web/server/dist/ideas.test.js web/server/dist/pr-watcher.test.js
```
- **Objective:** Validates event bus routing, ticket shaping logic, and PR watcher monitoring.
- **Pass Criteria:** `✔ 46 tests passed, 0 failed`.

### Step 2: Live Smoke Test
Ensure the server is running, then execute:
```powershell
node --test smoke.test.mjs
```
- **Objective:**
  1. Verifies the HTTP server returns 200 for `index.html`, JavaScript bundles, and static assets.
  2. Validates authenticated WebSocket connections on `/ws` receive a valid state snapshot.
  3. Verifies unauthorized requests lacking a valid session token are rejected.
- **Pass Criteria:** `✔ 3 tests passed, 0 failed`.

### Step 3: Graphify Knowledge Graph Sync
```powershell
powershell -ExecutionPolicy Bypass -File D:\Project\AgentCorp\scripts\Sync-Graphify.ps1
```
- **Objective:** Synchronizes AST symbol tables, dependencies, and community clusters in `graphify-out/`.
- **Pass Criteria:** `graph.json` and `graph.html` updated successfully without parser errors.

### Step 4: Regression Test Suite
```powershell
node --test web/server/dist/bus.test.js web/server/dist/ideas.test.js web/server/dist/account-isolation.test.js
```
- **Objective:** Runs core unit and regression tests (EventBus, Idea Board, Account Isolation).
- **Pass Criteria:** `✔ All tests passed, 0 failed`.

---

## 2. Visual & Interactive UI Checklist

Open `http://127.0.0.1:4317/` in a browser and verify:

- [ ] **Startup & Rendering:** Office viewport loads in under 2 seconds without red error toasts.
- [ ] **Canvas 2D Performance:** 60 FPS smooth rendering; pixel-art agents display ambient idle/typing animations and accurate shadow projections.
- [ ] **Pan / Zoom / Rotate:**
  - Hold middle mouse button or Space bar to pan across the virtual office.
  - Scroll mouse wheel to zoom in and out smoothly.
  - Click the camera rotation icon to switch through the 4 isometric angles.
- [ ] **Coding Agents Settings (`Settings -> Coding agents`):**
  - Lists all supported runners: Claude Code, Cursor, Copilot, Codex, Ollama.
  - On/Off toggles persist state changes immediately to `data/office/config.json`.
  - [Connect] buttons initiate Web OAuth bridges.
- [ ] **Worker HUD Panel:**
  - Clicking an agent at a desk slides out the worker panel with conversation history.
  - Displays worker name, persona, selected AI engine, Work/Chat mode toggle, and thinking effort selector.

---

## 3. Infrastructure & Isolation Checklist

- [ ] **SQLite Database:** `data/office/office.db` exists with `sqlite-vec` extension and populated schema tables.
- [ ] **Sandbox Isolation:** `data/home/` is isolated; child agent processes do not write configuration files or logs to host user directories.
- [ ] **Server Logs:**
  - `evidence/server.stdout.log` records server initialization on `127.0.0.1:4317`.
  - `evidence/server.stderr.log` contains zero fatal crashes or unhandled rejections.
- [ ] **Local AI (Ollama):** `curl.exe http://127.0.0.1:11434/api/tags` returns status 200 with local models listed.
