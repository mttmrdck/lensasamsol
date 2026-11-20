import { describe, expect, it } from 'vitest';
import { assertBuildTarget, assertReleaseConfig, readWranglerConfig, REQUIRED_SECRETS } from '../../scripts/lib/release-config.mjs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const STAGING_DB = '11111111-2222-4333-8444-555555555555';
const PROD_DB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';

/** A fully configured config; individual tests break one thing at a time. */
const good = (): Json => ({
  name: 'lensasamsol',
  d1_databases: [{ binding: 'DB', database_name: 'lensasamsol', database_id: '00000000-0000-0000-0000-000000000000' }],
  env: {
    test: { name: 'lensasamsol-test', d1_databases: [{ binding: 'DB', database_name: 'lensasamsol-test', database_id: '00000000-0000-0000-0000-000000000001' }] },
    staging: {
      name: 'lensasamsol-staging',
      workers_dev: true,
      vars: { APP_ENV: 'staging', DEMO_MODE: 'false', PUBLIC_ORIGIN: 'https://lensasamsol-staging.studio.workers.dev' },
      secrets: { required: [...REQUIRED_SECRETS] },
      d1_databases: [{ binding: 'DB', database_name: 'lensasamsol-staging', database_id: STAGING_DB, migrations_dir: 'migrations' }],
    },
    production: {
      name: 'lensasamsol',
      workers_dev: true,
      vars: { APP_ENV: 'production', DEMO_MODE: 'false', PUBLIC_ORIGIN: 'https://lensasamsol.studio.workers.dev' },
      secrets: { required: [...REQUIRED_SECRETS] },
      d1_databases: [{ binding: 'DB', database_name: 'lensasamsol-production', database_id: PROD_DB, migrations_dir: 'migrations' }],
    },
  },
});
const broken = (mutate: (c: Json) => void): Json => {
  const c = good();
  mutate(c);
  return c;
};

describe('assertReleaseConfig', () => {
  it('accepts a fully configured staging and production pair', () => {
    expect(() => assertReleaseConfig(good(), 'staging')).not.toThrow();
    expect(() => assertReleaseConfig(good(), 'production')).not.toThrow();
  });

  it.each([
    ['placeholder staging D1 id', (c: Json) => (c.env.staging.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000'), /placeholder/],
    ['placeholder production D1 id (checked for staging too)', (c: Json) => (c.env.production.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000'), /placeholder/],
    ['non-UUID D1 id', (c: Json) => (c.env.staging.d1_databases[0].database_id = 'not-a-uuid'), /placeholder/],
    ['shared D1 between staging and production', (c: Json) => (c.env.production.d1_databases[0].database_id = STAGING_DB), /different D1/],
    ['release D1 equal to the test D1', (c: Json) => (c.env.test.d1_databases[0].database_id = STAGING_DB), /isolated/],
    ['D1 name not ending in the environment', (c: Json) => (c.env.staging.d1_databases[0].database_name = 'lensasamsol'), /must end with/],
    ['demo mode on', (c: Json) => (c.env.staging.vars.DEMO_MODE = 'true'), /DEMO_MODE/],
    ['wrong APP_ENV', (c: Json) => (c.env.staging.vars.APP_ENV = 'development'), /APP_ENV/],
    ['empty origin', (c: Json) => (c.env.staging.vars.PUBLIC_ORIGIN = ''), /PUBLIC_ORIGIN/],
    ['localhost origin', (c: Json) => (c.env.staging.vars.PUBLIC_ORIGIN = 'http://localhost:5188'), /PUBLIC_ORIGIN/],
    ['http origin', (c: Json) => (c.env.staging.vars.PUBLIC_ORIGIN = 'http://lensasamsol-staging.studio.workers.dev'), /PUBLIC_ORIGIN/],
    ['origin with trailing slash', (c: Json) => (c.env.staging.vars.PUBLIC_ORIGIN += '/'), /PUBLIC_ORIGIN/],
    ['workers.dev origin for a different Worker', (c: Json) => (c.env.staging.vars.PUBLIC_ORIGIN = 'https://lensasamsol.studio.workers.dev'), /must start with the Worker name|differ/],
    ['same origin for both environments', (c: Json) => (c.env.production.vars.PUBLIC_ORIGIN = c.env.staging.vars.PUBLIC_ORIGIN), /Worker name|differ/],
    ['staging reusing the production Worker name', (c: Json) => (c.env.staging.name = 'lensasamsol'), /Worker names must differ|production Worker name/],
    ['missing required secret declaration', (c: Json) => (c.env.staging.secrets.required = c.env.staging.secrets.required.slice(1)), /secrets\.required/],
    ['no secrets block', (c: Json) => delete c.env.staging.secrets, /secrets\.required/],
    ['missing migrations_dir', (c: Json) => delete c.env.staging.d1_databases[0].migrations_dir, /migrations_dir/],
  ] as [string, (c: Json) => unknown, RegExp][])('rejects %s', (_label, mutate, message) => {
    expect(() => assertReleaseConfig(broken((c) => void mutate(c)), 'staging')).toThrow(message);
  });

  it('rejects an unknown environment', () => {
    expect(() => assertReleaseConfig(good(), 'development')).toThrow(/staging or production/);
  });
});

describe('assertBuildTarget (Vite build guard)', () => {
  it('refuses a CI build with no environment selected — the original deployment failure', () => {
    expect(() => assertBuildTarget({ WORKERS_CI: '1' }, good())).toThrow(/CLOUDFLARE_ENV/);
    expect(() => assertBuildTarget({ CI: 'true' }, good())).toThrow(/CLOUDFLARE_ENV/);
  });
  it('refuses a CI build that selects the local development or test environment', () => {
    expect(() => assertBuildTarget({ WORKERS_CI: '1', CLOUDFLARE_ENV: 'test' }, good())).toThrow(/CLOUDFLARE_ENV/);
  });
  it('refuses a release build whose configuration is incomplete', () => {
    expect(() => assertBuildTarget({ CLOUDFLARE_ENV: 'production' }, broken((c) => (c.env.production.vars.PUBLIC_ORIGIN = '')))).toThrow(/PUBLIC_ORIGIN/);
  });
  it('allows a valid release build and local non-CI builds', () => {
    expect(assertBuildTarget({ CLOUDFLARE_ENV: 'production', WORKERS_CI: '1' }, good())).toBeTruthy();
    expect(assertBuildTarget({}, good())).toBeNull();
    expect(assertBuildTarget({ CLOUDFLARE_ENV: 'test' }, good())).toBeNull();
  });
});

describe('committed wrangler.jsonc', () => {
  const config = readWranglerConfig() as Json;
  it('keeps the default and test environments local-only', () => {
    expect(config.vars.DEMO_MODE).toBe('true');
    expect(new URL(config.vars.PUBLIC_ORIGIN).hostname).toBe('localhost');
    expect(config.env.test.vars.APP_ENV).toBe('development');
  });
  it('names the production Worker after the existing dashboard Worker and staging separately', () => {
    expect(config.name).toBe('lensasamsol');
    expect(config.env.production.name).toBe('lensasamsol');
    expect(config.env.staging.name).toBe('lensasamsol-staging');
  });
  it('is not deployable until real D1 ids and origins are filled in (guard stays closed)', () => {
    // When the owner configures real values this expectation flips; the unit cases above cover the rules.
    const ready = (env: string) => {
      try {
        assertReleaseConfig(config, env);
        return true;
      } catch {
        return false;
      }
    };
    if (!ready('staging')) expect(() => assertBuildTarget({ CLOUDFLARE_ENV: 'staging', WORKERS_CI: '1' }, config)).toThrow();
  });
});
