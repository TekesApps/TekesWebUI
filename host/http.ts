import { createServer, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { realpath, readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { RuntimeBridge, Wire } from './bridge.js';
import { DirectoryAuthority } from './directory.js';
import { LIMIT } from './private.js';

export interface HttpOptions {
  assets: string;
  workspace: string;
  kernelVersion: string;
  hostVersion: string;
  browserToken: string;
  appToken: string;
  dshURL: string;
  directories: DirectoryAuthority;
  bridge: RuntimeBridge;
  attachDSH: (cookie: string) => Promise<unknown>;
}
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function headers(
  res: ServerResponse,
  status: number,
  type = 'application/json',
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
}
export function createHostServer(options: HttpOptions): Server {
  const { bridge, directories } = options;
  const reply = (res: ServerResponse, status: number, value: unknown) => {
    headers(res, status);
    res.end(JSON.stringify(value));
  };
  return createServer(async (req, res) => {
    const port = res.socket?.localPort ?? 0;
    const expected = `127.0.0.1:${port}`;
    if (
      req.headers.host !== expected ||
      (req.headers.origin && req.headers.origin !== `http://${expected}`)
    ) {
      reply(res, 403, { error: 'Invalid host or origin' });
      return;
    }
    try {
      if (req.method === 'GET') {
        const pathname = decodeURIComponent(
          new URL(req.url ?? '/', `http://${expected}`).pathname,
        );
        const candidate = await realpath(
          resolve(
            options.assets,
            pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''),
          ),
        ).catch(() => '');
        const kinds: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
        };
        if (
          !candidate.startsWith(options.assets + sep) ||
          !kinds[extname(candidate)] ||
          !(await stat(candidate)).isFile()
        ) {
          reply(res, 404, { error: 'Not found' });
          return;
        }
        const content = await readFile(candidate);
        headers(res, 200, kinds[extname(candidate)]);
        res.end(content);
        return;
      }
      if (req.method !== 'POST') {
        reply(res, 405, { error: 'Method not allowed' });
        return;
      }
      const authorization = req.headers.authorization ?? '';
      const app = equal(authorization, `Bearer ${options.appToken}`);
      if (!app && !equal(authorization, `Bearer ${options.browserToken}`)) {
        reply(res, 401, { error: 'Authentication required' });
        return;
      }
      if (req.url !== '/api') {
        reply(res, 404, { error: 'Not found' });
        return;
      }
      const size = Number(req.headers['content-length']);
      if (!Number.isInteger(size) || size <= 0 || size > LIMIT) {
        reply(res, 413, { error: 'Request size limit' });
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of req) {
        received += Buffer.byteLength(chunk);
        if (received > LIMIT) {
          reply(res, 413, { error: 'Request size limit' });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const request: Wire = JSON.parse(Buffer.concat(chunks).toString());
      if (!request || typeof request !== 'object' || Array.isArray(request))
        throw new Error('Invalid request');
      switch (request.op) {
        case 'host.info':
          reply(res, 200, {
            value: {
              workspace: options.workspace,
              kernelVersion: options.kernelVersion,
              hostVersion: options.hostVersion,
              directoryPicker: { endpoints: [...directories.endpoints].sort() },
            },
          });
          return;
        case 'host.pickDirectory':
          reply(res, 200, {
            value: {
              path: await directories.pick(
                request.endpoint,
                request.path,
                request.language,
              ),
            },
          });
          return;
        case 'host.attachDSH':
          if (!app) {
            reply(res, 403, { error: 'Native host authentication required' });
            return;
          }
          if (typeof request.cookie !== 'string' || !request.cookie)
            throw new Error('Expected DSH cookie');
          reply(res, 200, { value: await options.attachDSH(request.cookie) });
          return;
      }
      if (
        ![
          'endpoints',
          'describe',
          'snapshot',
          'call',
          'follow',
          'history',
          'respond',
          'earlier',
        ].includes(String(request.op))
      ) {
        reply(res, 400, { error: 'Unknown operation' });
        return;
      }
      if (
        request.op === 'call' &&
        request.method === 'session.create' &&
        request.endpoint === 'tekes-loopback-default'
      ) {
        const payload = (request.payload ?? {}) as Wire;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          throw new Error('Invalid session payload');
        payload.execution = await directories.execution(
          request.endpoint,
          payload.cwd ?? options.workspace,
          {
            cwd: options.workspace,
            read_roots: [options.workspace],
            writable_roots: [options.workspace],
            toolchain_roots: ['/bin', '/usr/bin'],
            network: false,
            allowed_tools: ['read', 'write', 'edit', 'shell'],
          },
        );
        delete payload.cwd;
        payload.identityProfile ??= 'general';
        request.payload = payload;
      }
      if (request.op !== 'follow') {
        reply(res, 200, { value: await bridge.request(request) });
        return;
      }
      headers(res, 200, 'application/x-ndjson');
      res.flushHeaders();
      let cancel: (() => void) | undefined;
      const heartbeat = setInterval(() => res.write('\n'), 5000);
      const close = () => {
        clearInterval(heartbeat);
        cancel?.();
      };
      res.once('close', close);
      cancel = bridge.observe(request, (message) => {
        if (res.destroyed) {
          close();
          return;
        }
        if (message.done && !message.error) {
          res.end();
          return;
        }
        if (res.writableLength > 1024 * 1024) {
          res.destroy();
          return;
        }
        const { id: _id, ...wire } = message;
        res.write(JSON.stringify(wire) + '\n');
        if (message.error) res.end();
      });
      if (res.destroyed) close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Host request failed';
      if (!res.headersSent) reply(res, 200, { error: message });
      else if (!res.destroyed)
        res.end(JSON.stringify({ error: message }) + '\n');
    }
  });
}
