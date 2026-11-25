/* Applies SQL migrations in supabase/migrations (and the local shim when DB_LOCAL=1). */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { loadEnv } from "./env";

loadEnv();

async function main() {
  const reset = process.argv.includes("--reset");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (reset) {
      if (process.env.DB_LOCAL !== "1") throw new Error("--reset is only allowed with DB_LOCAL=1");
      await client.query("drop schema if exists public cascade; drop schema if exists app cascade; create schema public;");
      console.log("reset: dropped schemas");
    }
    if (process.env.DB_LOCAL === "1") {
      await client.query(readFileSync(join("db/local/000_supabase_shim.sql"), "utf8"));
    }
    await client.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz default now())");
    const done = new Set((await client.query("select name from public._migrations")).rows.map((r) => r.name));
    const dir = "supabase/migrations";
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await client.query("begin");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("insert into public._migrations(name) values ($1)", [file]);
        await client.query("commit");
        console.log("applied", file);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${file}: ${(e as Error).message}`);
      }
    }
    // _migrations is internal: keep it away from app users.
    await client.query("alter table public._migrations enable row level security");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
