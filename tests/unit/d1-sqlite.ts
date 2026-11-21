// Test-only D1 emulation over node:sqlite with the repository's real migrations applied.
// Batches are atomic (BEGIN/COMMIT/ROLLBACK) like D1's, and failures can be injected, including a "hard kill"
// after which every call fails until revive(): that models a Worker terminated by the CPU limit, where no
// catch/finally handler gets to write anything.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export class KilledError extends Error {}

export interface FailurePlan {
  /** 1-based index of the batch() call that fails (counted from when the plan is set). */
  onBatch: number;
  /** 'error' throws and rolls back (handlers still run); 'kill' throws and then fails every call until revive(). */
  mode: 'error' | 'kill';
}

export function createD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = join(process.cwd(), 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(dir, f), 'utf8'));

  let batches = 0;
  let plan: FailurePlan | null = null;
  let dead = false;
  const log: { statements: number; maxParams: number }[] = [];

  const guard = () => {
    if (dead) throw new KilledError('worker terminated');
  };

  function statement(sql: string, bound: unknown[] = []) {
    const api = {
      sql,
      bound,
      bind: (...args: unknown[]) => statement(sql, args),
      async run() {
        guard();
        const r = sqlite.prepare(sql).run(...(bound as SQLInputValue[]));
        return { success: true, results: [], meta: { changes: Number(r.changes) } };
      },
      async all<T>() {
        guard();
        return { results: sqlite.prepare(sql).all(...(bound as SQLInputValue[])) as T[], meta: {} };
      },
      async first<T>() {
        guard();
        return (sqlite.prepare(sql).get(...(bound as SQLInputValue[])) ?? null) as T | null;
      },
    };
    return api;
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(stmts: ReturnType<typeof statement>[]) {
      guard();
      batches++;
      log.push({ statements: stmts.length, maxParams: Math.max(0, ...stmts.map((s) => s.bound.length)) });
      if (plan && batches === plan.onBatch) {
        const failing = plan;
        plan = null;
        if (failing.mode === 'kill') dead = true;
        throw failing.mode === 'kill' ? new KilledError('worker terminated mid-request') : new Error('D1_ERROR: transient');
      }
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map((s) => {
          const r = sqlite.prepare(s.sql).run(...(s.bound as SQLInputValue[]));
          return { success: true, results: [], meta: { changes: Number(r.changes) } };
        });
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };

  return {
    db: db as unknown as D1Database,
    sqlite,
    log,
    failOn(onBatch: number, mode: FailurePlan['mode']) {
      batches = 0;
      plan = { onBatch, mode };
    },
    revive() {
      dead = false;
    },
    get batchCount() {
      return batches;
    },
  };
}

/** Minimal valid collection row for engine tests. */
export function insertCollection(
  sqlite: DatabaseSync,
  id: string,
  opts: { folder?: string; mode?: 'all' | 'selected'; status?: 'draft' | 'published'; syncStatus?: string } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO collections (id, slug, title, source, drive_folder_id, drive_folder_name, folder_access, assignment_mode, status,
         style_draft_json, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, 'drive', ?, 'Folder', 'unknown', ?, ?, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`,
    )
    .run(id, `slug-${id}`, `Gallery ${id}`, opts.folder ?? 'FOLDER', opts.mode ?? 'all', opts.status ?? 'draft', opts.syncStatus ?? 'never');
}
