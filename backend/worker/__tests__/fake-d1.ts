/**
 * In-memory D1 stand-in for tests, backed by node:sqlite (Node >= 22).
 *
 * Implements the same structural D1Db surface functions/_lib/db.ts talks to,
 * so tests drive the REAL query translator + REAL SQL against a real SQLite
 * engine — schema bootstrap included — instead of asserting on transport
 * calls. `raw` exposes the underlying DatabaseSync for seeding/inspection.
 */
import { DatabaseSync } from 'node:sqlite';
import { __resetDbBootstrap, dbEnsureSchema, type D1Db, type D1Result, type D1Stmt } from '../functions/_lib/db';

export interface FakeD1 extends D1Db {
  raw: DatabaseSync;
}

type SqlParam = null | number | bigint | string | Uint8Array;

/** Fresh fake with the full vinax schema already applied. */
export async function fakeD1Ready(): Promise<FakeD1> {
  const db = fakeD1();
  await dbEnsureSchema({ DB: db });
  return db;
}

export function fakeD1(): FakeD1 {
  // Each fake database is fresh, so the per-isolate schema memo in db.ts
  // must be cleared or the second test would skip bootstrap on an empty DB.
  __resetDbBootstrap();
  const raw = new DatabaseSync(':memory:');

  const make = (sql: string, params: unknown[]): D1Stmt => ({
    bind: (...values: unknown[]) => make(sql, values),
    all: async <T,>(): Promise<D1Result<T>> => {
      const results = raw.prepare(sql).all(...(params as SqlParam[])) as T[];
      return { results, success: true };
    },
    run: async (): Promise<D1Result> => {
      raw.prepare(sql).run(...(params as SqlParam[]));
      return { success: true };
    },
    first: async <T,>(): Promise<T | null> => {
      const row = raw.prepare(sql).get(...(params as SqlParam[]));
      return (row ?? null) as T | null;
    },
  });

  return {
    raw,
    prepare: (sql: string) => make(sql, []),
    batch: async <T,>(stmts: D1Stmt[]): Promise<D1Result<T>[]> => {
      const out: D1Result<T>[] = [];
      for (const s of stmts) out.push(await (s.all as <U>() => Promise<D1Result<U>>)<T>());
      return out;
    },
  };
}

/** Insert rows into a table on the raw handle (fast path for seeding). */
export function seed(db: FakeD1, table: string, rows: Record<string, SqlParam>[]): void {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const stmt = db.raw.prepare(
    `insert into ${table} (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`,
  );
  for (const row of rows) stmt.run(...cols.map((c) => row[c]));
}

/** All rows of a table, for post-assertions. */
export function tableRows(db: FakeD1, table: string): Record<string, unknown>[] {
  return db.raw.prepare(`select * from ${table}`).all() as Record<string, unknown>[];
}
