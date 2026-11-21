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
import { fmtDateTime, fmtMoney, fmtNum } from '../lib/format';
import { clearRefCache } from '../lib/refs';
import type { ListResponse, Row } from '../types';

const TABS = [
  { key: 'items', label: 'Items' },
  { key: 'movements', label: 'Stock Movements' },
  { key: 'warehouses', label: 'Warehouses' },
  { key: 'plants', label: 'Plants' },
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

function stockStatus(item: Row): string {
  if (Number(item.quantity) <= 0) return 'Out of Stock';
  if (Number(item.quantity) <= Number(item.reorder_point)) return 'Low Stock';
  return 'In Stock';
}

interface MovementModalProps {
  item: Row | null;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}

function MovementModal({ item, onClose, onDone }: MovementModalProps) {
  const { toast } = useUI();
  const [type, setType] = useState('IN');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState(item ? item.unit_cost : '');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const projected = item
    ? Number(item.quantity) + (type === 'IN' ? Number(quantity) || 0 : -(Number(quantity) || 0))
    : 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item) return;
    setSaving(true);
    setError('');
    try {
      await api('/api/stock-movements', {
        method: 'POST',
        body: {
          item_id: item.id,
          type,
          quantity,
          unit_cost: unitCost === '' ? undefined : unitCost,
          reference,
          notes,
        },
      });
      clearRefCache('items');
      toast('Stock movement recorded.');
      await onDone();
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to record the movement.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record stock movement"
      subtitle={item ? `${item.sku} · ${item.name}` : 'Receive or issue stock'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="movement-form" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={14} /> {saving ? 'Recording…' : 'Record movement'}
          </button>
        </>
      }
    >
      <form id="movement-form" onSubmit={submit} noValidate>
        <div className="form-note">
          <Icon name="info" size={15} />
          <span>
            IN adds stock. OUT immediately deducts stock and cannot be edited or deleted. Use a clear
            reference such as a work order or delivery receipt.
          </span>
        </div>
        {item ? (
          <div className="form-field-summary" style={{ marginTop: 14 }}>
            <Icon name="box" size={15} />
            <div>
              <strong>{item.name}</strong>
              <span>
                On hand: {fmtNum(item.quantity)} {item.unit} · {item.sku}
              </span>
            </div>
          </div>
        ) : null}
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="mv-type">
              Movement type <span className="req">*</span>
            </label>
            <select
              className="select"
              id="mv-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              required
            >
              <option value="IN">IN — receive stock</option>
              <option value="OUT">OUT — issue stock</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="mv-qty">
              Quantity <span className="req">*</span>
            </label>
            <input
              className="input"
              type="number"
              id="mv-qty"
              min="0.01"
              step="0.01"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="mv-cost">Unit cost</label>
            <input
              className="input"
              type="number"
              id="mv-cost"
              min="0"
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              placeholder="Use current item cost"
            />
          </div>
          <div className="field">
            <label htmlFor="mv-ref">Reference</label>
            <input
              className="input"
              type="text"
              id="mv-ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="e.g. WO-2026-0012 / DR-8842"
            />
          </div>
          <div className="field full">
            <label htmlFor="mv-notes">Notes</label>
            <textarea
              className="textarea"
              id="mv-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional remarks for the stock ledger"
            />
          </div>
        </div>
        {item ? (
          <div className="balance-preview">
            Projected balance after this movement: <strong>{fmtNum(projected)} {item.unit}</strong>
            {projected < 0 ? <span className="badge badge-red" style={{ marginLeft: 8 }}>Insufficient stock</span> : null}
          </div>
        ) : null}
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}

function MovementTable({ rows }: { rows: Row[] }) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No movement history"
        text="Stock movements will appear here once parts or materials are received or issued."
        icon="swap"
      />
    );
  }
  return (
    <div className="mini-table-wrap">
      <table className="mini-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Balance</th>
            <th>Reference</th>
            <th>Recorded By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="nowrap">{fmtDateTime(row.created_at)}</td>
              <td>
                <Badge value={row.type} />
              </td>
              <td className="num">
                {row.type === 'IN' ? '+' : '−'}
                {fmtNum(row.quantity)} {row.item_unit || ''}
              </td>
              <td className="num">{fmtNum(row.resulting_qty)}</td>
              <td>{row.reference || '—'}</td>
              <td>{row.created_by || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ItemDetailProps {
  itemId: number;
  resourceRef: RefObject<ResourcePageHandle | null>;
  onClose: () => void;
  onChanged?: () => void;
}

function ItemDetail({ itemId, resourceRef, onClose, onChanged }: ItemDetailProps) {
  const { resources } = useAuth();
  const { toast } = useUI();
  const [item, setItem] = useState<Row | null>(null);
  const [movements, setMovements] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [movementOpen, setMovementOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [itemRow, movementResponse] = await Promise.all([
        api<Row>(`/api/items/${itemId}`),
        api<ListResponse>(`/api/stock-movements?item_id=${itemId}&limit=10&sort=created_at&dir=DESC`),
      ]);
      setItem(itemRow);
      setMovements(movementResponse.rows || []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to load the item.';
      setError(message);
      toast(message, 'error');
    }
  }, [itemId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = resources.items;
  const canWrite = Boolean(meta && meta.canWrite && !meta.readOnly);

  if (error && !item) {
    return (
      <Modal title="Item details" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <EmptyState title="Could not load item" text={error} icon="alert" />
      </Modal>
    );
  }

  if (!item) {
    return (
      <Modal title="Item details" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <div className="page-loading">
          <div className="skeleton" style={{ height: 74 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      </Modal>
    );
  }

  const status = stockStatus(item);
  const value = Number(item.quantity) * Number(item.unit_cost);

  return (
    <>
      <Modal
        title="Item details"
        subtitle={`${item.sku} · ${item.name}`}
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
                  resourceRef.current?.openForm(item);
                }}
              >
                <Icon name="edit" size={14} /> Edit item
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="btn btn-primary" onClick={() => setMovementOpen(true)}>
                <Icon name="swap" size={14} /> Record movement
              </button>
            ) : null}
          </div>
        }
      >
        <div className="report-summary" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <Stat
            label="On hand"
            value={
              <>
                {fmtNum(item.quantity)} <span className="muted" style={{ fontSize: 12 }}>{item.unit}</span>
              </>
            }
          />
          <Stat
            label="Reorder point"
            value={fmtNum(item.reorder_point)}
            sub={Number(item.quantity) <= Number(item.reorder_point) ? 'At or below reorder level' : 'Stock level is healthy'}
          />
          <Stat label="Unit cost" value={fmtMoney(item.unit_cost)} />
          <Stat label="Stock value" value={fmtMoney(value)} sub={`Status: ${status}`} />
        </div>
        <div className="detail-grid">
          {detailItem('Category', <Badge value={item.category} />)}
          {detailItem('Stock status', <Badge value={status} />)}
          {detailItem('Warehouse', item.warehouse_name || '—')}
          {detailItem('Bin / location', item.location || '—')}
          {detailItem('Preferred supplier', item.supplier_name || '—')}
          {detailItem('Last updated', fmtDateTime(item.updated_at))}
          {detailItem('Notes', item.notes || '', { full: true })}
        </div>
        <div className="section-title">Recent stock movements</div>
        <MovementTable rows={movements} />
        {!canWrite ? (
          <div className="form-note" style={{ marginTop: 16 }}>
            <Icon name="lock" size={15} />
            <span>Your role can view inventory but cannot record stock movements.</span>
          </div>
        ) : null}
      </Modal>
      {movementOpen ? (
        <MovementModal
          item={item}
          onClose={() => setMovementOpen(false)}
          onDone={async () => {
            await load();
            if (onChanged) onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function StockMovementDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  return (
    <RecordDetailModal
      resourceKey="stock-movements"
      row={row}
      onClose={onClose}
      extra={
        <div className="form-note" style={{ marginTop: 16 }}>
          <Icon name="info" size={15} />
          <span>
            Stock movements are permanent ledger entries. They cannot be edited or deleted; record a
            reversing movement instead.
          </span>
        </div>
      }
    />
  );
}

export default function Inventory() {
  const params = useParams();
  const { resources } = useAuth();
  const { toast } = useUI();
  const [active, setActive] = useState(params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'items');

  useEffect(() => {
    setActive(params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'items');
  }, [params.tab]);

  const pageRef = useRef<ResourcePageHandle>(null);
  const [itemDetail, setItemDetail] = useState<number | null>(null);
  const [movementItem, setMovementItem] = useState<Row | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementDetail, setMovementDetail] = useState<Row | null>(null);

  const itemsWritable = Boolean(resources.items && resources.items.canWrite && !resources.items.readOnly);
  const canMove = itemsWritable;

  const openMovement = (item: Row | null | undefined) => {
    if (!item) {
      toast('Select an item to record a stock movement.', 'warn');
      return;
    }
    setMovementItem(item);
    setMovementOpen(true);
  };

  return (
    <>
      <PageHeader
        eyebrow="Inventory control"
        title="Inventory"
        subtitle="Materials, spare parts, finished goods, and storage locations across the MEPZ II plants."
        actions={
          <Link className="btn" to="/reports/low-stock">
            <Icon name="alert" size={14} /> Reorder report
          </Link>
        }
      />
      <Tabs items={TABS} base="inventory" />

      {active === 'items' ? (
        <ResourcePage
          key="items"
          ref={pageRef}
          resourceKey="items"
          extraFilters={[{ key: 'low', label: 'Stock health', options: [{ value: '1', label: 'Low / out of stock' }] }]}
          onRowClick={(row) => setItemDetail(row.id)}
          actions={[
            {
              label: 'Record stock movement',
              icon: 'swap',
              show: () => canMove,
              onClick: (row) => openMovement(row),
            },
          ]}
          onSaved={() => clearRefCache('items')}
        />
      ) : null}

      {active === 'movements' ? (
        <ResourcePage
          key="movements"
          resourceKey="stock-movements"
          newLabel="New movement"
          emptyTitle="No stock movements yet"
          emptyText="Record an IN movement to receive stock, or issue materials against a work order."
          onRowClick={(row) => setMovementDetail(row)}
        />
      ) : null}

      {active === 'warehouses' ? (
        <ResourcePage
          key="warehouses"
          resourceKey="warehouses"
          emptyTitle="No warehouses yet"
          emptyText="Add a storage location for each plant."
        />
      ) : null}

      {active === 'plants' ? (
        <ResourcePage
          key="plants"
          resourceKey="plants"
          emptyTitle="No plants registered"
          emptyText="Add the manufacturing sites operated by the company."
        />
      ) : null}

      {itemDetail ? (
        <ItemDetail
          itemId={itemDetail}
          resourceRef={pageRef}
          onClose={() => setItemDetail(null)}
          onChanged={() => pageRef.current?.refresh()}
        />
      ) : null}

      {movementOpen && movementItem ? (
        <MovementModal
          item={movementItem}
          onClose={() => {
            setMovementOpen(false);
            setMovementItem(null);
          }}
          onDone={async () => {
            pageRef.current?.refresh();
          }}
        />
      ) : null}

      {movementDetail ? <StockMovementDetail row={movementDetail} onClose={() => setMovementDetail(null)} /> : null}
    </>
  );
}
