import crypto from 'node:crypto';
import { db } from './db';
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
  session_version?: number | null;
}

/**
 * Sessions are signed tokens instead of server-memory entries. That keeps a
 * sign-in valid across Vercel cold starts and separate function instances.
 * Changing a password, deactivating, or deleting a user advances the stored
 * session_version, which invalidates every previously issued token.
 */
const SESSION_SECRET = process.env.SESSION_SECRET || 'makoto-dev-session-secret-change-me';
const revokedTokens = new Set<string>();

interface SessionPayload {
  uid: number;
  v: number;
  iat: number;
  exp: number;
}

function signPayload(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readPayload(token: string): SessionPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!Number.isFinite(payload.uid) || !Number.isFinite(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

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
  const issuedAt = Date.now();
  return signPayload({
    uid: user.id,
    v: Number(user.session_version ?? 0),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_MS,
  });
}

export function getSession(token: string | null | undefined): SessionUser | null {
  if (!token || revokedTokens.has(token)) return null;
  const payload = readPayload(token);
  if (!payload || payload.exp < Date.now()) return null;

  const row = db
    .prepare(
      `SELECT id, username, full_name, role, department, active, session_version
       FROM users WHERE id = ?`
    )
    .get(payload.uid) as
    | (AuthUserRow & { active: number | boolean })
    | undefined;

  if (!row || !row.active || Number(row.session_version ?? 0) !== payload.v) return null;

  return {
    userId: row.id,
    username: row.username,
    fullName: row.full_name,
    role: normalize(row.role),
    department: row.department || '',
    createdAt: payload.iat,
    expiresAt: payload.exp,
  };
}

export function destroySession(token: string | null | undefined): void {
  if (token) revokedTokens.add(token);
}

export function destroyUserSessions(userId: number): void {
  db.prepare(
    'UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?'
  ).run(userId);
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
