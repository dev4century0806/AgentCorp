# ADR-005: Streamlined core and server-authoritative assistant naming

Date: 2026-10-31. Status: Accepted for this implementation.

## Decision

Ship Retro as the single built-in room. Remove progression, pets, seasonal overlays, arcade and the retired Telegram/Figma/Jira/Linear integrations. Retain normal worker/task functions, GitHub Issues, Factory and generic Toolkit/MCP support.

The backend owns the assistant's configured name and first-run marker. Browser storage is a convenience cache and cannot suppress setup or overwrite a name saved in another browser. Both welcome and General use the same API and validation. A failed write does not close the welcome form or mark setup complete.

Build the frontend and shared runtime contracts together from TypeScript with pinned build dependencies. Generated assets are named by hash; publishing an HTML page that points at a stale bundle is no longer the editing workflow.

## Consequences

Historical database migrations are kept to upgrade existing installations. Migration 35 removes unused progression and remote-message storage. Configuration migration 3 removes retired connection settings. Existing agent and conversation identifiers remain compatible.

Archived features can be reconsidered only as separately requested work. A one-root main branch is a presentation of the current tree, not a guarantee that previous commits, clones or caches have vanished.
