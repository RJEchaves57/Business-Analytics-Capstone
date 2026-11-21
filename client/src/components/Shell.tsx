import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initials } from '../lib/format';
import { profileFor } from '../lib/roles';
import ChangePasswordModal from './ChangePasswordModal';
import Icon from './Icon';

interface NavChild {
  key: string;
  label: string;
  to: string;
}

interface NavLinkEntry {
  type: 'link';
  key: string;
  label: string;
  icon: string;
  to: string;
  module: string;
}

interface NavGroupEntry {
  type: 'group';
  key: string;
  label: string;
  icon: string;
  module: string;
  items: NavChild[];
}

type NavEntry = NavLinkEntry | NavGroupEntry;

const NAV: NavEntry[] = [
  { type: 'link', key: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/dashboard', module: 'dashboard' },
  {
    type: 'group',
    key: 'inventory',
    label: 'Inventory',
    icon: 'box',
    module: 'inventory',
    items: [
      { key: 'items', label: 'Items', to: '/inventory/items' },
      { key: 'movements', label: 'Stock movements', to: '/inventory/movements' },
      { key: 'warehouses', label: 'Warehouses & plants', to: '/inventory/warehouses' },
    ],
  },
  {
    type: 'group',
    key: 'maintenance',
    label: 'Maintenance',
    icon: 'wrench',
    module: 'maintenance',
    items: [
      { key: 'work-orders', label: 'Work orders', to: '/maintenance/work-orders' },
      { key: 'schedules', label: 'Preventive schedules', to: '/maintenance/schedules' },
      { key: 'machines', label: 'Machines', to: '/maintenance/machines' },
    ],
  },
  { type: 'link', key: 'production', label: 'Production', icon: 'factory', to: '/production', module: 'production' },
  {
    type: 'group',
    key: 'purchasing',
    label: 'Purchasing',
    icon: 'cart',
    module: 'purchasing',
    items: [
      { key: 'purchase-orders', label: 'Purchase orders', to: '/purchasing/purchase-orders' },
      { key: 'suppliers', label: 'Suppliers', to: '/purchasing/suppliers' },
      { key: 'customers', label: 'Customers', to: '/purchasing/customers' },
    ],
  },
  { type: 'link', key: 'reports', label: 'Reports', icon: 'chart', to: '/reports', module: 'reports' },
  {
    type: 'group',
    key: 'admin',
    label: 'Administration',
    icon: 'shield',
    module: 'admin',
    items: [
      { key: 'users', label: 'Users', to: '/admin/users' },
      { key: 'activity', label: 'Activity log', to: '/admin/activity' },
      { key: 'settings', label: 'System settings', to: '/admin/settings' },
    ],
  },
];

const CRUMBS: Record<string, string | Record<string, string>> = {
  dashboard: 'Dashboard',
  production: 'Production orders',
  reports: 'Reports',
  inventory: {
    items: 'Inventory · Items',
    movements: 'Inventory · Stock movements',
    warehouses: 'Inventory · Warehouses',
    plants: 'Inventory · Plants',
  },
  maintenance: {
    'work-orders': 'Maintenance · Work orders',
    schedules: 'Maintenance · Schedules',
    machines: 'Maintenance · Machines',
  },
  purchasing: {
    'purchase-orders': 'Purchasing · Purchase orders',
    suppliers: 'Purchasing · Suppliers',
    customers: 'Purchasing · Customers',
  },
  admin: {
    users: 'Administration · Users',
    activity: 'Administration · Activity log',
    settings: 'Administration · Settings',
  },
};

function crumbFor(pathname: string): string {
  const [section, sub = ''] = pathname.replace(/^\//, '').split('/');
  const value = CRUMBS[section];
  if (!value) return 'Dashboard';
  if (typeof value === 'string') return value;
  return value[sub] || Object.values(value)[0] || 'Dashboard';
}

function itemIsActive(item: NavChild, pathname: string): boolean {
  if (pathname === item.to) return true;
  if (item.to === '/inventory/warehouses' && pathname.startsWith('/inventory/plants')) return true;
  return false;
}

export default function Shell() {
  const { user, settings, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const company = settings.company_short || 'Makoto Metal';
  const site = settings.site || 'MEPZ II, Basak, Lapu-Lapu City, Cebu';
  const pathname = location.pathname;
  const section = pathname.split('/')[1] || 'dashboard';

  useEffect(() => {
    const group = NAV.find((entry): entry is NavGroupEntry => entry.type === 'group' && entry.key === section);
    if (group) setOpenGroups((current) => ({ ...current, [group.key]: true }));
    setSidebarOpen(false);
    setUserMenuOpen(false);
  }, [pathname, section]);

  useEffect(() => {
    const onClick = (event: Event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const displayName = (user && (user.fullName || user.username)) || 'User';
  const profile = profileFor(user?.role);
  const visibleNav = NAV.filter((entry) => profile.modules.includes(entry.module));
  const canSeeReports = profile.modules.includes('reports');

  const signOut = async () => {
    setUserMenuOpen(false);
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <Link to="/dashboard" className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">{company}</div>
            <div className="brand-sub">MEPZ II Operations</div>
          </div>
        </Link>
        <div className="sidebar-site">
          <Icon name="building" size={14} />
          <span>{site}</span>
        </div>
        <nav className="nav" aria-label="Main navigation">
          <div className="nav-section">{profile.short} workspace</div>
          {visibleNav.map((entry) => {
            if (entry.type === 'link') {
              return (
                <NavLink
                  key={entry.key}
                  to={entry.to}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <Icon name={entry.icon} size={17} />
                  <span>{entry.label}</span>
                </NavLink>
              );
            }
            const open = Boolean(openGroups[entry.key]);
            const groupActive = entry.items.some((item) => itemIsActive(item, pathname));
            return (
              <div key={entry.key} className={`nav-group ${open ? 'open' : ''}`}>
                <button
                  type="button"
                  className={`nav-link ${groupActive ? 'active' : ''}`}
                  onClick={() => setOpenGroups((current) => ({ ...current, [entry.key]: !current[entry.key] }))}
                >
                  <Icon name={entry.icon} size={17} />
                  <span>{entry.label}</span>
                  <span className="nav-caret">
                    <Icon name="chevronRight" size={13} />
                  </span>
                </button>
                <div className="nav-children">
                  {entry.items.map((item) => (
                    <Link
                      key={item.key}
                      to={item.to}
                      className={`nav-child ${itemIsActive(item, pathname) ? 'active' : ''}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <div className="avatar amber">{initials(displayName)}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-role">
              {profile.label}
              {user?.department ? ` · ${user.department}` : ''}
            </div>
          </div>
          <button type="button" className="icon-btn" title="Sign out" aria-label="Sign out" onClick={signOut}>
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen((value) => !value)}
          >
            <Icon name="menu" size={19} />
          </button>
          <div className="crumbs">
            <span>{company}</span>
            <span className="sep">/</span>
            <b>{crumbFor(pathname)}</b>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <span className="connection-pill">System online</span>
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-chip"
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  setUserMenuOpen((value) => !value);
                }}
              >
                <div className="avatar">{initials(displayName)}</div>
                <div>
                  <div className="user-chip-name">{displayName}</div>
                  <div className="user-chip-role">{profile.label}</div>
                </div>
              </button>
              <div className={`dropdown ${userMenuOpen ? 'open' : ''}`}>
                <div className="dropdown-user">
                  <strong>{displayName}</strong>
                  <span>{profile.label}{user?.department ? ` · ${user.department}` : ''}</span>
                </div>
                <div className="dropdown-sep" />
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setPasswordOpen(true);
                  }}
                >
                  <Icon name="key" size={15} /> Change password
                </button>
                {canSeeReports ? (
                  <Link className="dropdown-item" to="/reports" onClick={() => setUserMenuOpen(false)}>
                    <Icon name="chart" size={15} /> Reports
                  </Link>
                ) : null}
                <div className="dropdown-sep" />
                <button type="button" className="dropdown-item danger" onClick={signOut}>
                  <Icon name="logout" size={15} /> Sign out
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="view">
          <Outlet />
        </main>
      </div>

      {passwordOpen ? <ChangePasswordModal onClose={() => setPasswordOpen(false)} /> : null}
    </div>
  );
}
