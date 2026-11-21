/**
 * Vercel API entry point.
 *
 * Two modes, same frontend code:
 *  - Default: run the unchanged Express/SQLite backend inside this function
 *    (MAKOTO_ROOT=/tmp, seeded on cold start). Good for a capstone demo.
 *  - With BACKEND_URL set: forward /api/... to an external, persistent backend.
 *
 * Vercel builds only the React app; the Express backend is never removed.
 */

// Vercel ignores an `env` block in vercel.json, so set the writable root here
// before the database module is imported. Otherwise SQLite tries to write to
// the read-only deployment directory and the function fails at startup.
process.env.MAKOTO_ROOT ||= '/tmp';

interface ApiRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ApiResponse {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  end(body?: unknown): void;
  once?(event: string, listener: () => void): void;
}

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

/**
 * Express's app() dispatches middleware but returns immediately. On Vercel the
 * invocation is considered complete when the handler promise resolves, so we
 * must wait for the response to actually finish before resolving.
 */
function runLocalApp(app: any, req: ApiRequest, res: ApiResponse): Promise<void> {
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

    res.once?.('finish', finish);
    res.once?.('close', finish);

    try {
      app(req, res, (error?: unknown) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function proxy(req: ApiRequest, res: ApiResponse): Promise<void> {
  const base = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
  const target = `${base}${normalizeUrl(req.url || '/')}`;
  const method = (req.method || 'GET').toUpperCase();

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    body =
      typeof req.body === 'string'
        ? req.body
        : req.body === undefined || req.body === null
          ? ''
          : JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(target, { method, headers, body, redirect: 'manual' });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower === 'set-cookie') return;
      res.setHeader(key, value);
    });
    const cookies = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (cookies?.length) res.setHeader('set-cookie', cookies);
    const payload = Buffer.from(await upstream.arrayBuffer());
    if (payload.length) res.end(payload);
    else res.end();
  } catch (error) {
    console.error('API proxy failed:', error);
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Backend is unavailable. Check BACKEND_URL.' }));
  }
}

async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const path = req.url || '/';
  if (path === '/api/health' || path === '/health') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, node: process.version, root: process.env.MAKOTO_ROOT || null }));
    return;
  }

  if (process.env.BACKEND_URL) {
    await proxy(req, res);
    return;
  }

  try {
    const app = await localApp();
    req.url = normalizeUrl(req.url || '/');
    await runLocalApp(app, req, res);
  } catch (error) {
    console.error('Backend initialization failed:', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Backend failed to initialize.',
      })
    );
  }
}

// Vercel writes this file as .js while package.json is CommonJS. Named method
// exports are required so POST/PUT/DELETE requests reach the same handler.
module.exports = {
  GET: handler,
  HEAD: handler,
  POST: handler,
  PUT: handler,
  PATCH: handler,
  DELETE: handler,
  OPTIONS: handler,
};
