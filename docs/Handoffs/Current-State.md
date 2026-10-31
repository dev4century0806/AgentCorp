# AgentCorp current state

Updated 2026-10-31, Asia/Saigon.

## Run and build

Use Node.js 24 on Windows. In `web/`, run `npm ci`, `npm run build`, then `npm start`. The server binds to `http://127.0.0.1:4317/`. Restart after server changes. Run `npm test` in a second terminal while the server is listening.

`web/build-ui.mjs` builds the TypeScript frontend, hashed CSS/JavaScript, and shared JavaScript contracts for the server. `web/ui/index.html` and `web/ui/styles.css` are the page sources; do not patch the generated bundle.

## Current scope

- One built-in room: Retro. Worker movement, view rotation, zoom, conversations, hiring, task board, memory and Toolkit remain.
- Pets, seasonal costumes/decorations, arcade, progression, leaderboard, perks and trophy rendering have been removed. Ordinary setup steps remain without rewards.
- GitHub Issues and Factory remain. Built-in Telegram, Figma, Jira and Linear connections are removed; their retired routes return 404.
- Assistant setup uses `GET/PUT /api/assistant`; its actual agent ID is resolved on the server. The name is stored in the agent record and the `assistant.named` meta flag in that account's SQLite database. General provides the same validated name form.
- Naming errors leave the form open. Names are normalized, limited to 24 characters and checked for duplicates. The current name is included in subsequent receptionist prompts, including an already-open session.

## Data compatibility

Schema migration 35 removes retired game/remote-message tables while keeping tasks, conversations, skills and memories. Configuration migration 3 removes retired connection settings and selects GitHub. Historical migrations and the internal receptionist identifier remain for compatibility; user-facing labels use Reception and the chosen name.

Workspace databases and runtime state live under `data/`. Three SQLite backups were made before the first restart during this change. Additional publication changes must preserve existing third-party license notices.

## Verification evidence

TypeScript checks and frontend builds passed. Playwright on Edge exercised real naming, settings rename, reload, a second fresh browser profile, view rotation and absence of the removed interface. An intercepted 503 was used only to test browser error handling; successful naming was tested against the real local server. The new automated suite uses isolated SQLite databases and a fake AI runner for name propagation, persistence, validation and route removal.

Local detailed results and screenshots: `evidence/remediation-2026-10-31/`. The earlier audit remains in `evidence/compliance-2026-10-31/` and describes the previous build. Consult the final validation file for exact test totals and the published commit, rather than treating this handoff as a blanket certification.

## Limits and next work

Provider sign-ins, actual LLM responses, every pre-existing memory/review function and whole-machine network egress were not recertified. Git history on main can be represented by one root commit, but old SHA URLs, forks or clones can remain accessible. No document or history has been fabricated.

Future feature archive remains at `E:\AgentCorp-Future-Features-Backlog.md`. Do not reintroduce any archived feature into the default room without a separate request.
