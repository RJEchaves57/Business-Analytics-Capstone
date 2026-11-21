import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import ResourcePage, { type ResourcePageHandle } from '../components/ResourcePage';
import { Badge, EmptyState, PageHeader, Tabs } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api } from '../lib/api';
import { fmtDate, fmtNum, fmtMoney } from '../lib/format';
import { clearRefCache, fetchRefs } from '../lib/refs';
import type { ListResponse, Row } from '../types';

const TABS = [
  { key: 'purchase-orders', label: 'Purchase Orders' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'customers', label: 'Customers' },
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

function LineTable({
  lines,
  editable,
  onRemove,
}: {
  lines: Row[];
  editable: boolean;
  onRemove: (line: Row) => void;
}) {
  if (!lines.length) {
    return (
      <EmptyState
        title="No line items yet"
        text="Add materials or parts to this order before it can be received into stock."
        icon="cart"
      />
    );
  }
  return (
    <div className="mini-table-wrap">
      <table className="mini-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Item</th>
            <th className="text-right">Ordered</th>
            <th className="text-right">Received</th>
            <th className="text-right">Remaining</th>
            <th className="text-right">Unit Cost</th>
            <th className="text-right">Amount</th>
            {editable ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td className="mono">{line.sku}</td>
              <td>{line.item_name}</td>
              <td className="num">
                {fmtNum(line.quantity)} {line.unit}
              </td>
              <td className="num">{fmtNum(line.received_qty)}</td>
              <td className="num">{fmtNum(line.remaining)}</td>
              <td className="num">{fmtMoney(line.unit_cost)}</td>
              <td className="num">
                <span className="amount">{fmtMoney(Number(line.quantity) * Number(line.unit_cost))}</span>
              </td>
              {editable ? (
                <td className="text-right">
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Remove line"
                    aria-label="Remove line"
                    onClick={() => onRemove(line)}
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

interface AddLineModalProps {
  po: Row;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}

function AddLineModal({ po, onClose, onDone }: AddLineModalProps) {
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
  const lineTotal = (Number(quantity) || 0) * (Number(unitCost) || 0);

  const chooseItem = (value: string) => {
    setItemId(value);
    const item = items.find((row) => String(row.id) === String(value));
    if (item) setUnitCost(item.unit_cost);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!itemId) {
      setError('Select an item for this line.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/api/purchase-orders/${po.id}/lines`, {
        method: 'POST',
        body: { item_id: itemId, quantity, unit_cost: unitCost },
      });
      clearRefCache('items');
      toast('Line item added.');
      await onDone();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to add the line item.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add line item"
      subtitle={`${po.po_number} · ${po.supplier_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="line-form" className="btn btn-primary" disabled={saving || loading}>
            <Icon name="plus" size={14} /> {saving ? 'Adding…' : 'Add line'}
          </button>
        </>
      }
    >
      <form id="line-form" onSubmit={submit} noValidate>
        <div className="form-note">
          <Icon name="info" size={15} />
          <span>
            Line items are not received into stock until the purchase order is received. The unit cost is
            prefilled from the item master and can be adjusted for this order.
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
              <label htmlFor="line-item">
                Item <span className="req">*</span>
              </label>
              <select
                className="select"
                id="line-item"
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
              <label htmlFor="line-qty">
                Quantity <span className="req">*</span>
              </label>
              <input
                className="input"
                type="number"
                id="line-qty"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
                placeholder="0"
              />
            </div>
            <div className="field">
              <label htmlFor="line-cost">
                Unit cost <span className="req">*</span>
              </label>
              <input
                className="input"
                type="number"
                id="line-cost"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                required
                placeholder="0.00"
              />
            </div>
            <div className="field full">
              <div className="balance-preview">
                Line total: <strong>{fmtMoney(lineTotal)}</strong>
                {selected ? (
                  <>
                    {' '}
                    · Current stock: <strong>{fmtNum(selected.quantity)} {selected.unit}</strong>
                  </>
                ) : (
                  ' · Select an item to prefill its current cost.'
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

interface PurchaseOrderDetailProps {
  poId: number;
  onClose: () => void;
  onChanged?: () => void;
}

function PurchaseOrderDetail({ poId, onClose, onChanged }: PurchaseOrderDetailProps) {
  const { resources } = useAuth();
  const { toast, confirm } = useUI();
  const [po, setPo] = useState<Row | null>(null);
  const [lines, setLines] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [order, lineResponse] = await Promise.all([
        api<Row>(`/api/purchase-orders/${poId}`),
        api<ListResponse>(`/api/purchase-orders/${poId}/lines`),
      ]);
      setPo(order);
      setLines(lineResponse.rows || []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to load the purchase order.';
      setError(message);
      toast(message, 'error');
    }
  }, [poId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = resources['purchase-orders'];
  const canWrite = Boolean(meta && meta.canWrite && !meta.readOnly);
  const closed = po ? ['Received', 'Cancelled'].includes(po.status) : false;
  const canEdit = canWrite && !closed;

  const removeLine = async (line: Row) => {
    if (!po) return;
    const confirmed = await confirm({
      title: 'Remove line item?',
      message: `Remove ${fmtNum(line.quantity)} ${line.unit} of ${line.item_name} from ${po.po_number}?`,
      confirmLabel: 'Remove line',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/purchase-orders/${poId}/lines/${line.id}`, { method: 'DELETE' });
      toast('Line item removed.');
      await load();
      if (onChanged) onChanged();
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to remove the line item.', 'error');
    }
  };

  const receive = async () => {
    if (!po) return;
    const confirmed = await confirm({
      title: 'Receive purchase order?',
      message: `Receive all remaining lines on ${po.po_number} into inventory? Stock quantities and the movement ledger will be updated, and the order will be marked Received.`,
      confirmLabel: 'Receive into stock',
    });
    if (!confirmed) return;
    setReceiving(true);
    try {
      await api(`/api/purchase-orders/${poId}/receive`, { method: 'POST' });
      clearRefCache('items');
      toast(`${po.po_number} received into stock.`);
      await load();
      if (onChanged) onChanged();
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to receive the purchase order.', 'error');
    } finally {
      setReceiving(false);
    }
  };

  if (error && !po) {
    return (
      <Modal
        title="Purchase order details"
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        }
      >
        <EmptyState title="Could not load purchase order" text={error} icon="alert" />
      </Modal>
    );
  }

  if (!po) {
    return (
      <Modal
        title="Purchase order details"
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

  return (
    <>
      <Modal
        title="Purchase order details"
        subtitle={`${po.po_number} · ${po.supplier_name}`}
        size="wide"
        onClose={onClose}
        footer={
          <div className="flex gap-8" style={{ flexWrap: 'wrap', width: '100%' }}>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <span style={{ flex: 1 }} />
            {canEdit ? (
              <button type="button" className="btn" onClick={() => setAddLineOpen(true)}>
                <Icon name="plus" size={14} /> Add line
              </button>
            ) : null}
            {canEdit && lines.length ? (
              <button type="button" className="btn btn-primary" onClick={receive} disabled={receiving}>
                <Icon name="truck" size={14} /> {receiving ? 'Receiving…' : 'Receive PO'}
              </button>
            ) : null}
          </div>
        }
      >
        <div className="report-summary" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Stat
            label="Status"
            value={<Badge value={po.status} />}
            sub={po.received_date ? `Received ${fmtDate(po.received_date)}` : `Ordered ${fmtDate(po.order_date)}`}
          />
          <Stat label="Supplier" value={po.supplier_name} sub="Approved vendor" />
          <Stat
            label="Order total"
            value={fmtMoney(po.total_amount)}
            sub={`${fmtNum(lines.length)} line item${lines.length === 1 ? '' : 's'}`}
          />
          <Stat
            label="Expected delivery"
            value={fmtDate(po.expected_date)}
            sub={po.received_date ? 'Delivery completed' : 'Open commitment'}
          />
        </div>
        <div className="detail-grid">
          {detailItem('PO number', <span className="mono">{po.po_number}</span>)}
          {detailItem('Supplier', po.supplier_name, { strong: true })}
          {detailItem('Order date', fmtDate(po.order_date))}
          {detailItem('Expected date', fmtDate(po.expected_date))}
          {detailItem('Received date', fmtDate(po.received_date))}
          {detailItem('Notes', po.notes || '', { full: true })}
        </div>
        <div className="section-title">Line items</div>
        <LineTable lines={lines} editable={canEdit} onRemove={removeLine} />
        {canEdit ? (
          <div className="report-meta" style={{ marginTop: 8 }}>
            Receiving this order adds every remaining line to on-hand stock and writes an IN movement to the
            stock ledger.
          </div>
        ) : null}
        {!canEdit && po.status === 'Received' ? (
          <div className="form-note" style={{ marginTop: 16 }}>
            <Icon name="check" size={15} />
            <span>This purchase order has been received in full. The lines are now part of the stock ledger.</span>
          </div>
        ) : null}
      </Modal>

      {addLineOpen ? (
        <AddLineModal
          po={po}
          onClose={() => setAddLineOpen(false)}
          onDone={async () => {
            await load();
            if (onChanged) onChanged();
          }}
        />
      ) : null}
    </>
  );
}

export default function Purchasing() {
  const params = useParams();
  const { resources } = useAuth();
  const { toast, confirm } = useUI();
  const [active, setActive] = useState(
    params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'purchase-orders'
  );
  const [detailId, setDetailId] = useState<number | null>(null);
  const ordersRef = useRef<ResourcePageHandle>(null);

  useEffect(() => {
    setActive(params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'purchase-orders');
    setDetailId(null);
  }, [params.tab]);

  const meta = resources['purchase-orders'];

  const receiveOrder = async (row: Row) => {
    const confirmed = await confirm({
      title: 'Receive purchase order?',
      message: `Receive all remaining lines on ${row.po_number} into inventory? Stock quantities and the movement ledger will be updated, and the order will be marked Received.`,
      confirmLabel: 'Receive into stock',
    });
    if (!confirmed) return;
    try {
      await api(`/api/purchase-orders/${row.id}/receive`, { method: 'POST' });
      clearRefCache('items');
      toast(`${row.po_number} received into stock.`);
      ordersRef.current?.refresh();
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to receive the purchase order.', 'error');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Purchasing"
        title="Purchasing"
        subtitle="Supplier orders, receiving into inventory, and the customer master record."
        actions={
          <Link className="btn" to="/reports/purchase-spend">
            <Icon name="chart" size={14} /> Spend report
          </Link>
        }
      />
      <Tabs items={TABS} base="purchasing" />

      {active === 'purchase-orders' ? (
        <ResourcePage
          key="purchase-orders"
          ref={ordersRef}
          resourceKey="purchase-orders"
          newLabel="New purchase order"
          emptyTitle="No purchase orders"
          emptyText="Create a purchase order, add line items, then receive it into stock."
          onRowClick={(row) => setDetailId(row.id)}
          actions={[
            {
              label: 'Receive into stock',
              icon: 'truck',
              show: (row) =>
                Boolean(meta && meta.canWrite) &&
                !['Received', 'Cancelled'].includes(row.status) &&
                Number(row.line_count) > 0,
              onClick: (row) => receiveOrder(row),
            },
          ]}
        />
      ) : null}

      {active === 'suppliers' ? (
        <ResourcePage
          key="suppliers"
          resourceKey="suppliers"
          newLabel="New supplier"
          emptyTitle="No suppliers"
          emptyText="Add approved vendors for materials, parts, and services."
        />
      ) : null}

      {active === 'customers' ? (
        <ResourcePage
          key="customers"
          resourceKey="customers"
          newLabel="New customer"
          emptyTitle="No customers"
          emptyText="Add the export and domestic customers served by the plants."
        />
      ) : null}

      {detailId ? (
        <PurchaseOrderDetail
          poId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => ordersRef.current?.refresh()}
        />
      ) : null}
    </>
  );
}
