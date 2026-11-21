import { api } from './api';
import type { ListResponse, Row } from '../types';

const cache = new Map<string, Row[]>();
const pending = new Map<string, Promise<Row[]>>();

export async function fetchRefs(key: string, { refresh = false }: { refresh?: boolean } = {}): Promise<Row[]> {
  if (!refresh && cache.has(key)) return cache.get(key)!;
  if (!refresh && pending.has(key)) return pending.get(key)!;
  const request = api<ListResponse>(`/api/${key}?limit=500`)
    .then((data) => {
      cache.set(key, data.rows);
      pending.delete(key);
      return data.rows;
    })
    .catch((error) => {
      pending.delete(key);
      throw error;
    });
  pending.set(key, request);
  return request;
}

export function clearRefCache(key?: string): void {
  if (key) {
    cache.delete(key);
    pending.delete(key);
  } else {
    cache.clear();
    pending.clear();
  }
}
