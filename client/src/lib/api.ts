export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  silent?: boolean;
}

export async function api<T = any>(path: string, { method = 'GET', body, silent = false }: ApiOptions = {}): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {},
  };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const isSessionProbe = path === '/api/meta';
    if (response.status === 401 && !silent && !isSessionProbe && !path.includes('/auth/')) {
      window.dispatchEvent(new Event('makoto:session-expired'));
    }
    throw new ApiError(response.status, (data && data.error) || `Request failed (${response.status}).`);
  }
  return data as T;
}

export function downloadCsv(path: string, filename: string): void {
  const link = document.createElement('a');
  link.href = path;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
