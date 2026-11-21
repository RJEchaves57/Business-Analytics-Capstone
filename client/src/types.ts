/** Shared client-side types for the Makoto Metal operations system. */

export type Row = Record<string, any>;

export type Role = 'admin' | 'manager' | 'maintenance' | 'user';

export type Action = 'read' | 'write' | 'delete';

export interface SessionUser {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
  department: string;
  createdAt?: number;
  expiresAt?: number;
}

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
  options?: string[];
  formOptions?: string[];
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

export interface ResourceMeta {
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

export interface Settings {
  company_name?: string;
  company_short?: string;
  site?: string;
  currency?: string;
  maintenance_alert_days?: string;
  default_page_size?: string;
  report_footer?: string;
  [key: string]: string | undefined;
}

export interface ListResponse<T = Row> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ReportCard {
  key: string;
  title: string;
  description: string;
  icon: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'number' | 'money' | 'percent' | string;
}

export interface ReportSummaryItem {
  label: string;
  value: number | string;
  type?: 'number' | 'money' | 'percent' | string;
}

export interface ReportData {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Row[];
  summary: ReportSummaryItem[];
}

export interface MetaResponse {
  user: SessionUser | null;
  settings: Settings;
  enums: Record<string, string[]>;
  reports: ReportCard[];
  resources: Record<string, ResourceMeta>;
}

export interface DashboardKpis {
  inventoryValue: number;
  skuCount: number;
  lowStock: number;
  outOfStock: number;
  machineTotal: number;
  machinesDown: number;
  overdueMaintenance: number;
  openWorkOrders: number;
  openPOs: number;
  productionMonth: number;
  scrapRate: number;
  downtimeMonth: number;
  attention: number;
}

export type ActionPriority = 'Critical' | 'High' | 'Normal';

export interface ActionRecommendation {
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

export interface ActionSummary {
  total: number;
  critical: number;
  high: number;
  normal: number;
}

export interface DashboardData {
  month: string;
  kpis: DashboardKpis;
  productionTrend: Row[];
  inventoryByCategory: Row[];
  machinesByStatus: Row[];
  workOrdersByStatus: Row[];
  lowStockList: Row[];
  upcomingMaintenance: Row[];
  recentActivity: Row[];
  recentMovements: Row[];
  actions: ActionRecommendation[];
  actionSummary: ActionSummary;
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | string;
}

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: string;
}
