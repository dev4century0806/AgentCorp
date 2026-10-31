# Feature Backlog & Enhancement Index

Current scope was updated on 2026-10-31. Older Completed/Verified entries below are historical implementation claims, not a fresh end-to-end certification. The current handoff defines verified scope.

---

## 1. High Priority (Core Workflow Capabilities)

| ID | Feature Name | Description | Status |
| :--- | :--- | :--- | :--- |
| **FEAT-001** | **Local Ollama Runner** | Integrates local Qwen3.5 (4B/9B) models via port 11434, optimized for RTX 3050 6GB GPU. | Completed & Verified |
| **FEAT-002** | **Web Auth [Connect] Button** | Replaces terminal commands with one-click web browser OAuth bridges for Claude, Codex, and Copilot. | Completed & Verified |
| **FEAT-003** | **Dual Mode: Chat vs. Work** | Multi-turn conversational flow without mandatory repo binding (Chat Mode) vs full Git worktree engineering (Work Mode). | Completed & Verified |
| **FEAT-004** | **Obsidian Vault Indexer & UI Settings** | Chunks `.md` notes, vectorizes with local MiniLM, queries via `sqlite-vec`, and manages vault via web settings card. | Completed & Verified |
| **FEAT-005** | **Graphify Code Knowledge Graph** | AST dependency mapping, interactive visualization (`graph.html`), and query navigation. | Completed & Verified |

---

## 2. Medium Priority (Productivity Enhancements)

| ID | Feature Name | Description | Status |
| :--- | :--- | :--- | :--- |
| **FEAT-006** | **Local AI Automated Code Review** | When a coding agent completes a diff in a worktree, a local Ollama worker reviews the patch and dispatches findings before merging. | Completed & Verified |
| **FEAT-007** | **Thinking Effort Control** | UI dropdown to select reasoning depth (Instant, Low, Medium, High, Max) across compatible models. | Completed & Verified |
| **FEAT-008** | **Remote integrations** | Archived for possible future optional work. | Removed from current scope |
| **FEAT-009** | **Retro office** | One built-in room with worker appearance and camera controls. | Implemented; Edge checked |

---

## 3. Low Priority (Ergonomics & OS Polish)

| ID | Feature Name | Description | Status |
| :--- | :--- | :--- | :--- |
| **FEAT-010** | **Native Windows Toast Alerts** | Fires system toast notifications when an agent requires permission grants or finishes a task. | Completed & Verified |
| **FEAT-011** | **Windows Service & Process Manager** | Single-command management script (`Manage-AgentCorp.ps1`) to Start, Stop, Restart, Status, Backup, and Open app. | Completed & Verified |
| **FEAT-012** | **Automated SQLite Backups** | Periodic snapshots of `office.db` saved to `data/backups/` with rolling retention via `/api/backup`. | Completed & Verified |
