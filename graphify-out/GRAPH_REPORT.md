# Graph Report - AgentCorp  (2026-10-31)

## Corpus Check
- 166 files · ~239,135 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 4, .toml 2, .onnx 1)

## Summary
- 2069 nodes · 5049 edges · 115 communities (102 shown, 13 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 191 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ded8e6b3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- graphify reference: incremental update and cluster-only
- graphify reference: incremental update and cluster-only
- protocol.ts
- office-contract.ts
- future.ts
- web/package.json
- openCreate
- worker.ts
- ideas.ts
- mountOffice
- store.ts
- tickets.ts
- person.ts
- ui/offices.ts
- decor.ts
- auth.ts
- openPreview
- shortcuts.ts
- showcase-api.ts
- settings.ts
- el
- Store
- day.ts
- update.ts
- smoke.test.mjs
- floors.ts
- ranks.ts
- memory.ts
- voice.ts
- preview.ts
- main.ts
- cards.ts
- runners.ts
- sound.ts
- build-ui.mjs
- panel-resize.ts
- ClipDeps
- skills/prompt-optimizer/SKILL.md
- voice-settings.ts
- skill/prompt-optimizer/SKILL.md
- runners.ts
- shading.ts
- clear
- el
- render
- ref_shared
- AtMenu
- compilerOptions
- repo-field.ts
- username.ts
- What You Must Do When Invoked
- desks.ts
- messages.ts
- share.ts
- devDependencies
- What You Must Do When Invoked
- Decisions/README.md
- Rules
- scripts
- trackerSection
- feedbackSection
- Rules
- officesSection
- Technical Debt & Refactoring Plan
- 2. Backend Subsystems (`web/server/dist/`)
- standup.ts
- referral.ts
- avatarSetting
- 2. Phase Breakdown
- MemoryIndicator
- Current Project State (Architecture & Handoff)
- interface
- interface
- Onboarding — Start Here
- tooltip.ts
- graphify reference: extra exports and benchmark
- graphify reference: extra exports and benchmark
- client.ts
- Core Directives
- Environment Setup & Operating Specifications
- Core Directives
- AgentCorp Workspace Rules & Execution Policies
- 2. Layer Breakdown
- 1. Automated Test Suites
- Karpathy Guidelines
- Karpathy Guidelines
- End-to-End System Data Flow
- graphify reference: query, path, explain
- graphify reference: query, path, explain
- Karpathy Guidelines
- Karpathy Guidelines
- Ponytail
- Ponytail
- Known Issues & Architectural Constraints
- Feature Backlog & Enhancement Index
- Ponytail
- Ponytail
- AgentCorp
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- Skill Library Management Policy (`.agents/skills/`)
- Skill Library Management Policy (`.agents/skills/`)
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- graphify/graphify/references/extraction-spec.md
- skill/graphify/references/extraction-spec.md
- ASK-1 — AgentCorp Architecture & System Capabilities
- Manage-AgentCorp.ps1

## God Nodes (most connected - your core abstractions)
1. `el()` - 197 edges
2. `$` - 88 edges
3. `mountOffice()` - 77 edges
4. `clear()` - 55 edges
5. `Store` - 51 edges
6. `box()` - 42 edges
7. `openCreate()` - 40 edges
8. `mountIdeasPanel()` - 33 edges
9. `rerender()` - 33 edges
10. `mountVoice()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `3. Consequences` --references--> `mirrored()`  [INFERRED]
  docs/Decisions/ADR-001-Camera-System.md → web/ui/src/scene/view.ts
- `2. Decision` --references--> `azimuth()`  [INFERRED]
  docs/Decisions/ADR-001-Camera-System.md → web/ui/src/scene/view.ts
- `2. Decision` --references--> `viewHeight()`  [INFERRED]
  docs/Decisions/ADR-001-Camera-System.md → web/ui/src/scene/view.ts
- `2. Decision` --references--> `farWalls()`  [INFERRED]
  docs/Decisions/ADR-001-Camera-System.md → web/ui/src/scene/view.ts
- `Entry` --references--> `OfficeManifest`  [EXTRACTED]
  web/ui/src/state/offices.ts → web/shared/office-contract.ts

## Import Cycles
- None detected.

## Communities (115 total, 13 thin omitted)

### Community 0 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 1 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 2 - "protocol.ts"
Cohesion: 0.02
Nodes (77): AgentKind, AtMention, BackgroundAgent, BackgroundCommand, BlockedSender, BUILT_IN_PAM_ID, BUILTIN_PERSONAS, Conversation (+69 more)

### Community 3 - "office-contract.ts"
Cohesion: 0.05
Nodes (53): ANCHOR_BOUNDS, Check, Decoration, DETAIL_LIMIT, extent(), FLOOR_PATTERNS, Hex, inside() (+45 more)

### Community 4 - "future.ts"
Cohesion: 0.08
Nodes (66): box(), mat(), onEveryWall(), onWall(), pick(), rand(), replacesFront(), receptionComputer() (+58 more)

### Community 5 - "web/package.json"
Cohesion: 0.09
Nodes (30): @agentclientprotocol/claude-agent-acp, @agentclientprotocol/codex-acp, better-sqlite3, fastify, @fastify/static, @github/copilot, @huggingface/transformers, @modelcontextprotocol/sdk (+22 more)

### Community 6 - "openCreate"
Cohesion: 0.10
Nodes (28): DesignerLogEntry, runnerLabel(), costNote(), designerFields(), designerMenu(), dismissGeneration(), emptyDetails(), generationCard() (+20 more)

### Community 7 - "worker.ts"
Cohesion: 0.09
Nodes (46): ErrorAction, isHandoffNote(), QuestionRequest, waitingOnAgents(), setRichText(), checkedAgo(), commandNote(), elapsed() (+38 more)

### Community 8 - "ideas.ts"
Cohesion: 0.10
Nodes (32): Attachment, draftTemplate(), Idea, projectOf(), SHAPING_BRIEF_OPENING, TicketDraft, trackerInfo, ideaFileUrl() (+24 more)

### Community 9 - "mountOffice"
Cohesion: 0.09
Nodes (49): besidePlace(), route(), lookFor(), bubbleIsCollapsed(), bubbleIsVisible(), bubbleText(), covers(), isBreak() (+41 more)

### Community 10 - "store.ts"
Cohesion: 0.09
Nodes (29): CLAUDE_MODEL_MENU, DoneEntry, Health, Limits, MessageStyle, Persona, RepoPersona, RunnerChoice (+21 more)

### Community 11 - "tickets.ts"
Cohesion: 0.09
Nodes (44): autoWorkerName(), displayKey(), isRepoPersonaId(), nearestModel(), splitTicketId(), hireRunnerChoice(), hireRunnerView, openRunnerSettings() (+36 more)

### Community 12 - "person.ts"
Cohesion: 0.08
Nodes (33): AgentLook, HAIRS, SHIRTS, SKINS, Spot, effects, spin, UP (+25 more)

### Community 13 - "ui/offices.ts"
Cohesion: 0.08
Nodes (46): DETAIL_FIELDS, OfficeBrief, OfficeGeneration, OfficeSummary, GenerateOfficeRequest, ModelMenu, OfficeRecord, officePreview() (+38 more)

### Community 14 - "decor.ts"
Cohesion: 0.15
Nodes (22): OfficeSlot, clearBoxes(), Decor, decorate(), FRONT, place(), DeskTop, Box (+14 more)

### Community 15 - "auth.ts"
Cohesion: 0.14
Nodes (16): SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, bindTermsOfService(), BlockedSender, callAvatar(), loadProfile(), openTermsOfService(), PerkOverride (+8 more)

### Community 16 - "openPreview"
Cohesion: 0.22
Nodes (24): actionsRow(), button(), confirmDialog(), creatorLine(), deleteOffice(), installFromListing(), byline(), listingChip() (+16 more)

### Community 17 - "shortcuts.ts"
Cohesion: 0.07
Nodes (44): ARROWS, bindError(), Bindings, bindKey(), BUTTONS, currentKey(), DEFAULT_DICTATE_KEY, defaultBindings() (+36 more)

### Community 18 - "showcase-api.ts"
Cohesion: 0.13
Nodes (19): supabaseClient(), galleryParams(), GalleryQuery, ListingStatus, normalizeTag(), REFRESH_MARGIN_MS, SessionEndedError, getPublicOffice() (+11 more)

### Community 19 - "settings.ts"
Cohesion: 0.08
Nodes (29): Editor, Settings, TrackerProjectSetting, TRACKERS, TrackerSettings, Approval, APPROVALS, capitalize() (+21 more)

### Community 20 - "el"
Cohesion: 0.06
Nodes (90): GeneralAgentToolInfo, McpServerInfo, PERSONA_DESCRIPTION_MAX, PERSONA_NAME_MAX, RepoAgentInfo, RepoAgentToolInfo, SKILL_NAME_MAX, skillMatrixKey() (+82 more)

### Community 21 - "Store"
Cohesion: 0.18
Nodes (6): Message, Snapshot, saveRoom(), Store, mountMemoryIndicator(), mountSettings()

### Community 22 - "day.ts"
Cohesion: 0.11
Nodes (14): DAY_WORKERS_MAX, DayMoment, encodeDayMoments(), OfficeDay, Room, ClipAspect, DAY_LENGTH, DayNews (+6 more)

### Community 23 - "update.ts"
Cohesion: 0.15
Nodes (17): checkForUpdateBeforeSignIn(), DesktopBridge, downloadIcon(), listeners, mountUpdate(), NoteBlock, noteBlocks(), progressRing() (+9 more)

### Community 24 - "smoke.test.mjs"
Cohesion: 0.15
Nodes (4): ws, content, ws@8.22.0, home

### Community 25 - "floors.ts"
Cohesion: 0.18
Nodes (14): FloorPattern, ParticleKind, floorSlab(), drawFloor(), grain(), monoFloor(), shade(), userFloor() (+6 more)

### Community 26 - "ranks.ts"
Cohesion: 0.22
Nodes (13): signedInAvatarUrl(), signedInUsername(), AvatarDocument, avatarHash(), avatarImg(), avatarPalette, avatarSource(), BACKGROUNDS (+5 more)

### Community 27 - "memory.ts"
Cohesion: 0.08
Nodes (38): GitHubAccountCheck, Memory, MemoryInput, MemoryKind, RepoChoice, RepoGitHubAccounts, ACTION_ICONS, actionIcon() (+30 more)

### Community 28 - "voice.ts"
Cohesion: 0.12
Nodes (20): VOICE_MAX_SECONDS, VOICE_MIN_SECONDS, VOICE_SAMPLE_RATE, BUTTON_ICONS, takesKeys(), watchDictateKey(), ClipStart, Dictated (+12 more)

### Community 29 - "preview.ts"
Cohesion: 0.09
Nodes (43): 2. Decision, Activity, AgentStatus, disposeRoom(), Walls, buildDesks(), buildReception(), Desk (+35 more)

### Community 30 - "main.ts"
Cohesion: 0.10
Nodes (17): chosenOffice, colour, startup, store, Colour, colourOf(), markColour(), blockSender() (+9 more)

### Community 31 - "cards.ts"
Cohesion: 0.17
Nodes (12): Agent, lastSaid(), View, VIEWS, ACTIVITY_LABELS, card(), chatSpace(), deskLabel() (+4 more)

### Community 32 - "runners.ts"
Cohesion: 0.19
Nodes (20): agentSetup(), LOOK_CHOICES, NO_EFFORT_MODELS, PERMISSION_LEVELS, PermissionLevel, SetupChoice, WorkerLook, canSwitchRunner() (+12 more)

### Community 33 - "sound.ts"
Cohesion: 0.18
Nodes (18): Toast, applyMusic(), audio(), CHORDS, DEFAULT_PREFS, freq(), loadSoundPrefs(), MELODY (+10 more)

### Community 34 - "build-ui.mjs"
Cohesion: 0.17
Nodes (9): css, dist, generated, html, js, outputs, root, home (+1 more)

### Community 35 - "panel-resize.ts"
Cohesion: 0.24
Nodes (11): CHAT_SIZE, clampWidth(), IDEAS_SIZE, loadWidth(), MAX_WIDTH, MIN_WIDTH, mountPanelResize(), PanelSize (+3 more)

### Community 37 - "skills/prompt-optimizer/SKILL.md"
Cohesion: 0.05
Nodes (31): 1. Goal & Attention Directive, 2. Constraints & Edge Cases, 3. Example Few-Shot Demonstrations, 4. Self-Correction / Verification Loop, Analytical Structured Optimization Reference, Key Sections, Purpose, Evaluation Scoring (+23 more)

### Community 38 - "voice-settings.ts"
Cohesion: 0.43
Nodes (7): currentDictateKey(), dictateKeyLabel(), MIC_DENIED_STEPS, micAccess(), megabytes(), onOffTabs(), voiceSection()

### Community 39 - "skill/prompt-optimizer/SKILL.md"
Cohesion: 0.05
Nodes (31): 1. Goal & Attention Directive, 2. Constraints & Edge Cases, 3. Example Few-Shot Demonstrations, 4. Self-Correction / Verification Loop, Analytical Structured Optimization Reference, Key Sections, Purpose, Evaluation Scoring (+23 more)

### Community 40 - "runners.ts"
Cohesion: 0.19
Nodes (12): hireableRunners(), RunnerHealth, RunnerMode, SIGN_IN, commandLine(), enableTabs(), RUNNER_OPTIONS, runnersCard() (+4 more)

### Community 41 - "shading.ts"
Cohesion: 0.09
Nodes (21): three, drawn, pass, sheet, keepShading(), onRenderStylePicked(), pickListeners, RENDER_NAMES (+13 more)

### Community 42 - "clear"
Cohesion: 0.18
Nodes (13): SlashCommand, AtCandidate, AtChip, atQuery(), matchCandidates(), mountAtMenu(), clear(), drawRepos() (+5 more)

### Community 43 - "el"
Cohesion: 0.13
Nodes (26): WORKER_NAME_MAX, api, mountAssistantWelcome(), nameForm(), $, appendLinked(), appendRich(), ClipboardWriter (+18 more)

### Community 44 - "render"
Cohesion: 0.33
Nodes (12): assistantNameSection(), settingCard(), autoReviewSection(), choiceTabs(), editorSection(), messageStyleSection(), newWorkersSection(), permissionsSection() (+4 more)

### Community 45 - "ref_shared"
Cohesion: 0.13
Nodes (24): DEFAULT_LOOK, Onboarding, QuestId, QUESTS, RUNNER_CHOICES, Ticket, TrackerId, trackerName() (+16 more)

### Community 47 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, lib, module, moduleResolution, noEmit, paths, skipLibCheck, strict (+3 more)

### Community 48 - "repo-field.ts"
Cohesion: 0.24
Nodes (10): hireKind(), NO_REPO, OTHER_REPO, pickedRepos(), repoMultiPicker, RepoPick, RepoPickerState, reposControl() (+2 more)

### Community 49 - "username.ts"
Cohesion: 0.18
Nodes (14): saveUsername(), signedInEmail(), usernameAvailable(), profileSection(), bindUsernameAvailability(), BLOCKED_USERNAMES, normalizeUsername(), USERNAME_MAX_LENGTH (+6 more)

### Community 50 - "What You Must Do When Invoked"
Cohesion: 0.07
Nodes (26): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+18 more)

### Community 51 - "desks.ts"
Cohesion: 0.08
Nodes (36): OfficeManifest, BoxOpts, DARKWOOD, DOOR_Z, geo(), geoCache, keep(), matCache (+28 more)

### Community 52 - "messages.ts"
Cohesion: 0.18
Nodes (15): SharePackageData, UserMessage, InboxMessage, SharePreview, downloadedNote(), MessagesApi, messageSnippet(), timeAgo() (+7 more)

### Community 53 - "share.ts"
Cohesion: 0.33
Nodes (8): SECRET_PATTERNS, lookupUserByUsername(), sharePackage(), escapeHtml(), TEXT_ICONS, openShareDialog(), ShareTarget, stripSecrets()

### Community 54 - "devDependencies"
Cohesion: 0.29
Nodes (7): esbuild, @types/three, typescript, devDependencies, esbuild@0.28.2, @types/three@0.187.0, typescript@5.9.3

### Community 55 - "What You Must Do When Invoked"
Cohesion: 0.07
Nodes (26): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+18 more)

### Community 56 - "Decisions/README.md"
Cohesion: 0.09
Nodes (17): 1. Context, 3. Consequences, ADR-001: Isometric 2.5D Camera Projection & Depth Sorting on Canvas 2D, 1. Context, 2. Decision, 3. Consequences, ADR-002: Local AI Runner Integration via Ollama (Qwen3.5 on RTX 3050), 1. Context (+9 more)

### Community 57 - "Rules"
Cohesion: 0.12
Nodes (16): 10. No preamble, no recap, no closing pleasantries, 1. Lead with the next action, 2. Number multi-step tasks, 3. End with one concrete next action, 4. Suppress tangents, 5. Restate state every turn, 6. Give specific time estimates, 7. Make completed work visible (+8 more)

### Community 58 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, backup, build, start, test, typecheck

### Community 59 - "trackerSection"
Cohesion: 0.47
Nodes (5): SourceStatus, connectionStatus, connectionLabel(), factorySection(), trackerSection()

### Community 60 - "feedbackSection"
Cohesion: 0.27
Nodes (9): sendFeedback(), buildFeedbackUrl(), FEEDBACK_REPO, FEEDBACK_REPO_URL, FeedbackUrlParams, getAppVersion(), getMacOsVersion(), runnerDisplayName() (+1 more)

### Community 61 - "Rules"
Cohesion: 0.12
Nodes (16): 10. No preamble, no recap, no closing pleasantries, 1. Lead with the next action, 2. Number multi-step tasks, 3. End with one concrete next action, 4. Suppress tangents, 5. Restate state every turn, 6. Give specific time estimates, 7. Make completed work visible (+8 more)

### Community 62 - "officesSection"
Cohesion: 0.40
Nodes (6): bindLive(), splitOffices(), visibleGenerations(), officesSection(), redrawLive(), refreshListings()

### Community 63 - "Technical Debt & Refactoring Plan"
Cohesion: 0.15
Nodes (12): 1. Frontend Build & Packaging Pipeline (Vite Bundling), 2. Backend JavaScript Modularity (Resolved), 3. Node.js Native Module ABI Compatibility, 4. WebSocket Disconnection & Stream Resilience, Current State, Current State, Current State, Current State (+4 more)

### Community 64 - "2. Backend Subsystems (`web/server/dist/`)"
Cohesion: 0.17
Nodes (11): 1. Root & Lifecycle Entry Points, 2.1. Core System & Protocols, 2.2. Agent & Runner Subsystem (`agents/`), 2.3. HTTP & WebSocket Networking (`http/`), 2.4. Semantic Vector Memory (`memory/`), 2. Backend Subsystems (`web/server/dist/`), 3.1. Isometric Scene Engine (`scene/`), 3.2. UI Components & HUD (`ui/`) (+3 more)

### Community 65 - "standup.ts"
Cohesion: 0.23
Nodes (14): StandupSummary, localDate(), yesterday(), getLastVisit(), getStandupShownDate(), hasHiredWorkers(), hideStandup(), mountStandup() (+6 more)

### Community 66 - "referral.ts"
Cohesion: 0.33
Nodes (4): REFERRAL_SOURCES, ReferralAnswer, ReferralSource, SOURCES

### Community 68 - "avatarSetting"
Cohesion: 0.21
Nodes (12): AVATAR_PICK_BYTES, AVATAR_PIXELS, AVATAR_TYPES, AVATAR_UPLOAD_BYTES, avatarFileError(), centreCrop(), Crop, encodeAvatar() (+4 more)

### Community 69 - "2. Phase Breakdown"
Cohesion: 0.20
Nodes (9): 1. Development Phases, 2. Phase Breakdown, Audit priorities proposed on 2026-10-31 — not implemented, Phase 1: Local AI & Web Auth Connect (Completed), Phase 2: Dual Mode Architecture (Chat vs. Work) (Completed), Phase 3: Obsidian Vault Semantic Memory (Completed), Phase 4: Codebase Knowledge Graph & Mandatory Skills (Completed), Phase 5: Two-Tier Hybrid Workflow (Completed & Verified) (+1 more)

### Community 72 - "MemoryIndicator"
Cohesion: 0.22
Nodes (6): MemoryActivity, MEMORY_LABEL, MemoryIndicator, MIN_ACTIVE_MS, realTimers, Timers

### Community 74 - "Current Project State (Architecture & Handoff)"
Cohesion: 0.33
Nodes (5): 1. Quick Start for Incoming Engineers (30 Seconds), 2. Feature Status Matrix, 3. Isolated User Storage, 4. Verification Checklist, Current Project State (Architecture & Handoff)

### Community 75 - "interface"
Cohesion: 0.29
Nodes (6): interface, default_prompt, display_name, short_description, policy, allow_implicit_invocation

### Community 76 - "interface"
Cohesion: 0.29
Nodes (6): interface, default_prompt, display_name, short_description, policy, allow_implicit_invocation

### Community 79 - "Onboarding — Start Here"
Cohesion: 0.22
Nodes (8): 1. Project Introduction (AgentCorp), 2. Five-Minute Quick Start, 3. High-Level Architecture, 4. Documentation Map & Reading Order, Onboarding — Start Here, Prerequisites, Start Steps, Verification

### Community 84 - "tooltip.ts"
Cohesion: 0.31
Nodes (8): ALIGNS, Box, mountTooltips(), hide(), placeTooltip(), scrollMovesAnchor(), tipAlign, titleIsOnlyName()

### Community 86 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 87 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 92 - "client.ts"
Cohesion: 0.07
Nodes (34): OfficeDetails, AttachmentUpload, GeneralAgentInfo, HintId, HireRequest, IdeaUpdate, InstallOfficeRequest, IssueType (+26 more)

### Community 97 - "Core Directives"
Cohesion: 0.25
Nodes (7): 1. Maintain Headroom Reserve, 2. Smart Compression by Content Type, 3. Byte-for-Byte Signal Preservation, 4. Local Cache & Retrieval (CCR), 5. Multi-Turn Compaction, Core Directives, Headroom

### Community 98 - "Environment Setup & Operating Specifications"
Cohesion: 0.22
Nodes (8): 1. Hardware Specifications, 2.1. Node.js Runtime, 2.2. Local AI Setup (Ollama), 2.3. Python & Graphify Engine, 2. Software Prerequisites & Runtime Setup, 3. Environment Variables, 4. Browser Guidelines, Environment Setup & Operating Specifications

### Community 99 - "Core Directives"
Cohesion: 0.25
Nodes (7): 1. Maintain Headroom Reserve, 2. Smart Compression by Content Type, 3. Byte-for-Byte Signal Preservation, 4. Local Cache & Retrieval (CCR), 5. Multi-Turn Compaction, Core Directives, Headroom

### Community 100 - "AgentCorp Workspace Rules & Execution Policies"
Cohesion: 0.29
Nodes (6): 1. Skill Governance & Mandatory Gates, 2. Graphify Code Management Workflow, 3. Strict Execution Policies & Quality Gates, AgentCorp Workspace Rules & Execution Policies, Contextual Skills (Activated by Task Trigger), Mandatory Skills (Active Across All Tasks)

### Community 102 - "2. Layer Breakdown"
Cohesion: 0.29
Nodes (6): 1. Architectural Model, 2.1. Frontend Layer, 2.2. Backend Server Layer, 2.3. Agent Execution & ACP Protocol Layer, 2. Layer Breakdown, System Architecture Overview

### Community 103 - "1. Automated Test Suites"
Cohesion: 0.22
Nodes (8): 1. Automated Test Suites, 2. Visual & Interactive UI Checklist, 3. Infrastructure & Isolation Checklist, Step 1: Core Unit & Bus Tests, Step 2: Live Smoke Test, Step 3: Graphify Knowledge Graph Sync, Step 4: Regression Test Suite, Verification & Sanity Checklist

### Community 105 - "Karpathy Guidelines"
Cohesion: 0.33
Nodes (5): 1. Think Before Coding, 2. Simplicity First, 3. Surgical Changes, 4. Goal-Driven Execution, Karpathy Guidelines

### Community 106 - "Karpathy Guidelines"
Cohesion: 0.33
Nodes (5): 1. Think Before Coding, 2. Simplicity First, 3. Surgical Changes, 4. Goal-Driven Execution, Karpathy Guidelines

### Community 109 - "End-to-End System Data Flow"
Cohesion: 0.33
Nodes (5): 1. Session Initialization & State Snapshot Flow, 2. Agent Chat & Task Execution Flow, 3. Semantic Memory & Obsidian Vault Indexing Flow, 4. Hybrid Local AI (Ollama) & Cloud ACP Agent Orchestration, End-to-End System Data Flow

### Community 112 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 113 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 114 - "Karpathy Guidelines"
Cohesion: 0.33
Nodes (5): 1. Think Before Coding, 2. Simplicity First, 3. Surgical Changes, 4. Goal-Driven Execution, Karpathy Guidelines

### Community 115 - "Karpathy Guidelines"
Cohesion: 0.33
Nodes (5): 1. Think Before Coding, 2. Simplicity First, 3. Surgical Changes, 4. Goal-Driven Execution, Karpathy Guidelines

### Community 119 - "Ponytail"
Cohesion: 0.40
Nodes (4): Before you write, Levels, Ponytail, The smallest complete change

### Community 120 - "Ponytail"
Cohesion: 0.40
Nodes (4): Before you write, Levels, Ponytail, The smallest complete change

### Community 122 - "Known Issues & Architectural Constraints"
Cohesion: 0.40
Nodes (4): 1. macOS Desktop vs. Windows Local Web Port Boundaries, 2. Hardware Constraints & Local AI Sizing (RTX 3050 6GB), 3. Windows Process Execution Specifics, Known Issues & Architectural Constraints

### Community 123 - "Feature Backlog & Enhancement Index"
Cohesion: 0.40
Nodes (4): 1. High Priority (Core Workflow Capabilities), 2. Medium Priority (Productivity Enhancements), 3. Low Priority (Ergonomics & OS Polish), Feature Backlog & Enhancement Index

### Community 124 - "Ponytail"
Cohesion: 0.40
Nodes (4): Before you write, Levels, Ponytail, The smallest complete change

### Community 125 - "Ponytail"
Cohesion: 0.40
Nodes (4): Before you write, Levels, Ponytail, The smallest complete change

### Community 127 - "AgentCorp"
Cohesion: 0.33
Nodes (5): AgentCorp, Build, Project layout, Run, Test

### Community 128 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 129 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 130 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 131 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 171 - "ASK-1 — AgentCorp Architecture & System Capabilities"
Cohesion: 0.40
Nodes (4): ASK-1 — AgentCorp Architecture & System Capabilities, Findings and Architecture, Request and Scope, Verification Limits

### Community 178 - "Manage-AgentCorp.ps1"
Cohesion: 0.52
Nodes (5): Create-Backup(), Get-ServerProcess(), Show-Status(), Start-Server(), Stop-Server()

## Knowledge Gaps
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `el()` connect `el` to `openCreate`, `worker.ts`, `ideas.ts`, `mountOffice`, `tickets.ts`, `ui/offices.ts`, `auth.ts`, `openPreview`, `shortcuts.ts`, `settings.ts`, `el`, `Store`, `update.ts`, `memory.ts`, `voice.ts`, `preview.ts`, `cards.ts`, `runners.ts`, `voice-settings.ts`, `runners.ts`, `clear`, `render`, `ref_shared`, `repo-field.ts`, `username.ts`, `messages.ts`, `share.ts`, `trackerSection`, `feedbackSection`, `officesSection`, `standup.ts`, `avatarSetting`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `mountOffice()` (e.g. with `refreshRoom()` and `resize()`) actually correct?**
  _`mountOffice()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `protocol.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.024096385542168676 - nodes in this community are weakly interconnected._
- **Why does `$` connect `el` to `worker.ts`, `ideas.ts`, `mountOffice`, `tickets.ts`, `ui/offices.ts`, `auth.ts`, `shortcuts.ts`, `settings.ts`, `el`, `Store`, `update.ts`, `ranks.ts`, `memory.ts`, `voice.ts`, `preview.ts`, `cards.ts`, `runners.ts`, `voice-settings.ts`, `runners.ts`, `clear`, `render`, `ref_shared`, `repo-field.ts`, `messages.ts`, `share.ts`, `standup.ts`, `MemoryIndicator`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `office-contract.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05336951605608322 - nodes in this community are weakly interconnected._
- **Why does `three` connect `shading.ts` to `future.ts`, `web/package.json`, `person.ts`, `decor.ts`, `desks.ts`, `floors.ts`, `preview.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `future.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0772635814889336 - nodes in this community are weakly interconnected._