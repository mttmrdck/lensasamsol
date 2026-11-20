import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

/** Fetch wrapper: same-origin credentials + CSRF header on every request; JSON errors become ApiError. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      'x-archive-csrf': '1',
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string; error?: string };
    if (
      res.status === 401 &&
      path.startsWith('/api/admin') &&
      !location.pathname.startsWith('/admin/login')
    ) {
      location.assign(`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    throw new ApiError(d.message ?? `Request failed (${res.status}).`, res.status, d.error ?? 'error');
  }
  return data as T;
}

/** Validated fetch for public payloads. */
export async function apiParsed<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
  const data = await api<unknown>(path);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError('The gallery data was malformed.', 500, 'schema');
  return parsed.data;
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
