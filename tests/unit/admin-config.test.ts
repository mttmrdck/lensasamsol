import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adminCredentials, credentialsFingerprintInput } from '../../worker/admin-credentials';
import { configurationErrors } from '../../worker/runtime';
import type { Env } from '../../worker/env';

const hash = (password: string) => {
  const salt = randomBytes(16);
  return `pbkdf2$sha256$100000$${salt.toString('base64')}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64')}`;
};
const strongA = hash('correct horse battery staple');
const strongB = hash('another long private passphrase');
const demo = hash('archive-demo-passphrase');
const fakeDb = { prepare: () => ({}) } as unknown as D1Database;

const twoAccounts = JSON.stringify([
  { username: 'solfb1', passwordHash: strongA },
  { username: 'akiffb1', passwordHash: strongB },
]);

const production = (overrides: Partial<Env> = {}): Env => ({
  APP_ENV: 'production',
  DEMO_MODE: 'false',
  PUBLIC_ORIGIN: 'https://gallery.example.com',
  ADMIN_CREDENTIALS_JSON: twoAccounts,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_ALLOWED_EMAIL: 'owner@example.com',
  DB: fakeDb,
  ASSETS: {} as Fetcher,
  ...overrides,
});
const prodUrl = 'https://gallery.example.com/api/health';

describe('adminCredentials', () => {
  it('parses the two configured operator accounts', () => {
    const accounts = adminCredentials(production());
    expect(accounts.map((a) => a.username)).toEqual(['solfb1', 'akiffb1']);
  });

  it('fails closed on malformed, duplicate, empty or oversized account lists', () => {
    for (const json of [
      'not json',
      '{}',
      '[]',
      JSON.stringify([{ username: 'solfb1', passwordHash: strongA }, { username: 'solfb1', passwordHash: strongB }]),
      JSON.stringify([{ username: 'a b', passwordHash: strongA }]),
      JSON.stringify([{ username: 'solfb1' }]),
      JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ username: `user${i}x`, passwordHash: strongA }))),
    ]) {
      expect(adminCredentials(production({ ADMIN_CREDENTIALS_JSON: json }))).toEqual([]);
    }
  });

  it('keeps the legacy single-account fallback, with the implicit "admin" ID only in development', () => {
    const legacy = { ADMIN_CREDENTIALS_JSON: undefined, ADMIN_PASSWORD_HASH: strongA };
    expect(adminCredentials(production({ ...legacy, APP_ENV: 'development' }))[0].username).toBe('admin');
    expect(adminCredentials(production(legacy))[0].username).toBe('');
    expect(adminCredentials(production({ ...legacy, ADMIN_USERNAME: 'solfb1' }))[0].username).toBe('solfb1');
  });

  it('fingerprint is order-independent and changes when any password changes', () => {
    const reversed = JSON.stringify(JSON.parse(twoAccounts).reverse());
    const fp = credentialsFingerprintInput(production());
    expect(credentialsFingerprintInput(production({ ADMIN_CREDENTIALS_JSON: reversed }))).toBe(fp);
    const rotated = JSON.stringify([
      { username: 'solfb1', passwordHash: strongA },
      { username: 'akiffb1', passwordHash: hash('rotated private passphrase') },
    ]);
    expect(credentialsFingerprintInput(production({ ADMIN_CREDENTIALS_JSON: rotated }))).not.toBe(fp);
  });
});

describe('configurationErrors', () => {
  it('accepts a complete production configuration', async () => {
    expect(await configurationErrors(production(), prodUrl)).toEqual([]);
  });

  it('skips checks only for loopback development', async () => {
    const dev = production({ APP_ENV: 'development', DEMO_MODE: 'true', ADMIN_CREDENTIALS_JSON: undefined });
    expect(await configurationErrors(dev, 'http://localhost:5188/')).toEqual([]);
    expect(await configurationErrors(dev, 'https://gallery.example.com/')).toContain('APP_ENV');
  });

  it('rejects the public demo password for any account', async () => {
    const json = JSON.stringify([
      { username: 'solfb1', passwordHash: strongA },
      { username: 'akiffb1', passwordHash: demo },
    ]);
    expect(await configurationErrors(production({ ADMIN_CREDENTIALS_JSON: json }), prodUrl)).toContain('ADMIN_PASSWORD_HASH');
  });

  it('rejects weak hash parameters', async () => {
    const weak = strongA.replace('$100000$', '$10000$');
    const json = JSON.stringify([{ username: 'solfb1', passwordHash: weak }]);
    expect(await configurationErrors(production({ ADMIN_CREDENTIALS_JSON: json }), prodUrl)).toContain('ADMIN_PASSWORD_HASH');
  });

  it.each([
    [{ DEMO_MODE: 'true' }, 'DEMO_MODE'],
    [{ DEMO_MODE: undefined }, 'DEMO_MODE'],
    [{ PUBLIC_ORIGIN: 'http://gallery.example.com' }, 'PUBLIC_ORIGIN'],
    [{ PUBLIC_ORIGIN: 'https://gallery.example.com/' }, 'PUBLIC_ORIGIN'],
    [{ PUBLIC_ORIGIN: '' }, 'PUBLIC_ORIGIN'],
    [{ ADMIN_CREDENTIALS_JSON: '[]' }, 'ADMIN_CREDENTIALS_JSON'],
    [{ TOKEN_ENCRYPTION_KEY: 'short' }, 'TOKEN_ENCRYPTION_KEY'],
    [{ GOOGLE_CLIENT_SECRET: undefined }, 'GOOGLE_CLIENT_SECRET'],
    [{ GOOGLE_ALLOWED_EMAIL: 'not-an-email' }, 'GOOGLE_ALLOWED_EMAIL'],
    [{ APP_ENV: undefined }, 'APP_ENV'],
  ] as [Partial<Env>, string][])('flags %o as %s', async (overrides, key) => {
    expect(await configurationErrors(production(overrides), prodUrl)).toContain(key);
  });

  it('rejects requests arriving on a non-canonical origin', async () => {
    expect(await configurationErrors(production(), 'https://archive-gallery.someone.workers.dev/')).toContain('canonical_origin');
  });
});
