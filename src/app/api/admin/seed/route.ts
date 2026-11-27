import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { seed } from "../../../../../scripts/seed";

export const maxDuration = 300;

/**
 * One-time SAMPLE data load for a fresh deployment.
 * Requires ALLOW_SEED=1 and Authorization: Bearer SEED_SECRET, and refuses if any organization already exists.
 * Remove ALLOW_SEED after use.
 */
export async function GET(req: Request) {
  // Same one-time load, for tools that can only open a URL: ?secret=SEED_SECRET (still requires ALLOW_SEED=1 and an empty database).
  const secret = new URL(req.url).searchParams.get("secret") ?? "";
  return POST(new Request(req.url, { method: "POST", headers: { authorization: `Bearer ${secret}` } }));
}

export async function POST(req: Request) {
  if (process.env.ALLOW_SEED !== "1" || !process.env.SEED_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.SEED_SECRET}`) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const c = await pool.connect();
  try {
    const n = await c.query("select count(*)::int n from organizations");
    if (n.rows[0].n > 0) return NextResponse.json({ error: "Database already has data; seeding is only for an empty database." }, { status: 409 });
    return NextResponse.json({ seeded: await seed(c as never) });
  } catch (e) {
    await c.query("rollback").catch(() => {});
    console.error("[seed]", e);
    return NextResponse.json({ error: "Seed failed; see server logs." }, { status: 500 });
  } finally {
    c.release();
  }
}
