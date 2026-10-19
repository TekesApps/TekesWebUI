import { t } from './i18n';
import type { Json } from './types';

export class AuthenticationError extends Error {}
export type Request = Record<string, unknown>;

/** One HTTP origin and one browser credential. Model credentials never enter the UI. */
export class AgentClient {
  constructor(private readonly token: string) {}
  private async request(request: Request, signal?: AbortSignal) {
    const response = await fetch('/api', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    if (response.status === 401)
      throw new AuthenticationError(
        t('访问令牌已过期，请从启动入口重新打开。'),
      );
    if (!response.ok)
      throw new Error(t('连接请求失败（{0}）', response.status));
    return response;
  }
  async unary<T>(request: Request): Promise<T> {
    const response = await this.request(request);
    const frame = (await response.json()) as { value: T; error?: string };
    if (frame.error) throw new Error(frame.error);
    return frame.value;
  }
  call<T = Json>(
    endpoint: string,
    method: string,
    payload: Request = {},
    rpcId: string = crypto.randomUUID(),
  ): Promise<T> {
    // Mutations are never retried by the transport.
    return this.unary<T>({ op: 'call', endpoint, method, payload, rpcId });
  }
  async follow<T>(
    request: Request,
    receive: (value: T) => void,
    signal: AbortSignal,
  ) {
    const response = await this.request({ op: 'follow', ...request }, signal);
    if (!response.body) throw new Error(t('服务没有返回数据流。'));
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let partial = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        partial += value;
        if (partial.length > 16 * 1024 * 1024)
          throw new Error(t('接收内容过大，请重新连接。'));
        let cut: number;
        while ((cut = partial.indexOf('\n')) >= 0) {
          const line = partial.slice(0, cut);
          partial = partial.slice(cut + 1);
          if (!line.trim()) continue;
          const frame = JSON.parse(line) as { error?: string; value?: T };
          if (frame.error) throw new Error(frame.error);
          if (frame.value !== undefined) receive(frame.value);
        }
      }
      if (!signal.aborted) throw new Error(t('连接已断开，正在重新连接。'));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function observe<T>(
  client: AgentClient,
  request: Request,
  receive: (value: T) => void,
  disconnected: (error: unknown) => void,
  signal: AbortSignal,
) {
  let failures = 0;
  while (!signal.aborted) {
    try {
      await client.follow<T>(
        request,
        (value) => {
          failures = 0;
          if (!signal.aborted) receive(value);
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) return;
      disconnected(error);
      if (error instanceof AuthenticationError) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(++failures * 1200, 6000));
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }
}
