// Minimal stand-ins for the Workers runtime globals referenced by worker/env.ts, so unit tests that import
// Worker modules typecheck under the Node project (full @cloudflare/workers-types conflicts with the DOM lib).
interface D1Database {
  prepare(query: string): unknown;
}
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
