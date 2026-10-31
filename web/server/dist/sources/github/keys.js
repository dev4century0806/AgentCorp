/** owner/repo and the number from an issue key like owner/repo#12, or null for anything else. */
export function parseIssueKey(key) {
    const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(key.trim());
    return m ? { repo: m[1], number: Number(m[2]) } : null;
}
/** Whether text names a repo as owner/repo. */
export function isRepoName(text) {
    return /^[\w.-]+\/[\w.-]+$/.test(text);
}
/**
 * owner/repo from a git remote on the host, in any of the forms git takes:
 * https, ssh, and ssh host aliases like git@github.com-work:owner/repo.git.
 */
export function githubRepoOf(remote, host = 'github.com') {
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}[^/:\\s]*[:/]+([\\w.-]+)/([\\w.-]+?)(?:\\.git)?/?$`, 'i').exec(remote.trim());
    return m ? `${m[1]}/${m[2]}` : null;
}
