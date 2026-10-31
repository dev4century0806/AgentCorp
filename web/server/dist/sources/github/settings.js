import { expandPath, saveConfigFields } from '../../config.js';
import { describeRepo } from '../../git/repos.js';
import { isRepoName } from './keys.js';
export class GitHubSettingsService {
    cfg;
    source;
    poller;
    auth;
    constructor(cfg, source, poller, auth) {
        this.cfg = cfg;
        this.source = source;
        this.poller = poller;
        this.auth = auth;
    }
    enabled() {
        return this.cfg.github.enabled;
    }
    async view() {
        const connected = this.auth.hasToken();
        const login = connected && this.cfg.github.enabled ? await this.source.login().catch(() => null) : null;
        return {
            id: 'github',
            enabled: this.cfg.github.enabled,
            connected,
            signInWith: 'GitHub',
            connectedNote: 'Missing an organization’s issues? An owner of that organization may need to approve AgentCorp in GitHub.',
            statusesAreLabels: true,
            projectNoun: 'repo',
            site: login ? `https://${this.cfg.github.host}/${login}` : null,
            projects: this.cfg.github.repos.map((r) => ({ key: r.key, repo: r.repo ? expandPath(r.repo.path) : null })),
            queryLanguage: null,
            query: null,
            defaultQuery: null,
            inProgressStatuses: this.cfg.github.inProgressStatuses,
            reviewStatuses: this.cfg.github.reviewStatuses,
        };
    }
    async update(patch) {
        const changed = {};
        if (patch.projects) {
            changed.repos = await Promise.all(patch.projects.map(async (p) => {
                const key = p.key.trim();
                if (!isRepoName(key))
                    throw new Error(`"${p.key}" is not a GitHub repo. Give it as owner/repo.`);
                const existing = this.cfg.github.repos.find((e) => e.key.toLowerCase() === key.toLowerCase());
                if (!p.repo)
                    return { key, repo: null };
                const repo = await describeRepo(p.repo);
                return { key, repo: { path: repo.path, baseBranch: existing?.repo?.baseBranch ?? repo.baseBranch } };
            }));
        }
        if (patch.inProgressStatuses)
            changed.inProgressStatuses = cleanList(patch.inProgressStatuses, 'in-progress');
        if (patch.reviewStatuses)
            changed.reviewStatuses = cleanList(patch.reviewStatuses, 'review');
        if (patch.enabled !== undefined) {
            if (patch.enabled && !this.auth.hasToken())
                throw new Error('Connect GitHub Issues first.');
            changed.enabled = patch.enabled;
        }
        saveConfigFields('github', changed);
        this.cfg.github = { ...this.cfg.github, ...changed };
        await this.apply();
        return this.view();
    }
    /** GitHub's consent page, opened by the Settings card. The office user's session pays for the code exchange. */
    async connect(opts = {}) {
        return { url: await this.auth.start(opts.session) };
    }
    async finishConnect(code, state) {
        await this.auth.finish(code, state);
        this.cfg.github.enabled = true;
        saveConfigFields('github', { enabled: true });
        await this.apply();
    }
    async disconnect() {
        this.auth.forget();
        this.cfg.github.enabled = false;
        saveConfigFields('github', { enabled: false });
        await this.apply();
    }
    async apply() {
        await this.source.reset();
        await this.poller.setEnabled(this.cfg.github.enabled && this.auth.hasToken());
    }
}
function cleanList(values, what) {
    const list = values.map((v) => v.trim()).filter(Boolean);
    if (!list.length)
        throw new Error(`Give at least one ${what} label.`);
    return list;
}
