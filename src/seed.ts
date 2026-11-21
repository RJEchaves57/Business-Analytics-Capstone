import { db, type Row } from './db';
import { hashPassword } from './auth';
import { today, addDays, toDate, toDateTime, round2 } from './util';

let rngState = 20261110;
function rnd(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
function between(min: number, max: number): number {
  return min + rnd() * (max - min);
}
function int(min: number, max: number): number {
  return Math.floor(between(min, max + 1));
}

function ins(table: string, data: Row): number {
  const cols = Object.keys(data);
  const result = db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => data[c]));
  return Number(result.lastInsertRowid);
}

function dateAgo(days: number): string {
  return addDays(today(), -days);
}

function dtAgo(days: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return toDateTime(d);
}

function monthDate(offset: number, day: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toDate(d);
}

export interface SeedItem {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  cost: number;
  reorder: number;
}

export function seedIfEmpty(): boolean {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (existing > 0) return false;

  db.exec('BEGIN');
  try {
    seedUsers();
    seedSettings();
    const plants = seedPlants();
    const warehouses = seedWarehouses(plants);
    const suppliers = seedSuppliers();
    const customers = seedCustomers();
    const items = seedItems(warehouses, suppliers);
    const machines = seedMachines(plants);
    const schedules = seedSchedules(machines);
    seedWorkOrders(machines, schedules, items);
    seedProduction(customers, machines, plants);
    seedPurchaseOrders(suppliers, items);
    seedActivity();
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

interface SeedUser {
  username: string;
  password: string;
  full_name: string;
  role: string;
  department: string;
}

function seedUsers(): void {
  const users: SeedUser[] = [
    { username: 'admin', password: 'admin123', full_name: 'RJ Echaves', role: 'admin', department: 'Plant Management' },
    { username: 'manager', password: 'manager123', full_name: 'Grace Andrea Seguros', role: 'manager', department: 'Operations' },
    { username: 'maintenance', password: 'maintenance123', full_name: 'Rodel Bautista', role: 'maintenance', department: 'Maintenance' },
    { username: 'user', password: 'user123', full_name: 'Nicole Lauron', role: 'user', department: 'Production Floor' },
  ];
  for (const user of users) {
    ins('users', {
      username: user.username,
      password_hash: hashPassword(user.password),
      full_name: user.full_name,
      role: user.role,
      department: user.department,
      active: 1,
      last_login: dtAgo(int(1, 4), int(7, 15), int(0, 59)),
      created_at: dtAgo(180, 8, 30),
    });
  }
}

function seedSettings(): void {
  const settings: Record<string, string> = {
    company_name: 'Makoto Metal Technology, Inc.',
    company_short: 'Makoto Metal',
    site: 'MEPZ II, Basak, Lapu-Lapu City, Cebu',
    currency: 'PHP',
    maintenance_alert_days: '30',
    default_page_size: '25',
    report_footer: 'Prepared by the Operations Department · Makoto Metal Technology, Inc. · MEPZ II',
  };
  for (const [key, value] of Object.entries(settings)) ins('settings', { key, value });
}

function seedPlants(): number[] {
  return [
    ins('plants', {
      code: 'PLT-01',
      name: 'Plant 1 — Machining',
      address: 'Dinagyang Street, MEPZ II, Basak, Lapu-Lapu City, Cebu',
      active: 1,
    }),
    ins('plants', {
      code: 'PLT-02',
      name: 'Plant 2 — Die-Casting & Finishing',
      address: 'Phase 1, Block 5, MEPZ II, Basak, Lapu-Lapu City, Cebu',
      active: 1,
    }),
  ];
}

function seedWarehouses(plants: number[]): number[] {
  const rows: Array<{ code: string; name: string; plant_id: number; location: string }> = [
    { code: 'WH-RM', name: 'Raw Materials Warehouse', plant_id: plants[0], location: 'Plant 1 · Bay A' },
    { code: 'WH-CON', name: 'Consumables Store', plant_id: plants[0], location: 'Plant 1 · Bay C' },
    { code: 'WH-SP', name: 'Spare Parts Store', plant_id: plants[1], location: 'Plant 2 · Maintenance Room' },
    { code: 'WH-FG', name: 'Finished Goods Warehouse', plant_id: plants[1], location: 'Plant 2 · Dispatch Area' },
  ];
  return rows.map((row) => ins('warehouses', { ...row, active: 1 }));
}

function seedSuppliers(): number[] {
  const rows: Array<[string, string, string, string, string, string, string]> = [
    ['SUP-001', 'Cebu Steel & Alloy Trading', 'Antonio Lim', 'antonio@cebusteel.example', '+63 32 344 1188', 'Mandaue City, Cebu', 'Net 30'],
    ['SUP-002', 'Mactan Industrial Supply', 'Sheila Tan', 'sheila@mactanindustrial.example', '+63 32 341 7720', 'Lapu-Lapu City, Cebu', 'Net 15'],
    ['SUP-003', 'Visayas Machine Parts Co.', 'Rogelio Cruz', 'sales@visayasmachine.example', '+63 32 416 3390', 'Cebu City, Cebu', 'Net 45'],
    ['SUP-004', 'Osaka Precision Metals', 'Hiroshi Tanaka', 'h.tanaka@osakaprecision.example', '+81 6 6120 4455', 'Osaka, Japan', 'Net 60'],
    ['SUP-005', 'Pacific Packaging Solutions', 'Carla Reyes', 'carla@pacificpack.example', '+63 32 520 8841', 'Consolacion, Cebu', 'Net 30'],
  ];
  return rows.map(([code, name, contact, email, phone, address, terms]) =>
    ins('suppliers', { code, name, contact_person: contact, email, phone, address, terms, active: 1, created_at: dtAgo(160) })
  );
}

function seedCustomers(): number[] {
  const rows: Array<[string, string, string, string]> = [
    ['CUS-001', 'Aerospace Components Japan Ltd.', 'Yuki Sato', 'Tokyo, Japan'],
    ['CUS-002', 'Cebu Electronics Manufacturing', 'Paolo Garcia', 'Cebu, Philippines'],
    ['CUS-003', 'Manila Auto Parts Corp.', 'Diana Mercado', 'Laguna, Philippines'],
    ['CUS-004', 'Visayas Appliance Works', 'Ernesto Sy', 'Iloilo, Philippines'],
    ['CUS-005', 'Kyushu Precision Industries', 'Masaru Ito', 'Fukuoka, Japan'],
  ];
  return rows.map(([code, name, contact, address]) =>
    ins('customers', {
      code,
      name,
      contact_person: contact,
      country: address.split(',').pop()!.trim(),
      address,
      email: `${code.toLowerCase()}@customer.example`,
      phone: '+63 32 555 0100',
      active: 1,
      created_at: dtAgo(150),
    })
  );
}

type ItemSeed = [string, string, string, string, number, number, number, number, number | null, string];

function seedItems(warehouses: number[], suppliers: number[]): SeedItem[] {
  const [rm, con, sp, fg] = warehouses;
  const [s1, s2, s3, s4, s5] = suppliers;

  const rows: ItemSeed[] = [
    ['RM-ADC12', 'ADC12 Aluminum Ingot', 'Raw Material', 'kg', 4200, 1500, 185, rm, s4, 'Rack RM-01'],
    ['RM-STEEL-SPCC', 'SPCC Steel Sheet 1.2mm', 'Raw Material', 'sheet', 180, 100, 1250, rm, s1, 'Rack RM-02'],
    ['RM-SS304', 'Stainless Steel 304 Rod 20mm', 'Raw Material', 'kg', 650, 300, 320, rm, s1, 'Rack RM-03'],
    ['RM-BRASS', 'Brass Bar 15mm', 'Raw Material', 'kg', 240, 120, 410, rm, s4, 'Rack RM-04'],
    ['RM-ZINC', 'Zinc Ingot 99.99%', 'Raw Material', 'kg', 900, 400, 165, rm, s4, 'Rack RM-05'],
    ['CN-CUT-OIL', 'Water-Soluble Cutting Oil', 'Consumable', 'L', 320, 120, 210, con, s2, 'Cabinet C-01'],
    ['CN-COOLANT', 'CNC Coolant Concentrate', 'Consumable', 'L', 140, 80, 380, con, s2, 'Cabinet C-02'],
    ['CN-WELD-WIRE', 'MIG Welding Wire 1.2mm', 'Consumable', 'roll', 45, 20, 1450, con, s2, 'Cabinet C-03'],
    ['CN-GRIND-DISC', 'Grinding Disc 4 inch', 'Consumable', 'pc', 260, 100, 65, con, s2, 'Bin C-04'],
    ['CN-DIE-LUBE', 'Die Release Lubricant', 'Consumable', 'L', 95, 50, 540, con, s2, 'Cabinet C-05'],
    ['CN-GLOVES', 'Heat-Resistant Gloves', 'Consumable', 'pair', 80, 40, 185, con, s2, 'Bin C-06'],
    ['CN-SAFETY-GLASS', 'Safety Glasses', 'Consumable', 'pc', 60, 30, 95, con, s2, 'Bin C-07'],
    ['SP-CNC-INSERT', 'CNC Carbide Insert CNMG', 'Spare Part', 'pc', 150, 80, 420, sp, s3, 'Drawer S-01'],
    ['SP-HYD-OIL', 'Hydraulic Oil ISO 68', 'Spare Part', 'L', 210, 100, 265, sp, s3, 'Drum S-02'],
    ['SP-BEARING', 'Spindle Bearing 6205', 'Spare Part', 'pc', 38, 20, 780, sp, s3, 'Drawer S-03'],
    ['SP-BELT', 'Drive Belt A-42', 'Spare Part', 'pc', 22, 15, 460, sp, s3, 'Drawer S-04'],
    ['SP-FILTER', 'Hydraulic Filter Element', 'Spare Part', 'pc', 14, 10, 1250, sp, s3, 'Drawer S-05'],
    ['SP-NOZZLE', 'Die-Casting Nozzle Tip', 'Spare Part', 'pc', 9, 12, 3200, sp, s3, 'Drawer S-06'],
    ['SP-SEAL', 'Hydraulic Seal Kit', 'Spare Part', 'set', 6, 8, 1850, sp, s3, 'Drawer S-07'],
    ['FG-BRACKET', 'Aluminum Mounting Bracket', 'Finished Good', 'pc', 1450, 500, 95, fg, null, 'FG-A1'],
    ['FG-HEATSINK', 'Heat Sink HS-220', 'Finished Good', 'pc', 620, 300, 240, fg, null, 'FG-A2'],
    ['FG-GEARBOX', 'Gearbox Housing GH-45', 'Finished Good', 'pc', 180, 100, 860, fg, null, 'FG-B1'],
    ['FG-CONNECTOR', 'Precision Connector Plate', 'Finished Good', 'pc', 95, 150, 380, fg, null, 'FG-B2'],
    ['PK-CARTON', 'Export Carton (Medium)', 'Packaging', 'pc', 340, 150, 48, fg, s5, 'PK-01'],
    ['PK-PALLET', 'Wooden Pallet', 'Packaging', 'pc', 48, 30, 350, fg, s5, 'PK-02'],
    ['PK-FOAM', 'Protective Foam Sheet', 'Packaging', 'sheet', 120, 60, 85, fg, s5, 'PK-03'],
  ];

  const items: SeedItem[] = rows.map(
    ([sku, name, category, unit, quantity, reorder, cost, warehouse, supplier, location]) => {
      const id = ins('items', {
        sku,
        name,
        category,
        unit,
        quantity,
        reorder_point: reorder,
        unit_cost: cost,
        warehouse_id: warehouse,
        supplier_id: supplier,
        location,
        active: 1,
        created_at: dtAgo(150, 8, 0),
        updated_at: dtAgo(2, 15, 0),
      });
      ins('stock_movements', {
        item_id: id,
        type: 'IN',
        quantity,
        unit_cost: cost,
        reference: 'Opening Balance',
        notes: 'Initial stock count',
        resulting_qty: quantity,
        created_by: 'system',
        created_at: dtAgo(150, 8, 0),
      });
      return { id, sku, name, category, unit, quantity, cost, reorder };
    }
  );

  // Recent production consumption for selected, non-critical materials.
  const consumption: Array<[string, number]> = [
    ['RM-ADC12', 320], ['RM-STEEL-SPCC', 24], ['CN-CUT-OIL', 42], ['CN-GRIND-DISC', 35],
    ['CN-WELD-WIRE', 6], ['SP-CNC-INSERT', 18], ['CN-GLOVES', 9], ['PK-CARTON', 45],
  ];
  consumption.forEach(([sku, qty], index) => {
    const item = items.find((i) => i.sku === sku);
    if (!item) return;
    const nextQty = round2(Number(item.quantity) - qty);
    db.prepare('UPDATE items SET quantity = ? WHERE id = ?').run(nextQty, item.id);
    item.quantity = nextQty;
    ins('stock_movements', {
      item_id: item.id,
      type: 'OUT',
      quantity: qty,
      unit_cost: item.cost,
      reference: `PRD-${new Date().getFullYear()}-${String(1001 + index).padStart(4, '0')}`,
      notes: 'Issued to production',
      resulting_qty: nextQty,
      created_by: 'maintenance',
      created_at: dtAgo(20 - index, 10, 15),
    });
  });

  return items;
}

type MachineSeed = [string, string, string, number, string, string, string, string, string];

function seedMachines(plants: number[]): number[] {
  const rows: MachineSeed[] = [
    ['MC-001', 'CNC Machining Center #1', 'CNC Machining Center', plants[0], 'Plant 1 · Bay 1', 'Mazak', 'VCN-530C', 'MZK-530-1187', 'Running'],
    ['MC-002', 'CNC Machining Center #2', 'CNC Machining Center', plants[0], 'Plant 1 · Bay 1', 'DMG Mori', 'NVX-5080', 'DMG-5080-2214', 'Running'],
    ['MC-003', 'CNC Lathe #1', 'Lathe', plants[0], 'Plant 1 · Bay 2', 'Okuma', 'LB-3000', 'OKM-3000-7741', 'Running'],
    ['MC-004', 'Die-Casting Machine 250T', 'Die-Casting Machine', plants[1], 'Plant 2 · Casting Aisle', 'Toshiba', 'DC-250', 'TSH-250-3388', 'Running'],
    ['MC-005', 'Die-Casting Machine 400T', 'Die-Casting Machine', plants[1], 'Plant 2 · Casting Aisle', 'Ube', 'UB-400', 'UBE-400-5120', 'Under Maintenance'],
    ['MC-006', 'Hydraulic Press 100T', 'Hydraulic Press', plants[1], 'Plant 2 · Press Line', 'Amada', 'HP-100', 'AMD-100-9032', 'Running'],
    ['MC-007', 'MIG Welding Robot', 'Welding Machine', plants[1], 'Plant 2 · Welding Cell', 'Panasonic', 'TA-1400', 'PAN-1400-6612', 'Idle'],
    ['MC-008', 'Shot Blast Machine', 'Shot Blast', plants[1], 'Plant 2 · Finishing', 'Sinto', 'SB-800', 'SIN-800-4480', 'Running'],
    ['MC-009', 'Surface Grinder', 'Grinder', plants[0], 'Plant 1 · Tool Room', 'Okamoto', 'SG-64', 'OKM-64-1190', 'Breakdown'],
    ['MC-010', 'Air Compressor 75HP', 'Compressor', plants[0], 'Plant 1 · Utility Room', 'Atlas Copco', 'GA-75', 'AC-75-8821', 'Running'],
    ['MC-011', 'CMM Inspection Machine', 'Inspection Equipment', plants[0], 'Plant 1 · QA Lab', 'Mitutoyo', 'Crysta-Apex', 'MIT-CA-3309', 'Running'],
    ['MC-012', 'TIG Welding Station', 'Welding Machine', plants[1], 'Plant 2 · Welding Cell', 'Fronius', 'MagicWave', 'FRN-MW-2260', 'Running'],
  ];
  return rows.map(([code, name, type, plant, location, manufacturer, model, serial, status]) =>
    ins('machines', {
      asset_code: code,
      name,
      type,
      plant_id: plant,
      location,
      manufacturer,
      model,
      serial_no: serial,
      acquired_date: dateAgo(int(400, 2200)),
      status,
      notes: status === 'Breakdown' ? 'Reported abnormal spindle vibration; awaiting parts.' : '',
      created_at: dtAgo(200),
    })
  );
}

type ScheduleSeed = [number, string, string, number, number, string];

function seedSchedules(machines: number[]): number[] {
  const rows: ScheduleSeed[] = [
    [0, 'CNC spindle lubrication & calibration', 'Preventive', 30, -6, 'Rodel Bautista'],
    [4, 'Hydraulic oil change and filter replacement', 'Preventive', 90, -2, 'Joel Dagohoy'],
    [3, 'Die-casting nozzle and plunger inspection', 'Inspection', 14, 0, 'Joel Dagohoy'],
    [9, 'Compressor air filter replacement', 'Preventive', 60, 3, 'Rodel Bautista'],
    [7, 'Shot blast media replenishment', 'Preventive', 45, 6, 'Benjie Ocampo'],
    [1, 'CNC axis backlash check', 'Calibration', 180, 12, 'Rodel Bautista'],
    [5, 'Press hydraulic pressure verification', 'Preventive', 30, 20, 'Joel Dagohoy'],
    [10, 'CMM probe calibration', 'Calibration', 365, 28, 'Grace Villanueva'],
    [6, 'Welding robot torch cleaning', 'Preventive', 7, 40, 'Benjie Ocampo'],
    [11, 'TIG welder safety inspection', 'Inspection', 90, 55, 'Benjie Ocampo'],
  ];
  return rows.map(([machineId, title, type, interval, offset, assigned]) => {
    const nextDue = addDays(today(), offset);
    return ins('maintenance_schedules', {
      machine_id: machines[machineId],
      title,
      maintenance_type: type,
      interval_days: interval,
      last_done: addDays(nextDue, -interval),
      next_due: nextDue,
      assigned_to: assigned,
      checklist: 'Follow the standard maintenance checklist and record findings before closing the work order.',
      active: 1,
      created_at: dtAgo(170),
    });
  });
}

interface WorkOrderSeed {
  days: number;
  machine: number;
  type: string;
  status: string;
  priority: string;
  downtime: number;
  labor: number;
}

function seedWorkOrders(machines: number[], schedules: number[], items: SeedItem[]): void {
  const technicians = ['Rodel Bautista', 'Joel Dagohoy', 'Benjie Ocampo'];
  const definitions: WorkOrderSeed[] = [
    { days: 132, machine: 0, type: 'Preventive', status: 'Completed', priority: 'Medium', downtime: 3.5, labor: 1800 },
    { days: 118, machine: 4, type: 'Corrective', status: 'Completed', priority: 'High', downtime: 6.0, labor: 3200 },
    { days: 96, machine: 3, type: 'Preventive', status: 'Completed', priority: 'Medium', downtime: 2.0, labor: 1200 },
    { days: 84, machine: 9, type: 'Corrective', status: 'Completed', priority: 'High', downtime: 4.5, labor: 2400 },
    { days: 70, machine: 1, type: 'Preventive', status: 'Completed', priority: 'Low', downtime: 1.5, labor: 900 },
    { days: 58, machine: 5, type: 'Preventive', status: 'Completed', priority: 'Medium', downtime: 2.5, labor: 1500 },
    { days: 47, machine: 8, type: 'Corrective', status: 'Completed', priority: 'Critical', downtime: 9.0, labor: 5200 },
    { days: 39, machine: 6, type: 'Preventive', status: 'Completed', priority: 'Low', downtime: 1.0, labor: 750 },
    { days: 31, machine: 10, type: 'Calibration', status: 'Completed', priority: 'Medium', downtime: 2.0, labor: 2100 },
    { days: 26, machine: 2, type: 'Corrective', status: 'Completed', priority: 'High', downtime: 5.5, labor: 2900 },
    { days: 18, machine: 11, type: 'Inspection', status: 'Completed', priority: 'Low', downtime: 0.5, labor: 600 },
    { days: 12, machine: 0, type: 'Preventive', status: 'In Progress', priority: 'Medium', downtime: 1.5, labor: 700 },
    { days: 9, machine: 4, type: 'Preventive', status: 'On Hold', priority: 'High', downtime: 3.0, labor: 1300 },
    { days: 6, machine: 9, type: 'Corrective', status: 'Open', priority: 'Critical', downtime: 0, labor: 0 },
    { days: 4, machine: 3, type: 'Inspection', status: 'Open', priority: 'Medium', downtime: 0, labor: 0 },
    { days: 2, machine: 7, type: 'Preventive', status: 'Open', priority: 'Low', downtime: 0, labor: 0 },
  ];

  const descriptions = [
    'Routine maintenance performed according to the preventive checklist.',
    'Abnormal noise reported by operator; inspected and corrected.',
    'Hydraulic pressure drifting below specification; seals and oil checked.',
    'Spindle vibration detected during finishing pass; bearing inspected.',
    'Safety guards and interlocks verified. No issues found.',
  ];

  const createdOrderIds: Array<{ id: number; days: number }> = [];
  definitions.forEach((def, index) => {
    const createdAt = dtAgo(def.days, 8, 15);
    const completedAt = def.status === 'Completed' ? dateAgo(Math.max(def.days - 1, 0)) : null;
    const id = ins('maintenance_orders', {
      wo_number: `WO-${new Date().getFullYear()}-${String(index + 1).padStart(4, '0')}`,
      machine_id: machines[def.machine],
      schedule_id: index < 4 ? schedules[index] : null,
      type: def.type,
      priority: def.priority,
      status: def.status,
      reported_by: index % 3 === 0 ? 'Production Supervisor' : 'Machine Operator',
      assigned_to: technicians[index % technicians.length],
      description: descriptions[index % descriptions.length],
      downtime_hours: def.downtime,
      labor_cost: def.labor,
      parts_cost: 0,
      started_at: dateAgo(Math.max(def.days - 2, 0)),
      completed_at: completedAt,
      created_at: createdAt,
      updated_at: completedAt ? `${completedAt} 16:30:00` : createdAt,
    });
    createdOrderIds.push({ id, days: def.days });
  });

  const parts: Array<[number, string, number]> = [
    [0, 'SP-CNC-INSERT', 4], [0, 'SP-HYD-OIL', 8],
    [1, 'SP-SEAL', 1], [1, 'SP-HYD-OIL', 12],
    [3, 'SP-BEARING', 2], [3, 'SP-BELT', 2],
    [6, 'SP-FILTER', 2], [8, 'SP-CNC-INSERT', 6],
    [10, 'SP-BEARING', 1],
  ];
  for (const [woIndex, sku, qty] of parts) {
    const wo = createdOrderIds[woIndex];
    const item = items.find((i) => i.sku === sku);
    if (!wo || !item) continue;
    const cost = Number(item.cost);
    ins('maintenance_parts', {
      maintenance_order_id: wo.id,
      item_id: item.id,
      quantity: qty,
      unit_cost: cost,
      created_at: `${dateAgo(Math.max(wo.days - 1, 0))} 11:20:00`,
    });
    const nextQty = round2(Number(item.quantity) - qty);
    db.prepare('UPDATE items SET quantity = ? WHERE id = ?').run(nextQty, item.id);
    item.quantity = nextQty;
    ins('stock_movements', {
      item_id: item.id,
      type: 'OUT',
      quantity: qty,
      unit_cost: cost,
      reference: `WO-${new Date().getFullYear()}-${String(woIndex + 1).padStart(4, '0')}`,
      notes: 'Spare part issued to work order',
      resulting_qty: nextQty,
      created_by: 'maintenance',
      created_at: `${dateAgo(Math.max(wo.days - 1, 0))} 11:20:00`,
    });
  }

  const totals = db
    .prepare(
      'SELECT maintenance_order_id AS id, SUM(quantity * unit_cost) AS total FROM maintenance_parts GROUP BY maintenance_order_id'
    )
    .all();
  for (const total of totals) {
    db.prepare('UPDATE maintenance_orders SET parts_cost = ? WHERE id = ?').run(round2(total.total), total.id);
  }
}

interface ProductSeed {
  name: string;
  unit: string;
  target: number;
}

function seedProduction(customers: number[], machines: number[], plants: number[]): void {
  const products: ProductSeed[] = [
    { name: 'Aluminum Mounting Bracket', unit: 'pc', target: 3200 },
    { name: 'Heat Sink HS-220', unit: 'pc', target: 1800 },
    { name: 'Gearbox Housing GH-45', unit: 'pc', target: 600 },
    { name: 'Precision Connector Plate', unit: 'pc', target: 2400 },
    { name: 'Motor End Cap', unit: 'pc', target: 1500 },
    { name: 'Sensor Bracket SB-12', unit: 'pc', target: 2800 },
    { name: 'Die-Cast Cover Plate', unit: 'pc', target: 1100 },
    { name: 'Welded Frame Assembly', unit: 'pc', target: 450 },
  ];

  let sequence = 0;
  for (let monthOffset = -5; monthOffset <= 0; monthOffset += 1) {
    for (let i = 0; i < 7; i += 1) {
      sequence += 1;
      const product = products[(sequence + i) % products.length];
      const customer = customers[(sequence + i) % customers.length];
      const machine = machines[(sequence + i * 2) % machines.length];
      const plant = plants[sequence % 2];
      const target = Math.round((product.target * between(0.75, 1.15)) / 50) * 50;
      const isCurrentMonth = monthOffset === 0;
      let status = 'Completed';
      if (isCurrentMonth && i >= 5) status = i === 6 ? 'Planned' : 'In Progress';
      else if (isCurrentMonth && i === 4 && rnd() > 0.5) status = 'In Progress';

      let completed = status === 'Completed' ? Math.round(target * between(0.92, 1.03)) : 0;
      if (status === 'In Progress') completed = Math.round(target * between(0.35, 0.75));
      if (status === 'Planned') completed = 0;
      const scrap = completed > 0 ? Math.round(completed * between(0.004, 0.018)) : 0;

      const startDay = 2 + i * 3;
      const startDate = monthDate(monthOffset, startDay);
      const dueDate = addDays(startDate, int(9, 18));
      const completedAt = status === 'Completed' ? dueDate : null;
      ins('production_orders', {
        order_no: `PRD-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`,
        customer_id: customer,
        product_name: product.name,
        target_qty: target,
        completed_qty: completed,
        scrap_qty: scrap,
        unit: product.unit,
        machine_id: machine,
        plant_id: plant,
        status,
        start_date: startDate,
        due_date: dueDate,
        completed_at: completedAt,
        notes: '',
        created_at: `${startDate} 07:45:00`,
        updated_at: completedAt ? `${completedAt} 16:10:00` : `${startDate} 07:45:00`,
      });
    }
  }
}

interface PurchaseOrderSeed {
  daysAgo: number;
  supplier: number;
  status: string;
  lines: Array<[string, number, number]>;
}

function seedPurchaseOrders(suppliers: number[], items: SeedItem[]): void {
  const definitions: PurchaseOrderSeed[] = [
    { daysAgo: 142, supplier: 0, status: 'Received', lines: [['RM-STEEL-SPCC', 40, 1250], ['RM-SS304', 120, 320]] },
    { daysAgo: 118, supplier: 3, status: 'Received', lines: [['RM-ADC12', 900, 185], ['RM-ZINC', 250, 165]] },
    { daysAgo: 86, supplier: 2, status: 'Received', lines: [['SP-CNC-INSERT', 60, 420], ['SP-HYD-OIL', 80, 265]] },
    { daysAgo: 62, supplier: 1, status: 'Received', lines: [['CN-CUT-OIL', 80, 210], ['CN-GLOVES', 30, 185], ['CN-GRIND-DISC', 90, 65]] },
    { daysAgo: 34, supplier: 4, status: 'Ordered', lines: [['PK-CARTON', 150, 48], ['PK-PALLET', 25, 350]] },
    { daysAgo: 21, supplier: 2, status: 'Ordered', lines: [['SP-FILTER', 10, 1250], ['SP-NOZZLE', 8, 3200]] },
    { daysAgo: 9, supplier: 0, status: 'Draft', lines: [['RM-BRASS', 60, 410]] },
    { daysAgo: 48, supplier: 1, status: 'Cancelled', lines: [['CN-DIE-LUBE', 20, 540]] },
  ];

  definitions.forEach((def, index) => {
    const orderDate = dateAgo(def.daysAgo);
    const received = def.status === 'Received';
    const poId = ins('purchase_orders', {
      po_number: `PO-${new Date().getFullYear()}-${String(index + 1).padStart(4, '0')}`,
      supplier_id: suppliers[def.supplier],
      status: def.status,
      order_date: orderDate,
      expected_date: addDays(orderDate, 14),
      received_date: received ? addDays(orderDate, 10) : null,
      total_amount: round2(def.lines.reduce((sum, line) => sum + line[1] * line[2], 0)),
      notes: '',
      created_by: 'admin',
      created_at: `${orderDate} 09:00:00`,
    });

    for (const [sku, qty, cost] of def.lines) {
      const item = items.find((i) => i.sku === sku);
      if (!item) continue;
      ins('purchase_order_items', {
        purchase_order_id: poId,
        item_id: item.id,
        quantity: qty,
        unit_cost: cost,
        received_qty: received ? qty : 0,
      });
      if (received) {
        const nextQty = round2(Number(item.quantity) + qty);
        db.prepare('UPDATE items SET quantity = ? WHERE id = ?').run(nextQty, item.id);
        item.quantity = nextQty;
        ins('stock_movements', {
          item_id: item.id,
          type: 'IN',
          quantity: qty,
          unit_cost: cost,
          reference: `PO-${new Date().getFullYear()}-${String(index + 1).padStart(4, '0')}`,
          notes: 'Received against purchase order',
          resulting_qty: nextQty,
          created_by: 'admin',
          created_at: `${addDays(orderDate, 10)} 13:30:00`,
        });
      }
    }
  });
}

function seedActivity(): void {
  const rows: Array<[string, string, string, string, string, string]> = [
    ['admin', 'Signed in', 'admin', 'Session', 'User signed in', dtAgo(1, 8, 2)],
    ['maintenance', 'Created', 'maintenance', 'Work Order', 'WO-2026-0016 preventive work order created', dtAgo(2, 9, 25)],
    ['manager', 'Updated', 'production', 'Production Order', 'PRD-2026-0042 moved to In Progress', dtAgo(2, 13, 10)],
    ['admin', 'Received', 'purchasing', 'Purchase Order', 'PO-2026-0006 received into stock', dtAgo(3, 15, 45)],
    ['maintenance', 'Created', 'inventory', 'Stock Movement', 'OUT 20 kg SP-CNC-INSERT for WO-2026-0014', dtAgo(4, 10, 5)],
    ['manager', 'Updated', 'maintenance', 'Schedule', 'CNC spindle lubrication rescheduled', dtAgo(5, 11, 30)],
    ['user', 'Signed in', 'admin', 'Session', 'User signed in', dtAgo(6, 7, 55)],
  ];
  for (const [username, action, module, entity, details, createdAt] of rows) {
    ins('activity_log', {
      user_id: null,
      username,
      action,
      module,
      entity,
      details,
      created_at: createdAt,
    });
  }
}
