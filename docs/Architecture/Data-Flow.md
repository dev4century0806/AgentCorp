# End-to-End System Data Flow

This document outlines the four principal data flows in AgentCorp: Session Initialization & Snapshot, Agent Task Execution, Semantic Memory Retrieval, and Hybrid Local/Cloud AI Orchestration.

---

## 1. Session Initialization & State Snapshot Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Browser User
    participant Fastify as Fastify HTTP (/api)
    participant WS as WebSocket (/ws)
    participant State as System State & DB

    User->>Fastify: GET / (Load Web Assets)
    Fastify-->>User: Serve Web UI + Set Same-Origin Session Cookie
    User->>WS: Connect WebSocket wss://127.0.0.1:4317/ws (Transmits Cookie)
    WS->>WS: Validate Session Token
    WS->>State: Fetch Full State Snapshot (Agents, Health, Config, Ranks)
    State-->>WS: Snapshot Object
    WS-->>User: Send Event: type="snapshot", data={...}
    User->>User: Client Reactive Store ingest -> Trigger redraw() on UI & Canvas
```

---

## 2. Agent Chat & Task Execution Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Browser User
    participant UI as Worker Chat Panel
    participant API as Fastify HTTP Server
    participant Manager as Agent Manager
    participant Runner as ACP / Ollama Runner
    participant WS as WebSocket Broadcast

    User->>UI: Input Prompt / Command + Click Send
    UI->>API: POST /api/agents/:id/messages { text, attachments }
    API->>Manager: Record Message in SQLite DB
    API-->>UI: 200 OK
    Manager->>WS: Broadcast Event: type="agent.message"
    WS-->>UI: Update message list in UI

    Manager->>Runner: Trigger Turn Execution
    loop Agent Inference & Code Generation Loop
        Runner-->>Manager: Stream Chunks / Tool Calls
        Manager->>WS: Broadcast Event: type="agent.turn.step"
        WS-->>UI: Show typing status and speech balloon over desk
    end

    alt Agent Requests File Modification / Tool Execution
        Runner-->>Manager: request_permission { tool, path, command }
        Manager->>WS: Broadcast Event: type="agent.permission"
        WS-->>UI: Display Permission Grant Modal
        User->>UI: Select Approve or Deny
        UI->>API: POST /api/agents/:id/permission { grantId, decision }
        API->>Runner: Forward Approval Result to ACP Process
    end

    Runner-->>Manager: Turn Finished
    Manager->>WS: Broadcast Event: type="agent.turn.done"
```

---

## 3. Semantic Memory & Obsidian Vault Indexing Flow

```mermaid
flowchart LR
    subgraph Ingestion["Ingestion Pipeline"]
        Vault[("Obsidian Vault<br/>Markdown Files (*.md)")]
        Parser["Markdown Chunker<br/>(Header & Code Block Splitter)"]
        Embedder["Transformers.js<br/>all-MiniLM-L6-v2 (384-d)"]
        VecDB[("SQLite DB<br/>Table: obsidian_notes + sqlite-vec")]
        
        Vault --> Parser --> Embedder --> VecDB
    end
    
    subgraph Query["Context Retrieval"]
        TaskPrompt["User Task Prompt"]
        EmbedQuery["Vectorize Query<br/>(MiniLM 384-d)"]
        KNN["Cosine KNN Search<br/>(sqlite-vec)"]
        TopDocs["Top 3-5 Relevant Architectural Excerpts"]
        InjectContext["Inject into System Prompt Context<br/>before passing to Coding Agent"]
        
        TaskPrompt --> EmbedQuery --> KNN
        VecDB --> KNN --> TopDocs --> InjectContext
    end
```

---

## 4. Hybrid Local AI (Ollama) & Cloud ACP Agent Orchestration

1. **Preparation Phase (Local GPU / Ollama):**
   - User inputs a complex feature request or refactoring task.
   - **Local AI (Qwen3.5 on Ollama):** Scans the file tree, matches Obsidian architecture notes, and identifies target symbols using Graphify without spending cloud tokens.
2. **Execution Phase (Cloud ACP Agents - Claude Code / Codex):**
   - **Coding Agent:** Receives targeted file paths, AST contexts, and requirements instead of a full-repo prompt dump.
   - Modifies code within an isolated Git worktree (`data/git/worktrees/...`).
3. **Verification Phase:**
   - Runs automated test suite (`npm.cmd test`, `python -m graphify update .`).
   - Surfaces diff and status to user for final review.
