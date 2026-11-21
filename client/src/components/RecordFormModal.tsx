/* eslint-disable react-refresh/only-export-components -- this module intentionally exports shared helpers alongside components */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { fetchRefs, clearRefCache } from '../lib/refs';
import { todayIso } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import Icon from './Icon';
import Modal from './Modal';
import type { FieldDef, Row } from '../types';

const DEFAULTS: Record<string, Row> = {
  items: { unit: 'pc', active: 1, quantity: 0, reorder_point: 0, unit_cost: 0 },
  'stock-movements': { type: 'IN' },
  warehouses: { active: 1 },
  plants: { active: 1 },
  machines: { status: 'Running' },
  'maintenance-schedules': { maintenance_type: 'Preventive', interval_days: 30, active: 1 },
  'maintenance-orders': { type: 'Corrective', priority: 'Medium', status: 'Open', downtime_hours: 0, labor_cost: 0 },
  'production-orders': { status: 'Planned', unit: 'pc', target_qty: 0, completed_qty: 0, scrap_qty: 0 },
  'purchase-orders': { status: 'Draft' },
  suppliers: { active: 1, terms: 'Net 30' },
  customers: { active: 1 },
  users: { role: 'maintenance', active: 1 },
};

function fieldOptions(field: FieldDef, editing: boolean): string[] {
  const options = [...(field.formOptions || field.options || [])];
  if (editing && field.value && !options.includes(String(field.value))) options.push(String(field.value));
  return options;
}

function optionList(field: FieldDef, row: Row | null): string[] {
  const options = [...(field.formOptions || field.options || [])];
  const current = row ? row[field.name] : undefined;
  if (current !== undefined && current !== null && current !== '' && !options.includes(current)) {
    options.push(current);
  }
  return options;
}

function defaultFor(resourceKey: string, field: FieldDef): unknown {
  if (field.default !== undefined) return field.default;
  const map = DEFAULTS[resourceKey] || {};
  if (map[field.name] !== undefined) return map[field.name];
  if (resourceKey === 'purchase-orders' && field.name === 'order_date') return todayIso();
  if (resourceKey === 'maintenance-orders' && field.name === 'started_at') return todayIso();
  if (resourceKey === 'production-orders' && field.name === 'start_date') return todayIso();
  return '';
}

function initialValue(resourceKey: string, field: FieldDef, row: Row | null): unknown {
  if (row) return row[field.name] === null || row[field.name] === undefined ? '' : row[field.name];
  const value = defaultFor(resourceKey, field);
  if (field.type === 'select' && field.required && (value === '' || value === undefined)) {
    const options = field.formOptions || field.options || [];
    return options[0] || '';
  }
  return value === null || value === undefined ? '' : value;
}

interface RecordFormModalProps {
  resourceKey: string;
  row: Row | null;
  onClose: () => void;
  onSaved?: (row: Row, created: boolean) => void;
}

export default function RecordFormModal({ resourceKey, row, onClose, onSaved }: RecordFormModalProps) {
  const { resources } = useAuth();
  const { toast } = useUI();
  const meta = resources[resourceKey];
  const editing = Boolean(row);
  const [values, setValues] = useState<Row>({});
  const [refData, setRefData] = useState<Record<string, Row[]>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const fields = useMemo<FieldDef[]>(() => {
    if (!meta) return [];
    return meta.fields.filter((field) => {
      if (field.computed || field.readOnly) return false;
      if (field.type === 'password' && !meta.custom) return false;
      if (field.hideOnCreate && !editing) return false;
      if (field.hideOnEdit && editing) return false;
      return true;
    });
  }, [meta, editing]);

  useEffect(() => {
    if (!meta) return;
    const next: Row = {};
    for (const field of fields) next[field.name] = initialValue(resourceKey, field, row);
    setValues(next);
  }, [resourceKey, meta, fields, row]);

  useEffect(() => {
    if (!meta) return undefined;
    let cancelled = false;
    const refKeys = [...new Set(fields.filter((field) => field.type === 'ref' && field.ref).map((field) => field.ref as string))];
    if (!refKeys.length) return undefined;
    Promise.all(
      refKeys.map((key) => fetchRefs(key).then((options) => [key, options] as const).catch(() => [key, []] as const))
    ).then((entries) => {
      if (!cancelled) setRefData(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [fields, meta]);

  if (!meta) return null;

  const setValue = (name: string, value: unknown) => setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!formRef.current || !formRef.current.reportValidity()) return;
    setSaving(true);
    setError('');
    const payload: Row = {};
    for (const field of fields) {
      if (field.type === 'bool') {
        payload[field.name] = values[field.name] ? 1 : 0;
      } else {
        payload[field.name] = values[field.name] ?? '';
      }
    }
    if (editing && fields.some((field) => field.type === 'password') && !payload.password) {
      delete payload.password;
    }
    try {
      const endpoint = resourceKey === 'users' ? '/api/users' : `/api/${resourceKey}`;
      const result = editing
        ? await api<Row>(`${endpoint}/${row?.id}`, { method: 'PUT', body: payload })
        : await api<Row>(endpoint, { method: 'POST', body: payload });
      clearRefCache();
      toast(`${meta.singular} ${editing ? 'updated' : 'created'} successfully.`);
      if (onSaved) onSaved(result, !editing);
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save the record.');
      setSaving(false);
    }
  };

  const renderControl = (field: FieldDef): { full: boolean; required: boolean; control: ReactNode } => {
    const value = values[field.name] ?? '';
    const required = Boolean(field.required) && !(editing && field.name === 'password');
    const full = Boolean(field.full) || field.type === 'textarea' || field.type === 'password';

    let control: ReactNode;
    if (field.type === 'textarea') {
      control = (
        <textarea
          className="textarea"
          id={`f-${field.name}`}
          value={value}
          onChange={(event) => setValue(field.name, event.target.value)}
          required={required}
        />
      );
    } else if (field.type === 'select') {
      control = (
        <select
          className="select"
          id={`f-${field.name}`}
          value={String(value)}
          onChange={(event) => setValue(field.name, event.target.value)}
          required={required}
        >
          {required ? null : <option value="">— Select —</option>}
          {optionList(field, editing ? row : null).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    } else if (field.type === 'ref') {
      const options = refData[field.ref || ''] || [];
      control = (
        <select
          className="select"
          id={`f-${field.name}`}
          value={String(value)}
          onChange={(event) => setValue(field.name, event.target.value)}
          required={required}
        >
          <option value="">— Select —</option>
          {options.map((option) => {
            const label = `${option[field.refSecondary as string] ? `${option[field.refSecondary as string]} · ` : ''}${option[field.refLabel as string] || option.name || option.id}`;
            return (
              <option key={option.id} value={option.id}>
                {label}
              </option>
            );
          })}
        </select>
      );
    } else if (field.type === 'bool') {
      control = (
        <div className="check-row">
          <input
            type="checkbox"
            id={`f-${field.name}`}
            checked={Boolean(Number(value))}
            onChange={(event) => setValue(field.name, event.target.checked ? 1 : 0)}
          />
          <span>{field.help || 'Enabled'}</span>
        </div>
      );
    } else if (field.type === 'password') {
      control = (
        <input
          className="input"
          type="password"
          id={`f-${field.name}`}
          autoComplete="new-password"
          value={value}
          required={required}
          placeholder={editing ? 'Leave blank to keep current' : 'At least 8 characters'}
          onChange={(event) => setValue(field.name, event.target.value)}
        />
      );
    } else {
      const type = field.type === 'date'
        ? 'date'
        : ['number', 'money', 'percent'].includes(field.type)
          ? 'number'
          : 'text';
      const step = field.type === 'money' ? '0.01' : field.step !== undefined ? field.step : 'any';
      control = (
        <input
          className="input"
          type={type}
          id={`f-${field.name}`}
          value={value}
          min={field.min}
          step={type === 'number' ? step : undefined}
          required={required}
          placeholder={field.placeholder || ''}
          onChange={(event) => setValue(field.name, event.target.value)}
        />
      );
    }

    return { full, required, control };
  };

  return (
    <Modal
      title={`${editing ? 'Edit' : 'New'} ${meta.singular}`}
      subtitle={editing ? undefined : meta.description}
      size={fields.length > 8 ? 'wide' : ''}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => submit()} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : `Create ${meta.singular}`}
          </button>
        </>
      }
    >
      <form ref={formRef} onSubmit={submit} noValidate>
        {resourceKey === 'stock-movements' ? (
          <div className="form-note">
            <Icon name="info" size={15} />
            <span>
              Stock movements are permanent ledger entries. Recording an OUT movement immediately reduces on-hand stock.
            </span>
          </div>
        ) : null}
        <div className="form-grid">
          {fields.map((field) => {
            const { full, required, control } = renderControl(field);
            return (
              <div key={field.name} className={`field ${full ? 'full' : ''}`}>
                <label htmlFor={`f-${field.name}`}>
                  {field.label}
                  {required ? <span className="req">*</span> : null}
                </label>
                {control}
                {field.help && field.type !== 'bool' ? <span className="help">{field.help}</span> : null}
              </div>
            );
          })}
        </div>
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}

export { fieldOptions, DEFAULTS };
