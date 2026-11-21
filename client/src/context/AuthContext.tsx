/* eslint-disable react-refresh/only-export-components -- this module intentionally exports shared helpers alongside components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { setCurrency } from '../lib/format';
import { clearRefCache } from '../lib/refs';
import { canRole } from '../lib/roles';
import type { Action, MetaResponse, ReportCard, ResourceMeta, SessionUser, Settings } from '../types';

interface AuthContextValue {
  user: SessionUser | null;
  meta: MetaResponse | null;
  settings: Settings;
  loading: boolean;
  notice: string;
  setNotice: (value: string) => void;
  login: (username: string, password: string) => Promise<SessionUser | null>;
  logout: () => Promise<void>;
  can: (module: string, action?: Action) => boolean;
  refreshMeta: () => Promise<void>;
  setSettings: (next: Settings) => void;
  resources: Record<string, ResourceMeta>;
  enums: Record<string, string[]>;
  reports: ReportCard[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [settings, setSettingsState] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const applyMeta = useCallback((data: MetaResponse) => {
    setUser(data.user || null);
    setMeta(data);
    setSettingsState(data.settings || {});
    setCurrency((data.settings || {}).currency || 'PHP');
  }, []);

  const boot = useCallback(async () => {
    try {
      const data = await api<MetaResponse>('/api/meta', { silent: true });
      applyMeta(data);
      setNotice('');
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 401) setNotice(error instanceof Error ? error.message : 'Unable to reach the server.');
      setUser(null);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [applyMeta]);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setMeta(null);
      clearRefCache();
      setNotice('Your session expired. Please sign in again.');
    };
    window.addEventListener('makoto:session-expired', onExpired);
    return () => window.removeEventListener('makoto:session-expired', onExpired);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      await api('/api/auth/login', { method: 'POST', body: { username, password } });
      const data = await api<MetaResponse>('/api/meta');
      applyMeta(data);
      clearRefCache();
      setNotice('');
      return data.user;
    },
    [applyMeta]
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Local state is cleared even if the API is unreachable.
    }
    clearRefCache();
    setUser(null);
    setMeta(null);
    setSettingsState({});
    setNotice('You have been signed out.');
  }, []);

  const can = useCallback(
    (module: string, action: Action = 'read') => canRole(user && user.role, module, action),
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      meta,
      settings,
      loading,
      notice,
      setNotice,
      login,
      logout,
      can,
      refreshMeta: boot,
      setSettings: (next: Settings) => {
        setSettingsState(next);
        setCurrency(next.currency || 'PHP');
      },
      resources: (meta && meta.resources) || {},
      enums: (meta && meta.enums) || {},
      reports: (meta && meta.reports) || [],
    }),
    [user, meta, settings, loading, notice, login, logout, can, boot]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
