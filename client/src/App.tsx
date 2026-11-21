import { Fragment, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Icon from './components/Icon';
import Shell from './components/Shell';
import { EmptyState, PageHeader } from './components/ui';
import { useAuth } from './context/AuthContext';
import { profileFor } from './lib/roles';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Login from './pages/Login';
import Maintenance from './pages/Maintenance';
import Production from './pages/Production';
import Purchasing from './pages/Purchasing';
import Reports from './pages/Reports';

type ModuleRoute = { path: string; module: string; page: ComponentType; tab?: string };

// One entry per module: path, permission, page, and its default tab (if any).
const MODULES: ModuleRoute[] = [
  { path: 'dashboard', module: 'dashboard', page: Dashboard },
  { path: 'inventory', module: 'inventory', page: Inventory, tab: 'items' },
  { path: 'maintenance', module: 'maintenance', page: Maintenance, tab: 'work-orders' },
  { path: 'production', module: 'production', page: Production },
  { path: 'purchasing', module: 'purchasing', page: Purchasing, tab: 'purchase-orders' },
  { path: 'reports', module: 'reports', page: Reports },
  { path: 'admin', module: 'admin', page: Admin, tab: 'users' },
];

function BootScreen({ error }: { error?: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-mark">M</div>
      {error ? (
        <>
          <div
            className="boot-text"
            style={{ textTransform: 'none', letterSpacing: 0, textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}
          >
            The operations console could not reach the server.
            <br />
            <span style={{ color: '#94a3b8' }}>{error}</span>
          </div>
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </>
      ) : (
        <div className="boot-text">Loading operations console…</div>
      )}
    </div>
  );
}

function Message({ eyebrow, title, subtitle, text, icon, emptyTitle = title }: { eyebrow: string; title: string; subtitle: string; text: string; icon: string; emptyTitle?: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <div className="card">
        <EmptyState title={emptyTitle} text={text} icon={icon} />
      </div>
    </>
  );
}

function RequireAccess({ module, children }: { module: string; children: ReactNode }) {
  const { user, can } = useAuth();
  if (can(module)) return children;
  return (
    <Message
      eyebrow="Access restricted"
      title="Permission required"
      subtitle="Your role does not include access to this module."
      text={`Signed in as ${user?.username ?? 'unknown'} (${profileFor(user?.role).label}). Contact an administrator if you need access to ${module}.`}
      icon="lock"
    />
  );
}

function NotFound() {
  return (
    <Message
      eyebrow="Not found"
      title="Page not found"
      subtitle="That address does not match any module in the console."
      text="Use the navigation to open a module."
      icon="info"
      emptyTitle="Nothing here"
    />
  );
}

function RoutesView() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        {MODULES.map(({ path, module, page: Page, tab }) => (
          <Fragment key={path}>
            {tab ? <Route path={path} element={<Navigate to={`/${path}/${tab}`} replace />} /> : null}
            <Route
              path={tab ? `${path}/:tab` : path}
              element={
                <RequireAccess module={module}>
                  <Page />
                </RequireAccess>
              }
            />
          </Fragment>
        ))}
        <Route
          path="reports/:key"
          element={
            <RequireAccess module="reports">
              <Reports />
            </RequireAccess>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { user, loading, notice } = useAuth();
  if (loading) return <BootScreen />;
  if (!user) return <Login />;

  return (
    <>
      {notice ? (
        <div className="info-banner" style={{ margin: 0, borderRadius: 0 }}>
          <Icon name="info" size={16} />
          <div>{notice}</div>
        </div>
      ) : null}
      <RoutesView />
    </>
  );
}
