// Local staging setup only. No Cloudflare commands, network calls, or plaintext password files.
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { hiddenInput } from './lib/secret-input.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, '.wrangler/staging-credentials');
const bundlePath = join(directory, 'secrets.json');
const usernames = ['solfb1', 'akiffb1'];
const required = [
  'ADMIN_CREDENTIALS_JSON', 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET', 'GOOGLE_ALLOWED_EMAIL',
];

class SetupError extends Error {}
function ensure(condition, message) {
  if (!condition) throw new SetupError(message);
}
function privatePath(path, isDirectory) {
  const info = lstatSync(path);
  ensure(!info.isSymbolicLink(), 'Credential paths must not be symbolic links.');
  ensure(isDirectory ? info.isDirectory() : info.isFile(), 'Invalid credential storage.');
  ensure((info.mode & 0o777) === (isDirectory ? 0o700 : 0o600),
    'Credential directory must have mode 0700 and bundle mode 0600.');
}
function parsePrivateJson(value) {
  try { return JSON.parse(value); }
  catch { throw new SetupError('Private credential JSON is invalid; values withheld.'); }
}
function hashParts(hash) {
  ensure(typeof hash === 'string', 'Invalid saved administrator hash.');
  const parts = hash.split('$');
  ensure(parts.length === 5 && parts[0] === 'pbkdf2' && parts[1] === 'sha256' && parts[2] === '100000',
    'Invalid saved administrator hash.');
  const salt = Buffer.from(parts[3], 'base64');
  const digest = Buffer.from(parts[4], 'base64');
  ensure(salt.length === 16 && digest.length === 32 && salt.toString('base64') === parts[3]
    && digest.toString('base64') === parts[4], 'Invalid saved administrator hash.');
  return { salt, digest };
}
function matches(password, hash) {
  const { salt, digest } = hashParts(hash);
  return timingSafeEqual(pbkdf2Sync(password, salt, 100000, 32, 'sha256'), digest);
}
function readAccounts(value) {
  if (value === undefined || value === '') return [];
  ensure(typeof value === 'string', 'Invalid saved administrator credentials.');
  const accounts = parsePrivateJson(value);
  ensure(Array.isArray(accounts) && accounts.length <= 2, 'Expected only the two staging administrators.');
  const seen = new Set();
  for (const account of accounts) {
    ensure(account && usernames.includes(account.username) && !seen.has(account.username),
      'Unexpected or duplicate staging administrator.');
    seen.add(account.username);
    hashParts(account.passwordHash);
    ensure(!matches('archive-demo-passphrase', account.passwordHash), 'Saved demo passwords are not allowed.');
  }
  return accounts;
}
const validClientId = value => typeof value === 'string'
  && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(value);
const validClientSecret = value => typeof value === 'string'
  // eslint-disable-next-line no-control-regex -- Explicitly reject hidden/pasted control characters.
  && value.length >= 8 && value.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(value);

async function passwordFor(username, accounts) {
  for (;;) {
    const password = await hiddenInput(`Set password for ${username} (hidden, at least 12 characters): `);
    // eslint-disable-next-line no-control-regex -- Explicitly reject hidden/pasted control characters.
    if (password.length < 12 || password === 'archive-demo-passphrase' || /[\x00-\x1f\x7f]/.test(password)) {
      console.log('Use at least 12 characters and avoid the demo password or control characters.');
      continue;
    }
    if (accounts.some(account => matches(password, account.passwordHash))) {
      console.log('Choose a different password for each administrator.');
      continue;
    }
    const confirmation = await hiddenInput(`Confirm password for ${username} (hidden): `);
    if (password !== confirmation) {
      console.log('Passwords did not match. Please try again.');
      continue;
    }
    const salt = randomBytes(16);
    const digest = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    return { username, passwordHash: `pbkdf2$sha256$100000$${salt.toString('base64')}$${digest.toString('base64')}` };
  }
}
async function collect(label, valid) {
  for (;;) {
    const value = (await hiddenInput(`${label} (hidden): `)).trim();
    if (valid(value)) return value;
    console.log('That value has an invalid format. Please try again.');
  }
}

async function main() {
  ensure(process.argv.length === 2, 'Run this script without arguments; enter credentials only at its hidden prompts.');
  ensure(!lstatSync(join(root, '.wrangler')).isSymbolicLink(), 'The .wrangler directory must not be a symbolic link.');
  privatePath(directory, true);
  privatePath(bundlePath, false);
  const original = readFileSync(bundlePath, 'utf8');
  const secrets = parsePrivateJson(original);
  ensure(secrets && typeof secrets === 'object' && !Array.isArray(secrets), 'Invalid staging bundle.');
  ensure(Object.keys(secrets).every(key => required.includes(key)), 'Unexpected settings in staging bundle.');
  ensure(typeof secrets.TOKEN_ENCRYPTION_KEY === 'string'
    && Buffer.from(secrets.TOKEN_ENCRYPTION_KEY, 'base64').length === 32
    && Buffer.from(secrets.TOKEN_ENCRYPTION_KEY, 'base64').toString('base64') === secrets.TOKEN_ENCRYPTION_KEY,
  'The existing encryption key is missing or invalid; it will not be replaced.');
  ensure(typeof secrets.GOOGLE_ALLOWED_EMAIL === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secrets.GOOGLE_ALLOWED_EMAIL),
  'The existing Google allowlist is missing or invalid; it will not be replaced.');
  const accounts = readAccounts(secrets.ADMIN_CREDENTIALS_JSON);
  for (const [key, valid] of [['GOOGLE_CLIENT_ID', validClientId], ['GOOGLE_CLIENT_SECRET', validClientSecret]]) {
    ensure(!secrets[key] || valid(secrets[key]), 'A saved OAuth setting has an invalid format; values withheld.');
  }

  console.log('Staging setup: existing encryption key and allowed Google email will be preserved.');
  console.log('Input is hidden. Press Ctrl+C to cancel without saving.');
  for (const username of usernames) {
    if (accounts.some(account => account.username === username)) console.log(`${username}: saved password hash preserved.`);
    else accounts.push(await passwordFor(username, accounts));
  }
  const complete = {
    ADMIN_CREDENTIALS_JSON: JSON.stringify(usernames.map(username => {
      const account = accounts.find(account => account.username === username);
      return { username, passwordHash: account.passwordHash };
    })),
    TOKEN_ENCRYPTION_KEY: secrets.TOKEN_ENCRYPTION_KEY,
    GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID || await collect('Google OAuth Client ID', validClientId),
    GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET || await collect('Google OAuth Client Secret', validClientSecret),
    GOOGLE_ALLOWED_EMAIL: secrets.GOOGLE_ALLOWED_EMAIL,
  };
  ensure(required.every(key => typeof complete[key] === 'string' && complete[key].length > 0), 'Staging bundle is incomplete.');
  ensure(readAccounts(complete.ADMIN_CREDENTIALS_JSON).length === 2, 'Both staging administrators are required.');
  privatePath(directory, true);
  privatePath(bundlePath, false);
  ensure(readFileSync(bundlePath, 'utf8') === original, 'Staging bundle changed during setup; rerun to preserve the latest values.');

  const serialized = JSON.stringify(complete, null, 2) + '\n';
  if (serialized !== original) {
    const temporary = join(directory, `.secrets-${randomBytes(12).toString('hex')}.tmp`);
    try {
      writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, bundlePath);
    } finally {
      try { unlinkSync(temporary); } catch { /* Renamed or never created. */ }
    }
  }
  privatePath(bundlePath, false);
  ensure(readFileSync(bundlePath, 'utf8') === serialized, 'Could not verify the saved staging bundle.');
  console.log('Verified: all five staging secrets and both administrator password hashes are saved privately.');
  console.log('Saved to .wrangler/staging-credentials/secrets.json. No secrets displayed; nothing uploaded or deployed.');
}

main().catch(error => {
  console.error(error instanceof SetupError ? error.message
    : 'Setup stopped without displaying private values. Check the private staging file permissions and run in an interactive terminal.');
  process.exitCode = 1;
});
