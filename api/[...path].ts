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

interface ApiRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string | string[]): void;
  end(body?: unknown): void;
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
    localAppPromise = import('../server').then((module) => module.default);
  }
  return localAppPromise;
}

function normalizeUrl(incoming: string): string {
  if (incoming.startsWith('/api')) return incoming;
  const suffix = incoming.startsWith('/') ? incoming : `/${incoming}`;
  return `/api${suffix}`;
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
    res.status(upstream.status);
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
    res.status(502);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Backend is unavailable. Check BACKEND_URL.' }));
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (process.env.BACKEND_URL) {
    await proxy(req, res);
    return;
  }

  const app = await localApp();
  req.url = normalizeUrl(req.url || '/');
  await app(req, res);
}
