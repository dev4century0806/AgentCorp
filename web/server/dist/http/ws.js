import { WebSocketServer } from 'ws';
import { SESSION_COOKIE, readCookie, tokenMatches } from '../session.js';
/**
 * One WebSocket channel at /ws carrying every change to the browser.
 *
 * Authenticated the same way as the REST API: the cookie set when Fastify
 * serves the page, or the token header the Vite dev proxy attaches.
 */
export function attachWebSocket(app, deps) {
    const wss = new WebSocketServer({ noServer: true });
    app.server.on('upgrade', (req, socket, head) => {
        const origin = req.headers.origin;
        if (origin) {
            const allowed = origin === 'http://127.0.0.1:4317' || origin === 'http://localhost:4317';
            if (!allowed) {
                socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/ws')
            return;
        const given = req.headers['x-agent-corp-token'] ??
            readCookie(req.headers.cookie, SESSION_COOKIE) ??
            url.searchParams.get('token');
        if (!tokenMatches(deps.token, given)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws) => {
        const send = (payload) => {
            if (ws.readyState === ws.OPEN)
                ws.send(JSON.stringify(payload));
        };
        // First frame is always a full snapshot, so the client has a baseline seq.
        const snap = deps.snapshot();
        send({ type: 'snapshot', seq: snap.seq, snapshot: snap });
        const unsubscribe = deps.bus.subscribe(send);
        // Keeps a sleeping laptop from leaving a half-dead socket behind.
        let alive = true;
        ws.on('pong', () => {
            alive = true;
        });
        const ping = setInterval(() => {
            if (!alive) {
                ws.terminate();
                return;
            }
            alive = false;
            ws.ping();
        }, 30_000);
        ping.unref();
        const cleanup = () => {
            clearInterval(ping);
            unsubscribe();
        };
        ws.on('close', cleanup);
        ws.on('error', cleanup);
    });
    // Before the HTTP server closes, not after: an open socket keeps it from
    // closing, so in onClose this would wait on the very clients it drops.
    app.addHook('preClose', async () => {
        for (const client of wss.clients)
            client.terminate();
        wss.close();
    });
}
