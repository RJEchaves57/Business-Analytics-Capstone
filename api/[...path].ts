/**
 * Vercel API proxy.
 *
 * The React frontend keeps calling same-origin `/api/...`. This function forwards
 * those calls to the unchanged Express/SQLite backend configured in BACKEND_URL.
 * It exists only so Vercel and the traditional Node server do not fight over the
 * build: Vercel builds the React app, Node runs the backend.
 */

interface ProxyRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ProxyResponse {
  status(code: number): ProxyResponse;
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

function backendBase(): string {
  return (process.env.BACKEND_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function apiPath(incoming: string): string {
  if (incoming.startsWith('/api')) return incoming;
  const suffix = incoming.startsWith('/') ? incoming : `/${incoming}`;
  return `/api${suffix}`;
}

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  const target = `${backendBase()}${apiPath(req.url || '/')}`;

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

    const setCookies = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (setCookies?.length) res.setHeader('set-cookie', setCookies);

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
