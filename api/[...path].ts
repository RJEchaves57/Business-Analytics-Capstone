/**
 * Vercel API entry point.
 *
 * Vercel calls non-Next.js functions as Web Handlers (`Request` -> `Response`).
 * The Express/SQLite backend is still used unchanged: this file adapts the Web
 * request into the Node request/response objects Express expects.
 *
 * Two modes, same frontend code:
 *  - Default: run the unchanged Express/SQLite backend inside this function
 *    (MAKOTO_ROOT=/tmp, seeded on cold start). Good for a capstone demo.
 *  - With BACKEND_URL set: forward /api/... to an external, persistent backend.
 */

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// Vercel ignores an `env` block in vercel.json, so set the writable root here
// before the database module is imported. Otherwise SQLite tries to write to
// the read-only deployment directory and the function fails at startup.
process.env.MAKOTO_ROOT ||= '/tmp';

export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

type HeaderValue = string | string[];
type HeaderInput = Record<string, HeaderValue | number | undefined | null>;

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

let localAppPromise: Promise<any> | null = null;

function localApp(): Promise<any> {
  if (!localAppPromise) {
    // Load the compiled CommonJS backend: Vercel bundles this file with the
    // function via `includeFiles`, while raw TypeScript source is not included.
    // @ts-expect-error Compiled backend has no TypeScript declaration file.
    localAppPromise = import('../server-dist/server.js').then((module: any) => {
      const app = module.app || module.default?.app || module.default?.default || module.default;
      if (typeof app !== 'function') throw new Error('Compiled Express app was not found.');
      return app;
    });
  }
  return localAppPromise;
}

function normalizeUrl(incoming: string): string {
  if (incoming.startsWith('/api')) return incoming;
  const suffix = incoming.startsWith('/') ? incoming : `/${incoming}`;
  return `/api${suffix}`;
}

function requestPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

/** Minimal Node IncomingMessage surface needed by Express and body-parser. */
function nodeRequest(request: Request, path: string, body: Buffer | undefined): any {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  if (body?.length && headers['content-length'] === undefined) {
    headers['content-length'] = String(body.length);
  }

  const req = new Readable({ read() {} }) as any;
  req.url = normalizeUrl(path);
  req.originalUrl = req.url;
  req.method = request.method.toUpperCase();
  req.headers = headers;
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  req.complete = true;
  req.aborted = false;
  req.body = undefined;

  const forwardedFor = headers['x-forwarded-for']?.split(',')[0]?.trim();
  const socket = {
    remoteAddress: forwardedFor || '127.0.0.1',
    remotePort: 0,
    localAddress: '127.0.0.1',
    localPort: 0,
    encrypted: url.protocol === 'https:',
    readable: true,
    writable: true,
    destroy() {},
    setTimeout() {},
  };
  req.socket = socket;
  req.connection = socket;
  req.client = socket;

  if (body?.length) req.push(body);
  req.push(null);
  return req;
}

/** Minimal Node ServerResponse surface needed by Express. */
class NodeResponse extends EventEmitter {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  finished = false;
  writableEnded = false;
  writable = true;
  req: any;
  locals: Record<string, unknown> = {};

  private readonly headerMap = new Map<string, string[]>();
  private readonly chunks: Buffer[] = [];

  constructor(req: any) {
    super();
    this.req = req;

    // Express replaces req/res prototypes with its own. Bind everything it
    // calls, plus our finalizer, as own properties so those calls keep using
    // this adapter instead of Node's real ServerResponse methods.
    const bound = [
      'on',
      'once',
      'off',
      'removeListener',
      'emit',
      'status',
      'setHeader',
      'getHeader',
      'getHeaderNames',
      'getHeaders',
      'hasHeader',
      'removeHeader',
      'flushHeaders',
      'writeHead',
      'write',
      'end',
      'toResponse',
    ] as const;
    for (const name of bound) {
      (this as any)[name] = (this as any)[name].bind(this);
    }
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: HeaderValue | number | undefined | null): this {
    if (value === undefined || value === null) {
      this.headerMap.delete(name.toLowerCase());
      return this;
    }
    const values = (Array.isArray(value) ? value : [value]).map(String);
    this.headerMap.set(name.toLowerCase(), values);
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    const values = this.headerMap.get(name.toLowerCase());
    if (!values) return undefined;
    return values.length === 1 ? values[0] : values;
  }

  getHeaderNames(): string[] {
    return [...this.headerMap.keys()];
  }

  getHeaders(): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [name, values] of this.headerMap) {
      out[name] = values.length === 1 ? values[0] : values;
    }
    return out;
  }

  hasHeader(name: string): boolean {
    return this.headerMap.has(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this.headerMap.delete(name.toLowerCase());
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | HeaderInput,
    maybeHeaders?: HeaderInput
  ): this {
    this.statusCode = statusCode;
    const headers = typeof statusMessageOrHeaders === 'string' ? maybeHeaders : statusMessageOrHeaders;
    if (typeof statusMessageOrHeaders === 'string') this.statusMessage = statusMessageOrHeaders;
    for (const [name, value] of Object.entries(headers || {})) {
      if (value !== undefined && value !== null) this.setHeader(name, value);
    }
    this.headersSent = true;
    return this;
  }

  write(chunk: any, encoding?: BufferEncoding | (() => void), callback?: () => void): boolean {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    this.headersSent = true;
    if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.from(chunk, encoding));
    callback?.();
    return true;
  }

  end(chunk?: any, encoding?: BufferEncoding | (() => void), callback?: () => void): this {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    if (this.writableEnded) {
      callback?.();
      return this;
    }
    if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.from(chunk, encoding));
    this.headersSent = true;
    this.writableEnded = true;
    this.finished = true;
    this.emit('finish');
    this.emit('close');
    callback?.();
    return this;
  }

  toResponse(method: string): Response {
    const headers = new Headers();
    for (const [name, values] of this.headerMap) {
      for (const value of values) headers.append(name, value);
    }
    const body = method.toUpperCase() === 'HEAD' ? null : Buffer.concat(this.chunks);
    return new Response(body as any, { status: this.statusCode, headers });
  }
}

/** Express dispatches asynchronously; wait until it has written the response. */
function runLocalApp(app: any, req: any, res: NodeResponse): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    res.once('finish', finish);
    res.once('close', finish);

    try {
      app(req, res, (error?: unknown) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function proxy(request: Request): Promise<Response> {
  const base = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
  const url = new URL(request.url);
  const target = `${base}${url.pathname}${url.search}`;
  const method = request.method.toUpperCase();

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);

  const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.arrayBuffer();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: request.signal,
    });

    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower === 'set-cookie') return;
      out.append(key, value);
    });
    const cookies = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    for (const cookie of cookies || []) out.append('set-cookie', cookie);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (error) {
    console.error('API proxy failed:', error);
    return Response.json({ error: 'Backend is unavailable. Check BACKEND_URL.' }, { status: 502 });
  }
}

async function handle(request: Request): Promise<Response> {
  const path = requestPath(request);
  if (path === '/api/health' || path === '/health') {
    return Response.json({ ok: true, node: process.version, root: process.env.MAKOTO_ROOT || null });
  }

  if (process.env.BACKEND_URL) return proxy(request);

  try {
    const app = await localApp();
    const method = request.method.toUpperCase();
    const body = ['GET', 'HEAD'].includes(method) ? undefined : Buffer.from(await request.arrayBuffer());
    const req = nodeRequest(request, path, body);
    const res = new NodeResponse(req);
    await runLocalApp(app, req, res);
    return res.toResponse(method);
  } catch (error) {
    console.error('Backend request failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Backend failed to initialize.' },
      { status: 500 }
    );
  }
}

// Vercel's Web Handler API uses a default `fetch` handler to serve every HTTP
// method, including POST/PUT/PATCH/DELETE.
export default { fetch: handle };
