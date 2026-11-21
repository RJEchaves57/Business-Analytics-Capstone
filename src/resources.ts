import { round2, today, daysBetween } from './util';
import { can, type SessionUser } from './auth';
import type { Row } from './db';

export interface FieldDef {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  list?: boolean;
  computed?: boolean;
  readOnly?: boolean;
  hideOnCreate?: boolean;
  hideOnEdit?: boolean;
  default?: unknown;
  options?: readonly string[];
  formOptions?: readonly string[];
  ref?: string;
  refLabel?: string;
  refSecondary?: string;
  filter?: boolean;
  badge?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
  sortName?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  full?: boolean;
  [key: string]: unknown;
}

export interface ExtraWhere {
  sql: string[];
  params: unknown[];
}

export interface ResourceConfig {
  module: string;
  table: string;
  label: string;
  singular: string;
  icon: string;
  description?: string;
  sql?: string;
  search?: string[];
  defaultSort: string;
  defaultDir: 'ASC' | 'DESC';
  custom?: boolean;
  readOnly?: boolean;
  noEdit?: boolean;
  noDelete?: boolean;
  extraWhere?: (query: Record<string, string>) => ExtraWhere;
  decorate?: (row: Row) => Row;
  fields: FieldDef[];
}

export interface PublicResource {
  key: string;
  label: string;
  singular: string;
  module: string;
  description?: string;
  icon: string;
  fields: FieldDef[];
  defaultSort: string;
  defaultDir: 'ASC' | 'DESC';
  readOnly: boolean;
  custom: boolean;
  noEdit: boolean;
  noDelete: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

const field = (name: string, label: string, type: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  name,
  label,
  type,
  ...extra,
});

const CATEGORIES = ['Raw Material', 'Consumable', 'Spare Part', 'Finished Good', 'Packaging'];
const UNITS = ['pc', 'kg', 'm', 'L', 'set', 'roll', 'box', 'sheet', 'pair'];
const MACHINE_TYPES = [
  'CNC Machining Center',
  'Die-Casting Machine',
  'Hydraulic Press',
  'Welding Machine',
  'Lathe',
  'Grinder',
  'Compressor',
  'Inspection Equipment',
  'Shot Blast',
  'Other',
];
const MACHINE_STATUS = ['Running', 'Idle', 'Under Maintenance', 'Breakdown', 'Retired'];
const MAINT_TYPES = ['Preventive', 'Corrective', 'Emergency', 'Calibration', 'Inspection'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const WO_STATUS = ['Open', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const PROD_STATUS = ['Planned', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
const PO_STATUS = ['Draft', 'Ordered', 'Partially Received', 'Received', 'Cancelled'];
const ROLES = ['admin', 'manager', 'maintenance', 'user'];
const DEPARTMENTS = [
  'Production',
  'Quality Assurance',
  'Maintenance',
  'Warehouse',
  'Purchasing',
  'Accounting',
  'HR & Admin',
  'Engineering',
  'Management',
];
const TERMS = ['Cash on Delivery', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];

const ENUMS = {
  categories: CATEGORIES,
  units: UNITS,
  machineTypes: MACHINE_TYPES,
  machineStatus: MACHINE_STATUS,
  maintenanceTypes: MAINT_TYPES,
  priorities: PRIORITIES,
  workOrderStatus: WO_STATUS,
  productionStatus: PROD_STATUS,
  purchaseStatus: PO_STATUS,
  roles: ROLES,
  departments: DEPARTMENTS,
  terms: TERMS,
};

function dueStatus(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Not Scheduled';
  const diff = daysBetween(today(), dateStr);
  if (diff < 0) return 'Overdue';
  if (diff <= 7) return 'Due Soon';
  return 'Scheduled';
}

function stockStatus(row: Row): string {
  if (Number(row.quantity) <= 0) return 'Out of Stock';
  if (Number(row.quantity) <= Number(row.reorder_point)) return 'Low Stock';
  return 'In Stock';
}

const resources: Record<string, ResourceConfig> = {
  items: {
    module: 'inventory',
    table: 'items',
    label: 'Inventory Items',
    singular: 'Item',
    icon: 'box',
    description: 'Raw materials, consumables, spare parts, finished goods, and packaging.',
    sql: `SELECT t.*, s.name AS supplier_name, w.name AS warehouse_name
          FROM items t
          LEFT JOIN suppliers s ON s.id = t.supplier_id
          LEFT JOIN warehouses w ON w.id = t.warehouse_id`,
    search: ['t.sku', 't.name', 't.location', 's.name'],
    defaultSort: 't.name',
    defaultDir: 'ASC',
    extraWhere(query) {
      if (query.low === '1') {
        return { sql: ['t.active = 1 AND t.quantity <= t.reorder_point'], params: [] };
      }
      return { sql: [], params: [] };
    },
    decorate(row) {
      row.on_hand = `${Number(row.quantity).toLocaleString('en-PH')} ${row.unit}`;
      row.total_value = round2(Number(row.quantity) * Number(row.unit_cost));
      row.stock_status = stockStatus(row);
      return row;
    },
    fields: [
      field('sku', 'SKU', 'text', { required: true, list: true, width: '120px', placeholder: 'e.g. RM-ADC12' }),
      field('name', 'Item Name', 'text', { required: true, list: true }),
      field('category', 'Category', 'select', { required: true, options: CATEGORIES, list: true, filter: true, badge: true }),
      field('unit', 'Unit', 'select', { required: true, options: UNITS, list: false }),
      field('quantity', 'Opening Quantity', 'number', {
        min: 0,
        step: 0.01,
        list: false,
        hideOnEdit: true,
        help: 'Opening stock. After creation, change stock through stock movements.',
      }),
      field('on_hand', 'On Hand', 'text', { computed: true, list: true, sortName: 'quantity', align: 'right' }),
      field('reorder_point', 'Reorder Point', 'number', { min: 0, step: 0.01, list: false }),
      field('unit_cost', 'Unit Cost', 'money', { required: true, min: 0, list: true, align: 'right' }),
      field('total_value', 'Stock Value', 'money', { computed: true, list: true, sortName: 'quantity', align: 'right' }),
      field('stock_status', 'Status', 'text', { computed: true, list: true, badge: true, align: 'center' }),
      field('warehouse_id', 'Warehouse', 'ref', {
        ref: 'warehouses',
        refLabel: 'name',
        list: false,
        filter: true,
      }),
      field('supplier_id', 'Supplier', 'ref', { ref: 'suppliers', refLabel: 'name', list: false }),
      field('location', 'Bin / Location', 'text', { list: false, placeholder: 'e.g. Rack A-03' }),
      field('active', 'Active', 'bool', { list: false, default: 1 }),
      field('notes', 'Notes', 'textarea', { list: false }),
      field('updated_at', 'Last Updated', 'datetime', { list: false, readOnly: true }),
    ],
  },

  'stock-movements': {
    module: 'inventory',
    table: 'stock_movements',
    label: 'Stock Movements',
    singular: 'Stock Movement',
    icon: 'swap',
    description: 'Every stock-in, stock-out, and adjustment, with full traceability.',
    sql: `SELECT t.*, i.sku AS item_sku, i.name AS item_name, i.unit AS item_unit
          FROM stock_movements t
          JOIN items i ON i.id = t.item_id`,
    search: ['i.sku', 'i.name', 't.reference', 't.notes'],
    defaultSort: 't.created_at',
    defaultDir: 'DESC',
    noEdit: true,
    noDelete: true,
    decorate(row) {
      row.item = `${row.item_sku} · ${row.item_name}`;
      row.signed_qty = row.type === 'IN' ? Number(row.quantity) : -Number(row.quantity);
      return row;
    },
    fields: [
      field('created_at', 'Date', 'datetime', { list: true, width: '155px', readOnly: true }),
      field('item', 'Item', 'text', { computed: true, list: true, sortName: 'item_id' }),
      field('item_id', 'Item', 'ref', {
        ref: 'items',
        refLabel: 'name',
        refSecondary: 'sku',
        required: true,
        list: false,
        filter: true,
        hideOnEdit: true,
        help: 'Select the inventory item being moved.',
      }),
      field('type', 'Type', 'select', { options: ['IN', 'OUT'], required: true, list: true, filter: true, badge: true, align: 'center' }),
      field('quantity', 'Quantity', 'number', { required: true, min: 0.01, step: 0.01, list: true, align: 'right' }),
      field('unit_cost', 'Unit Cost', 'money', { min: 0, list: true, align: 'right' }),
      field('reference', 'Reference', 'text', { list: true, placeholder: 'e.g. WO-2026-0012 / DR-8842' }),
      field('resulting_qty', 'Balance', 'number', { list: true, align: 'right', readOnly: true }),
      field('created_by', 'Recorded By', 'text', { list: true, readOnly: true, hideOnCreate: true }),
      field('notes', 'Notes', 'textarea', { list: false }),
    ],
  },

  warehouses: {
    module: 'inventory',
    table: 'warehouses',
    label: 'Warehouses',
    singular: 'Warehouse',
    icon: 'warehouse',
    description: 'Storage locations across the MEPZ II plants.',
    sql: `SELECT t.*, p.name AS plant_name FROM warehouses t LEFT JOIN plants p ON p.id = t.plant_id`,
    search: ['t.code', 't.name', 't.location'],
    defaultSort: 't.code',
    defaultDir: 'ASC',
    fields: [
      field('code', 'Code', 'text', { required: true, list: true, width: '120px' }),
      field('name', 'Warehouse Name', 'text', { required: true, list: true }),
      field('plant_id', 'Plant', 'ref', { ref: 'plants', refLabel: 'name', list: false, filter: true }),
      field('plant_name', 'Plant', 'text', { computed: true, list: true }),
      field('location', 'Location', 'text', { list: true }),
      field('active', 'Active', 'bool', { list: true, align: 'center' }),
    ],
  },

  plants: {
    module: 'inventory',
    table: 'plants',
    label: 'Plants',
    singular: 'Plant',
    icon: 'factory',
    description: 'Manufacturing sites.',
    sql: `SELECT t.* FROM plants t`,
    search: ['t.code', 't.name'],
    defaultSort: 't.code',
    defaultDir: 'ASC',
    fields: [
      field('code', 'Code', 'text', { required: true, list: true }),
      field('name', 'Plant Name', 'text', { required: true, list: true }),
      field('address', 'Address', 'text', { list: true }),
      field('active', 'Active', 'bool', { list: true, align: 'center' }),
    ],
  },

  machines: {
    module: 'maintenance',
    table: 'machines',
    label: 'Machines & Equipment',
    singular: 'Machine',
    icon: 'cog',
    description: 'Production equipment register with live maintenance status.',
    sql: `SELECT t.*, p.name AS plant_name,
            (SELECT MIN(next_due) FROM maintenance_schedules ms WHERE ms.machine_id = t.id AND ms.active = 1) AS next_due,
            (SELECT COUNT(*) FROM maintenance_orders mo WHERE mo.machine_id = t.id AND mo.status IN ('Open','In Progress','On Hold')) AS open_orders
          FROM machines t
          LEFT JOIN plants p ON p.id = t.plant_id`,
    search: ['t.asset_code', 't.name', 't.manufacturer', 't.model', 't.serial_no'],
    defaultSort: 't.asset_code',
    defaultDir: 'ASC',
    decorate(row) {
      row.due_status = row.next_due ? dueStatus(row.next_due) : '';
      return row;
    },
    fields: [
      field('asset_code', 'Asset Code', 'text', { required: true, list: true, width: '110px' }),
      field('name', 'Machine Name', 'text', { required: true, list: true }),
      field('type', 'Type', 'select', { required: true, options: MACHINE_TYPES, list: true, filter: true }),
      field('plant_id', 'Plant', 'ref', { ref: 'plants', refLabel: 'name', list: false, filter: true }),
      field('plant_name', 'Plant', 'text', { computed: true, list: true }),
      field('location', 'Location', 'text', { list: false }),
      field('manufacturer', 'Manufacturer', 'text', { list: false }),
      field('model', 'Model', 'text', { list: false }),
      field('serial_no', 'Serial No.', 'text', { list: false }),
      field('acquired_date', 'Acquired', 'date', { list: false }),
      field('status', 'Status', 'select', { options: MACHINE_STATUS, required: true, list: true, filter: true, badge: true, align: 'center' }),
      field('next_due', 'Next Maintenance', 'date', { computed: true, list: true }),
      field('due_status', 'Maintenance', 'text', { computed: true, list: true, badge: true, align: 'center' }),
      field('notes', 'Notes', 'textarea', { list: false }),
    ],
  },

  'maintenance-schedules': {
    module: 'maintenance',
    table: 'maintenance_schedules',
    label: 'Preventive Schedules',
    singular: 'Schedule',
    icon: 'calendar',
    description: 'Recurring preventive maintenance plans for every machine.',
    sql: `SELECT t.*, m.name AS machine_name, m.asset_code, p.name AS plant_name
          FROM maintenance_schedules t
          JOIN machines m ON m.id = t.machine_id
          LEFT JOIN plants p ON p.id = m.plant_id`,
    search: ['t.title', 'm.name', 'm.asset_code', 't.assigned_to'],
    defaultSort: 't.next_due',
    defaultDir: 'ASC',
    extraWhere(query) {
      const sql = [];
      if (query.due === 'overdue') sql.push("t.active = 1 AND t.next_due < date('now','localtime')");
      if (query.due === 'soon') {
        sql.push("t.active = 1 AND t.next_due >= date('now','localtime') AND t.next_due <= date('now','localtime','+7 day')");
      }
      return { sql, params: [] };
    },
    decorate(row) {
      row.due_status = dueStatus(row.next_due);
      return row;
    },
    fields: [
      field('machine_id', 'Machine', 'ref', {
        ref: 'machines',
        refLabel: 'name',
        refSecondary: 'asset_code',
        required: true,
        list: false,
        filter: true,
      }),
      field('machine_name', 'Machine', 'text', { computed: true, list: true, sortName: 'machine_id' }),
      field('title', 'Task', 'text', { required: true, list: true }),
      field('maintenance_type', 'Type', 'select', { options: ['Preventive', 'Predictive', 'Calibration', 'Inspection'], required: true, list: true, filter: true, badge: true }),
      field('interval_days', 'Interval (days)', 'number', { required: true, min: 1, step: 1, list: true, align: 'right' }),
      field('last_done', 'Last Done', 'date', { list: true }),
      field('next_due', 'Next Due', 'date', { list: true, help: 'Leave blank to calculate automatically from the interval.' }),
      field('due_status', 'Status', 'text', { computed: true, list: true, badge: true, align: 'center' }),
      field('assigned_to', 'Assigned To', 'text', { list: true }),
      field('active', 'Active', 'bool', { list: false, default: 1 }),
      field('checklist', 'Checklist / Procedure', 'textarea', { list: false }),
    ],
  },

  'maintenance-orders': {
    module: 'maintenance',
    table: 'maintenance_orders',
    label: 'Work Orders',
    singular: 'Work Order',
    icon: 'wrench',
    description: 'Corrective and preventive maintenance jobs, downtime, and costs.',
    sql: `SELECT t.*, m.name AS machine_name, m.asset_code,
            (SELECT COUNT(*) FROM maintenance_parts mp WHERE mp.maintenance_order_id = t.id) AS parts_count,
            (SELECT ms.title FROM maintenance_schedules ms WHERE ms.id = t.schedule_id) AS schedule_title
          FROM maintenance_orders t
          JOIN machines m ON m.id = t.machine_id`,
    search: ['t.wo_number', 'm.name', 'm.asset_code', 't.assigned_to', 't.description'],
    defaultSort: 't.created_at',
    defaultDir: 'DESC',
    decorate(row) {
      row.total_cost = round2(Number(row.labor_cost) + Number(row.parts_cost));
      return row;
    },
    fields: [
      field('wo_number', 'WO No.', 'text', { list: true, width: '125px', readOnly: true, hideOnCreate: true }),
      field('machine_id', 'Machine', 'ref', {
        ref: 'machines',
        refLabel: 'name',
        refSecondary: 'asset_code',
        required: true,
        list: false,
        filter: true,
      }),
      field('machine_name', 'Machine', 'text', { computed: true, list: true, sortName: 'machine_id' }),
      field('schedule_id', 'From Schedule', 'ref', { ref: 'maintenance-schedules', refLabel: 'title', list: false }),
      field('type', 'Type', 'select', { options: MAINT_TYPES, required: true, list: true, filter: true, badge: true }),
      field('priority', 'Priority', 'select', { options: PRIORITIES, required: true, list: true, filter: true, badge: true, align: 'center' }),
      field('status', 'Status', 'select', { options: WO_STATUS, required: true, list: true, filter: true, badge: true, align: 'center' }),
      field('assigned_to', 'Technician', 'text', { list: true }),
      field('reported_by', 'Reported By', 'text', { list: false }),
      field('description', 'Description / Findings', 'textarea', { list: false }),
      field('downtime_hours', 'Downtime (hrs)', 'number', { min: 0, step: 0.25, list: false }),
      field('labor_cost', 'Labor Cost', 'money', { min: 0, list: false }),
      field('parts_cost', 'Parts Cost', 'money', { min: 0, list: false, readOnly: true }),
      field('total_cost', 'Total Cost', 'money', { computed: true, list: true, align: 'right' }),
      field('started_at', 'Started', 'date', { list: true }),
      field('completed_at', 'Completed', 'date', { list: false }),
    ],
  },

  'production-orders': {
    module: 'production',
    table: 'production_orders',
    label: 'Production Orders',
    singular: 'Production Order',
    icon: 'factory',
    description: 'Customer orders, output, and scrap across both plants.',
    sql: `SELECT t.*, c.name AS customer_name, m.name AS machine_name, p.name AS plant_name
          FROM production_orders t
          LEFT JOIN customers c ON c.id = t.customer_id
          LEFT JOIN machines m ON m.id = t.machine_id
          LEFT JOIN plants p ON p.id = t.plant_id`,
    search: ['t.order_no', 't.product_name', 'c.name'],
    defaultSort: 't.due_date',
    defaultDir: 'DESC',
    decorate(row) {
      row.achievement = row.target_qty > 0 ? round2((Number(row.completed_qty) / Number(row.target_qty)) * 100) : 0;
      row.scrap_rate = Number(row.completed_qty) + Number(row.scrap_qty) > 0
        ? round2((Number(row.scrap_qty) / (Number(row.completed_qty) + Number(row.scrap_qty))) * 100)
        : 0;
      return row;
    },
    fields: [
      field('order_no', 'Order No.', 'text', { list: true, width: '135px', readOnly: true, hideOnCreate: true }),
      field('customer_id', 'Customer', 'ref', { ref: 'customers', refLabel: 'name', list: false, filter: true }),
      field('customer_name', 'Customer', 'text', { computed: true, list: true, sortName: 'customer_id' }),
      field('product_name', 'Product', 'text', { required: true, list: true }),
      field('target_qty', 'Target Qty', 'number', { required: true, min: 0, step: 0.01, list: true, align: 'right' }),
      field('completed_qty', 'Completed', 'number', { min: 0, step: 0.01, list: true, align: 'right' }),
      field('scrap_qty', 'Scrap', 'number', { min: 0, step: 0.01, list: true, align: 'right' }),
      field('unit', 'Unit', 'select', { options: UNITS, required: true, list: false }),
      field('achievement', 'Achievement', 'percent', { computed: true, list: true, align: 'right' }),
      field('machine_id', 'Machine', 'ref', { ref: 'machines', refLabel: 'name', list: false }),
      field('plant_id', 'Plant', 'ref', { ref: 'plants', refLabel: 'name', list: false, filter: true }),
      field('plant_name', 'Plant', 'text', { computed: true, list: false }),
      field('status', 'Status', 'select', { options: PROD_STATUS, required: true, list: true, filter: true, badge: true, align: 'center' }),
      field('start_date', 'Start Date', 'date', { list: false }),
      field('due_date', 'Due Date', 'date', { list: true }),
      field('completed_at', 'Completed', 'date', { list: false }),
      field('notes', 'Notes', 'textarea', { list: false }),
    ],
  },

  'purchase-orders': {
    module: 'purchasing',
    table: 'purchase_orders',
    label: 'Purchase Orders',
    singular: 'Purchase Order',
    icon: 'cart',
    description: 'Supplier orders and receiving into inventory.',
    sql: `SELECT t.*, s.name AS supplier_name,
            (SELECT COUNT(*) FROM purchase_order_items x WHERE x.purchase_order_id = t.id) AS line_count
          FROM purchase_orders t
          JOIN suppliers s ON s.id = t.supplier_id`,
    search: ['t.po_number', 's.name', 't.notes'],
    defaultSort: 't.order_date',
    defaultDir: 'DESC',
    fields: [
      field('po_number', 'PO No.', 'text', { list: true, width: '125px', readOnly: true, hideOnCreate: true }),
      field('supplier_id', 'Supplier', 'ref', { ref: 'suppliers', refLabel: 'name', required: true, list: false, filter: true }),
      field('supplier_name', 'Supplier', 'text', { computed: true, list: true, sortName: 'supplier_id' }),
      field('status', 'Status', 'select', { options: PO_STATUS, formOptions: ['Draft', 'Ordered', 'Cancelled'], required: true, list: true, filter: true, badge: true, align: 'center' }),
      field('order_date', 'Order Date', 'date', { list: true }),
      field('expected_date', 'Expected', 'date', { list: true }),
      field('received_date', 'Received', 'date', { list: false }),
      field('line_count', 'Lines', 'number', { computed: true, list: true, align: 'right' }),
      field('total_amount', 'Total', 'money', { min: 0, list: true, align: 'right', readOnly: true }),
      field('notes', 'Notes', 'textarea', { list: false }),
    ],
  },

  suppliers: {
    module: 'purchasing',
    table: 'suppliers',
    label: 'Suppliers',
    singular: 'Supplier',
    icon: 'truck',
    description: 'Approved vendors for materials, parts, and services.',
    sql: `SELECT t.* FROM suppliers t`,
    search: ['t.code', 't.name', 't.contact_person', 't.email'],
    defaultSort: 't.name',
    defaultDir: 'ASC',
    fields: [
      field('code', 'Code', 'text', { required: true, list: true, width: '110px' }),
      field('name', 'Supplier Name', 'text', { required: true, list: true }),
      field('contact_person', 'Contact Person', 'text', { list: true }),
      field('phone', 'Phone', 'text', { list: true }),
      field('email', 'Email', 'text', { list: true }),
      field('address', 'Address', 'text', { list: false }),
      field('terms', 'Payment Terms', 'select', { options: TERMS, list: false }),
      field('active', 'Active', 'bool', { list: true, align: 'center' }),
    ],
  },

  customers: {
    module: 'purchasing',
    table: 'customers',
    label: 'Customers',
    singular: 'Customer',
    icon: 'users',
    description: 'Export and domestic customers served by the plants.',
    sql: `SELECT t.* FROM customers t`,
    search: ['t.code', 't.name', 't.contact_person'],
    defaultSort: 't.name',
    defaultDir: 'ASC',
    fields: [
      field('code', 'Code', 'text', { required: true, list: true, width: '110px' }),
      field('name', 'Customer Name', 'text', { required: true, list: true }),
      field('contact_person', 'Contact Person', 'text', { list: true }),
      field('country', 'Country', 'text', { list: true }),
      field('phone', 'Phone', 'text', { list: true }),
      field('email', 'Email', 'text', { list: false }),
      field('address', 'Address', 'text', { list: false }),
      field('active', 'Active', 'bool', { list: true, align: 'center' }),
    ],
  },

  users: {
    module: 'admin',
    table: 'users',
    label: 'Users',
    singular: 'User',
    icon: 'user',
    description: 'System accounts and role assignments.',
    custom: true,
    search: ['t.username', 't.full_name', 't.department'],
    defaultSort: 't.full_name',
    defaultDir: 'ASC',
    fields: [
      field('username', 'Username', 'text', { required: true, list: true, width: '140px' }),
      field('full_name', 'Full Name', 'text', { required: true, list: true }),
      field('role', 'Role', 'select', { required: true, options: ROLES, list: true, filter: true, badge: true }),
      field('department', 'Department', 'select', { options: DEPARTMENTS, list: true, filter: true }),
      field('active', 'Active', 'bool', { list: true, align: 'center' }),
      field('last_login', 'Last Login', 'datetime', { list: true, readOnly: true }),
      field('password', 'Password', 'password', {
        required: true,
        list: false,
        help: 'Minimum 8 characters. Leave blank when editing to keep the current password.',
      }),
    ],
  },

  activity: {
    module: 'admin',
    table: 'activity_log',
    label: 'Activity Log',
    singular: 'Audit Entry',
    icon: 'shield',
    description: 'Who changed what, and when.',
    sql: `SELECT t.* FROM activity_log t`,
    search: ['t.username', 't.action', 't.entity', 't.details'],
    defaultSort: 't.created_at',
    defaultDir: 'DESC',
    readOnly: true,
    fields: [
      field('created_at', 'Date', 'datetime', { list: true, width: '160px' }),
      field('username', 'User', 'text', { list: true }),
      field('action', 'Action', 'text', { list: true, badge: true }),
      field('module', 'Module', 'text', { list: true }),
      field('entity', 'Record', 'text', { list: true }),
      field('details', 'Details', 'text', { list: false }),
    ],
  },
};

function publicResources(session: SessionUser): Record<string, PublicResource> {
  const out: Record<string, PublicResource> = {};
  for (const [key, config] of Object.entries(resources)) {
    out[key] = {
      key,
      label: config.label,
      singular: config.singular,
      module: config.module,
      description: config.description,
      icon: config.icon,
      fields: config.fields,
      defaultSort: config.defaultSort,
      defaultDir: config.defaultDir,
      readOnly: Boolean(config.readOnly),
      custom: Boolean(config.custom),
      noEdit: Boolean(config.noEdit),
      noDelete: Boolean(config.noDelete),
      canWrite: can(session.role, config.module, 'write'),
      canDelete: can(session.role, config.module, 'delete') && !config.readOnly,
    };
  }
  return out;
}

export { resources, publicResources, ENUMS };
