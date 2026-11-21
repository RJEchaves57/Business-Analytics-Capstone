import type { Action, Role } from '../types';

/** Four distinct shop-floor personas. Legacy roles are mapped so old databases still work. */
export function normalizeRole(role?: string | null): Role {
  if (role === 'staff') return 'maintenance';
  if (role === 'viewer') return 'user';
  return (role as Role) || 'user';
}

export function canRole(role: Role | null | undefined, module: string, action: Action = 'read'): boolean {
  const r = normalizeRole(role);
  if (r === 'admin') return true;
  if (module === 'admin' || module === 'settings') return false;

  if (r === 'manager') {
    if (action === 'read') return ['dashboard', 'inventory', 'maintenance', 'production', 'purchasing', 'reports'].includes(module);
    return ['inventory', 'production', 'purchasing'].includes(module); // includes delete
  }
  if (r === 'maintenance') {
    if (action === 'read') return ['dashboard', 'inventory', 'maintenance', 'reports'].includes(module);
    return module === 'maintenance';
  }
  // Shop user: records output, checks stock, nothing else.
  if (action === 'read') return ['dashboard', 'inventory', 'production'].includes(module);
  return module === 'production';
}

export interface QuickLink {
  label: string;
  to: string;
  icon: string;
}

export interface RoleProfile {
  label: string;
  short: string;
  tagline: string;
  focus: string;
  modules: string[];
  quick: QuickLink[];
  actions: string[]; // empty = all action categories
  demo: { username: string; password: string };
}

export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  admin: {
    label: 'Plant Administrator',
    short: 'Admin',
    tagline: 'Full control of the shop',
    focus: 'People, settings, every module, and the full audit trail.',
    modules: ['dashboard', 'inventory', 'maintenance', 'production', 'purchasing', 'reports', 'admin'],
    quick: [
      { label: 'Manage users', to: '/admin/users', icon: 'users' },
      { label: 'Activity log', to: '/admin/activity', icon: 'shield' },
      { label: 'All reports', to: '/reports', icon: 'chart' },
    ],
    actions: [],
    demo: { username: 'admin', password: 'admin123' },
  },
  manager: {
    label: 'Operations Manager',
    short: 'Manager',
    tagline: 'Keep orders and supply moving',
    focus: 'Production targets, purchasing, stock health, and management reports.',
    modules: ['dashboard', 'inventory', 'maintenance', 'production', 'purchasing', 'reports'],
    quick: [
      { label: 'Production orders', to: '/production', icon: 'factory' },
      { label: 'Purchase orders', to: '/purchasing/purchase-orders', icon: 'cart' },
      { label: 'Reports', to: '/reports', icon: 'chart' },
    ],
    actions: [],
    demo: { username: 'manager', password: 'manager123' },
  },
  maintenance: {
    label: 'Maintenance Staff',
    short: 'Maintenance',
    tagline: 'Keep every machine running',
    focus: 'Work orders, preventive schedules, machine status, and spare parts.',
    modules: ['dashboard', 'inventory', 'maintenance', 'reports'],
    quick: [
      { label: 'Work orders', to: '/maintenance/work-orders', icon: 'wrench' },
      { label: 'Preventive schedules', to: '/maintenance/schedules', icon: 'calendar' },
      { label: 'Machines', to: '/maintenance/machines', icon: 'cog' },
    ],
    actions: ['Maintenance', 'Inventory'],
    demo: { username: 'maintenance', password: 'maintenance123' },
  },
  user: {
    label: 'Shop User',
    short: 'User',
    tagline: 'Record work on the floor',
    focus: 'Log production output and look up stock. No buying, machine, or admin access.',
    modules: ['dashboard', 'inventory', 'production'],
    quick: [
      { label: 'Production orders', to: '/production', icon: 'factory' },
      { label: 'Stock items', to: '/inventory/items', icon: 'box' },
      { label: 'Stock movements', to: '/inventory/movements', icon: 'swap' },
    ],
    actions: ['Production'],
    demo: { username: 'user', password: 'user123' },
  },
};

export const profileFor = (role?: string | null): RoleProfile => ROLE_PROFILES[normalizeRole(role)];
