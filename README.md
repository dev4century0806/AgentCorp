# AgentCorp

A local virtual office for coordinating AI coding workers. The interface uses a Retro isometric room, with worker conversations, repositories, task tracking and a receptionist whose name you choose.

The server binds to **http://127.0.0.1:4317/**. Workspace configuration, conversations, notes and databases are stored under `data/`, outside the published source tree.

## Run

Use Windows 10/11 and Node.js 24 LTS. Coding providers require their own installed CLI and account; local inference requires Ollama and a downloaded model.

```powershell
cd web
npm ci
npm start
```

Open **http://127.0.0.1:4317/**. Choose the receptionist's name when prompted. You can change it later under **Settings → General → Trợ lý lễ tân**.

Use **Settings → Workspace** to configure coding providers, repositories, GitHub Issues or the optional Factory source. Skills, personas and MCP tools are managed in Toolkit.

## Build

The TypeScript frontend and shared server contracts are built together:

```powershell
cd web
npm run build
```

The build checks TypeScript, generates hashed JavaScript and CSS under `web/ui/dist/`, and updates `web/server/dist/protocol.js` and `office-contract.js`. Restart the server after changing server modules.

## Test

With the server running, use a second terminal:

```powershell
cd web
npm test
```

The suite checks HTTP/assets, session and Origin protections, WebSocket access, assistant naming and persistence, and removal of retired interfaces and routes. Assistant tests use an isolated temporary database and a fake AI runner; they do not contact a model provider.

## Project layout

- `web/ui/src/`: TypeScript interface and Three.js scene.
- `web/ui/index.html`, `web/ui/styles.css`: page template and styles.
- `web/shared/`: shared TypeScript contracts.
- `web/server/dist/`: server modules and provider adapters.
- `web/build-ui.mjs`: reproducible frontend and contract build.

See [LICENSE](LICENSE) for the software's license terms. Third-party dependencies retain their own licenses.
