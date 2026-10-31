/**
 * Type definitions for the Skills Library.
 *
 * Skills follow the Agent Skills SKILL.md standard: a folder with a SKILL.md
 * whose frontmatter has name and description. The library links them into
 * each tool's skill folder via symlinks.
 */
/** All supported tools and their skill paths. */
export const TOOL_PATHS = {
    claude: {
        id: 'claude',
        name: 'Claude Code',
        userSkills: '~/.claude/skills',
        repoSkills: '.claude/skills',
        reads: ['.claude/skills'],
        followsSymlinks: true,
        disableInvocationKey: 'disable-model-invocation',
        configPath: null,
    },
    codex: {
        id: 'codex',
        name: 'Codex',
        userSkills: '~/.agents/skills',
        repoSkills: '.agents/skills',
        reads: ['.agents/skills'],
        followsSymlinks: true,
        disableInvocationKey: null,
        configPath: '~/.codex/config.json',
    },
    cursor: {
        id: 'cursor',
        name: 'Cursor',
        userSkills: '~/.cursor/skills',
        repoSkills: '.cursor/skills',
        reads: ['.cursor/skills', '.agents/skills', '.claude/skills'],
        followsSymlinks: true,
        disableInvocationKey: null,
        configPath: null,
    },
    copilot: {
        id: 'copilot',
        name: 'Copilot',
        userSkills: '~/.copilot/skills',
        repoSkills: '.github/skills',
        reads: ['.github/skills', '.claude/skills', '.agents/skills'],
        followsSymlinks: true,
        configPath: null,
        disableInvocationKey: null,
    },
};
