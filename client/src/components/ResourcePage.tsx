/* eslint-disable react-refresh/only-export-components -- this module intentionally exports shared helpers alongside components */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { api } from '../lib/api';
import { fetchRefs, clearRefCache } from '../lib/refs';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import Icon from './Icon';
import RecordFormModal from './RecordFormModal';
import { CellValue, EmptyState } from './ui';
import type { FieldDef, ListResponse, Row } from '../types';

const DATE_SORTS = ['created_at', 'updated_at', 'start_date', 'due_date', 'order_date', 'next_due'];

export interface FilterOption {
  value: string;
  label: string;
}

export interface ExtraFilter {
  key: string;
  label: string;
  options: FilterOption[];
}

export interface RowAction {
  label: string;
  icon?: string;
  className?: string;
  show?: (row: Row) => boolean;
  onClick: (row: Row) => void;
}

export interface ToolbarContext {
  refresh: () => void;
  search: string;
  filters: Row;
  openForm: (row?: Row | null) => void;
}

export interface ToolbarAction {
  label: string;
  icon?: string;
  className?: string;
  onClick: (context: ToolbarContext) => void;
}

export interface ResourcePageHandle {
  refresh: () => void;
  openForm: (row?: Row | null) => void;
  remove: (row: Row) => Promise<void>;
}

export interface ResourcePageProps {
  resourceKey: string;
  extraFilters?: ExtraFilter[];
  onRowClick?: (row: Row) => void;
  actions?: RowAction[];
  hideNew?: boolean;
  hideExport?: boolean;
  newLabel?: string;
  emptyTitle?: string;
  emptyText?: string;
  onSaved?: (row: Row, created: boolean) => void;
  onDeleted?: (row: Row) => void;
  defaultQuery?: Row;
  toolbarActions?: ToolbarAction[];
}

function formatRowLabel(row: Row | null | undefined): string {
  if (!row) return '';
  return (
    row.name ||
    row.title ||
    row.wo_number ||
    row.po_number ||
    row.order_no ||
    row.product_name ||
    row.full_name ||
    row.username ||
    row.sku ||
    `#${row.id}`
  );
}

interface BuildParamsInput {
  page: number;
  limit: number;
  q?: string;
  sort: string;
  dir: 'ASC' | 'DESC' | string;
  filters: Row;
  extra?: Record<string, string>;
}

function buildParams({ page, limit, q, sort, dir, filters, extra = {} }: BuildParamsInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sort', sort);
  params.set('dir', dir);
  if (q) params.set('q', q);
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== undefined && value !== null && value !== 'all') {
      params.set(key, String(value));
    }
  }
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params;
}

function download(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 500);
}

const ResourcePage = forwardRef<ResourcePageHandle, ResourcePageProps>(function ResourcePage(
  {
    resourceKey,
    extraFilters = [],
    onRowClick,
    actions = [],
    hideNew = false,
    hideExport = false,
    newLabel,
    emptyTitle,
    emptyText,
    onSaved,
    onDeleted,
    defaultQuery = {},
    toolbarActions = [],
  },
  ref
) {
  const { resources, settings } = useAuth();
  const { toast, confirm } = useUI();
  const meta = resources[resourceKey];
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [limit] = useState(() => Number(defaultQuery.limit) || Number(settings.default_page_size) || 25);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(() => (meta && meta.defaultSort ? meta.defaultSort.replace(/^t\./, '') : 'id'));
  const [dir, setDir] = useState<'ASC' | 'DESC'>(() => (meta && meta.defaultDir) || 'ASC');
  const [filters, setFilters] = useState<Row>(() => ({ ...defaultQuery }));
  const [filterOptions, setFilterOptions] = useState<Record<string, FilterOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<{ open: boolean; row: Row | null }>({ open: false, row: null });
  const requestId = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const filterFields = useMemo(() => (meta ? meta.fields.filter((field) => field.filter) : []), [meta]);
  const filterDefs = useMemo<ExtraFilter[]>(() => {
    const defs: ExtraFilter[] = filterFields.map((field) => ({
      key: field.name,
      label: `All ${field.label.toLowerCase()}`,
      options: filterOptions[field.name] || [],
    }));
    return [...defs, ...extraFilters];
  }, [filterFields, filterOptions, extraFilters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const next: Record<string, FilterOption[]> = {};
      for (const field of filterFields) {
        if (field.type === 'ref' && field.ref) {
          try {
            const options = await fetchRefs(field.ref);
            next[field.name] = options.map((row) => ({
              value: String(row.id),
              label: `${row[field.refSecondary as string] ? `${row[field.refSecondary as string]} · ` : ''}${row[field.refLabel as string] || row.name || row.id}`,
            }));
          } catch {
            next[field.name] = [];
          }
        } else if (field.type === 'bool') {
          next[field.name] = [
            { value: '1', label: 'Active' },
            { value: '0', label: 'Inactive' },
          ];
        } else {
          next[field.name] = (field.options || []).map((value) => ({ value, label: value }));
        }
      }
      if (!cancelled) setFilterOptions(next);
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [filterFields]);

  useEffect(() => {
    if (!meta) return undefined;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    const params = buildParams({ page, limit, q, sort, dir, filters });
    api<ListResponse>(`/api/${resourceKey}?${params.toString()}`)
      .then((data) => {
        if (id !== requestId.current) return;
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setPage(data.page || 1);
        setPages(data.pages || 1);
      })
      .catch((requestError: unknown) => {
        if (id !== requestId.current) return;
        const message = requestError instanceof Error ? requestError.message : 'Unable to load records.';
        setError(message);
        setRows([]);
        setTotal(0);
        toast(message, 'error');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return undefined;
  }, [meta, resourceKey, page, limit, q, sort, dir, filters, tick, toast]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const remove = useCallback(
    async (row: Row) => {
      if (!meta) return;
      const label = formatRowLabel(row);
      const confirmed = await confirm({
        title: `Delete ${meta.singular}?`,
        message: `“${label}” will be permanently removed. Records linked to other data cannot be deleted.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api(`/api/${resourceKey}/${row.id}`, { method: 'DELETE' });
        clearRefCache();
        toast(`${meta.singular} deleted.`);
        refresh();
        if (onDeleted) onDeleted(row);
      } catch (deleteError) {
        toast(deleteError instanceof Error ? deleteError.message : 'Unable to delete the record.', 'error');
      }
    },
    [confirm, meta, onDeleted, refresh, resourceKey, toast]
  );

  const openForm = useCallback((row: Row | null = null) => setForm({ open: true, row }), []);

  useImperativeHandle(ref, () => ({ refresh, openForm, remove }), [refresh, openForm, remove]);

  const visibleFields = useMemo(
    () => (meta ? meta.fields.filter((field) => field.list && field.type !== 'password') : []),
    [meta]
  );

  if (!meta) {
    return <EmptyState title="Module unavailable" text="This module is not configured for your account." icon="lock" />;
  }

  const canEdit = meta.canWrite && !meta.readOnly && !meta.noEdit;
  const canDelete = meta.canDelete && !meta.noDelete;
  const hasActions = Boolean(onRowClick) || actions.length > 0 || canEdit || canDelete;
  const showNew = meta.canWrite && !meta.readOnly && !hideNew;

  const onSort = (field: FieldDef) => {
    const key = field.sortName || field.name;
    if (sort === key) {
      setDir(dir === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSort(key);
      setDir(DATE_SORTS.includes(key) ? 'DESC' : 'ASC');
    }
    setPage(1);
  };

  const exportCsv = () => {
    const params = buildParams({ page: 1, limit: 5000, q, sort, dir, filters, extra: { export: 'csv' } });
    download(`/api/${resourceKey}?${params.toString()}`);
    toast('Preparing CSV export…');
  };

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="data-card">
      <div className="data-toolbar">
        <div className="searchbox">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder={`Search ${meta.label.toLowerCase()}…`}
            value={searchInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchInput(event.target.value)}
            aria-label="Search"
          />
        </div>
        {filterDefs.map((filter) => (
          <select
            key={filter.key}
            className="filter-select"
            aria-label={filter.label}
            value={String(filters[filter.key] || '')}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setFilters((current) => ({ ...current, [filter.key]: event.target.value }));
              setPage(1);
            }}
          >
            <option value="">{filter.label}</option>
            {filter.options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        ))}
        <div className="spacer" />
        {!hideExport && !meta.custom ? (
          <button type="button" className="btn btn-sm" onClick={exportCsv}>
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
        {toolbarActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`btn btn-sm ${action.className || ''}`}
            onClick={() => action.onClick({ refresh, search: q, filters, openForm })}
          >
            {action.icon ? <Icon name={action.icon} size={14} /> : null} {action.label}
          </button>
        ))}
        {showNew ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openForm(null)}>
            <Icon name="plus" size={14} /> {newLabel || `New ${meta.singular}`}
          </button>
        ) : null}
      </div>

      <div className="table-wrap" ref={tableRef}>
        {loading ? (
          <div className="loading-card">
            <div className="skeleton" style={{ height: 16, width: '40%' }} />
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ height: 34 }} />
            ))}
          </div>
        ) : error ? (
          <EmptyState title="Could not load records" text={error} icon="alert" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={emptyTitle || `No ${meta.label.toLowerCase()} found`}
            text={
              q || Object.values(filters).some(Boolean)
                ? 'Try adjusting your search or filters.'
                : emptyText || (showNew ? `Use the "New ${meta.singular}" button to add the first record.` : 'No records have been added yet.')
            }
            icon={meta.icon || 'box'}
          />
        ) : (
          <table className="data">
            <thead>
              <tr>
                {visibleFields.map((field) => {
                  const sortable = !field.computed || field.sortName;
                  const sortName = field.sortName || field.name;
                  const sorted = sort === sortName;
                  return (
                    <th
                      key={field.name}
                      className={`${sortable ? 'sortable' : ''} ${sorted ? 'sorted' : ''} ${field.align || ''}`}
                      onClick={sortable ? () => onSort(field) : undefined}
                    >
                      {field.label}
                      {sorted ? <span className="sort-ind">{dir === 'ASC' ? '▲' : '▼'}</span> : null}
                    </th>
                  );
                })}
                {hasActions ? <th className="text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={onRowClick ? 'clickable' : ''}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleFields.map((field) => {
                    const isName = ['name', 'title', 'product_name', 'machine_name', 'supplier_name', 'customer_name', 'item'].includes(field.name);
                    const isCode = ['sku', 'code', 'asset_code', 'wo_number', 'po_number', 'order_no'].includes(field.name);
                    const cls = [field.align === 'right' ? 'num' : '', isCode ? 'mono' : ''].filter(Boolean).join(' ');
                    return (
                      <td key={field.name} className={cls}>
                        {isName ? (
                          <span className="cell-main">
                            <CellValue field={field} row={row} />
                          </span>
                        ) : (
                          <CellValue field={field} row={row} />
                        )}
                      </td>
                    );
                  })}
                  {hasActions ? (
                    <td>
                      <div className="row-actions">
                        {onRowClick ? (
                          <button
                            type="button"
                            className="icon-btn"
                            title="View details"
                            aria-label="View details"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRowClick(row);
                            }}
                          >
                            <Icon name="eye" size={15} />
                          </button>
                        ) : null}
                        {actions.map((action) =>
                          action.show && !action.show(row) ? null : (
                            <button
                              key={action.label}
                              type="button"
                              className={`icon-btn ${action.className || ''}`}
                              title={action.label}
                              aria-label={action.label}
                              onClick={(event) => {
                                event.stopPropagation();
                                action.onClick(row);
                              }}
                            >
                              <Icon name={action.icon || 'edit'} size={15} />
                            </button>
                          )
                        )}
                        {canEdit ? (
                          <button
                            type="button"
                            className="icon-btn"
                            title="Edit"
                            aria-label="Edit"
                            onClick={(event) => {
                              event.stopPropagation();
                              openForm(row);
                            }}
                          >
                            <Icon name="edit" size={15} />
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Delete"
                            aria-label="Delete"
                            onClick={(event) => {
                              event.stopPropagation();
                              remove(row);
                            }}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="table-footer">
        <span>
          Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> record{total === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <div className="pager">
          <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="pager-page">Page {page} of {pages}</span>
          <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </div>

      {form.open ? (
        <RecordFormModal
          resourceKey={resourceKey}
          row={form.row}
          onClose={() => setForm({ open: false, row: null })}
          onSaved={(result, created) => {
            refresh();
            if (onSaved) onSaved(result, created);
          }}
        />
      ) : null}
    </div>
  );
});

export { formatRowLabel as rowLabel, buildParams, download };
export default ResourcePage;
