# AgentCorp Workspace Rules & Execution Policies

> **Scope**: Root directory rules for `AgentCorp`. Applies recursively to all subdirectories, agent executions, and workflows unless superseded by a localized `AGENTS.md`.

---

## 1. Skill Governance & Mandatory Gates

All workspace skills reside in:
- `D:\Project\AgentCorp\lib\skill\` (and mirrored in `.agents/skills/`)

### Mandatory Skills (Active Across All Tasks)
The following 5 skills govern all agent reasoning, coding, communication, and codebase navigation:

1. **`karpathy`** (`lib/skill/karpathy/SKILL.md`):
   - **Think Before Coding**: Surface assumptions explicitly, ask when uncertain, push back against unnecessary complexity.
   - **Simplicity First**: Deliver the minimum code that solves the problem. No speculative abstractions, unrequested flexibility, or dead scaffolding.
   - **Surgical Changes**: Touch only what is necessary. Match existing style. Do not rewrite or refactor unrelated code.
   - **Goal-Driven Execution**: Define verifiable success criteria before editing and loop until verified.

2. **`ponytail`** (`lib/skill/ponytail/SKILL.md`):
   - **Lazy Senior Dev Mode**: The best code is the code never written. Solve the task with the smallest complete change.
   - **Impact Check**: Trace callers, fixtures, configs, and exports before editing. Never cut validation, error handling, security, or hardware calibration.
   - **Output Discipline**: End replies with one or two lines stating what was skipped, unverified, or any risks the user must know.

3. **`headroom`** (`lib/skill/headroom/SKILL.md`):
   - **Context Window Management**: Preserve at least 25% free context headroom for reasoning, thinking tags, and generation.
   - **Smart Compression**: Compress JSON, logs, and ASTs to essential schemas and fatal traces.
   - **Byte-for-Byte Signal Preservation**: Never compress away exceptions, function signatures, return types, or loopback bindings (`127.0.0.1`).
   - **Local Cache & Retrieval (CCR)**: Keep large outputs in local storage (`evidence/`, `graphify-out/`) and inject compact references into active prompts.

4. **`i-have-adhd`** (`lib/skill/i-have-adhd/SKILL.md`):
   - **Executive Communication**: Lead immediately with the concrete next action. Prose follows the action, if at all.
   - **Structured Steps**: Number multi-step tasks into atomic, single-action steps.
   - **No Fluff**: Strictly eliminate pleasantries, preambles, recaps, and unsolicited tangents.
   - **Chunking**: Cap visible lists to 5 items per group. State progress step-by-step.

5. **`graphify`** (`lib/skill/graphify/SKILL.md`):
   - **Graph-First Architecture Navigation**: Always query the knowledge graph in `graphify-out/graph.json` before reading or searching raw code files.
   - **Navigation Tools**: Use `graphify query "<question>"`, `graphify path "<A>" "<B>"`, and `graphify explain "<concept>"`.
   - **Incremental Sync**: Run `python -m graphify update .` after code modifications to maintain AST and relationship consistency.

---

### Contextual Skills (Activated by Task Trigger)
The following skills are loaded on demand when their specific trigger conditions match:

- **`prompt-optimizer`** (`lib/skill/prompt-optimizer/SKILL.md`):
  - *Trigger*: Tasks involving writing, analyzing, refining, optimizing, or evaluating LLM prompts, agent instructions, persona definitions, or template extraction.

---

## 2. Graphify Code Management Workflow

All architectural discovery and code editing workflows must leverage **Graphify**:

```
Codebase Ingestion / AST Parsing
               │
               ▼
   `graphify-out/graph.json` (2200+ nodes, 6000+ edges)
               │
      ┌────────┴────────┐
      ▼                 ▼
`graphify query`   `graphify path`
 (find callers)    (trace hops)
      │                 │
      └────────┬────────┘
               ▼
     Surgical Code Change
               │
               ▼
`python -m graphify update .` (Fast, AST-only sync)
```

1. **Before Modifying Code**:
   - Query symbols and dependencies via `python -m graphify query "<symbol>"` or check connections with `python -m graphify path "<source>" "<target>" --undirected`.
   - Do not perform blind recursive text searches across `web/`.
2. **After Modifying Code**:
   - Run `python -m graphify update .` to synchronize node symbols, imports, and calls.
   - If visual inspection is needed, open `graphify-out/graph.html` or inspect `graphify-out/GRAPH_REPORT.md`.

---

## 3. Strict Execution Policies & Quality Gates

1. **Verification Statements**:
   - The Agent must cite applied skills in its reasoning or response headers (e.g., `[Applied Skill: karpathy, ponytail, graphify]`).
2. **Zero-Attachment Documentation**:
   - Any new capability, architectural adjustment, or runner configuration must be documented in `/docs/TaskLog/` and reflected in `/docs/Handoffs/Current-State.md`.
3. **Directory Layout & Integrity**:
   - `lib/skill/`: Workspace skill library. Must maintain standard YAML frontmatter (`name`, `description`).
   - `web/`: Local web server runtime. Ensure loopback binding (`127.0.0.1:4317`) remains unchanged.
   - `data/`: Local SQLite databases and isolated user storage.
   - `evidence/`: Test logs, verification scripts, and runtime outputs.
   - `graphify-out/`: Persisted codebase knowledge graph (`graph.json`, `graph.html`, `GRAPH_REPORT.md`).
