import { adminCredentials } from './admin-credentials';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { configurationErrors, isLoopback } from './runtime';
import type { AppEnv } from './env';
import { isDemo } from './env';
import {
  checkCsrf,
  createSession,
  destroySession,
  isAdminRequest,
  reserveLoginAttempt,
  finishLoginAttempt,
} from './auth';
import { verifyPassword } from './crypto';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { imageRoutes } from './images';
import { loginSchema } from '../shared/api';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('x-frame-options', 'DENY');
  c.header('referrer-policy', 'no-referrer');
  if (c.req.path.startsWith('/api/admin') || c.req.path.startsWith('/api/auth') || c.res.status >= 400) c.header('cache-control', 'no-store');
});

app.use('*', async (c, next) => {
  const errors = await configurationErrors(c.env, c.req.url);
  if (errors.length) return c.json({error:'configuration',message:'Server configuration is incomplete.',ok:false},503);
  await next();
});
app.use('/api/*', bodyLimit({maxSize:256*1024,onError:c=>c.json({error:'payload_too_large'},413)}));
app.use('/api/auth/login', bodyLimit({maxSize:4096,onError:c=>c.json({error:'payload_too_large'},413)}));
app.get('/api/health', (c) => c.json({ ok: true, demoMode: isDemo(c.env) }));

app.get('/api/auth/me', async (c) => {
  c.header('cache-control', 'no-store');
  return c.json({
    authenticated: await isAdminRequest(c),
    configured: adminCredentials(c.env).length > 0,
    demoMode: isDemo(c.env),
  });
});

app.post('/api/auth/login', async (c) => {
  if (!checkCsrf(c)) return c.json({ error: 'csrf', message: 'Request blocked (cross-site).' }, 403);
  const credentials = adminCredentials(c.env);
  if (!credentials.length) {
    return c.json({ error: 'not_configured', message: 'Administrator credentials are not configured on the server.' }, 503);
  }
  const reservation = await reserveLoginAttempt(c);
  if (reservation === null) {
    return c.json({ error: 'throttled', message: 'Too many attempts. Wait 15 minutes and try again.' }, 429);
  }
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  const localDemo = (c.env.APP_ENV ?? 'development') === 'development' && isLoopback(c.req.url);
  const username = parsed.success ? (parsed.data.username ?? (localDemo ? 'admin' : '')) : '';
  // Run a fixed number of password checks for this configured account set, including unknown IDs.
  const results = parsed.success ? await Promise.all(credentials.map(account=>verifyPassword(parsed.data.password,account.passwordHash))) : [];
  const ok = credentials.some((account,i)=>account.username===username && results[i]);
  await finishLoginAttempt(c, reservation, ok);
  if (!ok) return c.json({ error: 'invalid', message: 'That user ID or password is not correct.' }, 401);
  await createSession(c, username);
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  if (!checkCsrf(c)) return c.json({ error: 'csrf' }, 403);
  await destroySession(c);
  return c.json({ ok: true });
});

app.route('/api/public', publicRoutes);
app.route('/api/admin', adminRoutes);
app.route('/img', imageRoutes);

app.all('/api', c=>c.json({error:'not_found'},404));
app.all('/img', c=>c.json({error:'not_found'},404));
app.all('/img/*', c=>c.json({error:'not_found'},404));
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error('request_failed', {name:err.name});
  return c.json({ error: 'server', message: 'Unexpected server error.' }, 500);
});

export default app;
