import { hiddenInput } from './lib/secret-input.mjs';
// Verifies each local operator account against the running development server (http://localhost:5188).
const names=process.argv.slice(2);
if(!names.length) throw new Error('Provide the user IDs to verify, e.g. solfb1 akiffb1.');
const base='http://localhost:5188';
for(const username of names) {
  const password=await hiddenInput(`Password for ${username} (input hidden): `);
  const res=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-archive-csrf':'1',origin:base},body:JSON.stringify({username,password})});
  if(res.status!==200) throw new Error(`Local login failed for ${username}: ${res.status}`);
  const cookie=res.headers.get('set-cookie')?.split(';')[0];
  if(!cookie || !/httponly/i.test(res.headers.get('set-cookie')??'')) throw new Error('Missing protected session cookie');
  const me=await (await fetch(`${base}/api/auth/me`,{headers:{cookie}})).json();
  if(!me.authenticated) throw new Error('Session was not accepted');
  const logout=await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{cookie,'x-archive-csrf':'1',origin:base}});
  if(!logout.ok) throw new Error('Logout failed');
  const after=await (await fetch(`${base}/api/auth/me`,{headers:{cookie}})).json();
  if(after.authenticated) throw new Error('Logout did not invalidate the session');
  console.log(`${username}: local login, protected session and logout verified.`);
}
