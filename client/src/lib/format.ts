import type { FieldDef, Row } from '../types';

const SYMBOLS: Record<string, string> = { PHP: '₱', USD: '$', EUR: '€', JPY: '¥', GBP: '£' };

let currency = 'PHP';

export function setCurrency(value?: string | null): void {
  currency = value || 'PHP';
}

export function currencySymbol(): string {
  return SYMBOLS[currency] || '₱';
}

export function fmtNum(value: unknown, decimals?: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals === undefined ? 2 : decimals,
  });
}

export function fmtMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${currencySymbol()}${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCompactMoney(value: unknown): string {
  const n = Number(value) || 0;
  const sym = currencySymbol();
  if (Math.abs(n) >= 1000000) return `${sym}${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}K`;
  return `${sym}${n.toFixed(0)}`;
}

export function fmtCompact(value: unknown): string {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtDate(value: unknown): string {
  if (!value) return '—';
  const datePart = String(value).slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return String(value);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fmtDateTime(value: unknown): string {
  if (!value) return '—';
  const s = String(value);
  const datePart = s.slice(0, 10);
  const timePart = s.slice(11, 19);
  const date = fmtDate(datePart);
  if (!timePart) return date;
  const [h, min] = timePart.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${date} · ${hour}:${String(min).padStart(2, '0')} ${suffix}`;
}

export function relativeTime(value: unknown): string {
  if (!value) return '';
  const then = new Date(String(value).replace(' ', 'T')).getTime();
  if (!Number.isFinite(then)) return fmtDateTime(value);
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtDate(value);
}

export function initials(name: unknown): string {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function titleCase(value: unknown): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const BADGE_MAP: Record<string, string> = {
  'in stock': 'green', active: 'green', running: 'green', completed: 'green', received: 'green',
  'signed in': 'green', created: 'green',
  'low stock': 'amber', 'due soon': 'amber', 'on hold': 'amber', ordered: 'blue',
  'in progress': 'blue', planned: 'slate', idle: 'slate', draft: 'slate', scheduled: 'blue',
  'partially received': 'amber', medium: 'amber', high: 'orange', low: 'slate', normal: 'blue',
  'out of stock': 'red', overdue: 'red', breakdown: 'red', cancelled: 'red',
  critical: 'red', emergency: 'red', deleted: 'red', error: 'red',
  'under maintenance': 'orange', 'not scheduled': 'slate',
  preventive: 'blue', corrective: 'orange', calibration: 'purple', inspection: 'purple',
  predictable: 'purple', updated: 'blue', received_stock: 'green',
  admin: 'purple', manager: 'blue', maintenance: 'orange', user: 'slate', staff: 'slate', viewer: 'slate',
  in: 'green', out: 'orange',
};

export function badgeClass(value: unknown): string {
  return BADGE_MAP[String(value || '').toLowerCase()] || 'slate';
}

export function formatValue(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field.type) {
    case 'money':
      return fmtMoney(value);
    case 'number':
      return fmtNum(value);
    case 'percent':
      return `${fmtNum(value)}%`;
    case 'date':
      return fmtDate(value);
    case 'datetime':
      return fmtDateTime(value);
    case 'bool':
      return Number(value) ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

export function rowLabel(row: Row | null | undefined): string {
  if (!row) return '';
  return row.name || row.title || row.wo_number || row.po_number || row.order_no
    || row.product_name || row.full_name || row.username || row.sku
    || row.machine_name || row.item_name || `#${row.id}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
