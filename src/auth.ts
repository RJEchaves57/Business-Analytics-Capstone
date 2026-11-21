import crypto from 'node:crypto';
import { AppError } from './util';

export const SESSION_COOKIE = 'makoto_sid';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type Role = 'admin' | 'manager' | 'maintenance' | 'user';
export type Action = 'read' | 'write' | 'delete';

export interface SessionUser {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
  department: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthUserRow {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  department?: string | null;
}

const sessions = new Map<string, SessionUser>();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(expectedBuf, derived);
}

export function createSession(user: AuthUserRow): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    department: user.department || '',
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

export function getSession(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function destroySession(token: string | null | undefined): void {
  if (token) sessions.delete(token);
}

export function destroyUserSessions(userId: number): void {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

/**
 * Four shop-floor personas. Legacy role values are mapped so old databases keep working.
 *   admin       - everything
 *   manager     - read all operations; write inventory, production, purchasing
 *   maintenance - machines and work orders; read inventory/reports
 *   user        - record production; read inventory
 */
function normalize(role: Role | null | undefined): Role {
  if ((role as string) === 'staff') return 'maintenance';
  if ((role as string) === 'viewer') return 'user';
  return role || 'user';
}

export function can(role: Role | null | undefined, module: string, action: Action): boolean {
  const r = normalize(role);
  if (r === 'admin') return true;
  if (module === 'admin' || module === 'settings') return false;

  if (r === 'manager') {
    if (action === 'read') return ['dashboard', 'inventory', 'maintenance', 'production', 'purchasing', 'reports'].includes(module);
    return ['inventory', 'production', 'purchasing'].includes(module);
  }
  if (r === 'maintenance') {
    if (action === 'read') return ['dashboard', 'inventory', 'maintenance', 'reports'].includes(module);
    return module === 'maintenance';
  }
  if (action === 'read') return ['dashboard', 'inventory', 'production'].includes(module);
  return module === 'production';
}

export function requireAuth(session: SessionUser | null): SessionUser {
  if (!session) throw new AppError(401, 'Please sign in to continue.');
  return session;
}

export function requirePermission(session: SessionUser | null, module: string, action: Action): SessionUser {
  requireAuth(session);
  if (!session || !can(session.role, module, action)) {
    throw new AppError(403, 'Your role does not allow this action.');
  }
  return session;
}

interface LoginAttemptEntry {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, LoginAttemptEntry>();

export function checkLoginRateLimit(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return;
  if (now > entry.resetAt) {
    loginAttempts.delete(ip);
    return;
  }
  if (entry.count >= 8) {
    throw new AppError(429, 'Too many failed sign-in attempts. Please wait a few minutes.');
  }
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(ip: string): void {
  loginAttempts.delete(ip);
}
