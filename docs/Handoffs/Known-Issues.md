# Known Issues & Architectural Constraints

This document details platform-specific constraints and architectural boundaries between the original macOS Electron application and the current Windows local web runtime.

---

## 1. macOS Desktop vs. Windows Local Web Port Boundaries

| Feature | Original Desktop (macOS Electron) | Current Port (Windows Web) | Mitigation / Expected Behavior |
| :--- | :--- | :--- | :--- |
| **Native Folder Picker** | Cocoa native file dialog (`NSOpenPanel`). | Web browsers cannot invoke native directory pickers due to sandbox isolation. | Input repository paths directly into the UI (e.g. `D:\Project\my-repo`) or configure default search roots. |
| **Voice Audio Input** | Direct microphone capture via Electron native preload bridge. | Disabled in web mode to prevent browser hardware permission friction. | Communicate via textual prompts in the worker chat HUD. |
| **Day Recap Video Export** | Encoded via bundled macOS `ffmpeg` binary. | Web canvas supports in-browser timelapse playback. | In-browser canvas animation playback is fully operational; disk `.mp4` export is deferred. |
| **Application Lifecycle** | Controlled via macOS application lifecycle (`Cmd+Q`). | Web browser tab lifecycle. | Terminate the background server process using `Stop-Process` on `data/server.pid`. |

---

## 2. Hardware Constraints & Local AI Sizing (RTX 3050 6GB)

- **Available VRAM:** 6GB GDDR6 on laptop RTX 3050.
  - **Qwen3.5 4B (Q4_K_M ~2.8 GB):** Consumes ~3GB VRAM, leaving ample overhead for Windows desktop composition. Generates >60 tokens/sec.
  - **Qwen3.5 9B (Q4_K_M ~5.6 GB):** Saturates VRAM. High context windows (>4k tokens) cause Ollama to offload tail layers to system RAM, throttling throughput to ~15–20 tokens/sec.
  - **Policy:** Do not run models $\ge 14\text{B}$ on 6GB VRAM configurations to avoid memory exhaustion and severe latency degradation.

---

## 3. Windows Process Execution Specifics

- **Path Delimiters:** Windows uses backslashes (`\`) whereas ACP tools (Claude Code/Codex) often emit POSIX paths (`/`). All path logic in `web/start.mjs`, `config.js`, and `memory/obsidian-indexer.js` normalizes paths with Node.js `path.resolve()`.
- **Command Extensions:** Node CLI binaries on Windows require `.cmd` extensions (e.g. `npm.cmd`, `npx.cmd`). Spawn calls must pass the extension or enable `{ shell: true }`.
- **Browser Popup Blocker:** When clicking the [Connect] button for Web Auth, browsers may trigger a popup warning. Grant permission for `127.0.0.1:4317` to enable automatic OAuth redirects.
