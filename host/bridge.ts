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
function logMeta(
  log: number,
  fields: Record<string, string | number | null>,
): void {
  const line = Object.entries(fields)
    .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
    .join(' ');
  write(log, `agentkit-bridge ${line}\n`, () => {});
}

export interface RuntimeBridge {
  request(request: Wire, timeout?: number): Promise<unknown>;
  observe(request: Wire, deliver: (message: BridgeMessage) => void): () => void;
}
export class Bridge implements RuntimeBridge {
  readonly process: ChildProcessWithoutNullStreams;
  private pending = new Map<string, (message: BridgeMessage) => void>();
  private ended = false;
  private terminalReason: string | undefined;
  constructor(
    binary: string,
    config: Wire,
    private readonly log: number,
  ) {
    this.process = spawn(binary, [], {
      env: cleanEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stderr.on('data', (data: Buffer) => {
      // Child diagnostics go only to the private host log, never to HTTP clients.
      write(log, data, () => {});
    });
    this.process.stdin.on('error', (error: NodeJS.ErrnoException) => {
      this.fail('stdin-error', error.code ?? 'unknown');
    });
    this.process.on('error', (error: NodeJS.ErrnoException) => {
      this.fail('spawn-error', error.code ?? 'unknown');
    });
    this.process.on('exit', (code, signal) => {
      logMeta(this.log, { event: 'child-exit', code, signal });
      this.disconnected();
    });
    let bytes = 0;
    this.process.stdout.on('data', (data: Buffer) => {
      let segmentStart = 0;
      for (let index = 0; index < data.length; index++) {
        if (data[index] !== 10) continue;
        bytes += index - segmentStart;
        if (bytes > LIMIT) {
          this.fail('stdout-frame-too-large', 'limit-exceeded');
          return;
        }
        bytes = 0;
        segmentStart = index + 1;
      }
      bytes += data.length - segmentStart;
      if (bytes > LIMIT) this.fail('stdout-frame-too-large', 'limit-exceeded');
    });
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      if (this.ended) return;
      let message: BridgeMessage;
      try {
        message = JSON.parse(line) as BridgeMessage;
      } catch {
        this.fail('stdout-invalid-json', 'parse-failed');
        return;
      }
      if (
        message === null ||
        typeof message !== 'object' ||
        Array.isArray(message)
      ) {
        this.fail('stdout-invalid-envelope', 'object-required');
        return;
      }
      if (message.id) {
        const deliver = this.pending.get(message.id);
        try {
          deliver?.(message);
        } catch {
          // Request consumers own callback errors; never report frame data as a parse failure.
          logMeta(this.log, {
            event: 'consumer-callback-error',
            category: 'callback-threw',
          });
        }
      }
    });
    this.process.stdin.write(JSON.stringify(config) + '\n');
  }
  private fail(reason: string, category: string): void {
    if (this.ended) return;
    this.terminalReason = reason;
    logMeta(this.log, { event: 'protocol-failure', reason, category });
    this.process.kill();
    this.disconnected();
  }
  private disconnected(): void {
    if (this.ended) return;
    if (!this.terminalReason) {
      this.terminalReason = 'child-disconnected';
      logMeta(this.log, { event: 'disconnected', reason: this.terminalReason });
    }
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
