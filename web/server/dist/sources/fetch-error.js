/**
 * Turns a failed check into a sentence Operator can act on.
 *
 * Node's fetch throws a bare "fetch failed" and keeps what went wrong in
 * `cause`, sometimes a level or two down, so the error's own message says
 * nothing about a certificate a proxy re-signed or a host that never answered.
 */
const CERT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;
const UNREACHABLE = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
]);
/** The error and everything under it: its causes, and the attempts an AggregateError collects. */
function chain(err) {
    const out = [];
    const queue = [err];
    while (queue.length && out.length < 10) {
        const e = queue.shift();
        if (!e || typeof e !== 'object' || out.includes(e))
            continue;
        out.push(e);
        queue.push(e.cause);
        if (Array.isArray(e.errors))
            queue.push(...e.errors);
    }
    return out;
}
/** The innermost code, the one that says what actually happened. */
export function errorCode(err) {
    const codes = chain(err)
        .map((e) => e.code)
        .filter((c) => typeof c === 'string' && c.length > 0);
    return codes.at(-1) ?? null;
}
/** `host` names the server the check talks to, for errors that do not carry it. */
export function describeSourceError(err, host) {
    const all = chain(err);
    if (!all.length)
        return String(err || 'Unknown error');
    const code = errorCode(err);
    const where = host || hostIn(all) || 'the server';
    if (code && CERT.test(code)) {
        return `Couldn't verify ${where}'s certificate (${code}). A network proxy (e.g. Zscaler) may be intercepting HTTPS.`;
    }
    if ((code && UNREACHABLE.has(code)) || all.some((e) => e.name === 'TimeoutError')) {
        return `Can't reach ${where}${code ? ` (${code})` : ''}. Check your connection or VPN.`;
    }
    const top = all[0];
    // "fetch failed" on its own says nothing; the cause underneath does.
    const message = /^fetch failed$/i.test(top.message ?? '') && all[1]?.message
        ? `Request to ${where} failed: ${all[1].message}`
        : top.message || 'Unknown error';
    return code && !message.includes(code) ? `${message} (${code})` : message;
}
function hostIn(all) {
    for (const e of all) {
        if (typeof e.hostname === 'string' && e.hostname)
            return e.hostname;
        if (typeof e.address === 'string' && e.address)
            return typeof e.port === 'number' ? `${e.address}:${e.port}` : e.address;
    }
    return null;
}
/** The host of a configured URL, or null when it does not parse. */
export function hostOf(url) {
    try {
        return url ? new URL(url).host : null;
    }
    catch {
        return null;
    }
}
