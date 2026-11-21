/* eslint-disable react-refresh/only-export-components -- this module intentionally exports shared helpers alongside components */
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import Icon from './Icon';
import {
  badgeClass,
  fmtCompact,
  fmtCompactMoney,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNum,
  formatValue,
} from '../lib/format';
import type { FieldDef, Row } from '../types';

export function Badge({ value, className = '' }: { value: unknown; className?: string }) {
  if (value === null || value === undefined || value === '') {
    return <span className="muted">—</span>;
  }
  return <span className={`badge badge-${badgeClass(value)} ${className}`}>{String(value)}</span>;
}

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        {eyebrow ? <div className="page-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({ items, base }: { items: TabItem[]; base: string }) {
  return (
    <div className="tabs">
      {items.map((item) => (
        <NavLink
          key={item.key}
          to={`/${base}/${item.key}`}
          className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
        >
          {item.label}
          {item.count !== undefined ? <span className="count">{item.count}</span> : null}
        </NavLink>
      ))}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="summary-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="report-meta">{sub}</div> : null}
    </div>
  );
}

export function ProgressBar({ percent, tone }: { percent: unknown; tone?: string }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const cls = tone || (p >= 100 ? 'green' : p < 40 ? 'red' : '');
  return (
    <div className="progress">
      <div className={`progress-bar ${cls}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export function EmptyState({ title, text = '', icon = 'box' }: { title: ReactNode; text?: ReactNode; icon?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={20} />
      </div>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="page-loading">
      <div className="skeleton" style={{ height: 74 }} />
      <div className="skeleton" style={{ height: 44 }} />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: 38 }} />
      ))}
    </div>
  );
}

export function DetailGrid({ fields, row }: { fields: FieldDef[]; row: Row }) {
  return (
    <div className="detail-grid">
      {fields
        .filter((field) => field.type !== 'password')
        .map((field) => {
          const value = row[field.name];
          let display: ReactNode;
          if (field.type === 'bool') {
            display = <Badge value={Number(value) ? 'Active' : 'Inactive'} />;
          } else if (field.badge) {
            display = <Badge value={value} />;
          } else {
            display = formatValue(field, value);
          }
          return (
            <div key={field.name} className={`detail-item ${field.full ? 'full' : ''}`}>
              <div className="detail-label">{field.label}</div>
              <div className={`detail-value ${field.type === 'money' ? 'strong' : ''}`}>{display}</div>
            </div>
          );
        })}
    </div>
  );
}

export function detailItem(
  label: ReactNode,
  value: ReactNode,
  { full = false, strong = false }: { full?: boolean; strong?: boolean } = {}
) {
  return (
    <div className={`detail-item ${full ? 'full' : ''}`}>
      <div className="detail-label">{label}</div>
      <div className={`detail-value ${strong ? 'strong' : ''}`}>{value || <span className="muted">—</span>}</div>
    </div>
  );
}

export function CellValue({ field, row }: { field: FieldDef; row: Row }) {
  const value = row[field.name];
  if (field.badge) return <Badge value={value} />;
  if (field.type === 'bool') return <Badge value={Number(value) ? 'Active' : 'Inactive'} />;
  if (field.type === 'money') return <span className="amount">{fmtMoney(value)}</span>;
  if (field.type === 'number') return <>{fmtNum(value)}</>;
  if (field.type === 'percent') {
    const p = Math.max(0, Math.min(100, Number(value) || 0));
    return (
      <div className="progress-row" style={{ justifyContent: 'flex-end', minWidth: 88 }}>
        <div className="progress" style={{ maxWidth: 52 }}>
          <div className={`progress-bar ${p >= 100 ? 'green' : p < 50 ? 'red' : ''}`} style={{ width: `${p}%` }} />
        </div>
        <span>{fmtNum(value)}%</span>
      </div>
    );
  }
  if (field.type === 'date') return <>{fmtDate(value)}</>;
  if (field.type === 'datetime') return <>{fmtDateTime(value)}</>;
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  return <>{String(value)}</>;
}

const CHART_COLORS = ['#f59e0b', '#2f6fed', '#0f9f6e', '#7c5cd6', '#e4692b', '#64748b', '#0ea5e9', '#be123c'];

function niceScale(max: number): number {
  if (max <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export interface BarSeries {
  name: string;
  values: Array<number | string>;
  color?: string;
}

export function BarChart({
  labels,
  series,
  height = 240,
  yFormatter = fmtCompact,
}: {
  labels: string[];
  series: BarSeries[];
  height?: number;
  yFormatter?: (value: number) => string;
}) {
  const width = 760;
  const pad = { top: 18, right: 12, bottom: 34, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const allValues = series.flatMap((serie) => serie.values.map((value) => Number(value) || 0));
  const niceMax = niceScale(Math.max(...allValues, 1));
  const groupW = plotW / Math.max(labels.length, 1);
  const barW = Math.max(6, Math.min(18, (groupW - 16) / Math.max(series.length, 1)));
  const gap = 3;

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bar chart">
        {Array.from({ length: 5 }).map((_, index) => {
          const y = pad.top + (plotH * index) / 4;
          const value = niceMax - (niceMax * index) / 4;
          return (
            <g key={index}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#eef2f7" strokeWidth="1" />
              <text x={pad.left - 9} y={y + 3.5} textAnchor="end" fontSize="9" fill="#8a98ab">
                {yFormatter(value)}
              </text>
            </g>
          );
        })}
        {labels.map((label, index) => {
          const center = pad.left + groupW * index + groupW / 2;
          const totalW = series.length * barW + (series.length - 1) * gap;
          const startX = center - totalW / 2;
          return (
            <g key={`${label}-${index}`}>
              {series.map((serie, seriesIndex) => {
                const value = Number(serie.values[index]) || 0;
                const barH = (value / niceMax) * plotH;
                const x = startX + seriesIndex * (barW + gap);
                const y = pad.top + plotH - barH;
                return (
                  <rect
                    key={serie.name}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(barH, value > 0 ? 1.5 : 0)}
                    rx="2.5"
                    fill={serie.color || CHART_COLORS[seriesIndex]}
                    opacity="0.92"
                  >
                    <title>{`${label} · ${serie.name}: ${yFormatter(value)}`}</title>
                  </rect>
                );
              })}
              <text x={center} y={height - 12} textAnchor="middle" fontSize="9.5" fill="#8a98ab">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((serie, index) => (
          <span className="legend-item" key={serie.name}>
            <span className="legend-dot" style={{ background: serie.color || CHART_COLORS[index] }} />
            {serie.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface DonutDatum {
  label: string;
  value: number | string;
  color?: string;
}

export function DonutChart({
  data,
  centerLabel = 'Total',
  total: explicitTotal,
  format = 'number',
}: {
  data: DonutDatum[];
  centerLabel?: string;
  total?: number;
  format?: 'number' | 'money' | string;
}) {
  const rows = data.filter((item) => Number(item.value) > 0);
  const total = explicitTotal !== undefined
    ? Number(explicitTotal)
    : rows.reduce((sum, item) => sum + Number(item.value), 0);
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const values = rows.map((row) => Number(row.value) || 0);
  const lengths = values.map((value) => (total > 0 ? value / total : 0) * circumference);
  const offsets = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, length) => sum + length, 0)
  );

  return (
    <div className="donut-layout">
      <svg className="donut-svg" viewBox="0 0 160 160" role="img" aria-label="Donut chart">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#eef2f7" strokeWidth="20" />
        {rows.map((row, index) => {
          const value = values[index];
          const length = lengths[index];
          const color = row.color || CHART_COLORS[index % CHART_COLORS.length];
          const dash = `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`;
          const dashOffset = (-offsets[index]).toFixed(2);
          return (
            <circle
              key={row.label}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="20"
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 80 80)"
            >
              <title>{`${row.label}: ${format === 'money' ? fmtMoney(value) : fmtNum(value)}`}</title>
            </circle>
          );
        })}
        <text x="80" y="76" textAnchor="middle" className="donut-center-label">
          {centerLabel}
        </text>
        <text x="80" y="95" textAnchor="middle" className="donut-center-value">
          {format === 'money' ? fmtCompactMoney(total) : fmtCompact(total)}
        </text>
      </svg>
      <div className="donut-legend">
        {rows.length ? (
          rows.map((row, index) => (
            <div className="donut-legend-row" key={row.label}>
              <span className="legend-dot" style={{ background: row.color || CHART_COLORS[index % CHART_COLORS.length] }} />
              <span className="name">{row.label}</span>
              <span className="val">{format === 'money' ? fmtMoney(row.value) : fmtNum(row.value)}</span>
            </div>
          ))
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            No data
          </span>
        )}
      </div>
    </div>
  );
}
