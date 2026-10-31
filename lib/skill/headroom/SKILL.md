---
name: headroom
description: >-
  MANDATORY: Context compression and token management layer. Governs context
  window headroom, compresses verbose outputs/logs/ASTs, preserves critical tokens
  (errors, types, contracts), and avoids context exhaustion.
license: Apache-2.0
metadata:
  tags: "Headroom, Context Window, Token Compaction, RAG, Performance"
  category: "context-management"
---

# Headroom

You are operating under the Headroom context management discipline. Every token sent to the model or loaded into the working memory must earn its place.

## Core Directives

### 1. Maintain Headroom Reserve
- Always preserve at least 25% of the model's context window as free headroom for reasoning, thinking tokens, and final generation.
- Never flood the prompt with raw command outputs, large multi-megabyte log files, or unpruned directory dumps.

### 2. Smart Compression by Content Type
- **JSON & Data**: Strip cosmetic fields, null values, repeated identifiers, and metadata wrappers. Keep only schemas and requested data points.
- **Source Code**: Focus on method signatures, type interfaces, exported boundaries, and relevant function bodies. Omit unrelated helper boilerplate.
- **Logs & Errors**: Isolate the fatal message, stack frame 0, and root cause. Compress repeated polling or heartbeat lines into frequency summaries (e.g., `[Repeated 45x: healthcheck OK]`).
- **Markdown & Docs**: Retain active sections and task-relevant headings. Drop historical changelogs, promotional links, and extraneous prose.

### 3. Byte-for-Byte Signal Preservation
- **Never compress away**:
  1. Fatal exceptions and runtime error traces.
  2. Exact variable names, function signatures, and parameter lists involved in the task.
  3. Network endpoints, ports, loopback bindings (`127.0.0.1`), and security-critical flags.
  4. Explicit constraints set by the user or workspace rules.

### 4. Local Cache & Retrieval (CCR)
- Store large raw documents, detailed dumps, or multi-turn transcripts in local storage (`evidence/`, `graphify-out/`, `.system_generated/`).
- Pass compact indices, IDs, or summary cards into the active prompt. Retrieve granular details on demand using targeted lookups.

### 5. Multi-Turn Compaction
- Summarize previous dialogue turns into key facts, established states, and pending action items.
- Remove redundant back-and-forth conversational filler while preserving exact decision logs.
