// Usage: npm run hash-password -- "a long passphrase"   → prints the ADMIN_PASSWORD_HASH value
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Provide a passphrase of at least 12 characters: npm run hash-password -- "your passphrase"');
  process.exit(1);
}
const iterations = 100000; // Workers WebCrypto caps PBKDF2 at 100k iterations.
const salt = randomBytes(16);
const hash = pbkdf2Sync(pw, salt, iterations, 32, 'sha256');
console.log(`pbkdf2$sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`);
