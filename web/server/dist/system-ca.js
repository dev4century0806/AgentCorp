import tls from 'node:tls';
/**
 * Trusts the operating system's certificates as well as Node's own.
 *
 * Node only trusts the CAs it ships with, so behind a proxy that re-signs
 * HTTPS with a root installed in the macOS keychain (Zscaler and the like),
 * every call out of the office fails with a bare "fetch failed" while the same
 * request from curl or a browser works. Runs before anything connects, since
 * the list is read when a connection is made.
 */
export function trustSystemCertificates() {
    // Node 22.15 and later; an older runtime keeps its own list.
    if (typeof tls.setDefaultCACertificates !== 'function')
        return;
    try {
        const system = tls.getCACertificates('system');
        if (!system.length)
            return;
        tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...system])]);
    }
    catch (err) {
        console.warn(`Could not add the system certificates: ${err.message}`);
    }
}
