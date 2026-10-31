# Skill Library Management Policy (`.agents/skills/`)

> **Precedence**: Inherits from root `D:\Project\AgentCorp\AGENTS.md`.

## Mandatory Directives for Skills

1. **Frontmatter Quality Standards**:
   Every skill created or modified in `.agents/skills/` must have a valid YAML frontmatter block containing:
   - `name`: Lowercase hyphenated string matching the directory name.
   - `description`: Explicit explanation of WHAT capabilities the skill provides and WHEN to load it (trigger keywords).
   - `license`: Open-source license identifier (e.g. `MIT`, `Apache-2.0`).

2. **Progressive Disclosure**:
   Keep `SKILL.md` focused on core principles, actionable rules, and compact checklists. Extensive references, type definitions, or large examples must be stored in a `references/` subdirectory and referenced via relative markdown links.

3. **Dual Directory Synchronization**:
   Workspace skills must be mirrored across both discovery locations:
   - `D:\Project\AgentCorp\lib\skill\<skill-name>\`
   - `D:\Project\AgentCorp\.agents\skills\<skill-name>\`
