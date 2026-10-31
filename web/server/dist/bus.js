import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
/**
 * One fan-out point for everything the browser needs to see.
 *
 * Every event carries a monotonically increasing `seq`, so a client that spots
 * a gap can refetch the snapshot instead of drifting out of sync.
 */
export class EventBus {
    seq = 0;
    subscribers = new Set();
    get currentSeq() {
        return this.seq;
    }
    subscribe(fn) {
        this.subscribers.add(fn);
        return () => this.subscribers.delete(fn);
    }
    /** Stamps the event with the next seq and delivers it. */
    emit(event) {
        const stamped = { ...event, seq: ++this.seq };
        for (const fn of this.subscribers) {
            try {
                fn(stamped);
            }
            catch (err) {
                console.error('[bus] subscriber threw:', err.message);
            }
        }
    }
    toast(text, kind = 'info', agentId = null) {
        this.emit({ type: 'toast', toast: { id: randomUUID(), text, kind, agentId } });
        if (process.platform === 'win32' && (kind === 'needs_you' || kind === 'done' || kind === 'error')) {
            const script = 'D:/Project/AgentCorp/scripts/send-toast.ps1';
            if (existsSync(script)) {
                try {
                    const title = kind === 'needs_you' ? 'AgentCorp: Action Required' : (kind === 'done' ? 'AgentCorp: Task Done' : 'AgentCorp');
                    const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', script, '-Title', title, '-Message', text], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true,
                    });
                    child.unref();
                }
                catch {}
            }
        }
    }
}
