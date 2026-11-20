// Release gates use installed tools only. No resource creation, migrations or secret updates.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const [action, environment, ...flags] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, ...extra });
  if (result.status !== 0) fail(`${command} failed; no release evidence recorded`);
}
function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    if (entry.isSymbolicLink()) fail(`Symlink in release output: ${relative(root, target)}`);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
function sourceDigest() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('Cannot enumerate source');
  const files = [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
  return hash(JSON.stringify(files.filter((p) => existsSync(p) && statSync(p).isFile()).map((p) => [p, hash(readFileSync(p))])));
}
function check() {
  const config = json('wrangler.jsonc'); // Deliberately requires strict JSON.
  const selected = config.env?.[environment];
  if (!selected) fail(`Missing ${environment} overlay`);
  const ids = [];
  for (const name of ['staging', 'production']) {
    const overlay = config.env?.[name];
    const db = overlay?.d1_databases?.find((binding) => binding.binding === 'DB');
    if (!db || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(db.database_id) || /^(0+|1+|f+)$/i.test(db.database_id.replaceAll('-', '')) || /placeholder|unconfigured|replace|example/i.test(db.database_name ?? '')) fail(`${name} requires an explicitly configured D1 database UUID/name`);
    ids.push(db.database_id.toLowerCase());
    if (!overlay.name || overlay.name === config.name) fail(`${name} requires its own Worker name`);
  }
  if (ids[0] === ids[1]) fail('Staging and production must use different D1 databases');
  for (const binding of [...(config.d1_databases ?? []), ...(config.env?.test?.d1_databases ?? [])]) {
    if (ids.includes(binding.database_id?.toLowerCase())) fail('Release D1 must be isolated from development/test');
  }
  if (config.env.staging.name === config.env.production.name) fail('Release Worker names must differ');
  if (selected.vars?.APP_ENV !== environment || selected.vars?.DEMO_MODE !== 'false') fail('Release requires matching APP_ENV and DEMO_MODE=false');
  let origin;
  try { origin = new URL(selected.vars.PUBLIC_ORIGIN); } catch { fail('Configure PUBLIC_ORIGIN'); }
  if (origin.protocol !== 'https:' || origin.origin !== selected.vars.PUBLIC_ORIGIN || origin.username || origin.password || /(^|\.)(localhost|local|test|invalid|example)(\.|$)|^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|:/.test(origin.hostname) || !origin.hostname.includes('.')) fail('PUBLIC_ORIGIN must be a real HTTPS public origin without path or credentials');
  const other = config.env[environment === 'staging' ? 'production' : 'staging'].vars?.PUBLIC_ORIGIN;
  if (other && other === selected.vars.PUBLIC_ORIGIN) fail('Release origins must differ');
  console.log(`${environment}: config checks passed (remote secrets and ownership remain operator checks)`);
  return selected;
}
function discover(selected) {
  const matches = readdirSync('dist', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => resolve('dist', e.name, 'wrangler.json')).filter(existsSync).filter((p) => { const c = json(p); return c.name === selected.name && c.vars?.APP_ENV === environment; });
  if (matches.length !== 1) fail('Expected exactly one matching generated release manifest; build the selected environment');
  const path = matches[0], built = json(path);
  if (built.vars?.PUBLIC_ORIGIN !== selected.vars.PUBLIC_ORIGIN || built.vars?.DEMO_MODE !== 'false' || built.d1_databases?.find((b) => b.binding === 'DB')?.database_id !== selected.d1_databases.find((b) => b.binding === 'DB')?.database_id) fail('Generated configuration differs from selected release');
  const outputs = [dirname(path), resolve(dirname(path), built.assets?.directory ?? '')];
  for (const output of outputs) if (!output.startsWith(resolve('dist') + '/') || output === resolve('dist')) fail('Generated assets must stay inside dist');
  return { path, outputs: [...new Set(outputs)] };
}
function clean(outputs) {
  for (const output of outputs) {
    for (const file of walk(output)) if (/^\.dev\.vars(?:\.|$)/.test(file.split('/').at(-1))) rmSync(file);
    const fixtures = join(output, '__fixtures');
    if (existsSync(fixtures)) rmSync(fixtures, { recursive: true });
  }
}
function secretValues() {
  const values = new Set();
  const add = (key, value) => {
    if (!/SECRET|PASSWORD|TOKEN_ENCRYPTION_KEY|ADMIN_CREDENTIALS_JSON|API_TOKEN|PRIVATE_KEY/.test(key) || typeof value !== 'string' || value.length < 8) return;
    values.add(value);
    if (key === 'ADMIN_CREDENTIALS_JSON') { try { for (const account of JSON.parse(value)) if (account.passwordHash) values.add(account.passwordHash); } catch { /* full raw value is still scanned */ } }
  };
  for (const [key, value] of Object.entries(process.env)) add(key, value);
  for (const file of readdirSync(root).filter((name) => /^(\.dev\.vars|\.env)(\.|$)/.test(name) && !name.endsWith('.example'))) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      add(match[1], value);
    }
  }
  return [...values];
}
function artifacts(outputs) {
  const secrets = secretValues();
  return [...new Set(outputs.flatMap(walk))].sort().map((file) => {
    const bytes = readFileSync(file);
    if (secrets.some((secret) => bytes.includes(Buffer.from(secret)))) fail(`Secret material detected in ${relative(root, file)} (value withheld)`);
    if (file.split('/').some((part) => part === '__fixtures' || /^\.dev\.vars(?:\.|$)/.test(part))) fail('Forbidden release sidecar or fixture');
    return [relative(root, file), hash(bytes)];
  });
}
try {
  if (!['check', 'build', 'dryrun', 'deploy'].includes(action) || !['staging', 'production'].includes(environment)) fail('Usage: node scripts/release.mjs <check|build|dryrun|deploy> <staging|production> [--approve <environment>]');
  if (flags.length && !(action === 'deploy' && flags.length === 2 && flags[0] === '--approve' && flags[1] === environment)) fail('Unexpected arguments');
  const selected = check();
  if (action === 'check') process.exit(0);
  const evidenceDir = resolve('test-results', 'release', environment);
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, 'manifest.json');
  if (action === 'build') {
    if (existsSync(evidencePath)) rmSync(evidencePath);
    run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { env: { ...process.env, CLOUDFLARE_ENV: environment, WRANGLER_SEND_METRICS: 'false' } });
    const generated = discover(selected);
    clean(generated.outputs);
    writeFileSync(evidencePath, JSON.stringify({ environment, builtAt: new Date().toISOString(), config: relative(root, generated.path), sourceDigest: sourceDigest(), artifacts: artifacts(generated.outputs), dryrun: false }, null, 2) + '\n');
    console.log(`Release artifact manifest: ${relative(root, evidencePath)}`);
  } else {
    if (!existsSync(evidencePath)) fail('Missing build evidence; run release build first');
    const evidence = json(evidencePath), generated = discover(selected);
    if (evidence.environment !== environment || evidence.config !== relative(root, generated.path) || evidence.sourceDigest !== sourceDigest() || JSON.stringify(evidence.artifacts) !== JSON.stringify(artifacts(generated.outputs))) fail('Source/artifact digest changed; rebuild and repeat dryrun');
    if (action === 'dryrun') {
      run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', generated.path, '--dry-run', '--outdir', join(evidenceDir, 'dryrun')]);
      const dryrunArtifacts = artifacts([join(evidenceDir, 'dryrun')]);
      if (!dryrunArtifacts.length) fail('Wrangler produced no dryrun output');
      evidence.dryrun = { checkedAt: new Date().toISOString(), artifacts: dryrunArtifacts };
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
      console.log('Upload validation only; no upload performed');
    } else {
      if (flags[0] !== '--approve' || flags[1] !== environment) fail(`Deployment requires --approve ${environment}`);
      if (!evidence.dryrun || JSON.stringify(evidence.dryrun.artifacts) !== JSON.stringify(artifacts([join(evidenceDir, 'dryrun')]))) fail('Missing or stale dryrun evidence');
      run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', generated.path]);
    }
  }
} catch (error) { console.error(`Release blocked: ${error.message}`); process.exitCode = 1; }
