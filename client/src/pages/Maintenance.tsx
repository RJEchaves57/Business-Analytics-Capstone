import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import RecordDetailModal from '../components/RecordDetailModal';
import ResourcePage, { type ResourcePageHandle } from '../components/ResourcePage';
import { Badge, EmptyState, PageHeader, Tabs } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api } from '../lib/api';
import { fmtDate, fmtMoney, fmtNum, todayIso } from '../lib/format';
import { clearRefCache, fetchRefs } from '../lib/refs';
import type { ListResponse, Row } from '../types';

const TABS = [
  { key: 'work-orders', label: 'Work Orders' },
  { key: 'schedules', label: 'Preventive Schedules' },
  { key: 'machines', label: 'Machines & Equipment' },
];

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

function PartTable({ parts, editable, onReturn }: { parts: Row[]; editable: boolean; onReturn: (part: Row) => void }) {
  if (!parts.length) {
    return (
      <EmptyState
        title="No parts issued"
        text="Spare parts issued to this work order are deducted from inventory and listed here."
        icon="box"
      />
    );
  }
  return (
    <div className="mini-table-wrap">
      <table className="mini-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Part</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Unit Cost</th>
            <th className="text-right">Amount</th>
            {editable ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => (
            <tr key={part.id}>
              <td className="mono">{part.sku}</td>
              <td>{part.item_name}</td>
              <td className="num">
                {fmtNum(part.quantity)} {part.unit}
              </td>
              <td className="num">{fmtMoney(part.unit_cost)}</td>
              <td className="num">
                <span className="amount">{fmtMoney(Number(part.quantity) * Number(part.unit_cost))}</span>
              </td>
              {editable ? (
                <td className="text-right">
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Return part to stock"
                    aria-label="Return part"
                    onClick={() => onReturn(part)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ModalFlowProps {
  onClose: () => void;
  onDone: () => Promise<void> | void;
}

function IssuePartModal({ wo, onClose, onDone }: ModalFlowProps & { wo: Row }) {
  const { toast } = useUI();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRefs('items', { refresh: true })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load items.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = items.find((item) => String(item.id) === String(itemId));
  const projected = selected ? Number(selected.quantity) - (Number(quantity) || 0) : 0;

  const chooseItem = (value: string) => {
    setItemId(value);
    const item = items.find((row) => String(row.id) === String(value));
    if (item) setUnitCost(item.unit_cost);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!itemId) {
      setError('Select a spare part.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/api/maintenance-orders/${wo.id}/parts`, {
        method: 'POST',
        body: { item_id: itemId, quantity, unit_cost: unitCost },
      });
      clearRefCache('items');
      toast('Spare part issued from inventory.');
      await onDone();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to issue the part.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Issue spare part"
      subtitle={`${wo.wo_number} · ${wo.machine_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="part-form" className="btn btn-primary" disabled={saving || loading}>
            <Icon name="box" size={14} /> {saving ? 'Issuing…' : 'Issue part'}
          </button>
        </>
      }
    >
      <form id="part-form" onSubmit={submit} noValidate>
        <div className="form-note">
          <Icon name="info" size={15} />
          <span>
            The selected quantity is deducted from on-hand stock immediately and recorded in the stock
            ledger against this work order.
          </span>
        </div>
        {loading ? (
          <div className="page-loading">
            <div className="skeleton" style={{ height: 42 }} />
            <div className="skeleton" style={{ height: 42 }} />
          </div>
        ) : (
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="field full">
              <label htmlFor="part-item">
                Spare part <span className="req">*</span>
              </label>
              <select
                className="select"
                id="part-item"
                value={itemId}
                onChange={(event) => chooseItem(event.target.value)}
                required
              >
                <option value="">— Select an item —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name} — {fmtNum(item.quantity)} {item.unit} on hand
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="part-qty">
                Quantity <span className="req">*</span>
              </label>
              <input
                className="input"
                type="number"
                id="part-qty"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
                placeholder="0"
              />
            </div>
            <div className="field">
              <label htmlFor="part-cost">Unit cost</label>
              <input
                className="input"
                type="number"
                id="part-cost"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                placeholder="Use item cost"
              />
            </div>
            <div className="field full">
              <div className="balance-preview">
                {selected ? (
                  <>
                    Available: <strong>{fmtNum(selected.quantity)} {selected.unit}</strong> · After issue:{' '}
                    <strong>{fmtNum(projected)} {selected.unit}</strong>
                    {projected < 0 ? <span className="badge badge-red" style={{ marginLeft: 8 }}>Insufficient stock</span> : null}
                  </>
                ) : (
                  'Select a part to see available stock.'
                )}
              </div>
            </div>
          </div>
        )}
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}

function CompleteWorkOrderModal({ wo, onClose, onDone }: ModalFlowProps & { wo: Row }) {
  const { toast } = useUI();
  const [completedAt, setCompletedAt] = useState(String(wo.completed_at || todayIso()));
  const [downtimeHours, setDowntimeHours] = useState<string | number>(wo.downtime_hours || 0);
  const [laborCost, setLaborCost] = useState<string | number>(wo.labor_cost || 0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(`/api/maintenance-orders/${wo.id}/complete`, {
        method: 'POST',
        body: { completed_at: completedAt, downtime_hours: downtimeHours, labor_cost: laborCost },
      });
      toast(`${wo.wo_number} completed.`);
      await onDone();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to complete the work order.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Complete work order"
      subtitle={`${wo.wo_number} · ${wo.machine_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="complete-form" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={14} /> {saving ? 'Completing…' : 'Complete work order'}
          </button>
        </>
      }
    >
      <form id="complete-form" onSubmit={submit} noValidate>
        <div className="form-note">
          <Icon name="info" size={15} />
          <span>
            Completing this work order updates the linked schedule, returns the machine to Running if it
            was down, and records downtime and labor cost for reporting.
          </span>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="wo-completed">
              Completed date <span className="req">*</span>
            </label>
            <input
              className="input"
              type="date"
              id="wo-completed"
              value={completedAt}
              onChange={(event) => setCompletedAt(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="wo-downtime">Downtime hours</label>
            <input
              className="input"
              type="number"
              id="wo-downtime"
              min="0"
              step="0.25"
              value={downtimeHours}
              onChange={(event) => setDowntimeHours(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="wo-labor">Labor cost</label>
            <input
              className="input"
              type="number"
              id="wo-labor"
              min="0"
              step="0.01"
              value={laborCost}
              onChange={(event) => setLaborCost(event.target.value)}
            />
          </div>
          <div className="field">
            <label>Parts cost</label>
            <input className="input" type="text" value={fmtMoney(wo.parts_cost)} readOnly />
          </div>
        </div>
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}

interface WorkOrderDetailProps {
  woId: number;
  onClose: () => void;
  onChanged?: () => void;
}

function WorkOrderDetail({ woId, onClose, onChanged }: WorkOrderDetailProps) {
  const { resources } = useAuth();
  const { toast, confirm } = useUI();
  const [wo, setWo] = useState<Row | null>(null);
  const [parts, setParts] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [order, partResponse] = await Promise.all([
        api<Row>(`/api/maintenance-orders/${woId}`),
        api<ListResponse>(`/api/maintenance-orders/${woId}/parts`),
      ]);
      setWo(order);
      setParts(partResponse.rows || []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to load the work order.';
      setError(message);
      toast(message, 'error');
    }
  }, [woId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = resources['maintenance-orders'];
  const canWrite = Boolean(meta && meta.canWrite && !meta.readOnly);
  const closed = wo ? ['Completed', 'Cancelled'].includes(wo.status) : false;
  const canEditParts = canWrite && !closed;

  const removePart = async (part: Row) => {
    const confirmed = await confirm({
      title: 'Return part to stock?',
      message: `Return ${fmtNum(part.quantity)} ${part.unit} of ${part.item_name} to inventory? The part will be removed from this work order.`,
      confirmLabel: 'Return part',
    });
    if (!confirmed) return;
    try {
      await api(`/api/maintenance-orders/${woId}/parts/${part.id}`, { method: 'DELETE' });
      clearRefCache('items');
      toast('Part returned to stock.');
      await load();
      if (onChanged) onChanged();
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to return the part.', 'error');
    }
  };

  if (error && !wo) {
    return (
      <Modal title="Work order details" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <EmptyState title="Could not load work order" text={error} icon="alert" />
      </Modal>
    );
  }

  if (!wo) {
    return (
      <Modal title="Work order details" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <div className="page-loading">
          <div className="skeleton" style={{ height: 74 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title="Work order details"
        subtitle={`${wo.wo_number} · ${wo.machine_name}`}
        size="wide"
        onClose={onClose}
        footer={
          <div className="flex gap-8" style={{ flexWrap: 'wrap', width: '100%' }}>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <span style={{ flex: 1 }} />
            {canWrite && !closed ? (
              <button type="button" className="btn" onClick={() => setIssueOpen(true)}>
                <Icon name="box" size={14} /> Issue part
              </button>
            ) : null}
            {canWrite && !closed ? (
              <button type="button" className="btn btn-primary" onClick={() => setCompleteOpen(true)}>
                <Icon name="check" size={14} /> Complete work order
              </button>
            ) : null}
          </div>
        }
      >
        <div className="report-summary" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Stat
            label="Work order"
            value={<span className="mono" style={{ fontSize: 14 }}>{wo.wo_number}</span>}
            sub={wo.schedule_title ? `From schedule: ${wo.schedule_title}` : wo.type}
          />
          <Stat label="Status" value={<Badge value={wo.status} />} sub={`${wo.priority} priority · ${wo.type}`} />
          <Stat label="Parts issued" value={fmtNum(wo.parts_count || 0)} sub={fmtMoney(wo.parts_cost)} />
          <Stat
            label="Total cost"
            value={fmtMoney(wo.total_cost)}
            sub={`Labor ${fmtMoney(wo.labor_cost)} · Downtime ${fmtNum(wo.downtime_hours)} hrs`}
          />
        </div>
        <div className="detail-grid">
          {detailItem('Machine', wo.machine_name, { strong: true })}
          {detailItem('Asset code', <span className="mono">{wo.asset_code}</span>)}
          {detailItem('Technician', wo.assigned_to || 'Unassigned')}
          {detailItem('Reported by', wo.reported_by || '—')}
          {detailItem('Started', fmtDate(wo.started_at))}
          {detailItem('Completed', fmtDate(wo.completed_at))}
          {detailItem('Description / findings', wo.description || '', { full: true })}
        </div>
        <div className="section-title">Spare parts</div>
        <PartTable parts={parts} editable={canEditParts} onReturn={removePart} />
        {canEditParts ? (
          <div className="report-meta" style={{ marginTop: 8 }}>
            Issuing a part immediately deducts it from inventory. Returning a part restores stock and writes
            a return movement to the ledger.
          </div>
        ) : null}
      </Modal>

      {issueOpen ? (
        <IssuePartModal
          wo={wo}
          onClose={() => setIssueOpen(false)}
          onDone={async () => {
            await load();
            if (onChanged) onChanged();
          }}
        />
      ) : null}

      {completeOpen ? (
        <CompleteWorkOrderModal
          wo={wo}
          onClose={() => setCompleteOpen(false)}
          onDone={async () => {
            await load();
            if (onChanged) onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function QuickWorkOrderModal({ machine, onClose, onDone }: ModalFlowProps & { machine: Row }) {
  const { toast } = useUI();
  const [type, setType] = useState('Corrective');
  const [priority, setPriority] = useState('Medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [startedAt, setStartedAt] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [setStatus, setSetStatus] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api<{ wo_number?: string }>('/api/maintenance-orders', {
        method: 'POST',
        body: {
          machine_id: machine.id,
          type,
          priority,
          status: 'Open',
          assigned_to: assignedTo,
          description,
          started_at: startedAt,
        },
      });
      if (setStatus && machine.status !== 'Retired') {
        try {
          await api(`/api/machines/${machine.id}`, { method: 'PUT', body: { status: 'Under Maintenance' } });
        } catch {
          // The work order exists even if the machine status could not be updated.
        }
      }
      clearRefCache('machines');
      toast(`Work order ${result.wo_number || ''} created.`);
      await onDone();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create the work order.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New work order"
      subtitle={`${machine.asset_code} · ${machine.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="quick-wo-form" className="btn btn-primary" disabled={saving}>
            <Icon name="wrench" size={14} /> {saving ? 'Creating…' : 'Create work order'}
          </button>
        </>
      }
    >
      <form id="quick-wo-form" onSubmit={submit} noValidate>
        <div className="form-note">
          <Icon name="info" size={15} />
          <span>
            A work order number is generated automatically. You can issue spare parts and record downtime
            after the job is created.
          </span>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="qwo-type">
              Type <span className="req">*</span>
            </label>
            <select className="select" id="qwo-type" value={type} onChange={(event) => setType(event.target.value)} required>
              {['Corrective', 'Preventive', 'Emergency', 'Calibration', 'Inspection'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="qwo-priority">
              Priority <span className="req">*</span>
            </label>
            <select
              className="select"
              id="qwo-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              required
            >
              {['Medium', 'Low', 'High', 'Critical'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="qwo-tech">Technician</label>
            <input
              className="input"
              type="text"
              id="qwo-tech"
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
              placeholder="Assigned technician"
            />
          </div>
          <div className="field">
            <label htmlFor="qwo-start">Started</label>
            <input
              className="input"
              type="date"
              id="qwo-start"
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="qwo-desc">Description / findings</label>
            <textarea
              className="textarea"
              id="qwo-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the fault or job scope"
            />
          </div>
          <div className="field full">
            <div className="check-row">
              <input
                type="checkbox"
                id="qwo-status"
                checked={setStatus}
                onChange={(event) => setSetStatus(event.target.checked)}
              />
              <span>Set machine status to Under Maintenance</span>
            </div>
          </div>
        </div>
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}

interface MachineDetailProps {
  machineId: number;
  resourceRef: RefObject<ResourcePageHandle | null>;
  onClose: () => void;
  onChanged?: () => void;
  onOpenWorkOrder: (id: number) => void;
}

function MachineDetail({ machineId, resourceRef, onClose, onChanged, onOpenWorkOrder }: MachineDetailProps) {
  const { resources } = useAuth();
  const { toast } = useUI();
  const [machine, setMachine] = useState<Row | null>(null);
  const [orders, setOrders] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [machineRow, orderResponse] = await Promise.all([
        api<Row>(`/api/machines/${machineId}`),
        api<ListResponse>(`/api/maintenance-orders?machine_id=${machineId}&limit=8&sort=created_at&dir=DESC`),
      ]);
      setMachine(machineRow);
      setOrders(orderResponse.rows || []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to load the machine.';
      setError(message);
      toast(message, 'error');
    }
  }, [machineId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = resources.machines;
  const canWrite = Boolean(meta && meta.canWrite && !meta.readOnly);

  if (error && !machine) {
    return (
      <Modal title="Machine details" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <EmptyState title="Could not load machine" text={error} icon="alert" />
      </Modal>
    );
  }

  if (!machine) {
    return (
      <Modal title="Machine details" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <div className="page-loading">
          <div className="skeleton" style={{ height: 74 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title="Machine details"
        subtitle={`${machine.asset_code} · ${machine.name}`}
        size="wide"
        onClose={onClose}
        footer={
          <div className="flex gap-8" style={{ flexWrap: 'wrap', width: '100%' }}>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <span style={{ flex: 1 }} />
            {canWrite ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onClose();
                  resourceRef.current?.openForm(machine);
                }}
              >
                <Icon name="edit" size={14} /> Edit machine
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="btn btn-primary" onClick={() => setQuickOpen(true)}>
                <Icon name="wrench" size={14} /> New work order
              </button>
            ) : null}
          </div>
        }
      >
        <div className="report-summary" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Stat label="Status" value={<Badge value={machine.status} />} />
          <Stat label="Next maintenance" value={fmtDate(machine.next_due)} sub={machine.due_status || 'No active schedule'} />
          <Stat label="Open work orders" value={fmtNum(machine.open_orders || 0)} sub="Open, in progress, or on hold" />
          <Stat label="Location" value={machine.location || '—'} sub={machine.plant_name || 'Plant not set'} />
        </div>
        <div className="detail-grid">
          {detailItem('Type', machine.type)}
          {detailItem('Manufacturer', machine.manufacturer || '—')}
          {detailItem('Model', machine.model || '—')}
          {detailItem('Serial number', <span className="mono">{machine.serial_no || '—'}</span>)}
          {detailItem('Acquired', fmtDate(machine.acquired_date))}
          {detailItem('Plant', machine.plant_name || '—')}
          {detailItem('Notes', machine.notes || '', { full: true })}
        </div>
        <div className="section-title">Recent work orders</div>
        {orders.length ? (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>WO No.</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="mono">{order.wo_number}</td>
                    <td>{order.type}</td>
                    <td><Badge value={order.priority} /></td>
                    <td><Badge value={order.status} /></td>
                    <td>{fmtDate(order.started_at)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          onClose();
                          onOpenWorkOrder(order.id);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No work orders for this machine"
            text="Open a work order when a fault is reported or maintenance is due."
            icon="wrench"
          />
        )}
      </Modal>

      {quickOpen ? (
        <QuickWorkOrderModal
          machine={machine}
          onClose={() => setQuickOpen(false)}
          onDone={async () => {
            await load();
            if (onChanged) onChanged();
          }}
        />
      ) : null}
    </>
  );
}

export default function Maintenance() {
  const params = useParams();
  const { resources } = useAuth();
  const { toast, confirm } = useUI();
  const [active, setActive] = useState(
    params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'work-orders'
  );
  const [woDetail, setWoDetail] = useState<number | null>(null);
  const [machineDetail, setMachineDetail] = useState<number | null>(null);
  const [scheduleDetail, setScheduleDetail] = useState<Row | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Row | null>(null);
  const [quickMachine, setQuickMachine] = useState<Row | null>(null);
  const workOrdersRef = useRef<ResourcePageHandle>(null);
  const schedulesRef = useRef<ResourcePageHandle>(null);
  const machinesRef = useRef<ResourcePageHandle>(null);

  useEffect(() => {
    setActive(params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'work-orders');
    setWoDetail(null);
    setMachineDetail(null);
    setScheduleDetail(null);
  }, [params.tab]);

  const woMeta = resources['maintenance-orders'];
  const scheduleMeta = resources['maintenance-schedules'];
  const machineMeta = resources.machines;

  const generateWorkOrder = async (schedule: Row, listRef: RefObject<ResourcePageHandle | null>) => {
    const confirmed = await confirm({
      title: 'Generate work order?',
      message: `Create a work order for ${schedule.machine_name} from the schedule “${schedule.title}”? The assigned technician is ${schedule.assigned_to || 'not set'}.`,
      confirmLabel: 'Generate work order',
    });
    if (!confirmed) return;
    try {
      const type = ['Preventive', 'Corrective', 'Emergency', 'Calibration', 'Inspection'].includes(
        schedule.maintenance_type
      )
        ? schedule.maintenance_type
        : 'Preventive';
      const result = await api<Row>('/api/maintenance-orders', {
        method: 'POST',
        body: {
          machine_id: schedule.machine_id,
          schedule_id: schedule.id,
          type,
          priority: 'Medium',
          status: 'Open',
          assigned_to: schedule.assigned_to || '',
          description: `Scheduled maintenance: ${schedule.title}`,
          started_at: todayIso(),
        },
      });
      toast(`Work order ${result.wo_number || ''} created.`);
      listRef.current?.refresh();
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to generate the work order.', 'error');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Maintenance management"
        title="Maintenance"
        subtitle="Work orders, preventive schedules, downtime, spare parts, and the equipment register."
        actions={
          <Link className="btn" to="/maintenance/schedules">
            <Icon name="calendar" size={14} /> Maintenance calendar
          </Link>
        }
      />
      <Tabs items={TABS} base="maintenance" />

      {active === 'work-orders' ? (
        <ResourcePage
          key="work-orders"
          ref={workOrdersRef}
          resourceKey="maintenance-orders"
          newLabel="New work order"
          emptyTitle="No work orders yet"
          emptyText="Open a corrective or preventive job from a machine or schedule."
          onRowClick={(row) => setWoDetail(row.id)}
          actions={[
            {
              label: 'Complete work order',
              icon: 'check',
              show: (row) =>
                Boolean(woMeta && woMeta.canWrite) && !['Completed', 'Cancelled'].includes(row.status),
              onClick: (row) => setCompleteTarget(row),
            },
          ]}
        />
      ) : null}

      {active === 'schedules' ? (
        <ResourcePage
          key="schedules"
          ref={schedulesRef}
          resourceKey="maintenance-schedules"
          newLabel="New schedule"
          emptyTitle="No preventive schedules"
          emptyText="Create a recurring maintenance plan for each machine."
          onRowClick={(row) => setScheduleDetail(row)}
          actions={[
            {
              label: 'Generate work order',
              icon: 'wrench',
              show: (row) => Boolean(scheduleMeta && scheduleMeta.canWrite) && Number(row.active) === 1,
              onClick: (row) => generateWorkOrder(row, schedulesRef),
            },
          ]}
        />
      ) : null}

      {active === 'machines' ? (
        <ResourcePage
          key="machines"
          ref={machinesRef}
          resourceKey="machines"
          newLabel="New machine"
          emptyTitle="No machines registered"
          emptyText="Add the production equipment and inspection devices used in the plants."
          onRowClick={(row) => setMachineDetail(row.id)}
          actions={[
            {
              label: 'New work order',
              icon: 'wrench',
              show: () => Boolean(machineMeta && machineMeta.canWrite),
              onClick: (row) => setQuickMachine(row),
            },
          ]}
        />
      ) : null}

      {woDetail ? (
        <WorkOrderDetail
          woId={woDetail}
          onClose={() => setWoDetail(null)}
          onChanged={() => workOrdersRef.current?.refresh()}
        />
      ) : null}

      {completeTarget ? (
        <CompleteWorkOrderModal
          wo={completeTarget}
          onClose={() => setCompleteTarget(null)}
          onDone={() => workOrdersRef.current?.refresh()}
        />
      ) : null}

      {scheduleDetail ? (
        <RecordDetailModal
          resourceKey="maintenance-schedules"
          row={scheduleDetail}
          onClose={() => setScheduleDetail(null)}
          extra={
            scheduleDetail.checklist ? (
              <>
                <div className="section-title">Checklist / procedure</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-soft)', whiteSpace: 'pre-wrap' }}>
                  {scheduleDetail.checklist}
                </div>
              </>
            ) : null
          }
          footer={
            scheduleMeta && scheduleMeta.canWrite ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const schedule = scheduleDetail;
                  setScheduleDetail(null);
                  generateWorkOrder(schedule, schedulesRef);
                }}
              >
                <Icon name="wrench" size={14} /> Generate work order
              </button>
            ) : null
          }
        />
      ) : null}

      {machineDetail ? (
        <MachineDetail
          machineId={machineDetail}
          resourceRef={machinesRef}
          onClose={() => setMachineDetail(null)}
          onChanged={() => machinesRef.current?.refresh()}
          onOpenWorkOrder={(id) => {
            setMachineDetail(null);
            setWoDetail(id);
          }}
        />
      ) : null}

      {quickMachine ? (
        <QuickWorkOrderModal
          machine={quickMachine}
          onClose={() => setQuickMachine(null)}
          onDone={() => machinesRef.current?.refresh()}
        />
      ) : null}
    </>
  );
}
