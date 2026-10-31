import { finishConnect, oauthProvider, startConnect } from '../oauth-connect.js';
export function factoryRedirectUri(cfg) {
    return `http://127.0.0.1:${cfg.port}/auth/8090/callback`;
}
function factoryTarget(cfg) {
    return { mcpUrl: cfg.factory.mcpUrl, redirectUri: factoryRedirectUri(cfg), headers: cfg.factory.headers, service: '8090' };
}
export function factoryAuth(cfg) {
    return oauthProvider(factoryTarget(cfg));
}
export function startFactoryConnect(cfg) {
    return startConnect(factoryTarget(cfg));
}
export function finishFactoryConnect(cfg, code, state) {
    return finishConnect(factoryTarget(cfg), code, state);
}
export function disconnectFactory(cfg) {
    factoryAuth(cfg).invalidateCredentials('all');
}
