import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { write } from 'node:fs';
import { createInterface } from 'node:readline';
import { cleanEnvironment, LIMIT } from './private.js';

export type Wire = Record<string, unknown>;
export interface BridgeMessage {
  id?: string;
  value?: unknown;
  error?: string;
  done?: boolean;
}
export interface RuntimeBridge {
  request(request: Wire, timeout?: number): Promise<unknown>;
  observe(request: Wire, deliver: (message: BridgeMessage) => void): () => void;
}
export class Bridge implements RuntimeBridge {
  readonly process: ChildProcessWithoutNullStreams;
  private pending = new Map<string, (message: BridgeMessage) => void>();
  private ended = false;
  constructor(binary: string, config: Wire, log: number) {
    this.process = spawn(binary, [], {
      env: cleanEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stderr.on('data', (data: Buffer) => {
      // Child diagnostics go only to the private host log, never to HTTP clients.
      write(log, data, () => {});
    });
    this.process.stdin.on('error', () => this.disconnected());
    this.process.on('error', () => this.disconnected());
    this.process.on('exit', () => this.disconnected());
    let bytes = 0;
    this.process.stdout.on('data', (data: Buffer) => {
      const last = data.lastIndexOf(10);
      bytes = last >= 0 ? data.length - last - 1 : bytes + data.length;
      if (bytes > LIMIT) {
        this.process.kill();
        this.disconnected();
      }
    });
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line) as BridgeMessage;
        if (message.id) this.pending.get(message.id)?.(message);
      } catch {
        this.process.kill();
        this.disconnected();
      }
    });
    this.process.stdin.write(JSON.stringify(config) + '\n');
  }
  private disconnected(): void {
    if (this.ended) return;
    this.ended = true;
    for (const deliver of [...this.pending.values()])
      deliver({ error: 'AgentKit process disconnected', done: true });
    this.pending.clear();
  }
  private begin(
    request: Wire,
    deliver: (message: BridgeMessage) => void,
  ): string {
    if (this.ended) throw new Error('AgentKit process disconnected');
    if (this.pending.size >= 128 || this.process.stdin.writableLength > LIMIT)
      throw new Error('Too many active requests');
    const id = randomBytes(16).toString('hex');
    this.pending.set(id, deliver);
    this.process.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    return id;
  }
  request(request: Wire, timeout = 60000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.begin(request, (message) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (message.error) reject(new Error(message.error));
        else resolve(message.value);
      });
      const timer = setTimeout(() => {
        // Dropping a unary caller never cancels an admitted mutation.
        this.pending.delete(id);
        reject(new Error('AgentKit request timed out'));
      }, timeout);
    });
  }
  observe(
    request: Wire,
    deliver: (message: BridgeMessage) => void,
  ): () => void {
    const id = this.begin(request, deliver);
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      this.pending.delete(id);
      if (!this.ended && this.process.stdin.writableLength < LIMIT)
        this.process.stdin.write(
          JSON.stringify({ id, op: 'cancelObservation' }) + '\n',
        );
    };
  }
  close(): void {
    this.process.stdin.end();
  }
}
