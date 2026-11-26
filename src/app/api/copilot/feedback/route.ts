import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { withSystem } from "@/lib/db";

const Body = z.object({ runId: z.string().uuid(), feedback: z.enum(["up", "down"]), note: z.string().max(1000).optional() });

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await withSystem((db) => db.query("update agent_runs set feedback=$2, feedback_note=$3 where id=$1 and user_id=$4", [b.data.runId, b.data.feedback, b.data.note ?? null, s.id]));
  return NextResponse.json({ ok: true });
}
