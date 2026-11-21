import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import ResourcePage, { type ResourcePageHandle } from '../components/ResourcePage';
import { Badge, EmptyState, PageHeader, ProgressBar } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, fmtNum, todayIso } from '../lib/format';
import { clearRefCache } from '../lib/refs';
import type { ListResponse, Row } from '../types';

const STATUSES = ['Planned', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];

function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="summary-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="report-meta">{sub}</div> : null}
    </div>
  );
}

function detailItem(
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

function monthKey(value: unknown): string {
  return String(value || '').slice(0, 7);
}

function datePart(value: unknown): string {
  return String(value || '').slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface ProductionStats {
  active: number;
  completed: number;
  target: number;
  scrap: number;
  scrapRate: number;
  dueSoon: number;
}

function computeStats(rows: Row[]): ProductionStats {
  const month = monthKey(todayIso());
  const current = rows.filter((row) => monthKey(row.start_date || row.due_date || row.created_at) === month);
  const completed = current.reduce((sum, row) => sum + Number(row.completed_qty || 0), 0);
  const target = current.reduce((sum, row) => sum + Number(row.target_qty || 0), 0);
  const scrap = current.reduce((sum, row) => sum + Number(row.scrap_qty || 0), 0);
  const active = rows.filter((row) => ['Planned', 'In Progress', 'On Hold'].includes(row.status)).length;
  const today = todayIso();
  const weekAhead = addDaysIso(today, 7);
  const dueSoon = rows.filter((row) => {
    const due = datePart(row.due_date);
    return due && !['Completed', 'Cancelled'].includes(row.status) && due >= today && due <= weekAhead;
  }).length;
  const scrapRate = completed + scrap > 0 ? (scrap / (completed + scrap)) * 100 : 0;

  return { active, completed, target, scrap, scrapRate, dueSoon };
}

interface ProgressModalProps {
  order: Row;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}

function ProgressModal({ order, onClose, onDone }: ProgressModalProps) {
  const { toast } = useUI();
  const [completedQty, setCompletedQty] = useState<string | number>(order.completed_qty || 0);
  const [scrapQty, setScrapQty] = useState<string | number>(order.scrap_qty || 0);
  const [status, setStatus] = useState(String(order.status));
  const [notes, setNotes] = useState(String(order.notes || ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const target = Number(order.target_qty) || 0;
  const achievement = target > 0 ? ((Number(completedQty) || 0) / target) * 100 : 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(`/api/production-orders/${order.id}`, {
        method: 'PUT',
        body: {
          completed_qty: completedQty,
          scrap_qty: scrapQty,
          status,
          notes,
        },
      });
      clearRefCache();
      toast('Production progress updated.');
      await onDone();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update production progress.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Update production progress"
      subtitle={`${order.order_no} · ${order.product_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="progress-form" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save progress'}
          </button>
        </>
      }
    >
      <form id="progress-form" onSubmit={submit} noValidate>
        <div className="form-note">
          <Icon name="info" size={15} />
          <span>
            Enter the latest cumulative output. Achievement and scrap rate are recalculated automatically.
            Marking the order Completed records today as the completion date.
          </span>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="prod-completed">
              Completed quantity <span className="req">*</span>
            </label>
            <input
              className="input"
              type="number"
              id="prod-completed"
              min="0"
              step="0.01"
              value={completedQty}
              onChange={(event) => setCompletedQty(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="prod-scrap">Scrap quantity</label>
            <input
              className="input"
              type="number"
              id="prod-scrap"
              min="0"
              step="0.01"
              value={scrapQty}
              onChange={(event) => setScrapQty(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="prod-status">
              Status <span className="req">*</span>
            </label>
            <select
              className="select"
              id="prod-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              required
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="prod-target">Target quantity</label>
            <input
              className="input"
              type="text"
              id="prod-target"
              value={`${fmtNum(order.target_qty)} ${order.unit || ''}`}
              readOnly
            />
          </div>
          <div className="field full">
            <label htmlFor="prod-notes">Notes</label>
            <textarea
              className="textarea"
              id="prod-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Shift remarks, delays, or quality notes"
            />
          </div>
          <div className="field full">
            <div className="balance-preview">
              Achievement after update: <strong>{fmtNum(achievement)}%</strong>
              <div className="progress-row" style={{ marginTop: 8 }}>
                <ProgressBar percent={achievement} />
                <span style={{ minWidth: 48 }}>{fmtNum(achievement)}%</span>
              </div>
            </div>
          </div>
        </div>
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}

interface ProductionDetailProps {
  orderId: number;
  onClose: () => void;
  onChanged?: () => void;
}

function ProductionDetail({ orderId, onClose, onChanged }: ProductionDetailProps) {
  const { resources } = useAuth();
  const { toast } = useUI();
  const [order, setOrder] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [progressOpen, setProgressOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrder(await api<Row>(`/api/production-orders/${orderId}`));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to load the production order.';
      setError(message);
      toast(message, 'error');
    }
  }, [orderId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = resources['production-orders'];
  const canWrite = Boolean(meta && meta.canWrite && !meta.readOnly);

  if (error && !order) {
    return (
      <Modal
        title="Production order details"
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <EmptyState title="Could not load production order" text={error} icon="alert" />
      </Modal>
    );
  }

  if (!order) {
    return (
      <Modal
        title="Production order details"
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="page-loading">
          <div className="skeleton" style={{ height: 74 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      </Modal>
    );
  }

  const achievement = Number(order.achievement || 0);
  const canUpdate = canWrite && order.status !== 'Cancelled';

  return (
    <>
      <Modal
        title="Production order details"
        subtitle={`${order.order_no} · ${order.product_name}`}
        size="wide"
        onClose={onClose}
        footer={
          <div className="flex gap-8" style={{ flexWrap: 'wrap', width: '100%' }}>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <span style={{ flex: 1 }} />
            {canUpdate ? (
              <button type="button" className="btn btn-primary" onClick={() => setProgressOpen(true)}>
                <Icon name="edit" size={14} /> Update progress
              </button>
            ) : null}
          </div>
        }
      >
        <div className="report-summary" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Stat label="Status" value={<Badge value={order.status} />} sub={order.customer_name || 'No customer set'} />
          <Stat
            label="Target"
            value={
              <>
                {fmtNum(order.target_qty)} <span className="muted" style={{ fontSize: 12 }}>{order.unit}</span>
              </>
            }
            sub={`Due ${fmtDate(order.due_date)}`}
          />
          <Stat label="Completed" value={fmtNum(order.completed_qty)} sub={`${fmtNum(achievement)}% achievement`} />
          <Stat label="Scrap" value={fmtNum(order.scrap_qty)} sub={`${fmtNum(order.scrap_rate || 0)}% scrap rate`} />
        </div>
        <div className="progress-row" style={{ marginBottom: 18 }}>
          <ProgressBar percent={achievement} />
          <span style={{ minWidth: 48 }}>{fmtNum(achievement)}%</span>
        </div>
        <div className="detail-grid">
          {detailItem('Order number', <span className="mono">{order.order_no}</span>)}
          {detailItem('Customer', order.customer_name || '—')}
          {detailItem('Product', order.product_name, { strong: true })}
          {detailItem('Plant', order.plant_name || '—')}
          {detailItem('Machine', order.machine_name || '—')}
          {detailItem('Start date', fmtDate(order.start_date))}
          {detailItem('Due date', fmtDate(order.due_date))}
          {detailItem('Completed on', fmtDate(order.completed_at))}
          {detailItem('Last updated', fmtDateTime(order.updated_at))}
          {detailItem('Notes', order.notes || '', { full: true })}
        </div>
      </Modal>

      {progressOpen ? (
        <ProgressModal
          order={order}
          onClose={() => setProgressOpen(false)}
          onDone={async () => {
            await load();
            if (onChanged) onChanged();
          }}
        />
      ) : null}
    </>
  );
}

export default function Production() {
  const { resources } = useAuth();
  const pageRef = useRef<ResourcePageHandle>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await api<ListResponse>('/api/production-orders?limit=500&sort=due_date&dir=DESC');
      setRows(data.rows || []);
    } catch {
      setRows([]);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const stats = computeStats(rows);
  const meta = resources['production-orders'];

  return (
    <>
      <PageHeader
        eyebrow="Production control"
        title="Production Orders"
        subtitle="Customer orders, output, scrap, and delivery dates across both plants."
        actions={
          <>
            {meta && meta.canWrite && !meta.readOnly ? (
              <button type="button" className="btn btn-primary" onClick={() => pageRef.current?.openForm()}>
                <Icon name="plus" size={14} /> New order
              </button>
            ) : null}
            <Link className="btn" to="/reports/production-summary">
              <Icon name="chart" size={14} /> Production report
            </Link>
          </>
        }
      />

      <div className="report-summary">
        <Stat label="Active orders" value={statsLoading ? '…' : fmtNum(stats.active)} sub="Planned, in progress, or on hold" />
        <Stat
          label="Output this month"
          value={statsLoading ? '…' : fmtNum(stats.completed)}
          sub={`Against ${fmtNum(stats.target)} target`}
        />
        <Stat
          label="Scrap rate"
          value={statsLoading ? '…' : `${fmtNum(stats.scrapRate)}%`}
          sub={`${fmtNum(stats.scrap)} scrapped units this month`}
        />
        <Stat
          label="Due within 7 days"
          value={statsLoading ? '…' : fmtNum(stats.dueSoon)}
          sub={stats.dueSoon > 0 ? 'Incomplete orders needing attention' : 'No immediate deadlines'}
        />
      </div>

      <ResourcePage
        ref={pageRef}
        resourceKey="production-orders"
        newLabel="New order"
        hideNew
        emptyTitle="No production orders"
        emptyText="Create an order to start tracking output against a customer deadline."
        onRowClick={(row) => setDetailId(row.id)}
        actions={[
          {
            label: 'Update progress',
            icon: 'edit',
            show: (row) => Boolean(meta && meta.canWrite) && row.status !== 'Cancelled',
            onClick: (row) => setDetailId(row.id),
          },
        ]}
        onSaved={loadStats}
        onDeleted={loadStats}
      />

      {detailId ? (
        <ProductionDetail
          orderId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            pageRef.current?.refresh();
            loadStats();
          }}
        />
      ) : null}
    </>
  );
}
