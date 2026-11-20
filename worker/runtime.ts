import { adminCredentials } from './admin-credentials';
import type { Env } from './env';
import { unb64, verifyPassword } from './crypto';

export function isLoopback(url: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
}
const passwordChecks = new Map<string, Promise<boolean>>();
async function unsafeDemoPassword(hash: string) {
  if (!passwordChecks.has(hash)) {
    if (passwordChecks.size > 4) passwordChecks.clear();
    passwordChecks.set(hash, verifyPassword('archive-demo-passphrase', hash));
  }
  return passwordChecks.get(hash)!;
}
/** Deployment fails closed; local demo credentials are accepted only on a loopback development runtime. */
export async function configurationErrors(env: Env, requestUrl: string): Promise<string[]> {
  if ((env.APP_ENV ?? 'development') === 'development' && isLoopback(requestUrl)) return [];
  const errors: string[] = [];
  if (!['staging', 'production'].includes(env.APP_ENV ?? '')) errors.push('APP_ENV');
  const credentials = adminCredentials(env);
  if (!credentials.length) errors.push('ADMIN_CREDENTIALS_JSON');
  if (env.DEMO_MODE !== 'false') errors.push('DEMO_MODE');
  try {
    const origin = new URL(env.PUBLIC_ORIGIN ?? '');
    if (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN || isLoopback(origin.href)) errors.push('PUBLIC_ORIGIN');
    else if (!isLoopback(requestUrl) && new URL(requestUrl).origin !== origin.origin) errors.push('canonical_origin');
  } catch { errors.push('PUBLIC_ORIGIN'); }
  for (const account of credentials) {
    if (!/^[A-Za-z0-9_.@-]{3,80}$/.test(account.username)) errors.push('ADMIN_USERNAME');
    try {
      const parts = account.passwordHash.split('$');
      if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256' || Number(parts[2]) !== 100000 || unb64(parts[3]).length < 16 || unb64(parts[4]).length !== 32 || await unsafeDemoPassword(account.passwordHash)) errors.push('ADMIN_PASSWORD_HASH');
    } catch { errors.push('ADMIN_PASSWORD_HASH'); }
  }
  try { if (unb64(env.TOKEN_ENCRYPTION_KEY ?? '').length !== 32) errors.push('TOKEN_ENCRYPTION_KEY'); }
  catch { errors.push('TOKEN_ENCRYPTION_KEY'); }
  for (const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_ALLOWED_EMAIL'] as const) if (!env[key]) errors.push(key);
  if (env.GOOGLE_ALLOWED_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.GOOGLE_ALLOWED_EMAIL)) errors.push('GOOGLE_ALLOWED_EMAIL');
  if (!env.DB?.prepare) errors.push('DB');
  return [...new Set(errors)];
}
