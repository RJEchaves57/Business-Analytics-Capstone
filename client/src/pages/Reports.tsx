import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { BarChart, Badge, DonutChart, EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../lib/format';
import type { ReportCard, ReportColumn, ReportData, ReportSummaryItem, Row } from '../types';

function shortLabel(value: unknown, max = 15): string {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function summaryDisplay(item: ReportSummaryItem): string {
  if (item.type === 'money') return fmtMoney(item.value);
  if (item.type === 'percent') return `${fmtNum(item.value)}%`;
  if (item.type === 'number' || typeof item.value === 'number') return fmtNum(item.value);
  return String(item.value ?? '—');
}

function formatCell(column: ReportColumn, row: Row): ReactNode {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  if (column.type === 'money') return fmtMoney(value);
  if (column.type === 'number') return fmtNum(value);
  if (column.type === 'percent') return `${fmtNum(value)}%`;
  if (['type', 'status', 'schedule_status', 'maintenance_type', 'action', 'priority'].includes(column.key)) {
    return <Badge value={value} />;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return String(value).length > 10 ? fmtDateTime(value) : fmtDate(value);
  }
  return String(value);
}

function chartFor(key: string, report: ReportData): ReactNode {
  if (key === 'inventory-valuation') {
    return (
      <div className="report-chart">
        <DonutChart
          data={report.rows.map((row) => ({ label: row.category, value: row.stock_value }))}
          centerLabel="Stock value"
          format="money"
        />
      </div>
    );
  }
  if (key === 'low-stock') {
    const rows = report.rows.slice(0, 10);
    return (
      <div className="report-chart">
        <BarChart
          labels={rows.map((row) => row.sku)}
          series={[{ name: 'Shortage', color: '#dc3d4b', values: rows.map((row) => row.shortage) }]}
          height={230}
        />
      </div>
    );
  }
  if (key === 'production-summary') {
    const rows = [...report.rows].reverse();
    return (
      <div className="report-chart">
        <BarChart
          labels={rows.map((row) => String(row.label).replace(' 20', " '"))}
          series={[
            { name: 'Target', color: '#cbd5e1', values: rows.map((row) => row.target) },
            { name: 'Completed', color: '#f59e0b', values: rows.map((row) => row.completed) },
          ]}
          height={250}
        />
      </div>
    );
  }
  if (key === 'maintenance-cost') {
    const rows = report.rows.slice(0, 8);
    return (
      <div className="report-chart">
        <BarChart
          labels={rows.map((row) => shortLabel(row.asset_code, 10))}
          series={[
            { name: 'Labor', color: '#2f6fed', values: rows.map((row) => row.labor) },
            { name: 'Parts', color: '#f59e0b', values: rows.map((row) => row.parts) },
          ]}
          height={240}
          yFormatter={(value) => fmtNum(value)}
        />
      </div>
    );
  }
  if (key === 'purchase-spend') {
    const rows = report.rows.slice(0, 8);
    return (
      <div className="report-chart">
        <BarChart
          labels={rows.map((row) => shortLabel(row.supplier, 13))}
          series={[
            { name: 'Committed', color: '#cbd5e1', values: rows.map((row) => row.total) },
            { name: 'Received', color: '#0f9f6e', values: rows.map((row) => row.received) },
          ]}
          height={240}
        />
      </div>
    );
  }
  if (key === 'stock-ledger') {
    const received = Number(report.summary.find((item) => /received/i.test(item.label))?.value || 0);
    const issued = Number(report.summary.find((item) => /issued/i.test(item.label))?.value || 0);
    return (
      <div className="report-chart">
        <DonutChart
          data={[
            { label: 'Total received', value: received, color: '#0f9f6e' },
            { label: 'Total issued', value: issued, color: '#f59e0b' },
          ]}
          centerLabel="Net movement"
          format="number"
        />
      </div>
    );
  }
  if (key === 'maintenance-due') {
    const groups = new Map<string, number>();
    for (const row of report.rows) {
      groups.set(row.schedule_status, (groups.get(row.schedule_status) || 0) + 1);
    }
    return (
      <div className="report-chart">
        <DonutChart
          data={Array.from(groups.entries()).map(([label, value]) => ({ label, value }))}
          centerLabel="Schedules"
          format="number"
        />
      </div>
    );
  }
  return null;
}

function ReportTable({ report }: { report: ReportData }) {
  if (!report.rows.length) {
    return (
      <div className="card-body">
        <EmptyState
          title="No data for this report"
          text="Once records exist for this area, the report will populate automatically."
          icon="chart"
        />
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data report-table">
        <thead>
          <tr>
            {report.columns.map((column) => {
              const numeric = ['number', 'money', 'percent'].includes(column.type || '');
              return (
                <th key={column.key} className={numeric ? 'text-right' : ''}>
                  {column.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, rowIndex) => (
            <tr key={row.id || `${rowIndex}-${row[report.columns[0].key]}`}>
              {report.columns.map((column) => {
                const numeric = ['number', 'money', 'percent'].includes(column.type || '');
                return (
                  <td key={column.key} className={numeric ? 'num' : ''}>
                    {formatCell(column, row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportIndex({ catalogue, onRefresh }: { catalogue: ReportCard[]; onRefresh: () => void }) {
  return (
    <>
      <PageHeader
        eyebrow="Reporting"
        title="Reports"
        subtitle="Operational reports for inventory, maintenance, production, and purchasing. Every report can be printed or exported to CSV."
        actions={
          <button type="button" className="btn" onClick={onRefresh}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        }
      />
      {catalogue.length ? (
        <div className="report-grid">
          {catalogue.map((report) => (
            <Link className="report-card" key={report.key} to={`/reports/${report.key}`}>
              <div className="report-icon">
                <Icon name={report.icon || 'chart'} size={18} />
              </div>
              <h3>{report.title}</h3>
              <p>{report.description}</p>
              <span className="report-open">
                Open report <Icon name="arrowRight" size={12} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState title="No reports configured" text="The report catalogue is empty." icon="chart" />
        </div>
      )}
    </>
  );
}

function ReportDetail({ reportKey }: { reportKey: string }) {
  const { settings, user } = useAuth();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api<ReportData>(`/api/reports/${encodeURIComponent(reportKey)}`)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load the report.');
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportKey]);

  const exportCsv = () => {
    const link = document.createElement('a');
    link.href = `/api/reports/${encodeURIComponent(reportKey)}?format=csv`;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => link.remove(), 500);
    toast('Preparing CSV export…');
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Operations report" title="Loading report…" />
        <LoadingBlock rows={5} />
      </>
    );
  }

  if (error || !report) {
    return (
      <>
        <PageHeader eyebrow="Reports" title="Report unavailable" />
        <div className="card">
          <EmptyState title="Could not load report" text={error} icon="alert" />
        </div>
        <div className="mt-16">
          <Link className="btn" to="/reports">
            <Icon name="arrowLeft" size={14} /> Back to reports
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations report"
        title={report.title}
        subtitle={report.subtitle}
        actions={
          <>
            <button type="button" className="btn" onClick={() => navigate('/reports')}>
              <Icon name="arrowLeft" size={14} /> All reports
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              <Icon name="print" size={14} /> Print
            </button>
            <button type="button" className="btn btn-primary" onClick={exportCsv}>
              <Icon name="download" size={14} /> Export CSV
            </button>
          </>
        }
      />

      <div className="print-head">
        <div>
          <strong>{settings.company_name || 'Makoto Metal Technology, Inc.'}</strong>
          <span>{settings.site || ''}</span>
        </div>
        <div className="print-head-right">
          <strong>{report.title}</strong>
          <span>{report.subtitle}</span>
        </div>
      </div>

      <div className="report-summary">
        {report.summary.map((item, index) => (
          <div className="summary-card" key={`${item.label}-${index}`}>
            <div className="label">{item.label}</div>
            <div className="value">{summaryDisplay(item)}</div>
          </div>
        ))}
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <div>
            <h3>{report.title}</h3>
            <p>
              {report.subtitle} · {fmtNum(report.rows.length)} row{report.rows.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="spacer" />
          <span className="badge badge-outline no-dot">{user ? user.department || user.role : ''}</span>
        </div>
        {chartFor(reportKey, report)}
        <ReportTable report={report} />
      </div>

      <div className="print-foot">{settings.report_footer || ''}</div>
    </>
  );
}

export default function Reports() {
  const params = useParams();
  const { reports, refreshMeta } = useAuth();
  const { toast } = useUI();
  const [catalogue, setCatalogue] = useState<ReportCard[]>(reports || []);

  useEffect(() => {
    if (reports && reports.length) setCatalogue(reports);
  }, [reports]);

  const refreshCatalogue = useCallback(async () => {
    try {
      const data = await api<{ reports: ReportCard[] }>('/api/reports');
      setCatalogue(data.reports || []);
      await refreshMeta();
      toast('Report catalogue refreshed.');
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to refresh the reports.', 'error');
    }
  }, [refreshMeta, toast]);

  if (params.key) return <ReportDetail reportKey={params.key} />;

  return <ReportIndex catalogue={catalogue} onRefresh={refreshCatalogue} />;
}
