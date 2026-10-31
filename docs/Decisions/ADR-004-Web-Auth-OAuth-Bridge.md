# ADR-004: Web Auth [Connect] Button Bridge over Raw API Keys

## 1. Context
- Many users utilize subscription-based tiers (ChatGPT Plus/Team, Claude Pro/Team, GitHub Copilot) rather than paying pay-as-you-go credit card API bills.
- In early iterations of the runner system:
  - Only Claude Code offered an automated browser sign-in flow (`/api/agent-cli/sign-in`).
  - Other runners (Codex, Copilot) required manual terminal command execution (`codex login` or `copilot login`).
- Forcing users out of the web UI introduces friction and complicates onboarding.

## 2. Decision
- **Standardize One-Click Web OAuth across all Runners:**
  - Avoid raw `sk-...` API key input forms and credential storage in plaintext config.
  - Implement `/api/agent-cli/sign-in/:runner` in `web/server/dist/agents/sign-in.js`:
    - For Codex: Spawns the CLI authentication subprocess, captures the OAuth URL (`https://auth0.openai.com/...`) from stdout, and returns it to the frontend to launch an authentication tab.
    - For Copilot: Extracts device authentication codes and directs the user to `https://github.com/login/device`.
  - Frontend Control (Runner UI module):
    - When a runner is in `Not signed in` state, renders an interactive **[Connect]** button alongside manual instructions.
    - Clicking the button opens the provider OAuth flow; upon authorization, runner status transitions to `Ready`.

## 3. Consequences
- **Positive:**
  - One-click modern sign-in UX (zero terminal friction).
  - High security: Sessions and tokens are managed directly by vendor OAuth protocols and stored in provider caches rather than plaintext configuration files.
- **Trade-offs:**
  - Web OAuth sessions expire based on vendor policy (e.g. 14–30 days), requiring periodic re-authentication via the [Connect] button.
