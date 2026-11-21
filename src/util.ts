export class AppError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDateTime(d: Date): string {
  return `${toDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function today(): string {
  return toDate(new Date());
}

export function addDays(dateStr: string | null | undefined, days: number | string | null | undefined): string {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return toDate(d);
}

export function daysBetween(a: string, b: string): number {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  return Math.round((end - start) / 86400000);
}

export function round2(n: number | string | null | undefined): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

export function isValidDate(value: unknown): boolean {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export function isValidDateTime(value: unknown): boolean {
  return typeof value === 'string' && DATETIME_RE.test(value);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvColumn {
  key: string;
  label: string;
  [key: string]: unknown;
}

export function toCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function monthKey(date: string | null | undefined): string {
  return date ? String(date).slice(0, 7) : '';
}

export function monthLabel(key: string | null | undefined): string {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
