import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { rowLabel } from '../lib/format';
import Icon from './Icon';
import Modal from './Modal';
import { DetailGrid } from './ui';
import type { Row } from '../types';

interface RecordDetailModalProps {
  resourceKey: string;
  row: Row | null;
  title?: string;
  extra?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  onEdit?: (row: Row) => void;
}

export default function RecordDetailModal({
  resourceKey,
  row,
  title,
  extra = null,
  footer = null,
  onClose,
  onEdit,
}: RecordDetailModalProps) {
  const { resources } = useAuth();
  const meta = resources[resourceKey];
  if (!meta || !row) return null;

  const fields = meta.fields.filter((field) => field.type !== 'password');
  const canEdit = Boolean(onEdit) && meta.canWrite && !meta.readOnly && !meta.noEdit;

  return (
    <Modal
      title={title || `${meta.singular} details`}
      subtitle={rowLabel(row)}
      size="wide"
      onClose={onClose}
      footer={
        <div className="flex gap-8" style={{ flexWrap: 'wrap', width: '100%' }}>
          {footer}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {canEdit && onEdit ? (
            <button type="button" className="btn btn-primary" onClick={() => onEdit(row)}>
              <Icon name="edit" size={14} /> Edit
            </button>
          ) : null}
        </div>
      }
    >
      <DetailGrid fields={fields} row={row} />
      {extra}
    </Modal>
  );
}
