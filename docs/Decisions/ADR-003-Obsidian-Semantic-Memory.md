# ADR-003: Local `sqlite-vec` & MiniLM Embedding for Obsidian Vault Indexing

## 1. Context
- Providing the entire codebase in agent prompts creates massive token overhead (100k+ tokens), increases LLM latency, and induces hallucinations or deviations from architectural conventions.
- Architectural guidelines, project conventions, and system boundaries are maintained in Markdown (`.md`) format within an **Obsidian Vault**.
- A local semantic vector search engine was required: lightweight, fully offline on Windows, and free of heavyweight external services (Docker, ChromaDB, Milvus, Pinecone).

## 2. Decision
- **Leverage Existing In-Process Infrastructure in AgentCorp:**
  - **Local Embedder:** Utilizes `web/server/dist/memory/embedder.js` with `@huggingface/transformers` and quantized **`Xenova/all-MiniLM-L6-v2`** weights (~23MB model footprint, 384-dimensional dense vectors running on ONNX runtime).
  - **Vector Database:** Utilizes **`sqlite-vec`** extension embedded directly into `data/office/office.db`.
- **Obsidian Vault Sync Pipeline:**
  - Configurable vault directory in `config.json` (`obsidian.vaultPath`).
  - Chunks markdown notes along header boundaries, computes 384-d embeddings, and inserts them into the `obsidian_notes` virtual vector table.
  - On task execution, vectorizes the user prompt, performs k-NN Cosine Similarity search, and injects the top 3–5 matching architectural notes into the agent's system prompt.

## 3. Consequences
- **Positive:**
  - Zero external process dependencies; all vector data persists within `office.db`.
  - Sub-10ms query retrieval latency with offline reliability.
  - Cuts up to 80% of prompt token payload before dispatching tasks to coding agents.
- **Trade-offs:**
  - `all-MiniLM-L6-v2` is tuned for technical English and source code tokens; pure Vietnamese prose semantic matching benefits from hybrid keyword matching (BM25).
