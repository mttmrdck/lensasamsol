// Release configuration rules shared by scripts/release.mjs and the Vite build guard (vite.config.ts).
// Pure and offline: reads wrangler.jsonc only. Remote state (secrets, migrations) is checked separately.
import { readFileSync } from 'node:fs';

export const RELEASE_ENVIRONMENTS = ['staging', 'production'];
export const REQUIRED_SECRETS = [
  'ADMIN_CREDENTIALS_JSON',
  'TOKEN_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_ALLOWED_EMAIL',
];
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** wrangler.jsonc is kept as strict JSON on purpose, so comments cannot hide values from this check. */
export function readWranglerConfig(path = 'wrangler.jsonc') {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Throws with a specific reason when the selected environment is not safe to build or deploy publicly. */
export function assertReleaseConfig(config, environment) {
  const fail = (message) => {
    throw new Error(`[${environment}] ${message}`);
  };
  if (!RELEASE_ENVIRONMENTS.includes(environment)) fail('Release environment must be staging or production');
  const selected = config.env?.[environment];
  if (!selected) fail(`Missing env.${environment} in wrangler.jsonc`);

  const isPlaceholderDb = (db) =>
    !db ||
    !UUID.test(db.database_id ?? '') ||
    /^(0+|1+|f+)$/i.test(db.database_id.replaceAll('-', '')) ||
    /placeholder|unconfigured|replace|example/i.test(db.database_name ?? '');
  const ids = {};
  for (const name of RELEASE_ENVIRONMENTS) {
    const overlay = config.env?.[name];
    const db = overlay?.d1_databases?.find((binding) => binding.binding === 'DB');
    // Only the selected environment must be fully real; the other may still be unconfigured (staged rollout).
    if (isPlaceholderDb(db)) {
      if (name === environment) fail(`env.${name} requires an explicitly configured D1 database UUID (placeholder found)`);
      continue;
    }
    if (!db.database_name?.endsWith(`-${name}`)) fail(`env.${name} D1 database_name must end with "-${name}"`);
    if (db.migrations_dir !== 'migrations') fail(`env.${name} must use migrations_dir "migrations"`);
    ids[name] = db.database_id.toLowerCase();
    if (!overlay.name) fail(`env.${name} requires an explicit Worker name`);
  }
  if (ids.staging && ids.staging === ids.production) fail('Staging and production must use different D1 databases');
  for (const binding of [...(config.d1_databases ?? []), ...(config.env?.test?.d1_databases ?? [])])
    if (Object.values(ids).includes(binding.database_id?.toLowerCase())) fail('Release D1 must be isolated from development/test');
  if (config.env.staging?.name === config.env.production?.name) fail('Staging and production Worker names must differ');
  if (environment === 'staging' && selected.name === config.name) fail('Staging must not use the production Worker name');

  const vars = selected.vars ?? {};
  if (vars.APP_ENV !== environment) fail(`APP_ENV must be "${environment}"`);
  if (vars.DEMO_MODE !== 'false') fail('DEMO_MODE must be the string "false"');
  let origin;
  try {
    origin = new URL(vars.PUBLIC_ORIGIN);
  } catch {
    fail('PUBLIC_ORIGIN is not configured');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== vars.PUBLIC_ORIGIN ||
    origin.username ||
    origin.password ||
    /(^|\.)(localhost|local|test|invalid|example)(\.|$)|^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|:/.test(origin.hostname) ||
    !origin.hostname.includes('.')
  )
    fail('PUBLIC_ORIGIN must be a real HTTPS public origin without path, port or credentials');
  if (origin.hostname.endsWith('.workers.dev') && !origin.hostname.startsWith(`${selected.name}.`))
    fail(`workers.dev PUBLIC_ORIGIN must start with the Worker name "${selected.name}."`);
  if (selected.workers_dev !== true && origin.hostname.endsWith('.workers.dev')) fail('workers.dev origin requires workers_dev: true');
  const other = config.env[environment === 'staging' ? 'production' : 'staging'].vars?.PUBLIC_ORIGIN;
  if (other && other === vars.PUBLIC_ORIGIN) fail('Staging and production origins must differ');

  const required = selected.secrets?.required ?? [];
  const missing = REQUIRED_SECRETS.filter((key) => !required.includes(key));
  if (missing.length) fail(`secrets.required must list ${missing.join(', ')}`);
  return selected;
}

/**
 * Vite build guard. Any CI build (Workers Builds sets WORKERS_CI=1) must target a release environment, and a
 * release environment must pass assertReleaseConfig. Local non-CI builds of development/test stay allowed.
 */
export function assertBuildTarget(env = process.env, config = readWranglerConfig()) {
  const target = env.CLOUDFLARE_ENV;
  if (RELEASE_ENVIRONMENTS.includes(target)) return assertReleaseConfig(config, target);
  if (env.WORKERS_CI === '1' || env.CI === 'true' || env.CI === '1')
    throw new Error(
      `Refusing CI build without CLOUDFLARE_ENV=staging|production (got ${target ? `"${target}"` : 'nothing'}). ` +
        'The default configuration is local-only: demo mode, localhost origin and placeholder D1.',
    );
  return null;
}
