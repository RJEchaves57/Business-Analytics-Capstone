import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Rows returned by SQLite are dynamic; resource-driven modules work with plain records. */
export type Row = Record<string, any>;

export interface Statement {
  get(...params: any[]): Row;
  all(...params: any[]): Row[];
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

// Resolve the project root from the process working directory so the data folder
// is stable in both `tsx server.ts` and `node server-dist/server.js` modes.
const ROOT = process.env.MAKOTO_ROOT || process.cwd();
export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'makoto.db');
export const db = new DatabaseSync(DB_PATH) as unknown as Database;

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','manager','maintenance','user','staff','viewer')),
  department TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 0,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  module TEXT,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plant_id INTEGER REFERENCES plants(id),
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  terms TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  country TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Raw Material','Consumable','Spare Part','Finished Good','Packaging')),
  unit TEXT NOT NULL DEFAULT 'pc',
  quantity REAL NOT NULL DEFAULT 0,
  reorder_point REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  warehouse_id INTEGER REFERENCES warehouses(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  location TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  type TEXT NOT NULL CHECK (type IN ('IN','OUT')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL,
  reference TEXT,
  notes TEXT,
  resulting_qty REAL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  plant_id INTEGER REFERENCES plants(id),
  location TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_no TEXT,
  acquired_date TEXT,
  status TEXT NOT NULL DEFAULT 'Running' CHECK (status IN ('Running','Idle','Under Maintenance','Breakdown','Retired')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  maintenance_type TEXT NOT NULL DEFAULT 'Preventive' CHECK (maintenance_type IN ('Preventive','Predictive','Calibration','Inspection')),
  interval_days INTEGER NOT NULL DEFAULT 30,
  last_done TEXT,
  next_due TEXT,
  assigned_to TEXT,
  checklist TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS maintenance_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_number TEXT NOT NULL UNIQUE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  schedule_id INTEGER REFERENCES maintenance_schedules(id),
  type TEXT NOT NULL DEFAULT 'Corrective' CHECK (type IN ('Preventive','Corrective','Emergency','Calibration','Inspection')),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','On Hold','Completed','Cancelled')),
  reported_by TEXT,
  assigned_to TEXT,
  description TEXT,
  downtime_hours REAL NOT NULL DEFAULT 0,
  labor_cost REAL NOT NULL DEFAULT 0,
  parts_cost REAL NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_order_id INTEGER NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  product_name TEXT NOT NULL,
  target_qty REAL NOT NULL DEFAULT 0,
  completed_qty REAL NOT NULL DEFAULT 0,
  scrap_qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pc',
  machine_id INTEGER REFERENCES machines(id),
  plant_id INTEGER REFERENCES plants(id),
  status TEXT NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned','In Progress','Completed','On Hold','Cancelled')),
  start_date TEXT,
  due_date TEXT,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Ordered','Partially Received','Received','Cancelled')),
  order_date TEXT,
  expected_date TEXT,
  received_date TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_movements_type_created ON stock_movements(type, created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_machine ON maintenance_schedules(machine_id);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON maintenance_schedules(next_due);
CREATE INDEX IF NOT EXISTS idx_wo_machine ON maintenance_orders(machine_id);
CREATE INDEX IF NOT EXISTS idx_wo_status ON maintenance_orders(status);
CREATE INDEX IF NOT EXISTS idx_prod_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_prod_start ON production_orders(start_date);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_expected ON purchase_orders(expected_date);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
`;

export function migrate(): void {
  db.exec(SCHEMA);

  // Upgrade an older demo database: rename legacy roles and adopt the new CHECK.
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as
    | { sql?: string }
    | undefined;
  if (table?.sql && table.sql.includes("'staff'") && !table.sql.includes("'maintenance'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','manager','maintenance','user','staff','viewer')),
        department TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        session_version INTEGER NOT NULL DEFAULT 0,
        last_login TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO users_new (id, username, password_hash, full_name, role, department, active, session_version, last_login, created_at)
      SELECT id, username, password_hash, full_name,
             CASE role WHEN 'staff' THEN 'maintenance' WHEN 'viewer' THEN 'user' ELSE role END,
             department, active, 0, last_login, created_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Databases created before stateless sessions need the version column.
  const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === 'session_version')) {
    db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
  }
}

/** Next document number in the form PREFIX-YYYY-0001. */
export function nextNumber(table: string, column: string, prefix: string): string {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db
    .prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`)
    .get(like);
  let n = 1;
  if (row && row.value) {
    const parsed = parseInt(String(row.value).split('-').pop() ?? '', 10);
    if (Number.isFinite(parsed)) n = parsed + 1;
  }
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
