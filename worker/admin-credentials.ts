import type { Env } from './env';
export interface AdminCredential { username: string; passwordHash: string }
/** Fixed operator-managed accounts, not a public registration or multi-tenant identity system. */
export function adminCredentials(env: Env): AdminCredential[] {
  if (env.ADMIN_CREDENTIALS_JSON) {
    try {
      const rows:unknown=JSON.parse(env.ADMIN_CREDENTIALS_JSON);
      if(!Array.isArray(rows)||rows.length<1||rows.length>8) return [];
      const seen=new Set<string>();
      for(const item of rows) {
        if(!item || typeof item.username!=='string' || !/^[A-Za-z0-9_.@-]{3,80}$/.test(item.username) || typeof item.passwordHash!=='string' || seen.has(item.username)) return [];
        seen.add(item.username);
      }
      return rows;
    } catch { return []; }
  }
  return env.ADMIN_PASSWORD_HASH ? [{username:env.ADMIN_USERNAME ?? ((env.APP_ENV ?? 'development')==='development'?'admin':''),passwordHash:env.ADMIN_PASSWORD_HASH}] : [];
}
export function credentialsFingerprintInput(env: Env): string {
  return JSON.stringify(adminCredentials(env).toSorted((a,b)=>a.username.localeCompare(b.username)));
}
