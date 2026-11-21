// Minimal stand-ins for the Workers runtime globals referenced by worker/env.ts, so unit tests that import
// Worker modules typecheck under the Node project (full @cloudflare/workers-types conflicts with the DOM lib).
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
