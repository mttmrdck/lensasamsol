import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { adminRoutes } from '../../worker/routes/admin';
import { credentialsFingerprintInput } from '../../worker/admin-credentials';
import { decryptSecret, encryptSecret, sha256 } from '../../worker/crypto';
import { disconnect, driveGet, exchangeCode, getAccessToken, storeConnection } from '../../worker/google';
import type { Env } from '../../worker/env';
import { oauthFailureMessage } from '../../shared/oauth';

const origin = 'https://lensasamsol-staging.lnoa.workers.dev';
const marker = 'synthetic-private-marker';
const driveScope = 'https://www.googleapis.com/auth/drive.readonly';
const workerError = 'Invalid redirect value, must be one of "follow" or "manual"';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fixture(
  options: { session?: boolean; state?: boolean; expired?: boolean; saveFails?: boolean } = {},
) {
  const env = {
    APP_ENV: 'staging',
    DEMO_MODE: 'false',
    PUBLIC_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: marker,
    GOOGLE_ALLOWED_EMAIL: 'owner@example.test',
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ADMIN_CREDENTIALS_JSON: JSON.stringify([{ username: 'solfb1', passwordHash: 'fixture-hash' }]),
  } as Env;
  const fingerprint = (await sha256(`fp:${credentialsFingerprintInput(env)}`)).slice(0, 24);
  let saved: unknown[] | null = null;
  let state = options.state !== false;
  let connection: Record<string, unknown> | null = null;
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first() {
          if (sql.includes('FROM sessions'))
            return options.session === false ? null : { expires_at: Date.now() + 60000, pw_fp: fingerprint };
          if (sql.includes('RETURNING code_verifier')) {
            if (!state) return null;
            state = false;
            return { code_verifier: marker, created_at: Date.now() - (options.expired ? 1000000 : 0) };
          }
          if (sql.includes('FROM google_connections')) return connection;
          throw new Error('Unexpected fixture query');
        },
        async run() {
          writes.push(sql);
          if (sql.includes('INSERT INTO google_connections')) {
            if (options.saveFails) throw new Error(`D1 error ${marker}`);
            saved = args;
          }
          if (sql.includes('DELETE FROM google_connections')) connection = null;
          return { meta: { changes: 1 }, success: true };
        },
      };
      return statement;
    },
  };
  env.DB = db as unknown as D1Database;
  const payload = (overrides: Record<string, unknown> = {}) => ({
    access_token: `access-${marker}`,
    refresh_token: `refresh-${marker}`,
    expires_in: 3600,
    scope: `openid email ${driveScope}`,
    id_token: `fixture.${Buffer.from(
      JSON.stringify({
        email: env.GOOGLE_ALLOWED_EMAIL,
        email_verified: true,
        aud: env.GOOGLE_CLIENT_ID,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...overrides,
      }),
    ).toString('base64url')}.signature`,
  });
  const callback = (query = `code=${marker}&state=${marker}`) =>
    adminRoutes.request(
      `${origin}/drive/callback?${query}`,
      { headers: { cookie: `archive_session=${marker}` } },
      env,
    );
  return {
    env,
    payload,
    callback,
    writes,
    saved: () => saved,
    state: () => state,
    setConnection: (row: Record<string, unknown>) => {
      connection = row;
    },
  };
}

function mockWorkerFetch(response: () => Response | Promise<Response>) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.redirect === 'error') throw new TypeError(workerError);
      return response();
    }),
  );
}

describe('Google fetch redirect policy in Workers', () => {
  it('exchanges a code with Workers-compatible manual redirect handling', async () => {
    const f = await fixture();
    mockWorkerFetch(() => Response.json(f.payload()));
    await expect(exchangeCode(f.env, origin, marker, marker)).resolves.toMatchObject({
      email: 'owner@example.test',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it.each([301, 302, 303, 307, 308])(
    'rejects HTTP %s without following or exposing Location/body',
    async (status) => {
      const f = await fixture();
      const json = vi.fn();
      const response = new Response(`upstream-${marker}`, {
        status,
        headers: { location: `https://elsewhere.invalid/?token=${marker}` },
      });
      response.json = json;
      mockWorkerFetch(() => response);
      const error = await exchangeCode(f.env, origin, marker, marker).catch((error) => error);
      expect(error).toMatchObject({ kind: 'upstream', status, redirectLocationPresent: true });
      expect(String(error)).not.toContain(marker);
      expect(json).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a redirect with no Location instead of parsing its body', async () => {
    const f = await fixture();
    mockWorkerFetch(() => new Response(marker, { status: 302 }));
    await expect(exchangeCode(f.env, origin, marker, marker)).rejects.toMatchObject({
      status: 302,
      redirectLocationPresent: false,
    });
  });

  it('does not echo upstream token errors or response bodies in callback diagnostics', async () => {
    const f = await fixture();
    mockWorkerFetch(() => Response.json({ error: marker, error_description: marker }, { status: 400 }));
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=token_exchange_failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  });

  it('logs only redirect classification/status/Location presence for a rejected redirect', async () => {
    const f = await fixture();
    mockWorkerFetch(
      () =>
        new Response(marker, {
          status: 302,
          headers: { location: `https://elsewhere.invalid/?token=${marker}` },
        }),
    );
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=token_exchange_redirect');
    expect(log).toHaveBeenCalledWith('oauth_callback_failed', {
      code: 'token_exchange_redirect',
      httpStatus: 302,
      hasLocation: true,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  });

  it('refreshes with manual mode and stores only encrypted access tokens', async () => {
    const f = await fixture();
    f.setConnection({
      refresh_token_enc: await encryptSecret(marker, f.env.TOKEN_ENCRYPTION_KEY!),
      connected_at: crypto.randomUUID(),
    });
    mockWorkerFetch(() => Response.json({ access_token: marker, expires_in: 3600 }));
    await expect(getAccessToken(f.env)).resolves.toBe(marker);
    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'manual' }));
  });

  it('revokes with manual mode; redirect rejection remains best effort', async () => {
    const f = await fixture();
    f.setConnection({ refresh_token_enc: await encryptSecret(marker, f.env.TOKEN_ENCRYPTION_KEY!) });
    mockWorkerFetch(
      () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.invalid/' } }),
    );
    await disconnect(f.env);
    expect(fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches Drive metadata with manual mode and rejects redirects without retry', async () => {
    const f = await fixture();
    f.setConnection({
      refresh_token_enc: await encryptSecret(marker, f.env.TOKEN_ENCRYPTION_KEY!),
      access_token_enc: await encryptSecret(marker, f.env.TOKEN_ENCRYPTION_KEY!),
      access_expires_at: Date.now() + 60000,
      connected_at: crypto.randomUUID(),
    });
    mockWorkerFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: `https://elsewhere.invalid/?token=${marker}` },
        }),
    );
    await expect(driveGet(f.env, '/about', {})).rejects.toMatchObject({ kind: 'upstream', status: 302 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'manual' }));
  });

  it('returns Drive identity metadata after a successful authenticated manual fetch', async () => {
    const f = await fixture();
    f.setConnection({
      refresh_token_enc: await encryptSecret(marker, f.env.TOKEN_ENCRYPTION_KEY!),
      access_token_enc: await encryptSecret(marker, f.env.TOKEN_ENCRYPTION_KEY!),
      access_expires_at: Date.now() + 60000,
      connected_at: crypto.randomUUID(),
    });
    const identity = { user: { emailAddress: 'owner@example.test' } };
    mockWorkerFetch(() => Response.json(identity));
    await expect(driveGet(f.env, '/about', { fields: 'user(emailAddress)' })).resolves.toEqual(identity);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'manual' }));
  });
});

describe('OAuth callback stages and secret-free failures', () => {
  it('requires an administrator session before consuming state', async () => {
    const f = await fixture({ session: false });
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/login?next=/admin/drive');
    expect(f.state()).toBe(true);
    expect(f.saved()).toBeNull();
  });

  it.each([{ state: false }, { expired: true }])(
    'rejects missing/expired state independently',
    async (options) => {
      const f = await fixture(options);
      const spy = vi.fn();
      vi.stubGlobal('fetch', spy);
      const response = await f.callback();
      expect(response.headers.get('location')).toBe('/admin/drive?error=state_invalid');
      expect(spy).not.toHaveBeenCalled();
      expect(f.saved()).toBeNull();
    },
  );

  it('consumes state but classifies token-exchange failures without forwarding exception text', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`request failed ${marker}`)));
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=token_exchange_failed');
    expect(f.state()).toBe(false);
    expect(f.saved()).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(log.mock.calls)).toContain('token_exchange_failed');
  });

  it.each([
    { email: 'other@example.test' },
    { email_verified: false },
    { aud: 'wrong-client' },
    { iss: 'https://untrusted.invalid' },
    { exp: 1 },
  ])('rejects an unauthorized or unverified Google identity', async (claims) => {
    const f = await fixture();
    mockWorkerFetch(() => Response.json(f.payload(claims)));
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=google_identity_failed');
    expect(f.saved()).toBeNull();
  });

  it('rejects missing Drive consent separately from identity and persistence', async () => {
    const f = await fixture();
    mockWorkerFetch(() => Response.json({ ...f.payload(), scope: 'openid email' }));
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=drive_scope_missing');
    expect(f.saved()).toBeNull();
  });

  it('does not echo arbitrary Google callback error values', async () => {
    const f = await fixture();
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await f.callback(`state=${marker}&error=${marker}`);
    expect(response.headers.get('location')).toBe('/admin/drive?error=consent_failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  });

  it('reports missing refresh token without claiming a saved connection', async () => {
    const f = await fixture();
    mockWorkerFetch(() => Response.json({ ...f.payload(), refresh_token: undefined }));
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=refresh_token_missing');
    expect(f.saved()).toBeNull();
  });

  it('separately reports encryption failure before D1 save', async () => {
    const f = await fixture();
    f.env.TOKEN_ENCRYPTION_KEY = 'invalid-key';
    mockWorkerFetch(() => Response.json(f.payload()));
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=token_encryption_failed');
    expect(f.saved()).toBeNull();
  });

  it('separately reports D1 save failure without echoing its exception', async () => {
    const f = await fixture({ saveFails: true });
    mockWorkerFetch(() => Response.json(f.payload()));
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?error=connection_save_failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(f.saved()).toBeNull();
  });

  it('saves encrypted tokens before returning connected=1', async () => {
    const f = await fixture();
    mockWorkerFetch(() => Response.json(f.payload()));
    const response = await f.callback();
    expect(response.headers.get('location')).toBe('/admin/drive?connected=1');
    const saved = f.saved()!;
    expect(saved[2]).not.toContain(marker);
    expect(saved[3]).not.toContain(marker);
    expect(await decryptSecret(saved[2] as string, f.env.TOKEN_ENCRYPTION_KEY!)).toBe(`refresh-${marker}`);
    expect(await decryptSecret(saved[3] as string, f.env.TOKEN_ENCRYPTION_KEY!)).toBe(`access-${marker}`);
  });

  it('does not persist plaintext when encryption fails in direct storage', async () => {
    const f = await fixture();
    f.env.TOKEN_ENCRYPTION_KEY = 'invalid';
    await expect(storeConnection(f.env, { ...f.payload(), email: 'owner@example.test' })).rejects.toThrow();
    expect(f.saved()).toBeNull();
  });

  it('only exposes fixed public messages for callback error codes', () => {
    expect(oauthFailureMessage('token_exchange_failed')).toContain('token exchange');
    expect(oauthFailureMessage(marker)).not.toContain(marker);
    expect(oauthFailureMessage('__proto__')).toBe(
      'Google Drive connection failed. Start a new connection attempt.',
    );
    expect(oauthFailureMessage(null)).toBeNull();
  });
});
