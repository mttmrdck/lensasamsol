import { hiddenInput } from './lib/secret-input.mjs';
// Register fixed local operator accounts without putting plaintext passwords in arguments or files.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
const names=process.argv.slice(2);
if(!names.length || names.length>8 || new Set(names).size!==names.length || names.some(n=>!/^[A-Za-z0-9_.@-]{3,80}$/.test(n))) throw new Error('Provide 1–8 distinct user IDs only.');
const accounts=[];
for(const username of names) {
  const password=await hiddenInput(`Password for ${username} (input hidden): `);
  if(password.length<12) throw new Error('Password must contain at least 12 characters.');
  const salt=randomBytes(16), hash=pbkdf2Sync(password,salt,100000,32,'sha256');
  accounts.push({username,passwordHash:`pbkdf2$sha256$100000$${salt.toString('base64')}$${hash.toString('base64')}`});
}
let content=existsSync('.dev.vars')?readFileSync('.dev.vars','utf8'):'';
content=content.split('\n').filter(line=>!/^ADMIN_(CREDENTIALS_JSON|PASSWORD_HASH|USERNAME)=/.test(line)).join('\n').trimEnd();
writeFileSync('.dev.vars',content+`\nADMIN_CREDENTIALS_JSON='${JSON.stringify(accounts)}'\n`,{mode:0o600});chmodSync('.dev.vars',0o600);
console.log(`Registered local operator accounts: ${names.join(', ')}. Only salted hashes were saved. Production was not modified.`);
