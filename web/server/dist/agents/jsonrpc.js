/** An error the other side sent back, as opposed to one that happened on this side. */
export class RpcError extends Error {
    code;
    data;
    constructor(message, code, 
    /** Additional error data from the JSON-RPC response, if any. */
    data) {
        super(message);
        this.code = code;
        this.data = data;
    }
}
/**
 * Line-delimited JSON-RPC 2.0 peer over a child process's stdio, which is
 * what `agent acp` speaks.
 *
 * Deliberately tolerant: an unrecognised message is handed to the handlers
 * rather than rejected, so a protocol revision in the CLI degrades to missing
 * features instead of a dead session.
 */
export class JsonRpcPeer {
    stdin;
    handlers;
    nextId = 1;
    pending = new Map();
    buffer = '';
    closed = false;
    constructor(stdin, stdout, handlers = {}) {
        this.stdin = stdin;
        this.handlers = handlers;
        stdout.setEncoding('utf8');
        stdout.on('data', (chunk) => this.consume(chunk));
        stdout.on('close', () => this.failAll(new Error('The agent process closed its output stream.')));
    }
    consume(chunk) {
        this.buffer += chunk;
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            if (line)
                this.handleLine(line);
            newline = this.buffer.indexOf('\n');
        }
    }
    handleLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            this.handlers.onParseError?.(line);
            return;
        }
        const id = msg['id'];
        const method = msg['method'];
        // A response carries an id and no method.
        if (id !== undefined && method === undefined) {
            const pending = this.pending.get(id);
            if (!pending)
                return;
            this.pending.delete(id);
            const error = msg['error'];
            if (error)
                pending.reject(new RpcError(error.message ?? `JSON-RPC error ${error.code ?? ''}`.trim(), error.code, error.data));
            else
                pending.resolve(msg['result']);
            return;
        }
        if (method === undefined)
            return;
        // A request carries both; a notification has no id.
        if (id !== undefined) {
            void this.respond(id, method, msg['params']);
        }
        else {
            this.handlers.onNotification?.(method, msg['params']);
        }
    }
    async respond(id, method, params) {
        if (!this.handlers.onRequest) {
            this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `No handler for ${method}` } });
            return;
        }
        try {
            const result = await this.handlers.onRequest(method, params, id);
            this.write({ jsonrpc: '2.0', id, result: result ?? null });
        }
        catch (err) {
            this.write({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
        }
    }
    request(method, params, timeoutMs = 10 * 60_000) {
        if (this.closed)
            return Promise.reject(new Error('The agent session is closed.'));
        const id = this.nextId++;
        const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs);
            timer.unref();
            this.pending.set(id, {
                resolve: (v) => {
                    clearTimeout(timer);
                    resolve(v);
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            });
        });
        this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
        return promise;
    }
    /**
     * Whether the other side is still reading what it is sent. Any reply counts,
     * an error included, which is why this asks for a method nothing implements.
     */
    async answers(timeoutMs) {
        try {
            await this.request('office/ping', undefined, timeoutMs);
            return true;
        }
        catch (err) {
            return err instanceof RpcError;
        }
    }
    notify(method, params) {
        this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
    }
    write(msg) {
        if (this.closed)
            return;
        try {
            this.stdin.write(`${JSON.stringify(msg)}\n`);
        }
        catch (err) {
            this.failAll(err);
        }
    }
    close() {
        this.closed = true;
        this.failAll(new Error('The agent session was closed.'));
    }
    failAll(err) {
        for (const [, p] of this.pending)
            p.reject(err);
        this.pending.clear();
    }
}
