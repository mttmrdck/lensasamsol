// Dummy isolated test credentials only; never modifies the operator's .dev.vars.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (!existsSync('.dev.vars.test')) {
  const salt=randomBytes(16);
  const hash=pbkdf2Sync('archive-demo-passphrase',salt,100000,32,'sha256');
  writeFileSync('.dev.vars.test',`ADMIN_USERNAME=admin\nADMIN_PASSWORD_HASH=pbkdf2$sha256$100000$${salt.toString('base64')}$${hash.toString('base64')}\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`,{mode:0o600});
}
console.log('Isolated test credentials ready.');
