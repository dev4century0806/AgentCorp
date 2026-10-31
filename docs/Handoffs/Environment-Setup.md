# Environment Setup & Operating Specifications

This document defines system requirements, environment variables, and configuration procedures for deploying or migrating AgentCorp to a Windows host.

---

## 1. Hardware Specifications

| Component | Minimum Requirement | Verified Test Machine Specification |
| :--- | :--- | :--- |
| **Operating System** | Windows 10 (64-bit) Build 19041+ | Windows 11 Pro 64-bit |
| **CPU** | 4 Cores / 8 Threads | Intel Core i5 / AMD Ryzen 5 or higher |
| **System RAM** | 8 GB RAM | 16 GB DDR5 |
| **GPU** | Integrated Graphics (Intel/AMD) | NVIDIA GeForce RTX 3050 Laptop (6GB VRAM) |
| **Storage** | 10 GB free space (SSD) | 30 GB free space (holds Ollama models) |

---

## 2. Software Prerequisites & Runtime Setup

### 2.1. Node.js Runtime
- **Version:** Node.js `v24.22.1` (or Node.js LTS `v20+`).
- **Native Modules:** Relies on `better-sqlite3` and `sqlite-vec`. Prebuilt Windows x64 binaries (`.node`) reside in `web/node_modules`.
- **Clean Dependency Reinstall (if needed):**
  ```powershell
  cd D:\Project\AgentCorp\web
  npm.cmd ci --omit=dev --no-audit --no-fund
  ```

### 2.2. Local AI Setup (Ollama)
1. Install Ollama for Windows from [https://ollama.com/download/windows](https://ollama.com/download/windows).
2. Pull the optimized Qwen3.5 models:
   ```powershell
   # Primary Model: Fits within 6GB VRAM for high-speed inference
   ollama pull qwen3.5:4b

   # Fallback Model: Higher reasoning capacity with slight RAM offload
   ollama pull qwen3.5:9b
   ```
3. Verify the Ollama service endpoint:
   ```powershell
   curl.exe http://127.0.0.1:11434/api/tags
   ```

### 2.3. Python & Graphify Engine
- **Version:** Python 3.10+ (tested with Python 3.14.7).
- **Package:** `graphifyy` installed via pip.
- **Verification:**
  ```powershell
  python -m graphify --help
  ```

---

## 3. Environment Variables

AgentCorp supports dynamic configuration via environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `AGENT_CORP_PORT` | `4317` | Local loopback port for HTTP and WebSocket services. |
| `AGENT_CORP_HOME` | `D:\Project\AgentCorp\data\office` | Storage root for `office.db`, accounts, and local configurations. |
| `USERPROFILE` | `D:\Project\AgentCorp\data\home` | Isolated user profile directory assigned to child agent processes. |
| `NODE_NO_WARNINGS` | `1` | Suppresses experimental Node.js warnings during startup. |

---

## 4. Browser Guidelines
- **Supported Browsers:** Google Chrome, Microsoft Edge, Mozilla Firefox.
- **URL:** `http://127.0.0.1:4317/`.
- Ensure cookies and local storage are enabled for `127.0.0.1` to maintain session tokens.
