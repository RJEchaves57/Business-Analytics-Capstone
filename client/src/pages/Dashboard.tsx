import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { BarChart, DonutChart, EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { fmtCompactMoney, fmtDate, fmtDateTime, fmtNum, relativeTime, badgeClass } from '../lib/format';
import { profileFor } from '../lib/roles';
import type { DashboardData, Row } from '../types';

const ACTION_ICONS: Record<string, string> = {
  Inventory: 'box',
  Maintenance: 'wrench',
  Production: 'factory',
  Purchasing: 'cart',
};

const ACTION_TONES: Record<string, string> = {
  Critical: 'red',
  High: 'amber',
  Normal: 'blue',
};

interface KpiProps {
  label: string;
  value: unknown;
  sub?: ReactNode;
  icon: string;
  tone?: string;
  money?: boolean;
}

function Kpi({ label, value, sub, icon, tone = '', money = false }: KpiProps) {
  return (
    <div className="kpi">
      <div className="kpi-accent" />
      <div className="kpi-top">
        <div className={`kpi-icon ${tone}`}>
          <Icon name={icon} size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-value">{money ? fmtCompactMoney(value) : fmtNum(value)}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function LowStockRow({ item }: { item: Row }) {
  const out = Number(item.quantity) <= 0;
  return (
    <Link className="list-row clickable" to="/inventory/items">
      <div className={`list-icon ${out ? 'red' : 'amber'}`}>
        <Icon name={out ? 'alert' : 'box'} size={15} />
      </div>
      <div className="list-body">
        <div className="list-title">{item.name}</div>
        <div className="list-sub">
          {item.sku} · {item.category}
        </div>
      </div>
      <div className="list-right">
        <span className={`badge badge-${out ? 'red' : 'amber'}`}>
          {fmtNum(item.quantity)} {item.unit}
        </span>
        <small>Reorder at {fmtNum(item.reorder_point)}</small>
      </div>
    </Link>
  );
}

function MaintenanceRow({ row }: { row: Row }) {
  const overdue = row.days_left < 0;
  const tone = overdue ? 'red' : row.days_left <= 7 ? 'amber' : 'blue';
  return (
    <Link className="list-row clickable" to="/maintenance/schedules">
      <div className={`list-icon ${tone}`}>
        <Icon name="calendar" size={15} />
      </div>
      <div className="list-body">
        <div className="list-title">{row.title}</div>
        <div className="list-sub">
          {row.machine_name} · due {fmtDate(row.next_due)}
        </div>
      </div>
      <div className="list-right">
        <span className={`badge badge-${row.due_status === 'Overdue' ? 'red' : row.due_status === 'Due Soon' ? 'amber' : 'blue'}`}>
          {row.due_status}
        </span>
      </div>
    </Link>
  );
}

function MovementRow({ row }: { row: Row }) {
  return (
    <Link className="list-row clickable" to="/inventory/movements">
      <div className={`list-icon ${row.type === 'IN' ? 'green' : 'amber'}`}>
        <Icon name="swap" size={15} />
      </div>
      <div className="list-body">
        <div className="list-title">{row.name}</div>
        <div className="list-sub">
          {row.reference || 'No reference'} · {fmtDateTime(row.created_at)}
        </div>
      </div>
      <div className="list-right">
        <span className="amount">
          {row.type === 'IN' ? '+' : '−'}
          {fmtNum(row.quantity)} {row.unit}
        </span>
        <small>{row.type === 'IN' ? 'Received' : 'Issued'}</small>
      </div>
    </Link>
  );
}

function ActivityRow({ row }: { row: Row }) {
  const color =
    row.action === 'Deleted' ? 'var(--red)' : row.action === 'Created' ? 'var(--green)' : 'var(--brand)';
  return (
    <div className="activity-row">
      <span className="activity-dot" style={{ background: color }} />
      <div className="activity-body">
        <div className="activity-text">
          <strong>{row.username}</strong> {String(row.details || row.action).toLowerCase()}
        </div>
        <div className="activity-time">{relativeTime(row.created_at)}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const profile = profileFor(user?.role);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api<DashboardData>('/api/dashboard'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <PageHeader
      eyebrow={`${profile.label} dashboard`}
      title={profile.tagline}
      subtitle={profile.focus}
      actions={
        <>
          <button type="button" className="btn" onClick={load}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
          {profile.modules.includes('reports') ? (
            <Link className="btn btn-dark" to="/reports">
              <Icon name="chart" size={14} /> View reports
            </Link>
          ) : null}
        </>
      }
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <LoadingBlock rows={6} />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        {header}
        <div className="card">
          <EmptyState title="Could not load dashboard" text={error} icon="alert" />
        </div>
      </>
    );
  }

  const k = data.kpis;
  const actions = profile.actions.length
    ? data.actions.filter((item) => profile.actions.includes(item.category))
    : data.actions;
  const summary = {
    critical: actions.filter((item) => item.priority === 'Critical').length,
    high: actions.filter((item) => item.priority === 'High').length,
    normal: actions.filter((item) => item.priority === 'Normal').length,
    total: actions.length,
  };
  const trendLabels = data.productionTrend.map((row) => row.label.replace(' 20', " '"));

  return (
    <>
      {header}

      <div className="card mb-16">
        <div className="card-head">
          <div>
            <h3>{profile.label} workspace</h3>
            <p>{profile.focus}</p>
          </div>
        </div>
        <div className="card-body">
          <div className="grid grid-3">
            {profile.quick.map((link) => (
              <Link className="btn" to={link.to} key={link.label}>
                <Icon name={link.icon} size={14} /> {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi
          label="Inventory value"
          value={k.inventoryValue}
          money
          icon="coins"
          sub={
            <>
              <strong>{fmtNum(k.skuCount)}</strong> active SKUs
            </>
          }
        />
        <Kpi
          label="Low stock"
          value={k.lowStock}
          icon="alert"
          tone="amber"
          sub={
            <>
              <strong>{fmtNum(k.outOfStock)}</strong> out of stock · needs reorder
            </>
          }
        />
        <Kpi
          label="Production this month"
          value={k.productionMonth}
          icon="factory"
          tone="green"
          sub={
            <>
              Scrap rate <strong>{fmtNum(k.scrapRate)}%</strong>
            </>
          }
        />
        <Kpi
          label="Open work orders"
          value={k.openWorkOrders}
          icon="wrench"
          tone="purple"
          sub={
            <>
              <strong>{fmtNum(k.overdueMaintenance)}</strong> overdue schedules
            </>
          }
        />
        <Kpi
          label="Machines down"
          value={k.machinesDown}
          icon="cog"
          tone="red"
          sub={
            <>
              of <strong>{fmtNum(k.machineTotal)}</strong> registered machines
            </>
          }
        />
        <Kpi
          label="Downtime this month"
          value={k.downtimeMonth}
          icon="clock"
          tone="amber"
          sub="Hours on completed work orders"
        />
        <Kpi
          label="Open purchase orders"
          value={k.openPOs}
          icon="cart"
          sub="Draft, ordered, or partially received"
        />
        <Kpi
          label="Items needing attention"
          value={k.attention}
          icon="shield"
          tone={k.attention > 0 ? 'red' : 'green'}
          sub={k.attention > 0 ? 'Low stock, overdue, and machine issues' : 'Everything is within target'}
        />
      </div>

      {k.attention > 0 ? (
        <div className="info-banner">
          <Icon name="alert" size={16} />
          <div>
            <strong>
              {k.attention} item{k.attention === 1 ? '' : 's'} need attention.
            </strong>{' '}
            {k.lowStock} low-stock item{k.lowStock === 1 ? '' : 's'}, {k.overdueMaintenance} overdue
            maintenance schedule{k.overdueMaintenance === 1 ? '' : 's'} and {k.machinesDown} machine
            {k.machinesDown === 1 ? '' : 's'} down. <Link to="/inventory/items">Review inventory</Link> or{' '}
            <Link to="/maintenance/work-orders">open work orders</Link>.
          </div>
        </div>
      ) : null}

      <div className="card mb-16">
        <div className="card-head">
          <div>
            <h3>{profile.short} priorities</h3>
            <p>
              {profile.actions.length
                ? `Ranked ${profile.actions.join(' and ').toLowerCase()} actions for your role`
                : 'Prioritized decisions across inventory, maintenance, production, and purchasing'}
            </p>
          </div>
          <div className="spacer" />
          {profile.modules.includes('reports') ? (
            <Link className="card-link" to="/reports/action-plan">
              Full action plan <Icon name="arrowRight" size={12} />
            </Link>
          ) : null}
        </div>
        <div className="card-body">
          {actions.length ? (
            <>
              <div className="flex gap-8" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                <span className="badge badge-red no-dot">{summary.critical} critical</span>
                <span className="badge badge-orange no-dot">{summary.high} high</span>
                <span className="badge badge-blue no-dot">{summary.normal} normal</span>
                <span className="badge badge-outline no-dot">{summary.total} total</span>
              </div>
              <div className="list">
                {actions.slice(0, 6).map((item) => (
                  <Link className="list-row clickable" to={item.link} key={item.id}>
                    <div className={`list-icon ${ACTION_TONES[item.priority] || 'blue'}`}>
                      <Icon name={ACTION_ICONS[item.category] || 'alert'} size={15} />
                    </div>
                    <div className="list-body">
                      <div className="list-title">
                        {item.title}{' '}
                        <span className={`badge badge-${badgeClass(item.priority)} no-dot`}>{item.priority}</span>
                      </div>
                      <div className="list-sub">{item.detail}</div>
                      <div className="list-action">{item.action}</div>
                    </div>
                    <div className="list-right">
                      <span className="amount">{item.metric}</span>
                      <small>{item.due_date ? `By ${fmtDate(item.due_date)}` : item.category}</small>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No action required"
              text="Inventory, maintenance, production, and purchasing are within target."
              icon="check"
            />
          )}
        </div>
      </div>

      <div className="grid grid-2-1 mb-16">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Production output</h3>
              <p>Target vs completed, last 6 months</p>
            </div>
            <div className="spacer" />
            <Link className="card-link" to="/production">
              Production orders <Icon name="arrowRight" size={12} />
            </Link>
          </div>
          <div className="card-body">
            <BarChart
              labels={trendLabels}
              series={[
                { name: 'Target', color: '#cbd5e1', values: data.productionTrend.map((row) => row.target) },
                { name: 'Completed', color: '#f59e0b', values: data.productionTrend.map((row) => row.completed) },
              ]}
              height={250}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Inventory by category</h3>
              <p>Current stock value</p>
            </div>
            <div className="spacer" />
            <Link className="card-link" to="/inventory/items">
              <Icon name="arrowRight" size={12} />
            </Link>
          </div>
          <div className="card-body">
            <DonutChart
              data={data.inventoryByCategory.map((row) => ({ label: row.label, value: row.value }))}
              centerLabel="Stock value"
              format="money"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-2 mb-16">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Low stock &amp; reorder</h3>
              <p>
                {k.lowStock} item{k.lowStock === 1 ? '' : 's'} at or below reorder point
              </p>
            </div>
            <div className="spacer" />
            <Link className="card-link" to="/reports">
              Reorder report <Icon name="arrowRight" size={12} />
            </Link>
          </div>
          <div className="card-body">
            {data.lowStockList.length ? (
              <div className="list">
                {data.lowStockList.map((item) => (
                  <LowStockRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState title="Stock levels are healthy" text="No item is at or below its reorder point." icon="check" />
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Upcoming maintenance</h3>
              <p>Schedules due in the next 30 days</p>
            </div>
            <div className="spacer" />
            <Link className="card-link" to="/maintenance/schedules">
              All schedules <Icon name="arrowRight" size={12} />
            </Link>
          </div>
          <div className="card-body">
            {data.upcomingMaintenance.length ? (
              <div className="list">
                {data.upcomingMaintenance.map((row) => (
                  <MaintenanceRow key={row.id} row={row} />
                ))}
              </div>
            ) : (
              <EmptyState title="No maintenance due" text="Nothing is scheduled in the next 30 days." icon="calendar" />
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-2-1 mb-16">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Recent stock movements</h3>
              <p>Latest receipts and issuances</p>
            </div>
            <div className="spacer" />
            <Link className="card-link" to="/inventory/movements">
              Full ledger <Icon name="arrowRight" size={12} />
            </Link>
          </div>
          <div className="card-body">
            {data.recentMovements.length ? (
              <div className="list">
                {data.recentMovements.map((row) => (
                  <MovementRow key={row.id} row={row} />
                ))}
              </div>
            ) : (
              <EmptyState title="No movements yet" icon="swap" />
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Work order status</h3>
              <p>Open and completed jobs</p>
            </div>
            <div className="spacer" />
            <Link className="card-link" to="/maintenance/work-orders">
              <Icon name="arrowRight" size={12} />
            </Link>
          </div>
          <div className="card-body">
            <DonutChart
              data={data.workOrdersByStatus.map((row) => ({ label: row.label, value: row.value }))}
              centerLabel="Work orders"
              format="number"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Recent activity</h3>
            <p>System audit trail</p>
          </div>
          <div className="spacer" />
          <Link className="card-link" to="/admin/activity">
            View audit log <Icon name="arrowRight" size={12} />
          </Link>
        </div>
        <div className="card-body">
          {data.recentActivity.length ? (
            data.recentActivity.map((row) => <ActivityRow key={row.id} row={row} />)
          ) : (
            <EmptyState title="No activity yet" icon="shield" />
          )}
        </div>
      </div>
    </>
  );
}
