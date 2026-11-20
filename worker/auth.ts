import { adminCredentials, credentialsFingerprintInput } from './admin-credentials';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from './env';
import { randomToken, sha256 } from './crypto';

export const SESSION_COOKIE = 'archive_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/** Fingerprint of the configured password hash: changing ADMIN_PASSWORD_HASH invalidates every session. */
const passwordFingerprint = async (c: Context<AppEnv>) =>
  (await sha256(`fp:${credentialsFingerprintInput(c.env)}`)).slice(0, 24);

export async function createSession(c: Context<AppEnv>, username: string): Promise<void> {
  const token = randomToken(32);
  const now = Date.now();
  const oldToken = getCookie(c, SESSION_COOKIE);
  const insert = c.env.DB.prepare(
    'INSERT INTO sessions (token_hash, created_at, expires_at, user_agent, pw_fp, admin_username) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256(token),
      now,
      now + SESSION_TTL_MS,
      (c.req.header('user-agent') ?? '').slice(0, 200),
      await passwordFingerprint(c),
      username,
) ;
  await c.env.DB.batch([insert, ...(oldToken && oldToken.length <= 200 ? [c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(oldToken))] : [])]);
  // Opportunistic cleanup of expired sessions.
  await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure everywhere except plain-http localhost development.
    secure: new URL(c.req.url).protocol === 'https:',
    // Lax (not Strict) so the cookie survives the top-level redirect back from Google's OAuth consent screen.
    // Mutations are separately protected by the Origin + custom-header CSRF check below.
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function isAdminRequest(c: Context<AppEnv>): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 200) return false;
  if (!adminCredentials(c.env).length) return false;
  const row = await c.env.DB.prepare('SELECT expires_at, pw_fp FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ expires_at: number; pw_fp: string | null }>();
  return !!row && row.expires_at > Date.now() && row.pw_fp === (await passwordFingerprint(c));
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token)
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** CSRF: state-changing requests must be same-origin AND carry a header a cross-site form cannot set. */
export function checkCsrf(c: Context<AppEnv>): boolean {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (c.req.header('x-archive-csrf') !== '1') return false;
  const origin = c.req.header('origin');
  if (!origin) return false;
  const self = new URL(c.req.url).origin;
  return origin === self || (!!c.env.PUBLIC_ORIGIN && origin === c.env.PUBLIC_ORIGIN);
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!checkCsrf(c)) return c.json({ error: 'csrf', message: 'Request blocked (cross-site).' }, 403);
  if (!(await isAdminRequest(c))) return c.json({ error: 'unauthorized', message: 'Please sign in.' }, 401);
  if (!mutationAllowed(c))
    return c.json({ error: 'rate_limited', message: 'Too many changes — slow down.' }, 429);
  c.set('admin', true);
  await next();
};

// In-isolate token bucket for admin mutations (best-effort; login throttling is durable in D1).
const bucket = { tokens: 120, at: Date.now() };
function mutationAllowed(c: Context<AppEnv>): boolean {
  if (c.req.method === 'GET') return true;
  const now = Date.now();
  bucket.tokens = Math.min(120, bucket.tokens + ((now - bucket.at) / 1000) * 2);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? 'local';
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 6;

export async function loginThrottled(c: Context<AppEnv>): Promise<boolean> {
  const since = Date.now() - WINDOW_MS;
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(since).run();
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at >= ? AND success = 0',
  )
    .bind(clientIp(c), since)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordLogin(c: Context<AppEnv>, success: boolean): Promise<void> {
  await c.env.DB.prepare('INSERT INTO login_attempts (ip, attempted_at, success) VALUES (?, ?, ?)')
    .bind(clientIp(c), Date.now(), success ? 1 : 0)
    .run();
}

export async function sessionTokenHash(c: Context<AppEnv>): Promise<string | null> {
  const token=getCookie(c, SESSION_COOKIE);
  return token && token.length <= 200 ? sha256(token) : null;
}

export const LOGIN_RESERVATION_SQL = `INSERT INTO login_attempts (ip, attempted_at, success)
 SELECT ?1, ?2, 0 WHERE (SELECT COUNT(*) FROM login_attempts WHERE ip = ?1 AND attempted_at >= ?3 AND success = 0) < 6 RETURNING rowid AS id`;
export async function reserveLoginAttempt(c: Context<AppEnv>): Promise<number | null> {
 const now=Date.now();
 await c.env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(now-WINDOW_MS).run();
 const row=await c.env.DB.prepare(LOGIN_RESERVATION_SQL).bind(clientIp(c),now,now-WINDOW_MS).first<{id:number}>();
 return row?.id ?? null;
}
export async function finishLoginAttempt(c: Context<AppEnv>, id: number, success: boolean) {
 await c.env.DB.prepare('UPDATE login_attempts SET success = ? WHERE rowid = ?').bind(success?1:0,id).run();
}
