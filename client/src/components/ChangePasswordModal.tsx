import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useUI } from '../context/UIContext';
import Icon from './Icon';
import Modal from './Modal';

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { toast } = useUI();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('The new password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
      });
      toast('Password changed successfully.');
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to change the password.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Change password"
      subtitle="Update the password for your signed-in account."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="change-password-form" className="btn btn-primary" disabled={saving}>
            <Icon name="key" size={14} /> {saving ? 'Updating…' : 'Update password'}
          </button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} noValidate>
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
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
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
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
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
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>
        </div>
        {error ? <div className="form-error show">{error}</div> : null}
      </form>
    </Modal>
  );
}
