// Production secret preparation. Local only: no Cloudflare commands, no network calls, nothing printed.
// Writes ~/.lensasamsol-production/secrets.json (directory 0700, file 0600), outside the repository.
// Run it in an interactive terminal: node scripts/prepare-production-secrets.mjs
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { hiddenInput } from './lib/secret-input.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(homedir(), '.lensasamsol-production');
const bundlePath = join(directory, 'secrets.json');
const stagingBundle = join(root, '.wrangler/staging-credentials/secrets.json');
const usernames = ['solfb1', 'akiffb1'];
const required = [
  'ADMIN_CREDENTIALS_JSON',
  'TOKEN_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_ALLOWED_EMAIL',
];
const ITERATIONS = 100000;

class SetupError extends Error {}
function ensure(condition, message) {
  if (!condition) throw new SetupError(message);
}
function privatePath(path, isDirectory) {
  const info = lstatSync(path);
  ensure(!info.isSymbolicLink(), 'Credential paths must not be symbolic links.');
  ensure(isDirectory ? info.isDirectory() : info.isFile(), 'Invalid credential storage.');
  ensure((info.mode & 0o777) === (isDirectory ? 0o700 : 0o600), 'Credential directory must be mode 0700 and the bundle 0600.');
}
function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new SetupError('Private credential JSON is invalid; values withheld.');
  }
}
function hashParts(hash) {
  ensure(typeof hash === 'string', 'Invalid administrator hash.');
  const parts = hash.split('$');
  ensure(parts.length === 5 && parts[0] === 'pbkdf2' && parts[1] === 'sha256' && parts[2] === String(ITERATIONS), 'Invalid administrator hash.');
  const salt = Buffer.from(parts[3], 'base64');
  const digest = Buffer.from(parts[4], 'base64');
  ensure(salt.length === 16 && digest.length === 32, 'Invalid administrator hash.');
  return { salt, digest };
}
function matches(password, hash) {
  const { salt, digest } = hashParts(hash);
  return timingSafeEqual(pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256'), digest);
}
function accountsOf(value) {
  if (value === undefined || value === '') return [];
  const accounts = parse(value);
  ensure(Array.isArray(accounts) && accounts.length <= 2, 'Expected only the two administrators.');
  for (const a of accounts) {
    ensure(a && usernames.includes(a.username), 'Unexpected administrator.');
    hashParts(a.passwordHash);
  }
  return accounts;
}

// Staging values are read only to refuse reusing them. They are never copied or printed.
function stagingValues() {
  try {
    const s = parse(readFileSync(stagingBundle, 'utf8'));
    return { hashes: accountsOf(s.ADMIN_CREDENTIALS_JSON).map(a => a.passwordHash), clientId: s.GOOGLE_CLIENT_ID, key: s.TOKEN_ENCRYPTION_KEY };
  } catch {
    return { hashes: [], clientId: undefined, key: undefined };
  }
}
const staging = stagingValues();

const validClientId = v => typeof v === 'string' && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(v);
// eslint-disable-next-line no-control-regex -- Explicitly reject pasted control characters.
const validSecret = v => typeof v === 'string' && v.length >= 8 && v.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(v);
const validEmail = v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function passwordFor(username, taken) {
  for (;;) {
    const password = await hiddenInput(`Production password for ${username} (hidden, at least 12 characters): `);
    // eslint-disable-next-line no-control-regex -- Explicitly reject pasted control characters.
    if (password.length < 12 || password === 'archive-demo-passphrase' || /[\x00-\x1f\x7f]/.test(password)) {
      console.log('Use at least 12 characters; not the demo passphrase; no control characters.');
      continue;
    }
    if ([...taken, ...staging.hashes].some(h => matches(password, h))) {
      console.log('Use a password that differs from the other administrator and from staging.');
      continue;
    }
    if (password !== (await hiddenInput(`Confirm password for ${username} (hidden): `))) {
      console.log('Passwords did not match. Try again.');
      continue;
    }
    const salt = randomBytes(16);
    const digest = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
    return { username, passwordHash: `pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64')}$${digest.toString('base64')}` };
  }
}
async function collect(label, valid, reject) {
  for (;;) {
    const value = (await hiddenInput(`${label} (hidden): `)).trim();
    if (!valid(value)) console.log('That value has an invalid format. Try again.');
    else if (reject?.(value)) console.log('That value is already used by staging. Enter the PRODUCTION value.');
    else return value;
  }
}

async function main() {
  ensure(process.argv.length === 2, 'Run without arguments; enter credentials only at the hidden prompts.');
  ensure(!directory.startsWith(root), 'The production bundle must live outside the repository.');
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  privatePath(directory, true);

  let existing = {};
  let original = null;
  if (existsSync(bundlePath)) {
    privatePath(bundlePath, false);
    original = readFileSync(bundlePath, 'utf8');
    existing = parse(original);
    ensure(existing && typeof existing === 'object' && !Array.isArray(existing), 'Invalid production bundle.');
    ensure(Object.keys(existing).every(k => required.includes(k)), 'Unexpected settings in the production bundle.');
  }
  let key = existing.TOKEN_ENCRYPTION_KEY;
  if (key === undefined) {
    key = randomBytes(32).toString('base64');
    ensure(key !== staging.key, 'Generated key collided with staging; rerun.');
    console.log('Generated a new production-only encryption key (not displayed). Back it up with your other production secrets.');
  } else {
    ensure(Buffer.from(key, 'base64').length === 32 && key !== staging.key, 'The saved encryption key is invalid or equals staging; it will not be replaced.');
    console.log('Saved production encryption key preserved.');
  }

  const accounts = accountsOf(existing.ADMIN_CREDENTIALS_JSON);
  console.log('Input is hidden. Press Ctrl+C to cancel without saving.');
  for (const username of usernames) {
    if (accounts.some(a => a.username === username)) console.log(`${username}: saved password hash preserved.`);
    else accounts.push(await passwordFor(username, accounts.map(a => a.passwordHash)));
  }
  const complete = {
    ADMIN_CREDENTIALS_JSON: JSON.stringify(usernames.map(u => ({ username: u, passwordHash: accounts.find(a => a.username === u).passwordHash }))),
    TOKEN_ENCRYPTION_KEY: key,
    GOOGLE_CLIENT_ID: validClientId(existing.GOOGLE_CLIENT_ID) ? existing.GOOGLE_CLIENT_ID : await collect('Production Google OAuth Client ID', validClientId, v => v === staging.clientId),
    GOOGLE_CLIENT_SECRET: validSecret(existing.GOOGLE_CLIENT_SECRET) ? existing.GOOGLE_CLIENT_SECRET : await collect('Production Google OAuth Client Secret', validSecret),
    GOOGLE_ALLOWED_EMAIL: validEmail(existing.GOOGLE_ALLOWED_EMAIL) ? existing.GOOGLE_ALLOWED_EMAIL : await collect('Google account allowed to connect Drive (email)', validEmail),
  };
  ensure(required.every(k => typeof complete[k] === 'string' && complete[k]), 'Production bundle is incomplete.');
  ensure(accountsOf(complete.ADMIN_CREDENTIALS_JSON).length === 2, 'Both administrators are required.');
  ensure(original === null || readFileSync(bundlePath, 'utf8') === original, 'Bundle changed during setup; rerun.');

  const serialized = JSON.stringify(complete, null, 2) + '\n';
  const temporary = join(directory, `.secrets-${randomBytes(12).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, bundlePath);
  } finally {
    try { unlinkSync(temporary); } catch { /* renamed or never created */ }
  }
  privatePath(bundlePath, false);
  ensure(readFileSync(bundlePath, 'utf8') === serialized, 'Could not verify the saved bundle.');
  console.log('Verified: all five production secrets are saved privately in ~/.lensasamsol-production/secrets.json.');
  console.log('Nothing was displayed, uploaded or deployed.');
}

main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Setup stopped without displaying private values. Run it in an interactive terminal.');
  process.exitCode = 1;
});
