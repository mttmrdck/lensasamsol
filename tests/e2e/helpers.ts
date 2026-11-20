import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = process.env.ADMIN_PASS ?? 'archive-demo-passphrase';
export const ORIGIN = 'http://localhost:5190';
const MUTATION_HEADERS = { 'x-archive-csrf': '1', origin: ORIGIN };

export async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('User ID', {exact:true}).fill(process.env.ADMIN_USER ?? 'admin');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/admin') && !u.pathname.startsWith('/admin/login'));
}

/** Signs an API request context in as the owner (cookie kept by the context). */
export async function apiLogin(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', {
    data: { username: process.env.ADMIN_USER ?? 'admin', password: PASSWORD },
    headers: MUTATION_HEADERS,
  });
  expect(res.status()).toBe(200);
}

export async function adminJson<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(path, {
    method,
    data,
    headers: method === 'GET' ? { 'x-archive-csrf': '1' } : MUTATION_HEADERS,
  });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

export interface Detail {
  id: string;
  title: string;
  status: string;
  shareToken: string | null;
  photos: Array<{ id: string; assigned: boolean; filename: string }>;
}

export const detail = (request: APIRequestContext, id: string) =>
  adminJson<Detail>(request, 'GET', `/api/admin/collections/${id}`);

export async function tokenOf(request: APIRequestContext, id: string) {
  const d = await detail(request, id);
  if (!d.shareToken) throw new Error(`no token for ${id}`);
  return d.shareToken;
}

export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
