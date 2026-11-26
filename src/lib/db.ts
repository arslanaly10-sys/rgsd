import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const g = globalThis as unknown as { __rgsPool?: Pool };

export const pool: Pool =
  g.__rgsPool ??
  (g.__rgsPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    ssl: process.env.DB_LOCAL === "1" ? false : { rejectUnauthorized: false },
  }));

export type Db = PoolClient;

export type Actor = {
  /** profiles.id of the person on whose behalf the work runs */
  id: string;
  actorKind?: "user" | "agent";
  runId?: string;
};

/** Run queries as a user: RLS applies exactly as it would for that person. */
export async function withUser<T>(actor: Actor, fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: actor.id, role: "authenticated", actor_kind: actor.actorKind ?? "user", run_id: actor.runId ?? "" }),
    ]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Run as the system (bypasses RLS). Only for watchers, workflow internals and
 * session lookup. Never pass user-controlled scope without checking it first.
 */
export async function withSystem<T>(fn: (db: Db) => Promise<T>, opts: { runId?: string; actorId?: string } = {}): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      // RLS is bypassed here; sub only records who the work is for in the audit log.
      JSON.stringify({ sub: opts.actorId ?? "", actor_kind: opts.actorId ? "agent" : "system", run_id: opts.runId ?? "" }),
    ]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function rows<T extends QueryResultRow = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends QueryResultRow = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}
