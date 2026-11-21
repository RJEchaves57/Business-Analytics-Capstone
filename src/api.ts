import type { Request, Response } from 'express';
import { db, nextNumber, type Row } from './db';
import { resources, publicResources, ENUMS, type FieldDef, type ResourceConfig } from './resources';
import {
  AppError,
  today,
  addDays,
  round2,
  isValidDate,
  isValidDateTime,
  toCsv,
  toDateTime,
  monthKey,
  monthLabel,
  parseCookies,
} from './util';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyUserSessions,
  requirePermission,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  type SessionUser,
  type AuthUserRow,
} from './auth';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function json(res: Response, status: number, data: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function csvResponse(res: Response, filename: string, csv: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(`\ufeff${csv}`);
}

function sqliteError(error: unknown, config?: ResourceConfig): unknown {
  const message = String(error && (error as Error).message ? (error as Error).message : error);
  if (message.includes('UNIQUE constraint failed')) {
    const column = (message.split(':').pop() ?? '').trim().split('.').pop() ?? '';
    const meta = config ? config.fields.find((f) => f.name === column) : null;
    return new AppError(409, `${meta ? meta.label : column} is already in use.`);
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new AppError(409, 'This record is linked to other records, so it cannot be removed or changed.');
  }
  if (message.includes('CHECK constraint failed')) {
    return new AppError(400, 'One of the values is not allowed.');
  }
  if (message.includes('NOT NULL constraint failed')) {
    const column = (message.split(':').pop() ?? '').trim().split('.').pop() ?? '';
    return new AppError(400, `${column.replace(/_/g, ' ')} is required.`);
  }
  return error;
}

function audit(
  session: SessionUser,
  action: string,
  module: string,
  entity: string,
  entityId: number | null,
  details: string
): void {
  db.prepare(
    `INSERT INTO activity_log (user_id, username, action, module, entity, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(session.userId, session.username, action, module || '', entity || '', entityId || null, details || '');
}

function getUserSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

function parseId(value: unknown, label = 'Record'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, `${label} not found.`);
  return id;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function coerce(field: FieldDef, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;

  if (field.type === 'text' || field.type === 'textarea' || field.type === 'password') {
    const value = String(raw).trim();
    if (value.length > 5000) throw new AppError(400, `${field.label} is too long.`);
    return value === '' ? null : value;
  }

  if (field.type === 'number' || field.type === 'money' || field.type === 'percent') {
    if (raw === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new AppError(400, `${field.label} must be a number.`);
    if (field.min !== undefined && value < field.min) {
      throw new AppError(400, `${field.label} must be at least ${field.min}.`);
    }
    if (field.max !== undefined && value > field.max) {
      throw new AppError(400, `${field.label} must be at most ${field.max}.`);
    }
    return field.type === 'money' ? round2(value) : value;
  }

  if (field.type === 'date') {
    if (raw === '') return null;
    if (!isValidDate(String(raw))) throw new AppError(400, `${field.label} must be a valid date (YYYY-MM-DD).`);
    return String(raw);
  }

  if (field.type === 'datetime') {
    if (raw === '') return null;
    if (!isValidDateTime(String(raw))) throw new AppError(400, `${field.label} must be a valid date/time.`);
    return String(raw).replace('T', ' ');
  }

  if (field.type === 'select') {
    if (raw === '') return null;
    const value = String(raw);
    if (field.options && !field.options.includes(value)) {
      throw new AppError(400, `${field.label} must be one of: ${field.options.join(', ')}.`);
    }
    return value;
  }

  if (field.type === 'ref') {
    if (raw === '' || raw === null || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new AppError(400, `${field.label} is not valid.`);
    return value;
  }

  if (field.type === 'bool') {
    return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on' ? 1 : 0;
  }

  return raw;
}

function validate(
  config: ResourceConfig,
  body: Row,
  { creating, existing }: { creating: boolean; existing?: Row }
): Row {
  const values: Row = {};
  for (const field of config.fields) {
    if (field.computed || field.readOnly) continue;
    if (creating && field.hideOnCreate) continue;
    if (!creating && field.hideOnEdit) continue;
    const raw = body[field.name];
    if (raw === undefined) {
      if (creating && field.required) throw new AppError(400, `${field.label} is required.`);
      continue;
    }
    const value = coerce(field, raw);
    if (field.required && (value === null || value === '')) {
      throw new AppError(400, `${field.label} is required.`);
    }
    values[field.name] = value;
  }
  if (existing) {
    // Preserve fields the client did not send.
    for (const field of config.fields) {
      if (Object.prototype.hasOwnProperty.call(values, field.name)) continue;
      if (field.computed || field.readOnly) continue;
      if (field.hideOnEdit) continue;
      if (Object.prototype.hasOwnProperty.call(existing, field.name)) values[field.name] = existing[field.name];
    }
  }
  return values;
}

/* ------------------------------------------------------------------ */
/* List / read                                                         */
/* ------------------------------------------------------------------ */

function sortableColumns(config: ResourceConfig): Set<string> {
  const cols = new Set<string>();
  for (const f of config.fields) {
    if (!f.computed && f.type !== 'password') cols.add(f.name);
    if (f.sortName) cols.add(f.sortName);
  }
  cols.add('id');
  cols.add('created_at');
  return cols;
}

interface ListResult {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

function listRows(config: ResourceConfig, query: Row): ListResult {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const q = String(query.q || '').trim();
  if (q && config.search && config.search.length) {
    const parts = config.search.map((col) => `${col} LIKE ?`);
    conditions.push(`(${parts.join(' OR ')})`);
    for (let i = 0; i < config.search.length; i += 1) params.push(`%${q}%`);
  }

  for (const field of config.fields) {
    if (!field.filter) continue;
    const raw = query[field.name];
    if (raw === undefined || raw === '' || raw === null || raw === 'all') continue;
    let value = raw;
    if (field.type === 'bool') value = raw === '1' || raw === 'true' ? 1 : 0;
    if (field.type === 'ref' || field.type === 'number') value = Number(raw);
    conditions.push(`t.${field.name} = ?`);
    params.push(value);
  }

  if (config.extraWhere) {
    const extra = config.extraWhere(query);
    for (const clause of extra.sql) conditions.push(clause);
    for (const value of extra.params) params.push(value);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${config.sql}${where})`).get(...params).n;

  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = (page - 1) * limit;

  let sort = String(query.sort || '');
  if (!sort) sort = config.defaultSort || 't.id';
  sort = sort.replace(/^(t\.)+/, '');
  if (!sortableColumns(config).has(sort)) sort = (config.defaultSort || 't.id').replace(/^t\./, '');
  const dir = String(query.dir || config.defaultDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const orderBy = `t.${sort} ${dir}`;

  const rows = db
    .prepare(`${config.sql}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map((row) => (config.decorate ? config.decorate({ ...row }) : { ...row }));

  return { rows, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) };
}

function getRow(config: ResourceConfig, id: number): Row {
  const row = db.prepare(`${config.sql} WHERE t.id = ?`).get(id);
  if (!row) throw new AppError(404, `${config.singular} not found.`);
  return config.decorate ? config.decorate({ ...row }) : { ...row };
}

function listColumns(config: ResourceConfig): Array<{ key: string; label: string }> {
  return config.fields
    .filter((f) => f.list && f.type !== 'password')
    .map((f) => ({ key: f.name, label: f.label }));
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

function applyMovement(movement: Row): void {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(movement.item_id);
  if (!item) throw new AppError(400, 'Inventory item not found.');
  const delta = movement.type === 'IN' ? Number(movement.quantity) : -Number(movement.quantity);
  const nextQty = round2(Number(item.quantity) + delta);
  const nextCost = movement.type === 'IN' && movement.unit_cost !== null && movement.unit_cost !== undefined
    ? Number(movement.unit_cost)
    : Number(item.unit_cost);
  db.prepare("UPDATE items SET quantity = ?, unit_cost = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(nextQty, nextCost, item.id);
  db.prepare('UPDATE stock_movements SET resulting_qty = ? WHERE id = ?').run(nextQty, movement.id);
}

function computeNextDue(values: Row, existing: Row | null): void {
  const interval = Number(values.interval_days !== undefined ? values.interval_days : existing && existing.interval_days) || 30;
  const lastDone = values.last_done !== undefined ? values.last_done : existing && existing.last_done;
  const explicit = values.next_due !== undefined ? values.next_due : existing && existing.next_due;
  const explicitChanged = values.next_due !== undefined;
  if (!explicitChanged || !explicit) {
    if (lastDone) values.next_due = addDays(lastDone, interval);
    else values.next_due = addDays(today(), interval);
  }
}

interface HookSet {
  beforeCreate?: (values: Row, session: SessionUser) => void;
  afterCreate?: (row: Row, session: SessionUser) => void;
  beforeUpdate?: (values: Row, existing: Row, session: SessionUser) => void;
  afterUpdate?: (row: Row, values: Row, existing: Row, session: SessionUser) => void;
}

const HOOKS: Record<string, HookSet> = {
  items: {
    beforeCreate(values) {
      values.updated_at = toDateTime(new Date());
      if (values.quantity === undefined) values.quantity = 0;
    },
    afterCreate(row, session) {
      if (Number(row.quantity) > 0) {
        const result = db.prepare(
          `INSERT INTO stock_movements (item_id, type, quantity, unit_cost, reference, notes, resulting_qty, created_by)
           VALUES (?, 'IN', ?, ?, 'Opening Balance', 'Initial stock on item creation', ?, ?)`
        ).run(row.id, row.quantity, row.unit_cost, row.quantity, session.username);
        db.prepare('UPDATE stock_movements SET resulting_qty = ? WHERE id = ?').run(row.quantity, result.lastInsertRowid);
      }
    },
    beforeUpdate(values) {
      delete values.quantity;
      values.updated_at = toDateTime(new Date());
    },
  },

  'stock-movements': {
    beforeCreate(values, session) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(values.item_id);
      if (!item) throw new AppError(400, 'Select a valid inventory item.');
      if (values.type === 'OUT' && Number(values.quantity) > Number(item.quantity)) {
        throw new AppError(400, `Insufficient stock. ${item.sku} only has ${item.quantity} ${item.unit} on hand.`);
      }
      values.created_by = session.username;
      values.created_at = toDateTime(new Date());
      if (values.unit_cost === undefined || values.unit_cost === null) values.unit_cost = item.unit_cost;
    },
    afterCreate(row) {
      applyMovement(row);
    },
  },

  'maintenance-schedules': {
    beforeCreate(values) {
      computeNextDue(values, null);
      if (!values.next_due) values.next_due = addDays(today(), Number(values.interval_days) || 30);
    },
    beforeUpdate(values, existing) {
      computeNextDue(values, existing);
    },
  },

  'maintenance-orders': {
    beforeCreate(values, session) {
      if (!values.wo_number) values.wo_number = nextNumber('maintenance_orders', 'wo_number', 'WO');
      values.created_at = toDateTime(new Date());
      values.updated_at = values.created_at;
      if (!values.status) values.status = 'Open';
      if (!values.reported_by) values.reported_by = session.fullName;
    },
    beforeUpdate(values) {
      values.updated_at = toDateTime(new Date());
      if (values.status === 'Completed' && !values.completed_at) values.completed_at = today();
    },
    afterUpdate(row, values, existing) {
      if (row.status === 'Completed' && existing.status !== 'Completed') {
        if (row.schedule_id) {
          const schedule = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(row.schedule_id);
          if (schedule) {
            const done = row.completed_at || today();
            db.prepare('UPDATE maintenance_schedules SET last_done = ?, next_due = ? WHERE id = ?')
              .run(done, addDays(done, Number(schedule.interval_days) || 30), schedule.id);
          }
        }
        db.prepare("UPDATE machines SET status = 'Running' WHERE id = ? AND status IN ('Under Maintenance','Breakdown')")
          .run(row.machine_id);
      }
    },
  },

  'production-orders': {
    beforeCreate(values) {
      if (!values.order_no) values.order_no = nextNumber('production_orders', 'order_no', 'PRD');
      values.created_at = toDateTime(new Date());
      values.updated_at = values.created_at;
    },
    beforeUpdate(values) {
      values.updated_at = toDateTime(new Date());
      if (values.status === 'Completed' && !values.completed_at) values.completed_at = today();
    },
  },

  'purchase-orders': {
    beforeCreate(values, session) {
      if (!values.po_number) values.po_number = nextNumber('purchase_orders', 'po_number', 'PO');
      if (!values.order_date) values.order_date = today();
      if (!values.status) values.status = 'Draft';
      values.created_by = session.username;
      values.created_at = toDateTime(new Date());
      values.total_amount = 0;
    },
    beforeUpdate(values, existing) {
      if (['Received', 'Partially Received'].includes(values.status) && existing.status !== values.status) {
        throw new AppError(400, 'Use the Receive action to receive a purchase order into stock.');
      }
      delete values.total_amount;
    },
  },
};

/* ------------------------------------------------------------------ */
/* Create / update / delete                                            */
/* ------------------------------------------------------------------ */

function createRow(config: ResourceConfig, body: Row, session: SessionUser): Row {
  requirePermission(session, config.module, 'write');
  if (config.readOnly) throw new AppError(403, 'This module is read-only.');
  const values = validate(config, body, { creating: true });
  const key = configKey(config);
  const hook = key ? HOOKS[key] : undefined;
  if (hook && hook.beforeCreate) hook.beforeCreate(values, session);

  const cols = Object.keys(values).filter((k) => values[k] !== undefined);
  let result;
  try {
    if (!cols.length) {
      result = db.prepare(`INSERT INTO ${config.table} DEFAULT VALUES`).run();
    } else {
      const placeholders = cols.map(() => '?').join(', ');
      result = db.prepare(`INSERT INTO ${config.table} (${cols.join(', ')}) VALUES (${placeholders})`)
        .run(...cols.map((c) => values[c]));
    }
  } catch (error) {
    throw sqliteError(error, config);
  }
  const id = Number(result.lastInsertRowid);
  const row = getRow(config, id);
  if (hook && hook.afterCreate) hook.afterCreate({ ...row }, session);
  audit(session, 'Created', config.module, config.singular, id, `${config.singular} ${row.sku || row.name || row.wo_number || row.po_number || row.order_no || id} added`);
  return getRow(config, id);
}

function configKey(config: ResourceConfig): string | undefined {
  return Object.keys(resources).find((k) => resources[k] === config);
}

function updateRow(config: ResourceConfig, id: number, body: Row, session: SessionUser): Row {
  requirePermission(session, config.module, 'write');
  if (config.readOnly) throw new AppError(403, 'This module is read-only.');
  const existing = getRow(config, id);
  const values = validate(config, body, { creating: false, existing });
  const key = configKey(config);
  const hook = key ? HOOKS[key] : undefined;
  if (hook && hook.beforeUpdate) hook.beforeUpdate(values, existing, session);

  const hasUpdatedAt = Object.prototype.hasOwnProperty.call(existing, 'updated_at');
  if (hasUpdatedAt && values.updated_at === undefined) values.updated_at = toDateTime(new Date());

  const cols = Object.keys(values).filter((k) => values[k] !== undefined);
  if (cols.length) {
    try {
      db.prepare(`UPDATE ${config.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => values[c]), id);
    } catch (error) {
      throw sqliteError(error, config);
    }
  }
  const row = getRow(config, id);
  if (hook && hook.afterUpdate) hook.afterUpdate({ ...row }, values, existing, session);
  audit(session, 'Updated', config.module, config.singular, id, `${config.singular} ${row.sku || row.name || row.wo_number || row.po_number || row.order_no || id} updated`);
  return getRow(config, id);
}

function deleteRow(config: ResourceConfig, id: number, session: SessionUser): { ok: boolean } {
  requirePermission(session, config.module, 'delete');
  if (config.readOnly) throw new AppError(403, 'This module is read-only.');
  const row = getRow(config, id);
  try {
    db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(id);
  } catch (error) {
    throw sqliteError(error, config);
  }
  audit(session, 'Deleted', config.module, config.singular, id, `${config.singular} ${row.sku || row.name || row.wo_number || row.po_number || row.order_no || id} deleted`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Purchase orders                                                     */
/* ------------------------------------------------------------------ */

function getPO(id: number): Row {
  const po = db.prepare(`${resources['purchase-orders'].sql} WHERE t.id = ?`).get(id);
  if (!po) throw new AppError(404, 'Purchase order not found.');
  return po;
}

function recalcPO(id: number): number {
  const total = db.prepare('SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM purchase_order_items WHERE purchase_order_id = ?').get(id).total;
  db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(round2(total), id);
  return round2(total);
}

function poLines(id: number): Row[] {
  return db.prepare(
    `SELECT l.*, i.sku, i.name AS item_name, i.unit, (l.quantity - l.received_qty) AS remaining
     FROM purchase_order_items l JOIN items i ON i.id = l.item_id
     WHERE l.purchase_order_id = ? ORDER BY l.id`
  ).all(id);
}

function receivePurchaseOrder(id: number, session: SessionUser): Row {
  requirePermission(session, 'purchasing', 'write');
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw new AppError(404, 'Purchase order not found.');
  if (po.status === 'Received') throw new AppError(400, 'This purchase order has already been received.');
  if (po.status === 'Cancelled') throw new AppError(400, 'Cancelled purchase orders cannot be received.');
  const lines = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(id);
  if (!lines.length) throw new AppError(400, 'Add at least one line item before receiving this order.');

  db.exec('BEGIN');
  try {
    for (const line of lines) {
      const remaining = round2(Number(line.quantity) - Number(line.received_qty));
      if (remaining <= 0) continue;
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(line.item_id);
      if (!item) throw new AppError(400, 'An item on this order no longer exists.');
      const nextQty = round2(Number(item.quantity) + remaining);
      const cost = Number(line.unit_cost) > 0 ? Number(line.unit_cost) : Number(item.unit_cost);
      db.prepare("UPDATE items SET quantity = ?, unit_cost = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(nextQty, cost, item.id);
      const movement = db.prepare(
        `INSERT INTO stock_movements (item_id, type, quantity, unit_cost, reference, notes, resulting_qty, created_by)
         VALUES (?, 'IN', ?, ?, ?, 'Received against purchase order', ?, ?)`
      ).run(item.id, remaining, cost, po.po_number, nextQty, session.username);
      db.prepare('UPDATE purchase_order_items SET received_qty = quantity WHERE id = ?').run(line.id);
      void movement;
    }
    db.prepare("UPDATE purchase_orders SET status = 'Received', received_date = ?, total_amount = ? WHERE id = ?")
      .run(today(), recalcPO(id), id);
    audit(session, 'Received', 'purchasing', 'Purchase Order', id, `Stock received for ${po.po_number}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getPO(id);
}

function addPoLine(id: number, body: Row, session: SessionUser): { id: number } {
  requirePermission(session, 'purchasing', 'write');
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw new AppError(404, 'Purchase order not found.');
  if (po.status === 'Received' || po.status === 'Cancelled') {
    throw new AppError(400, 'Lines cannot be changed on a received or cancelled order.');
  }
  const itemId = Number(body.item_id);
  const quantity = Number(body.quantity);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) throw new AppError(400, 'Select a valid item.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError(400, 'Quantity must be greater than zero.');
  const unitCost = body.unit_cost === '' || body.unit_cost === undefined || body.unit_cost === null
    ? Number(item.unit_cost)
    : Number(body.unit_cost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new AppError(400, 'Unit cost is not valid.');
  const result = db.prepare(
    'INSERT INTO purchase_order_items (purchase_order_id, item_id, quantity, unit_cost) VALUES (?, ?, ?, ?)'
  ).run(id, itemId, quantity, round2(unitCost));
  recalcPO(id);
  audit(session, 'Updated', 'purchasing', 'Purchase Order', id, `Line added to ${po.po_number}`);
  return { id: Number(result.lastInsertRowid) };
}

function removePoLine(id: number, lineId: number, session: SessionUser): { ok: boolean } {
  requirePermission(session, 'purchasing', 'write');
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw new AppError(404, 'Purchase order not found.');
  if (po.status === 'Received') throw new AppError(400, 'Received orders cannot be edited.');
  db.prepare('DELETE FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?').run(lineId, id);
  recalcPO(id);
  audit(session, 'Updated', 'purchasing', 'Purchase Order', id, `Line removed from ${po.po_number}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Maintenance parts and completion                                    */
/* ------------------------------------------------------------------ */

function woParts(id: number): Row[] {
  return db.prepare(
    `SELECT p.*, i.sku, i.name AS item_name, i.unit
     FROM maintenance_parts p JOIN items i ON i.id = p.item_id
     WHERE p.maintenance_order_id = ? ORDER BY p.id`
  ).all(id);
}

function recalcWOParts(id: number): number {
  const total = db.prepare('SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM maintenance_parts WHERE maintenance_order_id = ?').get(id).total;
  db.prepare('UPDATE maintenance_orders SET parts_cost = ? WHERE id = ?').run(round2(total), id);
  return round2(total);
}

function addWOPart(id: number, body: Row, session: SessionUser): { ok: boolean } {
  requirePermission(session, 'maintenance', 'write');
  const wo = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(id);
  if (!wo) throw new AppError(404, 'Work order not found.');
  const itemId = Number(body.item_id);
  const quantity = Number(body.quantity);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) throw new AppError(400, 'Select a valid spare part.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new AppError(400, 'Quantity must be greater than zero.');
  if (quantity > Number(item.quantity)) {
    throw new AppError(400, `Insufficient stock. ${item.sku} only has ${item.quantity} ${item.unit} on hand.`);
  }
  const unitCost = body.unit_cost === '' || body.unit_cost === undefined || body.unit_cost === null
    ? Number(item.unit_cost)
    : Number(body.unit_cost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new AppError(400, 'Unit cost is not valid.');

  db.exec('BEGIN');
  try {
    const nextQty = round2(Number(item.quantity) - quantity);
    db.prepare("UPDATE items SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(nextQty, item.id);
    db.prepare(
      `INSERT INTO stock_movements (item_id, type, quantity, unit_cost, reference, notes, resulting_qty, created_by)
       VALUES (?, 'OUT', ?, ?, ?, 'Spare part issued to work order', ?, ?)`
    ).run(item.id, quantity, unitCost, wo.wo_number, nextQty, session.username);
    db.prepare('INSERT INTO maintenance_parts (maintenance_order_id, item_id, quantity, unit_cost) VALUES (?, ?, ?, ?)')
      .run(id, item.id, quantity, round2(unitCost));
    recalcWOParts(id);
    audit(session, 'Updated', 'maintenance', 'Work Order', id, `Part ${item.sku} issued to ${wo.wo_number}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true };
}

function removeWOPart(id: number, partId: number, session: SessionUser): { ok: boolean } {
  requirePermission(session, 'maintenance', 'write');
  const wo = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(id);
  if (!wo) throw new AppError(404, 'Work order not found.');
  const part = db.prepare('SELECT * FROM maintenance_parts WHERE id = ? AND maintenance_order_id = ?').get(partId, id);
  if (!part) throw new AppError(404, 'Part entry not found.');
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(part.item_id);

  db.exec('BEGIN');
  try {
    if (item) {
      const nextQty = round2(Number(item.quantity) + Number(part.quantity));
      db.prepare("UPDATE items SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(nextQty, item.id);
      db.prepare(
        `INSERT INTO stock_movements (item_id, type, quantity, unit_cost, reference, notes, resulting_qty, created_by)
         VALUES (?, 'IN', ?, ?, ?, 'Part returned from work order', ?, ?)`
      ).run(item.id, part.quantity, part.unit_cost, wo.wo_number, nextQty, session.username);
    }
    db.prepare('DELETE FROM maintenance_parts WHERE id = ?').run(partId);
    recalcWOParts(id);
    audit(session, 'Updated', 'maintenance', 'Work Order', id, `Part returned from ${wo.wo_number}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true };
}

function completeWorkOrder(id: number, body: Row, session: SessionUser): Row {
  requirePermission(session, 'maintenance', 'write');
  const wo = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(id);
  if (!wo) throw new AppError(404, 'Work order not found.');
  if (wo.status === 'Completed') throw new AppError(400, 'This work order is already completed.');
  const completedAt = body.completed_at && isValidDate(body.completed_at) ? body.completed_at : today();
  const downtime = body.downtime_hours !== undefined ? Number(body.downtime_hours) : Number(wo.downtime_hours);
  const labor = body.labor_cost !== undefined ? Number(body.labor_cost) : Number(wo.labor_cost);
  if (!Number.isFinite(downtime) || downtime < 0) throw new AppError(400, 'Downtime must be zero or more.');
  if (!Number.isFinite(labor) || labor < 0) throw new AppError(400, 'Labor cost must be zero or more.');

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE maintenance_orders
       SET status = 'Completed', completed_at = ?, downtime_hours = ?, labor_cost = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(completedAt, downtime, round2(labor), id);
    if (wo.schedule_id) {
      const schedule = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(wo.schedule_id);
      if (schedule) {
        db.prepare('UPDATE maintenance_schedules SET last_done = ?, next_due = ? WHERE id = ?')
          .run(completedAt, addDays(completedAt, Number(schedule.interval_days) || 30), schedule.id);
      }
    }
    db.prepare("UPDATE machines SET status = 'Running' WHERE id = ? AND status IN ('Under Maintenance','Breakdown')")
      .run(wo.machine_id);
    audit(session, 'Completed', 'maintenance', 'Work Order', id, `${wo.wo_number} completed`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getRow(resources['maintenance-orders'], id);
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Decision support                                                    */
/* ------------------------------------------------------------------ */

type ActionPriority = 'Critical' | 'High' | 'Normal';

interface ActionItem {
  id: string;
  category: 'Inventory' | 'Maintenance' | 'Production' | 'Purchasing';
  priority: ActionPriority;
  title: string;
  detail: string;
  action: string;
  metric: string;
  due_date: string | null;
  link: string;
}

interface ActionPlan {
  generated_at: string;
  summary: { total: number; critical: number; high: number; normal: number };
  actions: ActionItem[];
}

const PRIORITY_RANK: Record<ActionPriority, number> = { Critical: 0, High: 1, Normal: 2 };

function qtyLabel(value: unknown): string {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function usageByItem(days = 90): Map<number, number> {
  const rows = db.prepare(
    `SELECT item_id, COALESCE(SUM(quantity), 0) AS used
     FROM stock_movements
     WHERE type = 'OUT' AND created_at >= datetime('now','localtime', ?)
     GROUP BY item_id`
  ).all(`-${days} day`);
  const map = new Map<number, number>();
  for (const row of rows) map.set(Number(row.item_id), Number(row.used) || 0);
  return map;
}

function leadTimeBySupplier(): Map<number, number> {
  const rows = db.prepare(
    `SELECT supplier_id, AVG(julianday(received_date) - julianday(order_date)) AS days
     FROM purchase_orders
     WHERE status = 'Received'
       AND order_date IS NOT NULL
       AND received_date IS NOT NULL
       AND received_date >= order_date
     GROUP BY supplier_id`
  ).all();
  const map = new Map<number, number>();
  for (const row of rows) {
    const value = Math.round(Number(row.days));
    if (Number.isFinite(value)) map.set(Number(row.supplier_id), Math.min(Math.max(value, 3), 60));
  }
  return map;
}

/**
 * Builds the prescriptive layer of the system: a single prioritized action list
 * that combines inventory, maintenance, production, and purchasing signals.
 * Every rule is deliberately simple and auditable for internal use.
 */
function buildRecommendations(): ActionPlan {
  const actions: ActionItem[] = [];
  const usage = usageByItem(90);
  const leadTimes = leadTimeBySupplier();

  /* Inventory: reorder quantity based on recent usage, lead time, and a 7-day buffer. */
  const lowItems = db.prepare(
    `SELECT i.id, i.sku, i.name, i.unit, i.quantity, i.reorder_point, i.unit_cost, i.supplier_id,
            s.name AS supplier_name
     FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.active = 1 AND i.quantity <= i.reorder_point`
  ).all();
  for (const item of lowItems) {
    const avgDaily = round2((usage.get(Number(item.id)) || 0) / 90);
    const leadTime = leadTimes.get(Number(item.supplier_id)) || 14;
    const coverage = round2(avgDaily * (leadTime + 7));
    const target = Math.max(round2(Number(item.reorder_point) * 2), coverage);
    const recommended = round2(Math.max(target - Number(item.quantity), 0));
    if (recommended <= 0) continue;

    const daysCover = avgDaily > 0 ? round2(Number(item.quantity) / avgDaily) : null;
    const priority: ActionPriority =
      Number(item.quantity) <= 0 || (daysCover !== null && daysCover <= 7)
        ? 'Critical'
        : Number(item.quantity) < Number(item.reorder_point) || (daysCover !== null && daysCover <= leadTime + 7)
          ? 'High'
          : 'Normal';

    actions.push({
      id: `inventory-${item.id}`,
      category: 'Inventory',
      priority,
      title: `Reorder ${item.name}`,
      detail: `${item.sku} · ${qtyLabel(item.quantity)} ${item.unit} on hand against a reorder point of ${qtyLabel(item.reorder_point)} ${item.unit}${
        daysCover !== null ? ` · ${qtyLabel(daysCover)} days of cover` : ' · no recent usage recorded'
      }.`,
      action: `Order ${qtyLabel(recommended)} ${item.unit} from ${item.supplier_name || 'an approved supplier'}; expected lead time ${leadTime} days.`,
      metric: `${qtyLabel(recommended)} ${item.unit}`,
      due_date: daysCover !== null ? addDays(today(), Math.floor(daysCover)) : null,
      link: '/inventory/items',
    });
  }

  /* Maintenance: risk score from overdue days, machine status, and open work orders. */
  const schedules = db.prepare(
    `SELECT ms.id, ms.title, ms.next_due, ms.maintenance_type, ms.assigned_to,
            m.name AS machine_name, m.asset_code, m.status AS machine_status,
            CAST(julianday(ms.next_due) - julianday(date('now','localtime')) AS INTEGER) AS days_left,
            COALESCE(wo.open_orders, 0) AS open_orders
     FROM maintenance_schedules ms
     JOIN machines m ON m.id = ms.machine_id
     LEFT JOIN (
       SELECT machine_id, COUNT(*) AS open_orders
       FROM maintenance_orders
       WHERE status IN ('Open','In Progress','On Hold')
       GROUP BY machine_id
     ) wo ON wo.machine_id = m.id
     WHERE ms.active = 1 AND ms.next_due IS NOT NULL
       AND ms.next_due <= date('now','localtime','+30 day')
     ORDER BY ms.next_due`
  ).all();
  for (const schedule of schedules) {
    const daysLeft = Number(schedule.days_left);
    if (!Number.isFinite(daysLeft)) continue;

    const machineStatus = String(schedule.machine_status || '');
    const openOrders = Number(schedule.open_orders) || 0;
    let risk = 0;
    if (daysLeft < 0) risk += Math.min(50, Math.abs(daysLeft) * 3);
    else if (daysLeft <= 7) risk += 25;
    else if (daysLeft <= 14) risk += 15;
    else if (daysLeft <= 30) risk += 5;
    if (machineStatus === 'Breakdown') risk += 40;
    else if (machineStatus === 'Under Maintenance') risk += 20;
    else if (machineStatus === 'Idle') risk += 5;
    risk += Math.min(20, openOrders * 5);
    risk = Math.min(100, Math.round(risk));

    const priority: ActionPriority = risk >= 60 ? 'Critical' : risk >= 30 ? 'High' : 'Normal';
    if (priority === 'Normal' && daysLeft > 14) continue;

    actions.push({
      id: `maintenance-${schedule.id}`,
      category: 'Maintenance',
      priority,
      title: schedule.title,
      detail: `${schedule.asset_code} · ${schedule.machine_name} · ${schedule.maintenance_type} · ${
        daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `due in ${daysLeft} days`
      }${openOrders ? ` · ${openOrders} open work order${openOrders === 1 ? '' : 's'}` : ''}.`,
      action:
        daysLeft < 0
          ? `Raise a work order and service immediately — ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} overdue.`
          : daysLeft <= 7
            ? 'Schedule the work order this week.'
            : 'Add the job to this month’s maintenance plan.',
      metric: `Risk ${risk}/100`,
      due_date: schedule.next_due,
      link: '/maintenance/schedules',
    });
  }

  /* Production: compare required daily output with the current run rate. */
  const production = db.prepare(
    `SELECT po.id, po.order_no, po.product_name, po.target_qty, po.completed_qty, po.unit,
            po.status, po.start_date, po.due_date,
            CAST(julianday(po.due_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left,
            CAST(julianday(date('now','localtime')) - julianday(COALESCE(po.start_date, po.created_at)) AS INTEGER) AS elapsed_days
     FROM production_orders po
     WHERE po.status IN ('In Progress','On Hold') AND po.due_date IS NOT NULL`
  ).all();
  for (const order of production) {
    const daysLeft = Number(order.days_left);
    if (!Number.isFinite(daysLeft)) continue;
    const remaining = Math.max(round2(Number(order.target_qty) - Number(order.completed_qty)), 0);
    if (remaining <= 0) continue;

    const elapsed = Math.max(Number(order.elapsed_days) || 1, 1);
    const currentRate = round2(Number(order.completed_qty) / elapsed);
    const requiredRate = round2(remaining / (daysLeft > 0 ? daysLeft : 1));
    const behind = daysLeft < 0 || currentRate <= 0 || requiredRate > currentRate * 1.15;
    if (!behind) continue;

    const priority: ActionPriority =
      daysLeft < 0 || daysLeft <= 7 ? 'Critical' : daysLeft <= 14 ? 'High' : 'Normal';

    actions.push({
      id: `production-${order.id}`,
      category: 'Production',
      priority,
      title: `Delivery risk · ${order.order_no}`,
      detail: `${order.product_name} · ${qtyLabel(remaining)} ${order.unit} remaining · ${
        daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`
      } · current pace ${qtyLabel(currentRate)} ${order.unit}/day.`,
      action:
        daysLeft < 0
          ? `Recover the schedule: complete the remaining ${qtyLabel(remaining)} ${order.unit} and confirm a new delivery date.`
          : `Increase output to ${qtyLabel(requiredRate)} ${order.unit}/day from ${qtyLabel(currentRate)} ${order.unit}/day to meet the due date.`,
      metric: `${qtyLabel(requiredRate)} ${order.unit}/day`,
      due_date: order.due_date,
      link: '/production',
    });
  }

  /* Purchasing: open orders that have passed their expected delivery date. */
  const purchaseOrders = db.prepare(
    `SELECT po.id, po.po_number, po.status, po.expected_date, s.name AS supplier_name,
            CAST(julianday(date('now','localtime')) - julianday(po.expected_date) AS INTEGER) AS days_late
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.status IN ('Draft','Ordered','Partially Received')
       AND po.expected_date IS NOT NULL
       AND po.expected_date < date('now','localtime')`
  ).all();
  for (const po of purchaseOrders) {
    const daysLate = Number(po.days_late);
    if (!Number.isFinite(daysLate) || daysLate <= 0) continue;
    const priority: ActionPriority = daysLate >= 14 ? 'Critical' : daysLate >= 3 ? 'High' : 'Normal';

    actions.push({
      id: `purchasing-${po.id}`,
      category: 'Purchasing',
      priority,
      title: `Late delivery · ${po.po_number}`,
      detail: `${po.supplier_name} · status ${po.status} · expected ${po.expected_date}.`,
      action:
        'Follow up with the supplier, confirm a revised delivery date, and expedite if the material is needed for production.',
      metric: `${daysLate} day${daysLate === 1 ? '' : 's'} late`,
      due_date: po.expected_date,
      link: '/purchasing/purchase-orders',
    });
  }

  actions.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31'));
  });

  return {
    generated_at: today(),
    summary: {
      total: actions.length,
      critical: actions.filter((item) => item.priority === 'Critical').length,
      high: actions.filter((item) => item.priority === 'High').length,
      normal: actions.filter((item) => item.priority === 'Normal').length,
    },
    actions,
  };
}

function dashboard(): Row {
  const one = (sql: string, ...params: unknown[]): Row => db.prepare(sql).get(...params);
  const month = monthKey(today());

  const inventoryValue = Number(one('SELECT COALESCE(SUM(quantity * unit_cost), 0) AS v FROM items WHERE active = 1').v);
  const skuCount = Number(one('SELECT COUNT(*) AS v FROM items WHERE active = 1').v);
  const lowStock = Number(one('SELECT COUNT(*) AS v FROM items WHERE active = 1 AND quantity <= reorder_point').v);
  const outOfStock = Number(one('SELECT COUNT(*) AS v FROM items WHERE active = 1 AND quantity <= 0').v);
  const machineTotal = Number(one("SELECT COUNT(*) AS v FROM machines WHERE status != 'Retired'").v);
  const machinesDown = Number(one("SELECT COUNT(*) AS v FROM machines WHERE status IN ('Breakdown','Under Maintenance')").v);
  const overdueMaintenance = Number(one("SELECT COUNT(*) AS v FROM maintenance_schedules WHERE active = 1 AND next_due < date('now','localtime')").v);
  const openWorkOrders = Number(one("SELECT COUNT(*) AS v FROM maintenance_orders WHERE status IN ('Open','In Progress','On Hold')").v);
  const openPOs = Number(one("SELECT COUNT(*) AS v FROM purchase_orders WHERE status IN ('Draft','Ordered','Partially Received')").v);

  const production = one(
    `SELECT COALESCE(SUM(completed_qty), 0) AS completed, COALESCE(SUM(scrap_qty), 0) AS scrap
     FROM production_orders
     WHERE substr(COALESCE(start_date, due_date, created_at), 1, 7) = ?`,
    month
  );
  const productionMonth = Number(production.completed);
  const scrapMonth = Number(production.scrap);
  const scrapRate = productionMonth + scrapMonth > 0 ? round2((scrapMonth / (productionMonth + scrapMonth)) * 100) : 0;

  const downtimeMonth = Number(one(
    `SELECT COALESCE(SUM(downtime_hours), 0) AS v FROM maintenance_orders
     WHERE substr(COALESCE(completed_at, updated_at, created_at), 1, 7) = ?`,
    month
  ).v);

  const trendMap = new Map<string, Row>();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trendMap.set(key, { month: key, label: monthLabel(key), target: 0, completed: 0, scrap: 0, orders: 0 });
  }
  const trendRows = db.prepare(
    `SELECT substr(COALESCE(start_date, due_date, created_at), 1, 7) AS m,
            COUNT(*) AS orders, SUM(target_qty) AS target, SUM(completed_qty) AS completed, SUM(scrap_qty) AS scrap
     FROM production_orders
     WHERE COALESCE(start_date, due_date, created_at) >= date('now','localtime','-6 months')
     GROUP BY m`
  ).all();
  for (const row of trendRows) {
    const current = trendMap.get(row.m);
    if (current) trendMap.set(row.m, { ...current, ...row, label: monthLabel(row.m) });
  }

  const inventoryByCategory = db.prepare(
    `SELECT category AS label, COUNT(*) AS items, ROUND(SUM(quantity * unit_cost), 2) AS value
     FROM items WHERE active = 1 GROUP BY category ORDER BY value DESC`
  ).all();

  const machinesByStatus = db.prepare(
    "SELECT status AS label, COUNT(*) AS value FROM machines WHERE status != 'Retired' GROUP BY status ORDER BY value DESC"
  ).all();

  const workOrdersByStatus = db.prepare(
    'SELECT status AS label, COUNT(*) AS value FROM maintenance_orders GROUP BY status'
  ).all();

  const lowStockList = db.prepare(
    `SELECT id, sku, name, category, unit, quantity, reorder_point, unit_cost,
            ROUND(reorder_point - quantity, 2) AS shortage
     FROM items WHERE active = 1 AND quantity <= reorder_point
     ORDER BY CASE WHEN quantity <= 0 THEN 0 ELSE 1 END, (quantity + 0.0001) / (reorder_point + 0.0001)
     LIMIT 8`
  ).all();

  const upcomingMaintenance = db.prepare(
    `SELECT ms.id, ms.title, ms.next_due, ms.maintenance_type, ms.assigned_to,
            m.name AS machine_name, m.asset_code,
            CAST(julianday(ms.next_due) - julianday(date('now','localtime')) AS INTEGER) AS days_left
     FROM maintenance_schedules ms JOIN machines m ON m.id = ms.machine_id
     WHERE ms.active = 1 AND ms.next_due <= date('now','localtime','+30 day')
     ORDER BY ms.next_due LIMIT 8`
  ).all().map((row) => ({ ...row, due_status: row.days_left < 0 ? 'Overdue' : row.days_left <= 7 ? 'Due Soon' : 'Scheduled' }));

  const recentActivity = db.prepare(
    'SELECT id, username, action, module, details, created_at FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 8'
  ).all();

  const recentMovements = db.prepare(
    `SELECT sm.id, sm.created_at, sm.type, sm.quantity, sm.reference, i.sku, i.name, i.unit
     FROM stock_movements sm JOIN items i ON i.id = sm.item_id
     ORDER BY sm.created_at DESC, sm.id DESC LIMIT 8`
  ).all();

  const attention = lowStock + overdueMaintenance + machinesDown;
  const actionPlan = buildRecommendations();

  return {
    month,
    kpis: {
      inventoryValue,
      skuCount,
      lowStock,
      outOfStock,
      machineTotal,
      machinesDown,
      overdueMaintenance,
      openWorkOrders,
      openPOs,
      productionMonth,
      scrapRate,
      downtimeMonth,
      attention,
    },
    productionTrend: Array.from(trendMap.values()),
    inventoryByCategory,
    machinesByStatus,
    workOrdersByStatus,
    lowStockList,
    upcomingMaintenance,
    recentActivity,
    recentMovements,
    actions: actionPlan.actions,
    actionSummary: actionPlan.summary,
  };
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

function reportList(): Row[] {
  return [
    { key: 'action-plan', title: 'Operations Action Plan', description: 'Prioritized reorder, maintenance, production, and purchasing recommendations.', icon: 'shield' },
    { key: 'inventory-valuation', title: 'Inventory Valuation', description: 'Stock value by category, with low-stock exposure.', icon: 'box' },
    { key: 'low-stock', title: 'Low Stock & Reorder', description: 'Items at or below reorder point, with recommended order quantity and cost.', icon: 'alert' },
    { key: 'stock-ledger', title: 'Stock Movement Ledger', description: 'All receipts and issuances over the last 90 days.', icon: 'swap' },
    { key: 'maintenance-due', title: 'Maintenance Due', description: 'Preventive work due in the next 60 days, including overdue.', icon: 'calendar' },
    { key: 'maintenance-cost', title: 'Maintenance Cost & Downtime', description: 'Completed work orders by machine over the last 6 months.', icon: 'wrench' },
    { key: 'production-summary', title: 'Production Summary', description: 'Output, achievement, and scrap rate by month.', icon: 'factory' },
    { key: 'purchase-spend', title: 'Purchase Spend', description: 'Committed and received spend by supplier.', icon: 'cart' },
  ];
}

function buildReport(key: string): Row {
  const num = (v: unknown): number => Number(v || 0);

  if (key === 'action-plan') {
    const plan = buildRecommendations();
    return {
      title: 'Operations Action Plan',
      subtitle: `Prioritized recommendations · generated ${plan.generated_at}`,
      columns: [
        { key: 'priority', label: 'Priority' },
        { key: 'category', label: 'Area' },
        { key: 'title', label: 'Issue' },
        { key: 'detail', label: 'Context' },
        { key: 'action', label: 'Recommended Action' },
        { key: 'metric', label: 'Quantity / Measure' },
        { key: 'due_date', label: 'Target Date' },
      ],
      rows: plan.actions,
      summary: [
        { label: 'Total actions', value: plan.summary.total, type: 'number' },
        { label: 'Critical', value: plan.summary.critical, type: 'number' },
        { label: 'High', value: plan.summary.high, type: 'number' },
        { label: 'Normal', value: plan.summary.normal, type: 'number' },
      ],
    };
  }

  if (key === 'inventory-valuation') {
    const rows = db.prepare(
      `SELECT category, COUNT(*) AS items, ROUND(SUM(quantity * unit_cost), 2) AS stock_value
       FROM items WHERE active = 1 GROUP BY category ORDER BY stock_value DESC`
    ).all();
    const total = rows.reduce((sum, row) => sum + num(row.stock_value), 0);
    for (const row of rows) {
      row.share = total > 0 ? round2((num(row.stock_value) / total) * 100) : 0;
    }
    const low = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM((reorder_point - quantity) * unit_cost), 0) AS v FROM items WHERE active = 1 AND quantity <= reorder_point').get();
    return {
      title: 'Inventory Valuation',
      subtitle: `As of ${today()}`,
      columns: [
        { key: 'category', label: 'Category' },
        { key: 'items', label: 'Items', type: 'number' },
        { key: 'stock_value', label: 'Stock Value', type: 'money' },
        { key: 'share', label: 'Share %', type: 'percent' },
      ],
      rows,
      summary: [
        { label: 'Total stock value', value: round2(total), type: 'money' },
        { label: 'Active SKUs', value: db.prepare('SELECT COUNT(*) AS n FROM items WHERE active = 1').get().n, type: 'number' },
        { label: 'Low stock items', value: low.n, type: 'number' },
        { label: 'Low stock exposure', value: round2(num(low.v)), type: 'money' },
      ],
    };
  }

  if (key === 'low-stock') {
    const usage = usageByItem(90);
    const leadTimes = leadTimeBySupplier();
    const rows = db.prepare(
      `SELECT i.id, i.sku, i.name, i.category, i.unit, i.quantity, i.reorder_point, i.unit_cost,
              i.supplier_id, s.name AS supplier_name,
              ROUND(i.reorder_point - i.quantity, 2) AS shortage
       FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.active = 1 AND i.quantity <= i.reorder_point
       ORDER BY CASE WHEN i.quantity <= 0 THEN 0 ELSE 1 END, shortage DESC`
    ).all().map((row): Row => {
      const avgDaily = round2((usage.get(Number(row.id)) || 0) / 90);
      const leadTime = leadTimes.get(Number(row.supplier_id)) || 14;
      const coverage = round2(avgDaily * (leadTime + 7));
      const target = Math.max(round2(Number(row.reorder_point) * 2), coverage);
      const recommended = round2(Math.max(target - Number(row.quantity), 0));
      const daysCover = avgDaily > 0 ? round2(Number(row.quantity) / avgDaily) : null;
      const priority: ActionPriority =
        Number(row.quantity) <= 0 || (daysCover !== null && daysCover <= 7)
          ? 'Critical'
          : Number(row.quantity) < Number(row.reorder_point) || (daysCover !== null && daysCover <= leadTime + 7)
            ? 'High'
            : 'Normal';
      return {
        ...row,
        avg_daily: avgDaily,
        days_cover: daysCover,
        lead_time: leadTime,
        recommended_qty: recommended,
        priority,
        reorder_value: round2(recommended * Number(row.unit_cost)),
      };
    });
    return {
      title: 'Low Stock & Reorder',
      subtitle: `Generated ${today()} · quantities based on 90-day usage and supplier lead time`,
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Item' },
        { key: 'category', label: 'Category' },
        { key: 'quantity', label: 'On Hand', type: 'number' },
        { key: 'reorder_point', label: 'Reorder Point', type: 'number' },
        { key: 'avg_daily', label: 'Avg Daily Use', type: 'number' },
        { key: 'days_cover', label: 'Days Cover', type: 'number' },
        { key: 'lead_time', label: 'Lead Time (days)', type: 'number' },
        { key: 'recommended_qty', label: 'Recommended Qty', type: 'number' },
        { key: 'unit', label: 'Unit' },
        { key: 'priority', label: 'Priority' },
        { key: 'reorder_value', label: 'Est. Cost', type: 'money' },
        { key: 'supplier_name', label: 'Supplier' },
      ],
      rows,
      summary: [
        { label: 'Items to reorder', value: rows.length, type: 'number' },
        { label: 'Out of stock', value: rows.filter((r) => num(r.quantity) <= 0).length, type: 'number' },
        { label: 'Critical', value: rows.filter((r) => r.priority === 'Critical').length, type: 'number' },
        { label: 'Estimated reorder value', value: round2(rows.reduce((sum, r) => sum + num(r.reorder_value), 0)), type: 'money' },
      ],
    };
  }

  if (key === 'stock-ledger') {
    const rows = db.prepare(
      `SELECT sm.created_at AS date, i.sku, i.name AS item, sm.type,
              sm.quantity, i.unit, sm.reference, sm.created_by
       FROM stock_movements sm JOIN items i ON i.id = sm.item_id
       WHERE sm.created_at >= datetime('now','localtime','-90 day')
       ORDER BY sm.created_at DESC, sm.id DESC LIMIT 500`
    ).all();
    const inQty = rows.filter((r) => r.type === 'IN').reduce((s, r) => s + num(r.quantity), 0);
    const outQty = rows.filter((r) => r.type === 'OUT').reduce((s, r) => s + num(r.quantity), 0);
    return {
      title: 'Stock Movement Ledger',
      subtitle: 'Last 90 days — most recent first',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'sku', label: 'SKU' },
        { key: 'item', label: 'Item' },
        { key: 'type', label: 'Type' },
        { key: 'quantity', label: 'Qty', type: 'number' },
        { key: 'unit', label: 'Unit' },
        { key: 'reference', label: 'Reference' },
        { key: 'created_by', label: 'Recorded By' },
      ],
      rows,
      summary: [
        { label: 'Transactions', value: rows.length, type: 'number' },
        { label: 'Total received', value: round2(inQty), type: 'number' },
        { label: 'Total issued', value: round2(outQty), type: 'number' },
      ],
    };
  }

  if (key === 'maintenance-due') {
    const rows = db.prepare(
      `SELECT m.asset_code, m.name AS machine, m.status AS machine_status, ms.title AS task,
              ms.maintenance_type, ms.last_done, ms.next_due,
              CAST(julianday(ms.next_due) - julianday(date('now','localtime')) AS INTEGER) AS days_left,
              ms.assigned_to,
              COALESCE(wo.open_orders, 0) AS open_orders
       FROM maintenance_schedules ms
       JOIN machines m ON m.id = ms.machine_id
       LEFT JOIN (
         SELECT machine_id, COUNT(*) AS open_orders
         FROM maintenance_orders
         WHERE status IN ('Open','In Progress','On Hold')
         GROUP BY machine_id
       ) wo ON wo.machine_id = m.id
       WHERE ms.active = 1 AND ms.next_due <= date('now','localtime','+60 day')
       ORDER BY ms.next_due`
    ).all().map((row): Row => {
      const daysLeft = Number(row.days_left);
      const machineStatus = String(row.machine_status || '');
      const openOrders = Number(row.open_orders) || 0;
      let risk = 0;
      if (daysLeft < 0) risk += Math.min(50, Math.abs(daysLeft) * 3);
      else if (daysLeft <= 7) risk += 25;
      else if (daysLeft <= 14) risk += 15;
      else if (daysLeft <= 30) risk += 5;
      if (machineStatus === 'Breakdown') risk += 40;
      else if (machineStatus === 'Under Maintenance') risk += 20;
      else if (machineStatus === 'Idle') risk += 5;
      risk += Math.min(20, openOrders * 5);
      risk = Math.min(100, Math.round(risk));
      const priority = risk >= 60 ? 'Critical' : risk >= 30 ? 'High' : 'Normal';
      const recommendedAction =
        daysLeft < 0
          ? `Service immediately — ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} overdue.`
          : daysLeft <= 7
            ? 'Schedule the work order this week.'
            : daysLeft <= 30
              ? 'Add the job to this month’s maintenance plan.'
              : 'Plan for the next maintenance cycle.';
      return {
        ...row,
        schedule_status: daysLeft < 0 ? 'Overdue' : daysLeft <= 7 ? 'Due Soon' : 'Scheduled',
        risk_score: risk,
        priority,
        recommended_action: recommendedAction,
      };
    });
    return {
      title: 'Maintenance Due',
      subtitle: 'Next 60 days · risk-based priority and recommended action',
      columns: [
        { key: 'asset_code', label: 'Asset' },
        { key: 'machine', label: 'Machine' },
        { key: 'machine_status', label: 'Machine Status' },
        { key: 'task', label: 'Task' },
        { key: 'maintenance_type', label: 'Type' },
        { key: 'last_done', label: 'Last Done' },
        { key: 'next_due', label: 'Next Due' },
        { key: 'days_left', label: 'Days Left', type: 'number' },
        { key: 'open_orders', label: 'Open WOs', type: 'number' },
        { key: 'risk_score', label: 'Risk Score', type: 'number' },
        { key: 'priority', label: 'Priority' },
        { key: 'recommended_action', label: 'Recommended Action' },
        { key: 'assigned_to', label: 'Assigned To' },
      ],
      rows,
      summary: [
        { label: 'Overdue', value: rows.filter((r) => r.days_left < 0).length, type: 'number' },
        { label: 'Critical', value: rows.filter((r) => r.priority === 'Critical').length, type: 'number' },
        { label: 'High', value: rows.filter((r) => r.priority === 'High').length, type: 'number' },
        { label: 'Total scheduled', value: rows.length, type: 'number' },
      ],
    };
  }

  if (key === 'maintenance-cost') {
    const rows = db.prepare(
      `SELECT m.asset_code, m.name AS machine, COUNT(mo.id) AS orders,
              ROUND(SUM(mo.downtime_hours), 2) AS downtime,
              ROUND(SUM(mo.labor_cost), 2) AS labor,
              ROUND(SUM(mo.parts_cost), 2) AS parts,
              ROUND(SUM(mo.labor_cost + mo.parts_cost), 2) AS total
       FROM maintenance_orders mo JOIN machines m ON m.id = mo.machine_id
       WHERE mo.status = 'Completed' AND mo.completed_at >= date('now','localtime','-6 months')
       GROUP BY m.id ORDER BY total DESC`
    ).all();
    const sum = (key: string): number => round2(rows.reduce((s, r) => s + num(r[key]), 0));
    return {
      title: 'Maintenance Cost & Downtime',
      subtitle: 'Completed work orders, last 6 months',
      columns: [
        { key: 'asset_code', label: 'Asset' },
        { key: 'machine', label: 'Machine' },
        { key: 'orders', label: 'Work Orders', type: 'number' },
        { key: 'downtime', label: 'Downtime (hrs)', type: 'number' },
        { key: 'labor', label: 'Labor', type: 'money' },
        { key: 'parts', label: 'Parts', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' },
      ],
      rows,
      summary: [
        { label: 'Total maintenance cost', value: sum('total'), type: 'money' },
        { label: 'Total downtime', value: sum('downtime'), type: 'number' },
        { label: 'Work orders', value: rows.reduce((s, r) => s + num(r.orders), 0), type: 'number' },
      ],
    };
  }

  if (key === 'production-summary') {
    const rows = db.prepare(
      `SELECT substr(COALESCE(start_date, due_date, created_at), 1, 7) AS month,
              COUNT(*) AS orders, ROUND(SUM(target_qty), 2) AS target,
              ROUND(SUM(completed_qty), 2) AS completed, ROUND(SUM(scrap_qty), 2) AS scrap
       FROM production_orders
       WHERE COALESCE(start_date, due_date, created_at) >= date('now','localtime','-6 months')
       GROUP BY month ORDER BY month DESC`
    ).all().map((row): Row => ({
      ...row,
      label: monthLabel(row.month),
      achievement: num(row.target) > 0 ? round2((num(row.completed) / num(row.target)) * 100) : 0,
      variance: round2(num(row.completed) - num(row.target)),
      scrap_rate: num(row.completed) + num(row.scrap) > 0
        ? round2((num(row.scrap) / (num(row.completed) + num(row.scrap))) * 100)
        : 0,
    }));
    return {
      title: 'Production Summary',
      subtitle: 'Last 6 months by month',
      columns: [
        { key: 'label', label: 'Month' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'target', label: 'Target Qty', type: 'number' },
        { key: 'completed', label: 'Completed Qty', type: 'number' },
        { key: 'variance', label: 'Variance', type: 'number' },
        { key: 'scrap', label: 'Scrap Qty', type: 'number' },
        { key: 'achievement', label: 'Achievement', type: 'percent' },
        { key: 'scrap_rate', label: 'Scrap Rate', type: 'percent' },
      ],
      rows,
      summary: [
        { label: 'Completed output', value: round2(rows.reduce((s, r) => s + num(r.completed), 0)), type: 'number' },
        { label: 'Total variance', value: round2(rows.reduce((s, r) => s + num(r.variance), 0)), type: 'number' },
        { label: 'Scrap', value: round2(rows.reduce((s, r) => s + num(r.scrap), 0)), type: 'number' },
        { label: 'Avg achievement', value: rows.length ? round2(rows.reduce((s, r) => s + num(r.achievement), 0) / rows.length) : 0, type: 'percent' },
      ],
    };
  }

  if (key === 'purchase-spend') {
    const rows = db.prepare(
      `SELECT s.name AS supplier, COUNT(po.id) AS orders,
              ROUND(SUM(po.total_amount), 2) AS total,
              ROUND(SUM(CASE WHEN po.status = 'Received' THEN po.total_amount ELSE 0 END), 2) AS received
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status != 'Cancelled' AND po.order_date >= date('now','localtime','-6 months')
       GROUP BY s.id ORDER BY total DESC`
    ).all();
    return {
      title: 'Purchase Spend',
      subtitle: 'Last 6 months by supplier',
      columns: [
        { key: 'supplier', label: 'Supplier' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'total', label: 'Committed', type: 'money' },
        { key: 'received', label: 'Received', type: 'money' },
      ],
      rows,
      summary: [
        { label: 'Total committed', value: round2(rows.reduce((s, r) => s + num(r.total), 0)), type: 'money' },
        { label: 'Total received', value: round2(rows.reduce((s, r) => s + num(r.received), 0)), type: 'money' },
        { label: 'Suppliers', value: rows.length, type: 'number' },
      ],
    };
  }

  throw new AppError(404, 'Report not found.');
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

function listUsers(query: Row): ListResult {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const q = String(query.q || '').trim();
  if (q) {
    conditions.push('(t.username LIKE ? OR t.full_name LIKE ? OR t.department LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const field of ['role', 'department']) {
    if (query[field]) {
      conditions.push(`t.${field} = ?`);
      params.push(query[field]);
    }
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users t${where}`).get(...params).n;
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);
  const rows = db.prepare(
    `SELECT t.id, t.username, t.full_name, t.role, t.department, t.active, t.last_login, t.created_at
     FROM users t${where} ORDER BY t.full_name ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);
  return { rows, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) };
}

function createUser(body: Row, session: SessionUser): { id: number } {
  requirePermission(session, 'admin', 'write');
  const username = String(body.username || '').trim();
  const fullName = String(body.full_name || '').trim();
  const role = String(body.role || 'user');
  const department = body.department ? String(body.department) : null;
  const password = String(body.password || '');
  const active = body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
  if (!username) throw new AppError(400, 'Username is required.');
  if (!fullName) throw new AppError(400, 'Full name is required.');
  if (!ENUMS.roles.includes(role)) throw new AppError(400, 'Select a valid role.');
  if (password.length < 8) throw new AppError(400, 'Password must be at least 8 characters.');
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role, department, active) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, hashPassword(password), fullName, role, department, active);
    audit(session, 'Created', 'admin', 'User', Number(result.lastInsertRowid), `User ${username} created`);
    return { id: Number(result.lastInsertRowid) };
  } catch (error) {
    throw sqliteError(error, resources.users);
  }
}

function updateUser(id: number, body: Row, session: SessionUser): { ok: boolean } {
  requirePermission(session, 'admin', 'write');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError(404, 'User not found.');
  const username = body.username !== undefined ? String(body.username).trim() : user.username;
  const fullName = body.full_name !== undefined ? String(body.full_name).trim() : user.full_name;
  const role = body.role !== undefined ? String(body.role) : user.role;
  const department = body.department !== undefined ? (body.department || null) : user.department;
  const active = body.active !== undefined ? (body.active === true || body.active === 1 || body.active === '1' ? 1 : 0) : user.active;
  if (!username) throw new AppError(400, 'Username is required.');
  if (!fullName) throw new AppError(400, 'Full name is required.');
  if (!ENUMS.roles.includes(role)) throw new AppError(400, 'Select a valid role.');
  if (user.role === 'admin' && role !== 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
    if (admins <= 1) throw new AppError(400, 'At least one active administrator is required.');
  }
  if (user.id === session.userId && active === 0) throw new AppError(400, 'You cannot deactivate your own account.');
  try {
    db.prepare('UPDATE users SET username = ?, full_name = ?, role = ?, department = ?, active = ? WHERE id = ?')
      .run(username, fullName, role, department, active, id);
    const password = String(body.password || '');
    if (password) {
      if (password.length < 8) throw new AppError(400, 'Password must be at least 8 characters.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
      if (id !== session.userId) destroyUserSessions(id);
    }
    if (active === 0) destroyUserSessions(id);
    audit(session, 'Updated', 'admin', 'User', id, `User ${username} updated`);
  } catch (error) {
    throw error instanceof AppError ? error : sqliteError(error, resources.users);
  }
  return { ok: true };
}

function deleteUser(id: number, session: SessionUser): { ok: boolean } {
  requirePermission(session, 'admin', 'delete');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError(404, 'User not found.');
  if (user.id === session.userId) throw new AppError(400, 'You cannot delete your own account.');
  if (user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
    if (admins <= 1) throw new AppError(400, 'At least one active administrator is required.');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  destroyUserSessions(id);
  audit(session, 'Deleted', 'admin', 'User', id, `User ${user.username} deleted`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Main API router                                                     */
/* ------------------------------------------------------------------ */

async function handleApi(
  req: Request,
  res: Response,
  url: URL,
  body: Row,
  session: SessionUser | null,
  ip: string
): Promise<void> {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;

  /* ---- Auth ------------------------------------------------------ */
  if (path === '/auth/me' && method === 'GET') {
    return json(res, 200, { user: session || null });
  }

  if (path === '/auth/login' && method === 'POST') {
    checkLoginRateLimit(ip);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) throw new AppError(400, 'Enter your username and password.');
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(ip);
      throw new AppError(401, 'Incorrect username or password.');
    }
    if (!user.active) throw new AppError(403, 'This account has been deactivated. Contact an administrator.');
    clearLoginFailures(ip);
    const token = createSession(user as unknown as AuthUserRow);
    db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);
    const sessionData: SessionUser = {
      ...(session as SessionUser),
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      department: user.department || '',
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    audit(sessionData, 'Signed in', 'admin', 'Session', user.id, 'User signed in');
    return json(
      res,
      200,
      {
        user: {
          userId: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          department: user.department,
        },
      },
      {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      }
    );
  }

  if (path === '/auth/logout' && method === 'POST') {
    if (session) {
      destroySession(requireCookie(req));
      audit(session, 'Signed out', 'admin', 'Session', session.userId, 'User signed out');
    }
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`,
    });
  }

  if (!session) throw new AppError(401, 'Please sign in to continue.');

  if (path === '/auth/change-password' && method === 'POST') {
    const current = String(body.current_password || '');
    const next = String(body.new_password || '');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
    if (!user || !verifyPassword(current, user.password_hash)) throw new AppError(400, 'Current password is incorrect.');
    if (next.length < 8) throw new AppError(400, 'New password must be at least 8 characters.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), session.userId);
    audit(session, 'Updated', 'admin', 'User', session.userId, 'Changed own password');
    return json(res, 200, { ok: true });
  }

  /* ---- Meta ------------------------------------------------------ */
  if (path === '/meta' && method === 'GET') {
    return json(res, 200, {
      user: session,
      settings: getUserSettings(),
      enums: ENUMS,
      reports: reportList(),
      resources: publicResources(session),
    });
  }

  if (path === '/dashboard' && method === 'GET') {
    return json(res, 200, dashboard());
  }

  /* ---- Reports --------------------------------------------------- */
  if (path === '/reports' && method === 'GET') {
    requirePermission(session, 'reports', 'read');
    return json(res, 200, { reports: reportList() });
  }

  const reportMatch = path.match(/^\/reports\/([a-z0-9-]+)$/);
  if (reportMatch && method === 'GET') {
    requirePermission(session, 'reports', 'read');
    const report = buildReport(reportMatch[1]);
    if (url.searchParams.get('format') === 'csv') {
      return csvResponse(res, `${reportMatch[1]}-${today()}.csv`, toCsv(report.columns, report.rows));
    }
    return json(res, 200, report);
  }

  /* ---- Settings -------------------------------------------------- */
  if (path === '/settings' && method === 'GET') {
    requirePermission(session, 'settings', 'read');
    return json(res, 200, { settings: getUserSettings() });
  }
  if (path === '/settings' && method === 'PUT') {
    requirePermission(session, 'settings', 'write');
    const allowed = [
      'company_name',
      'company_short',
      'site',
      'currency',
      'maintenance_alert_days',
      'default_page_size',
      'report_footer',
    ];
    const update = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const key of allowed) {
      if (body[key] !== undefined) update.run(key, String(body[key]));
    }
    audit(session, 'Updated', 'settings', 'Settings', null, 'System settings updated');
    return json(res, 200, { settings: getUserSettings() });
  }

  /* ---- Users ----------------------------------------------------- */
  if (path === '/users' && method === 'GET') {
    requirePermission(session, 'admin', 'read');
    return json(res, 200, listUsers(Object.fromEntries(url.searchParams)));
  }
  if (path === '/users' && method === 'POST') {
    return json(res, 201, createUser(body, session));
  }
  const userMatch = path.match(/^\/users\/(\d+)$/);
  if (userMatch && method === 'PUT') {
    return json(res, 200, updateUser(parseId(userMatch[1], 'User'), body, session));
  }
  if (userMatch && method === 'DELETE') {
    return json(res, 200, deleteUser(parseId(userMatch[1], 'User'), session));
  }

  /* ---- Purchase order custom routes ------------------------------ */
  const poLinesMatch = path.match(/^\/purchase-orders\/(\d+)\/lines$/);
  if (poLinesMatch && method === 'GET') {
    requirePermission(session, 'purchasing', 'read');
    return json(res, 200, { rows: poLines(parseId(poLinesMatch[1], 'Purchase order')) });
  }
  if (poLinesMatch && method === 'POST') {
    return json(res, 201, addPoLine(parseId(poLinesMatch[1], 'Purchase order'), body, session));
  }
  const poLineMatch = path.match(/^\/purchase-orders\/(\d+)\/lines\/(\d+)$/);
  if (poLineMatch && method === 'DELETE') {
    return json(res, 200, removePoLine(parseId(poLineMatch[1], 'Purchase order'), parseId(poLineMatch[2], 'Line'), session));
  }
  const poReceiveMatch = path.match(/^\/purchase-orders\/(\d+)\/receive$/);
  if (poReceiveMatch && method === 'POST') {
    return json(res, 200, receivePurchaseOrder(parseId(poReceiveMatch[1], 'Purchase order'), session));
  }

  /* ---- Maintenance custom routes --------------------------------- */
  const woPartsMatch = path.match(/^\/maintenance-orders\/(\d+)\/parts$/);
  if (woPartsMatch && method === 'GET') {
    requirePermission(session, 'maintenance', 'read');
    return json(res, 200, { rows: woParts(parseId(woPartsMatch[1], 'Work order')) });
  }
  if (woPartsMatch && method === 'POST') {
    return json(res, 201, addWOPart(parseId(woPartsMatch[1], 'Work order'), body, session));
  }
  const woPartMatch = path.match(/^\/maintenance-orders\/(\d+)\/parts\/(\d+)$/);
  if (woPartMatch && method === 'DELETE') {
    return json(res, 200, removeWOPart(parseId(woPartMatch[1], 'Work order'), parseId(woPartMatch[2], 'Part'), session));
  }
  const woCompleteMatch = path.match(/^\/maintenance-orders\/(\d+)\/complete$/);
  if (woCompleteMatch && method === 'POST') {
    return json(res, 200, completeWorkOrder(parseId(woCompleteMatch[1], 'Work order'), body, session));
  }

  /* ---- Generic resources ----------------------------------------- */
  const segments = path.split('/').filter(Boolean);
  const key = segments[0];
  const config = resources[key];
  if (!config) throw new AppError(404, 'Unknown module.');

  if (config.custom) throw new AppError(405, 'This module has its own endpoints.');

  if (segments.length === 1 && method === 'GET') {
    requirePermission(session, config.module, 'read');
    const query = Object.fromEntries(url.searchParams);
    if (query.export === 'csv') {
      const result = listRows(config, { ...query, limit: 5000, page: 1 });
      return csvResponse(res, `${key}-${today()}.csv`, toCsv(listColumns(config), result.rows));
    }
    return json(res, 200, listRows(config, query));
  }

  const idMatch = segments.length === 2 ? segments[1].match(/^(\d+)$/) : null;
  if (idMatch) {
    const id = parseId(idMatch[1]);
    if (method === 'GET') {
      requirePermission(session, config.module, 'read');
      return json(res, 200, getRow(config, id));
    }
    if (method === 'PUT' || method === 'PATCH') {
      return json(res, 200, updateRow(config, id, body, session));
    }
    if (method === 'DELETE') {
      return json(res, 200, deleteRow(config, id, session));
    }
  }

  if (segments.length === 1 && method === 'POST') {
    return json(res, 201, createRow(config, body, session));
  }

  throw new AppError(405, 'Method not allowed.');
}

function requireCookie(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export { handleApi };
