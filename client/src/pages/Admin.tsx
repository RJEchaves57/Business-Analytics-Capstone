import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import ResourcePage, { type ResourcePageHandle } from '../components/ResourcePage';
import { EmptyState, LoadingBlock, PageHeader, Tabs } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { api } from '../lib/api';
import type { Row, Settings } from '../types';

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'activity', label: 'Activity Log' },
  { key: 'settings', label: 'Settings' },
];

interface SettingField {
  name: string;
  label: string;
  full?: boolean;
  type?: string;
  options?: string[];
  min?: number;
  step?: number;
  help?: string;
  rows?: number;
}

const SETTING_FIELDS: SettingField[] = [
  { name: 'company_name', label: 'Company name', full: true },
  { name: 'company_short', label: 'Short name' },
  {
    name: 'currency',
    label: 'Currency',
    type: 'select',
    options: ['PHP', 'USD', 'JPY', 'EUR', 'GBP'],
  },
  { name: 'site', label: 'Site / address', full: true },
  {
    name: 'maintenance_alert_days',
    label: 'Maintenance alert window (days)',
    type: 'number',
    min: 1,
    step: 1,
    help: 'Schedules within this many days are highlighted as due soon.',
  },
  {
    name: 'default_page_size',
    label: 'Default page size',
    type: 'select',
    options: ['10', '25', '50', '100'],
    help: 'Applies when a table is first opened.',
  },
  {
    name: 'report_footer',
    label: 'Report footer',
    type: 'textarea',
    full: true,
    rows: 2,
    help: 'Printed at the bottom of printed reports.',
  },
];

function SettingsField({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: unknown;
  onChange: (name: string, value: string) => void;
}) {
  const id = `set-${field.name}`;
  let control;
  if (field.type === 'select') {
    control = (
      <select className="select" id={id} value={String(value ?? '')} onChange={(event) => onChange(field.name, event.target.value)}>
        {(field.options || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'textarea') {
    control = (
      <textarea
        className="textarea"
        id={id}
        rows={field.rows || 3}
        value={String(value ?? '')}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    );
  } else {
    control = (
      <input
        className="input"
        type={field.type === 'number' ? 'number' : 'text'}
        id={id}
        min={field.min}
        step={field.step}
        value={String(value ?? '')}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    );
  }
  return (
    <div className={`field ${field.full ? 'full' : ''}`}>
      <label htmlFor={id}>{field.label}</label>
      {control}
      {field.help ? <span className="help">{field.help}</span> : null}
    </div>
  );
}

function SettingsPanel() {
  const { user, settings: contextSettings, setSettings } = useAuth();
  const { toast } = useUI();
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ settings: Settings }>('/api/settings')
      .then((data) => {
        if (!cancelled) setForm(data.settings || {});
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && !form) {
    return (
      <div className="card">
        <EmptyState title="Could not load settings" text={error} icon="alert" />
      </div>
    );
  }

  if (!form) return <LoadingBlock rows={4} />;

  const update = (name: string, value: string) => setForm((current) => ({ ...(current || {}), [name]: value }));

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload: Row = {};
      for (const field of SETTING_FIELDS) payload[field.name] = form ? form[field.name] : '';
      const data = await api<{ settings: Settings }>('/api/settings', { method: 'PUT', body: payload });
      setForm(data.settings || {});
      setSettings(data.settings || {});
      toast('System settings saved.');
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : 'Unable to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError('');
    if (password.next !== password.confirm) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    if (password.next.length < 8) {
      setPasswordError('The new password must be at least 8 characters.');
      return;
    }
    setChangingPassword(true);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { current_password: password.current, new_password: password.next },
      });
      setPassword({ current: '', next: '', confirm: '' });
      toast('Password changed successfully.');
    } catch (requestError) {
      setPasswordError(requestError instanceof Error ? requestError.message : 'Unable to change the password.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Company &amp; system settings</h3>
            <p>Used across the console, reports, and printed documents.</p>
          </div>
        </div>
        <div className="card-body">
          <form onSubmit={saveSettings} noValidate>
            <div className="form-grid">
              {SETTING_FIELDS.map((field) => (
                <SettingsField key={field.name} field={field} value={form[field.name]} onChange={update} />
              ))}
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Your account</h3>
              <p>
                Signed in as {user?.fullName || user?.username} · {user?.role}
              </p>
            </div>
          </div>
          <div className="card-body">
            <form onSubmit={changePassword} noValidate>
              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="pw-current">
                    Current password <span className="req">*</span>
                  </label>
                  <input
                    className="input"
                    type="password"
                    id="pw-current"
                    autoComplete="current-password"
                    value={password.current}
                    onChange={(event) => setPassword((current) => ({ ...current, current: event.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="pw-new">
                    New password <span className="req">*</span>
                  </label>
                  <input
                    className="input"
                    type="password"
                    id="pw-new"
                    autoComplete="new-password"
                    minLength={8}
                    value={password.next}
                    onChange={(event) => setPassword((current) => ({ ...current, next: event.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="pw-confirm">
                    Confirm new password <span className="req">*</span>
                  </label>
                  <input
                    className="input"
                    type="password"
                    id="pw-confirm"
                    autoComplete="new-password"
                    minLength={8}
                    value={password.confirm}
                    onChange={(event) => setPassword((current) => ({ ...current, confirm: event.target.value }))}
                    required
                  />
                </div>
              </div>
              {passwordError ? <div className="form-error show">{passwordError}</div> : null}
              <div className="form-actions">
                <button className="btn" type="submit" disabled={changingPassword}>
                  <Icon name="key" size={14} /> {changingPassword ? 'Updating…' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>System information</h3>
              <p>Deployment and data notes</p>
            </div>
          </div>
          <div className="card-body">
            <div className="detail-grid" style={{ gridTemplateColumns: '1fr' }}>
              <div className="detail-item">
                <div className="detail-label">Application</div>
                <div className="detail-value strong">Makoto Metal Operations Console · v1.0</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Database</div>
                <div className="detail-value">
                  SQLite · <span className="mono">data/makoto.db</span>
                </div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Site</div>
                <div className="detail-value">{form.site || contextSettings.site || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Signed in</div>
                <div className="detail-value">
                  {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>
            </div>
            <div className="form-note" style={{ margin: '16px 0 0' }}>
              <Icon name="info" size={15} />
              <span>
                Back up by copying <span className="mono">data/makoto.db</span> while the server is stopped.
                Demo data can be restored with <span className="mono">npm run reset</span>.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const params = useParams();
  const [active, setActive] = useState(
    params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'users'
  );
  const usersRef = useRef<ResourcePageHandle>(null);

  useEffect(() => {
    setActive(params.tab && TABS.some((tab) => tab.key === params.tab) ? params.tab : 'users');
  }, [params.tab]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Administration"
        subtitle="User accounts, the audit trail, and system-wide configuration."
      />
      <Tabs items={TABS} base="admin" />

      {active === 'users' ? (
        <>
          <div className="info-banner">
            <Icon name="shield" size={16} />
            <div>
              <strong>Role-based access.</strong> Administrators manage everything. Managers run operational
              modules but cannot manage users or settings. Staff can write inventory, maintenance, and
              production. Viewers are read-only.
            </div>
          </div>
          <ResourcePage
            key="users"
            ref={usersRef}
            resourceKey="users"
            newLabel="New user"
            emptyTitle="No users"
            emptyText="Create accounts for the operations team."
          />
        </>
      ) : null}

      {active === 'activity' ? (
        <ResourcePage
          key="activity"
          resourceKey="activity"
          emptyTitle="No activity recorded"
          emptyText="Sign-ins and record changes will appear in this audit trail."
        />
      ) : null}

      {active === 'settings' ? <SettingsPanel /> : null}
    </>
  );
}
